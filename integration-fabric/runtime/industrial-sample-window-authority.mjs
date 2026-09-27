import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:^|_)(?:password|passwd|secret|token|credential|authorization|cookie|api[_-]?key|client[_-]?secret)(?:$|_)|^(?:accessToken|refreshToken|sessionToken|clientSecret|apiKey)$/i;
function fail(message){throw new Error(message);}
function cloneInert(value,path='value',seen=new WeakSet()){
  if(value===null||['string','number','boolean'].includes(typeof value)) return value;
  if(typeof value!=='object') fail(`${path} contains executable or unsupported data`);
  if(seen.has(value)) fail(`${path} contains cyclic data`);seen.add(value);
  if(Array.isArray(value)){
    const copy=[];let count=0;
    for(const key of Reflect.ownKeys(value)){
      if(key==='length') continue;
      if(typeof key!=='string') fail(`${path} contains symbol data`);
      if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret or credential material`);
      if(!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=4294967295) fail(`${path}.${key} is not an array index`);
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}[${key}] contains executable or hidden data`);
      copy[key]=cloneInert(descriptor.value,`${path}[${key}]`,seen);count++;
    }
    if(count!==value.length) fail(`${path} contains sparse array data`);seen.delete(value);return copy;
  }
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null) fail(`${path} must be plain data`);
  const copy=Object.create(null);
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string') fail(`${path} contains symbol data`);
    if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret or credential material`);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}.${key} contains executable or hidden data`);
    copy[key]=cloneInert(descriptor.value,`${path}.${key}`,seen);
  }
  seen.delete(value);return copy;
}
function exactKeys(value,allowed,path){for(const key of Object.keys(value)) if(!allowed.has(key)) fail(`${path}.${key} is not allowed`);for(const key of allowed) if(!Object.hasOwn(value,key)) fail(`${path}.${key} is required`);}
function text(value,name){if(typeof value!=='string'||!value||value.trim()!==value||/[\u0000-\u001f\u007f]/.test(value)) fail(`${name} must be a non-empty clean string`);return value;}
function opaque(value,name){if(typeof value!=='string'||value.length===0) fail(`${name} must be a non-empty opaque string`);return value;}
function nullableOpaque(value,name){return value===null?null:opaque(value,name);}
function nullableBatchEntryId(value,name){if(value===null) return null;const result=text(value,name);if(!/^[A-Za-z0-9_-]{1,64}$/.test(result)) fail(`${name} must match the AWS batch entry ID pattern`);return result;}
function fingerprint(value,name){const result=text(value,name);if(!/^sha256:[a-f0-9]{64}$/.test(result)) fail(`${name} must be a canonical sha256 fingerprint`);return result;}
function nullableFingerprint(value,name){return value===null?null:fingerprint(value,name);}
function integer(value,name,{minimum=0,maximum=Number.MAX_SAFE_INTEGER}={}){if(!Number.isSafeInteger(value)||value<minimum||value>maximum) fail(`${name} must be an integer from ${minimum} to ${maximum}`);return value;}
function instant(value,name){const result=text(value,name);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result)) fail(`${name} must be a UTC instant`);const ms=Date.parse(result),canonical=result.includes('.')?result:result.replace('Z','.000Z');if(!Number.isFinite(ms)||new Date(ms).toISOString()!==canonical) fail(`${name} must be a real UTC instant`);return canonical;}
function timestamp(value,name){exactKeys(value,new Set(['seconds','offsetInNanos']),name);return {seconds:integer(value.seconds,`${name}.seconds`,{minimum:1}),offsetInNanos:integer(value.offsetInNanos,`${name}.offsetInNanos`,{maximum:999999999})};}
function compareTimestamp(left,right){return left.seconds-right.seconds||left.offsetInNanos-right.offsetInNanos;}
function providerStartBoundary(value){
  if(value.seconds<=1) fail('windowStart cannot be safely over-read through the SiteWise whole-second boundary');
  return {seconds:value.seconds-1,offsetInNanos:0};
}
const FIPS_DATA_REGIONS=new Set(['us-east-2','us-east-1','us-west-2','ca-central-1','us-gov-west-1']);
function exactOrigin(value,region,endpointVariant){
  const result=text(value,'dataPlaneOrigin');let parsed;try{parsed=new URL(result);}catch{fail('dataPlaneOrigin must be an exact regional HTTPS origin');}
  if(endpointVariant!=='standard'&&endpointVariant!=='fips') fail('endpointVariant must be standard or fips');
  if(endpointVariant==='fips'&&!FIPS_DATA_REGIONS.has(region)) fail('FIPS data endpoint is not documented for the approved region');
  const expectedHost=endpointVariant==='fips'?`data.iotsitewise-fips.${region}.amazonaws.com`:`data.iotsitewise.${region}.amazonaws.com`;
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.origin!==result||parsed.hostname!==expectedHost) fail('dataPlaneOrigin must be the exact documented regional SiteWise HTTPS origin without a custom port');
  return parsed.origin;
}
function canonical(value){if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;return JSON.stringify(value);}
function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}
function sameTimestamp(actual,expected,name){if(compareTimestamp(actual,expected)!==0) fail(`${name} does not match approved authority`);}
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value)) deepFreeze(child);Object.freeze(value);}return value;}

export function createIndustrialSampleWindowAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  const textScopeFields=['provider','wfmTenantId','connectionId','awsAccountId','awsRegion','endpointVariant','apiVersion','readOperation','siteId','assetId','propertyId','unit','sourceTimestampMode'];
  const scopeFields=[...textScopeFields,'batchEntryId','batchEntryCount'];
  const fingerprintFields=['principalFingerprint','iamPolicyFingerprint','queryFingerprint','schemaFingerprint'];
  exactKeys(policy,new Set([...scopeFields,'dataPlaneOrigin','edgeGatewayId','propertyAlias',...fingerprintFields,'expectedCheckpointPredecessor','windowStart','windowEnd','providerStartExclusive','providerEndInclusive','expectedObservedAt','maxPages','maxSamples']),'policy');
  for(const field of textScopeFields) policy[field]=text(policy[field],field);
  if(!/^\d{12}$/.test(policy.awsAccountId)) fail('awsAccountId must be a 12-digit AWS account');
  if(!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(policy.awsRegion)) fail('awsRegion must be an exact AWS region');
  policy.dataPlaneOrigin=exactOrigin(policy.dataPlaneOrigin,policy.awsRegion,policy.endpointVariant);
  if(policy.readOperation!=='GetAssetPropertyValueHistory'&&policy.readOperation!=='BatchGetAssetPropertyValueHistory') fail('only exact read history operations are allowed');
  policy.batchEntryId=nullableBatchEntryId(policy.batchEntryId,'batchEntryId');
  policy.batchEntryCount=policy.batchEntryCount===null?null:integer(policy.batchEntryCount,'batchEntryCount',{minimum:1,maximum:16});
  if(policy.readOperation==='BatchGetAssetPropertyValueHistory'&&policy.batchEntryId===null) fail('BatchGet history requires an exact batch entry id');
  if(policy.readOperation==='BatchGetAssetPropertyValueHistory'&&policy.batchEntryCount!==1) fail('BatchGet history authority currently requires exactly one batch entry');
  if(policy.readOperation==='GetAssetPropertyValueHistory'&&(policy.batchEntryId!==null||policy.batchEntryCount!==null)) fail('Get history must not carry batch entry authority');
  if(!['device','server'].includes(policy.sourceTimestampMode)) fail('sourceTimestampMode must be device or server');
  policy.edgeGatewayId=nullableOpaque(policy.edgeGatewayId,'edgeGatewayId');policy.propertyAlias=nullableOpaque(policy.propertyAlias,'propertyAlias');
  for(const field of fingerprintFields) policy[field]=fingerprint(policy[field],field);
  policy.expectedCheckpointPredecessor=text(policy.expectedCheckpointPredecessor,'expectedCheckpointPredecessor');
  policy.windowStart=timestamp(policy.windowStart,'windowStart');policy.windowEnd=timestamp(policy.windowEnd,'windowEnd');
  if(compareTimestamp(policy.windowStart,policy.windowEnd)>=0) fail('sample window must be non-empty');
  policy.providerStartExclusive=timestamp(policy.providerStartExclusive,'providerStartExclusive');policy.providerEndInclusive=timestamp(policy.providerEndInclusive,'providerEndInclusive');
  sameTimestamp(policy.providerStartExclusive,providerStartBoundary(policy.windowStart),'provider exclusive-start boundary');
  sameTimestamp(policy.providerEndInclusive,{seconds:policy.windowEnd.seconds,offsetInNanos:0},'provider inclusive-end boundary');
  policy.expectedObservedAt=instant(policy.expectedObservedAt,'expectedObservedAt');
  policy.maxPages=integer(policy.maxPages,'maxPages',{minimum:1});policy.maxSamples=integer(policy.maxSamples,'maxSamples',{minimum:1});deepFreeze(policy);

  const scope=Object.fromEntries(scopeFields.map(field=>[field,policy[field]]));
  Object.assign(scope,{dataPlaneOrigin:policy.dataPlaneOrigin,edgeGatewayId:policy.edgeGatewayId,propertyAlias:policy.propertyAlias,...Object.fromEntries(fingerprintFields.map(field=>[field,policy[field]]))});
  const checkpointNamespace=`industrial-sample-window:${digest(scope)}`;

  function admit(rawReceipt){
    const receipt=cloneInert(rawReceipt,'receipt');
    exactKeys(receipt,new Set([...scopeFields,'dataPlaneOrigin','edgeGatewayId','propertyAlias',...fingerprintFields,'checkpointPredecessor','windowStart','windowEnd','providerStartExclusive','providerEndInclusive','observedAt','complete','terminal','skippedEntries','errorEntries','pages']),'receipt');
    for(const field of textScopeFields) same(text(receipt[field],field),policy[field],field);
    same(nullableBatchEntryId(receipt.batchEntryId,'batchEntryId'),policy.batchEntryId,'batch entry id');
    const receiptBatchEntryCount=receipt.batchEntryCount===null?null:integer(receipt.batchEntryCount,'batchEntryCount',{minimum:1,maximum:16});
    same(receiptBatchEntryCount,policy.batchEntryCount,'batch entry count');
    same(exactOrigin(receipt.dataPlaneOrigin,receipt.awsRegion,receipt.endpointVariant),policy.dataPlaneOrigin,'data plane origin');
    same(nullableOpaque(receipt.edgeGatewayId,'edgeGatewayId'),policy.edgeGatewayId,'edge gateway');same(nullableOpaque(receipt.propertyAlias,'propertyAlias'),policy.propertyAlias,'property alias');
    for(const field of fingerprintFields) same(fingerprint(receipt[field],field),policy[field],field.replace('Fingerprint',' fingerprint'));
    same(text(receipt.checkpointPredecessor,'checkpointPredecessor'),policy.expectedCheckpointPredecessor,'checkpoint predecessor');
    sameTimestamp(timestamp(receipt.windowStart,'windowStart'),policy.windowStart,'window start');sameTimestamp(timestamp(receipt.windowEnd,'windowEnd'),policy.windowEnd,'window end');
    sameTimestamp(timestamp(receipt.providerStartExclusive,'providerStartExclusive'),policy.providerStartExclusive,'provider exclusive-start boundary');
    sameTimestamp(timestamp(receipt.providerEndInclusive,'providerEndInclusive'),policy.providerEndInclusive,'provider inclusive-end boundary');
    same(instant(receipt.observedAt,'observedAt'),policy.expectedObservedAt,'observation horizon');
    if(receipt.complete!==true) fail('sample window is incomplete');if(receipt.terminal!==true) fail('sample window is not terminal');
    if(!Array.isArray(receipt.skippedEntries)||receipt.skippedEntries.length) fail('skipped entries make the batch partial');
    if(!Array.isArray(receipt.errorEntries)||receipt.errorEntries.length) fail('error entries make the batch partial');
    if(!Array.isArray(receipt.pages)||receipt.pages.length===0||receipt.pages.length>policy.maxPages) fail('pages exceed the page limit or are missing');

    const byTimestamp=new Map(),samples=[];const qualityCounts={GOOD:0,UNCERTAIN:0,BAD:0};let exactReplayCount=0,totalSamples=0;
    let expectedRequestToken=null;const seenTokens=new Set();
    for(let pageOffset=0;pageOffset<receipt.pages.length;pageOffset++){
      const page=receipt.pages[pageOffset],path=`pages[${pageOffset}]`;
      exactKeys(page,new Set(['pageIndex','entryId','requestTokenDigest','nextTokenDigest','successful','samples']),path);
      if(integer(page.pageIndex,`${path}.pageIndex`)!==pageOffset) fail(`${path} creates a page gap or reorder`);
      same(nullableBatchEntryId(page.entryId,`${path}.entryId`),policy.batchEntryId,'batch success entry id');
      const requestToken=nullableFingerprint(page.requestTokenDigest,`${path}.requestTokenDigest`),nextToken=nullableFingerprint(page.nextTokenDigest,`${path}.nextTokenDigest`);
      same(requestToken,expectedRequestToken,'request token');if(page.successful!==true) fail(`${path} failed`);
      const isLast=pageOffset===receipt.pages.length-1;
      if(isLast&&nextToken!==null) fail('terminal page must not return a next token');if(!isLast&&nextToken===null) fail('non-terminal page must return a next token');
      if(nextToken!==null){if(seenTokens.has(nextToken)) fail('page token loop detected');seenTokens.add(nextToken);}expectedRequestToken=nextToken;
      if(!Array.isArray(page.samples)) fail(`${path}.samples must be an array`);totalSamples+=page.samples.length;if(totalSamples>policy.maxSamples) fail('samples exceed the sample limit');
      for(let sampleOffset=0;sampleOffset<page.samples.length;sampleOffset++){
        const raw=page.samples[sampleOffset],samplePath=`${path}.samples[${sampleOffset}]`;
        exactKeys(raw,new Set(['sourceTimestamp','ingestedAt','quality','valueType','nullValueType','valueDigest']),samplePath);
        const sourceTimestamp=timestamp(raw.sourceTimestamp,`${samplePath}.sourceTimestamp`);
        if(compareTimestamp(sourceTimestamp,policy.windowStart)<0||compareTimestamp(sourceTimestamp,policy.windowEnd)>=0) fail(`${samplePath} is outside the exact sample window`);
        const ingestedAt=instant(raw.ingestedAt,`${samplePath}.ingestedAt`);if(ingestedAt>policy.expectedObservedAt) fail(`${samplePath} ingestion is after the observation horizon`);
        const quality=text(raw.quality,`${samplePath}.quality`);if(!Object.hasOwn(qualityCounts,quality)) fail(`${samplePath}.quality is not documented`);
        const valueType=text(raw.valueType,`${samplePath}.valueType`);if(!['boolean','double','integer','string','null'].includes(valueType)) fail(`${samplePath}.valueType is unsupported`);
        const nullValueType=raw.nullValueType===null?null:text(raw.nullValueType,`${samplePath}.nullValueType`);
        if(valueType==='null'){
          if(!['B','D','S','I','U'].includes(nullValueType)) fail(`${samplePath}.nullValueType is unsupported`);
          if(quality==='GOOD') fail(`${samplePath} null value cannot have GOOD quality`);
        }else if(nullValueType!==null) fail(`${samplePath} non-null value must not carry a null value type`);
        const valueDigest=fingerprint(raw.valueDigest,`${samplePath}.valueDigest`);
        const normalized={sourceTimestamp,ingestedAt,quality,valueType,nullValueType,valueDigest};
        normalized.scopedSampleFingerprint=`sha256:${digest({scope,sourceTimestamp})}`;
        const identity=`${sourceTimestamp.seconds}:${sourceTimestamp.offsetInNanos}`;const prior=byTimestamp.get(identity);
        if(prior){if(canonical(prior)!==canonical(normalized)) fail(`${samplePath} is a conflicting value at one source timestamp`);exactReplayCount++;continue;}
        byTimestamp.set(identity,normalized);samples.push(normalized);qualityCounts[quality]++;
      }
    }
    samples.sort((a,b)=>compareTimestamp(a.sourceTimestamp,b.sourceTimestamp));
    const decision={sampleWindowReconciliationCandidate:true,checkpointAdvanceAllowed:false,deletionAuthority:false,operationalDecisionAuthority:false,causalClaimAuthority:false,writeBackAuthority:false,payrollAuthority:false,attendanceAuthority:false,...scope,checkpointNamespace,checkpointPredecessor:policy.expectedCheckpointPredecessor,windowStart:policy.windowStart,windowEnd:policy.windowEnd,providerStartExclusive:policy.providerStartExclusive,providerEndInclusive:policy.providerEndInclusive,observedAt:policy.expectedObservedAt,pageCount:receipt.pages.length,reportedSampleCount:totalSamples,uniqueSampleCount:samples.length,exactReplayCount,qualityCounts,samples};
    decision.reconciliationFingerprint=`sha256:${digest(decision)}`;return deepFreeze(decision);
  }
  return Object.freeze({admit});
}
