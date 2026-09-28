import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:token|secret|password|authorization|cookie|session|privatekey|clientsecret|apikey)$/i;
const SOURCE_KINDS=new Set(['transactional-read','analytic-projection']);

function fail(message){throw new Error(message);}

function cloneInert(value,path='value',seen=new WeakSet()){
  if(value===null||typeof value==='boolean'||typeof value==='string') return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return value;
  }
  if(!value||typeof value!=='object') fail(`${path} contains unsupported data`);
  if(seen.has(value)) fail(`${path} contains a cycle or shared executable shape`);
  seen.add(value);
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype) fail(`${path} must use a plain array`);
    const descriptors=Object.getOwnPropertyDescriptors(value);
    if(Object.keys(value).length!==value.length) fail(`${path} contains holes or hidden values`);
    return value.map((_,index)=>{
      const descriptor=descriptors[index];
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path} contains executable or hidden data`);
      return cloneInert(descriptor.value,`${path}[${index}]`,seen);
    });
  }
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null) fail(`${path} must be plain data`);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const copy={};
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string') fail(`${path} contains symbol data`);
    if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret or credential material`);
    const descriptor=descriptors[key];
    if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}.${key} contains executable or hidden data`);
    copy[key]=cloneInert(descriptor.value,`${path}.${key}`,seen);
  }
  return copy;
}

function deepFreeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value,allowed,path){
  if(!value||typeof value!=='object'||Array.isArray(value)) fail(`${path} must be an object`);
  for(const key of Object.keys(value)) if(!allowed.has(key)) fail(`${path}.${key} is not allowed`);
}

function text(value,name){
  if(typeof value!=='string'||!value.normalize('NFC').trim()||value.includes('\0')) fail(`${name} is required`);
  return value.normalize('NFC').trim();
}

function integer(value,name,{minimum=0}={}){
  if(!Number.isSafeInteger(value)||value<minimum) fail(`${name} must be a safe integer of at least ${minimum}`);
  return value;
}

function instant(value,name){
  const normalized=text(value,name);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)) fail(`${name} must be a real UTC ISO-8601 instant`);
  const parsed=Date.parse(normalized);
  const canonicalInstant=normalized.includes('.')?normalized:normalized.replace('Z','.000Z');
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==canonicalInstant) fail(`${name} must be a real UTC ISO-8601 instant`);
  return parsed;
}

function exactHttpsOrigin(value){
  const normalized=text(value,'apiOrigin');
  let url;
  try{url=new URL(normalized);}catch{fail('apiOrigin must be an exact HTTPS origin');}
  if(
    url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
    url.pathname!=='/'||normalized.includes('*')||url.origin!==normalized
  ) fail('apiOrigin must be an exact HTTPS origin');
  return url.origin.toLowerCase();
}

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}

function decimal(value,name){
  if(typeof value==='string'&&value.length>128) fail(`${name} exceeds the decimal length limit`);
  if(typeof value!=='string'||!/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value)){
    fail(`${name} must be a canonical non-negative decimal string`);
  }
  return value;
}

export function createManufacturingObservationAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  exactKeys(policy,new Set([
    'provider','wfmTenantId','connectionId','sourceInstanceId','plantId','apiOrigin','apiVersion',
    'dataset','sourceKind','schemaFingerprint','approvedMetrics','approvedResources','maxWindowSeconds',
    'maxLagSeconds','maxResources','maxObservations'
  ]),'policy');
  for(const field of [
    'provider','wfmTenantId','connectionId','sourceInstanceId','plantId','apiVersion','dataset',
    'sourceKind','schemaFingerprint'
  ]) policy[field]=text(policy[field],field);
  if(!SOURCE_KINDS.has(policy.sourceKind)) fail('sourceKind is not supported');
  policy.apiOrigin=exactHttpsOrigin(policy.apiOrigin);
  if(!Array.isArray(policy.approvedMetrics)||policy.approvedMetrics.length===0) fail('approvedMetrics must not be empty');
  const metricUnits=new Map();
  policy.approvedMetrics=policy.approvedMetrics.map((entry,index)=>{
    exactKeys(entry,new Set(['metric','unit']),`approvedMetrics[${index}]`);
    const metric=text(entry.metric,`approvedMetrics[${index}].metric`);
    const unit=text(entry.unit,`approvedMetrics[${index}].unit`);
    if(metricUnits.has(metric)) fail('approved metric names must be unique');
    metricUnits.set(metric,unit);
    return {metric,unit};
  }).sort((left,right)=>left.metric.localeCompare(right.metric));
  if(!Array.isArray(policy.approvedResources)||policy.approvedResources.length===0) fail('approvedResources must not be empty');
  policy.approvedResources=policy.approvedResources.map((value,index)=>text(value,`approvedResources[${index}]`)).sort();
  if(new Set(policy.approvedResources).size!==policy.approvedResources.length) fail('approvedResources must be unique');
  const approvedResources=new Set(policy.approvedResources);
  policy.maxWindowSeconds=integer(policy.maxWindowSeconds,'maxWindowSeconds',{minimum:1});
  policy.maxLagSeconds=integer(policy.maxLagSeconds,'maxLagSeconds');
  policy.maxResources=integer(policy.maxResources,'maxResources',{minimum:1});
  policy.maxObservations=integer(policy.maxObservations,'maxObservations',{minimum:1});
  deepFreeze(policy);

  const scope={
    provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,
    sourceInstanceId:policy.sourceInstanceId,plantId:policy.plantId,apiOrigin:policy.apiOrigin,
    apiVersion:policy.apiVersion,dataset:policy.dataset,sourceKind:policy.sourceKind,
    schemaFingerprint:policy.schemaFingerprint
  };
  const checkpointNamespace=`manufacturing-observation:${digest(scope)}`;

  function admitWindow(rawRun){
    const run=cloneInert(rawRun,'run');
    exactKeys(run,new Set([
      'provider','wfmTenantId','connectionId','sourceInstanceId','plantId','apiOrigin','apiVersion',
      'dataset','sourceKind','schemaFingerprint','windowStart','windowEnd','dataAvailableThrough',
      'observedAt','complete','observations'
    ]),'run');
    for(const field of [
      'provider','wfmTenantId','connectionId','sourceInstanceId','plantId','apiVersion','dataset',
      'sourceKind','schemaFingerprint'
    ]) same(run[field],policy[field],field);
    same(exactHttpsOrigin(run.apiOrigin),policy.apiOrigin,'apiOrigin');
    const windowStartMs=instant(run.windowStart,'windowStart');
    const windowEndMs=instant(run.windowEnd,'windowEnd');
    const dataAvailableThroughMs=instant(run.dataAvailableThrough,'dataAvailableThrough');
    const observedAtMs=instant(run.observedAt,'observedAt');
    if(windowEndMs<=windowStartMs) fail('window end must be after window start');
    if((windowEndMs-windowStartMs)/1000>policy.maxWindowSeconds) fail('window exceeds the approved window limit');
    if(windowEndMs>observedAtMs) fail('window end is after observation time');
    if(dataAvailableThroughMs>observedAtMs) fail('data available time is after observation time');
    if(run.complete!==true) fail('observation window is incomplete');
    if(!Array.isArray(run.observations)) fail('observations must be an array');
    if(run.observations.length>policy.maxObservations) fail('observation result exceeds the observation limit');

    const versions=new Map();
    const observations=[];
    const resources=new Set();
    let exactReplayCount=0;
    for(let index=0;index<run.observations.length;index++){
      const item=run.observations[index];
      exactKeys(item,new Set([
        'sourceId','sourceVersion','metric','value','unit','occurredAt','resourceId',
        'workCenterId','orderId','operationId','payloadDigest'
      ]),`observations[${index}]`);
      const sourceId=text(item.sourceId,`observations[${index}].sourceId`);
      const sourceVersion=text(item.sourceVersion,`observations[${index}].sourceVersion`);
      const metric=text(item.metric,`observations[${index}].metric`);
      const approvedUnit=metricUnits.get(metric);
      if(!approvedUnit) fail(`observations[${index}] metric is not approved`);
      const unit=text(item.unit,`observations[${index}].unit`);
      if(unit!==approvedUnit) fail(`observations[${index}] unit is not approved for its metric`);
      const value=decimal(item.value,`observations[${index}].value`);
      const occurredAt=text(item.occurredAt,`observations[${index}].occurredAt`);
      const occurredAtMs=instant(occurredAt,`observations[${index}].occurredAt`);
      if(occurredAtMs<windowStartMs||occurredAtMs>windowEndMs) fail(`observations[${index}] is outside the closed source window`);
      const resourceId=text(item.resourceId,`observations[${index}].resourceId`);
      if(!approvedResources.has(resourceId)) fail(`observations[${index}] resource is not approved`);
      resources.add(resourceId);
      if(resources.size>policy.maxResources) fail('observation result exceeds the resource limit');
      const normalized={
        sourceId,sourceVersion,metric,value,unit,occurredAt:new Date(occurredAtMs).toISOString(),
        resourceId,
        workCenterId:item.workCenterId===null?null:text(item.workCenterId,`observations[${index}].workCenterId`),
        orderId:item.orderId===null?null:text(item.orderId,`observations[${index}].orderId`),
        operationId:item.operationId===null?null:text(item.operationId,`observations[${index}].operationId`),
        payloadDigest:text(item.payloadDigest,`observations[${index}].payloadDigest`)
      };
      const identity=canonical([sourceId,sourceVersion,metric,resourceId]);
      const evidenceDigest=digest(normalized);
      const prior=versions.get(identity);
      if(prior!==undefined){
        if(prior!==evidenceDigest) fail('conflicting duplicate manufacturing observation is quarantined');
        exactReplayCount++;
        continue;
      }
      versions.set(identity,evidenceDigest);
      observations.push(normalized);
    }
    observations.sort((left,right)=>left.occurredAt.localeCompare(right.occurredAt)||left.sourceId.localeCompare(right.sourceId)||left.metric.localeCompare(right.metric));
    const freshnessSeconds=(observedAtMs-dataAvailableThroughMs)/1000;
    return deepFreeze({
      derivedObservationCandidate:policy.sourceKind==='analytic-projection',
      transactionalEvidenceCandidate:policy.sourceKind==='transactional-read',
      operationalDecisionAuthority:false,
      writeBackAuthority:false,
      payrollAuthority:false,
      causalClaimAuthority:false,
      checkpointAdvanceAllowed:false,
      deletionAuthority:false,
      ...scope,
      checkpointNamespace,
      windowStart:new Date(windowStartMs).toISOString(),
      windowEnd:new Date(windowEndMs).toISOString(),
      dataAvailableThrough:new Date(dataAvailableThroughMs).toISOString(),
      observedAt:new Date(observedAtMs).toISOString(),
      freshnessSeconds,
      stale:freshnessSeconds>policy.maxLagSeconds,
      reportedObservationCount:run.observations.length,
      uniqueObservationCount:observations.length,
      exactReplayCount,
      resourceCount:resources.size,
      observations,
      reconciliationFingerprint:`sha256:${digest({scope,windowStart:run.windowStart,windowEnd:run.windowEnd,dataAvailableThrough:run.dataAvailableThrough,observations})}`
    });
  }

  return Object.freeze({admitWindow});
}
