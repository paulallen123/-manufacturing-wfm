import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:^|_)(?:password|passwd|secret|token|credential|authorization|cookie|api[_-]?key|client[_-]?secret)(?:$|_)/i;
function fail(message){throw new Error(message);}

function cloneInert(value,path='value',seen=new WeakSet()){
  if(value===null||['string','number','boolean'].includes(typeof value)) return value;
  if(typeof value!=='object') fail(`${path} contains executable or unsupported data`);
  if(seen.has(value)) fail(`${path} contains cyclic data`);
  seen.add(value);
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
    if(count!==value.length) fail(`${path} contains sparse array data`);
    seen.delete(value);return copy;
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

function exactKeys(value,allowed,path){
  for(const key of Object.keys(value)) if(!allowed.has(key)) fail(`${path}.${key} is not allowed`);
  for(const key of allowed) if(!Object.hasOwn(value,key)) fail(`${path}.${key} is required`);
}
function text(value,name){if(typeof value!=='string'||!value||value.trim()!==value) fail(`${name} must be a non-empty string without surrounding whitespace`);return value;}
function opaque(value,name){if(typeof value!=='string'||value.length===0) fail(`${name} must be a non-empty opaque string`);return value;}
function fingerprint(value,name){const result=text(value,name);if(!/^sha256:[a-f0-9]{64}$/.test(result)) fail(`${name} must be a canonical sha256 fingerprint`);return result;}
function integer(value,name,minimum){if(!Number.isSafeInteger(value)||value<minimum) fail(`${name} must be an integer of at least ${minimum}`);return value;}
function instant(value,name){
  const result=text(value,name);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result)) fail(`${name} must be a UTC instant`);
  const milliseconds=Date.parse(result);const canonical=result.includes('.')?result:result.replace('Z','.000Z');
  if(!Number.isFinite(milliseconds)||new Date(milliseconds).toISOString()!==canonical) fail(`${name} must be a real UTC instant`);
  return canonical;
}
function exactOrigin(value){
  const result=text(value,'apiOrigin');let parsed;
  try{parsed=new URL(result);}catch{fail('apiOrigin must be an exact HTTPS origin');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.origin!==result||result.includes('*')) fail('apiOrigin must be an exact HTTPS origin');
  return parsed.origin.toLowerCase();
}
function exactRoute(value){
  const result=text(value,'snapshotRoute');
  if(!result.startsWith('/')||result.includes('*')||result.includes('?')||result.includes('#')||result.includes('%')||result.includes('\\')||result.includes('//')||/\s|[\u0000-\u001f\u007f]/.test(result)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(result)) fail('snapshotRoute must be an exact safe read path');
  return result;
}
function canonical(value){if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;return JSON.stringify(value);}
function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value)) deepFreeze(child);Object.freeze(value);}return value;}
function uniqueOpaqueList(values,name,maximum){
  if(!Array.isArray(values)||values.length>maximum) fail(`${name} exceeds the limit or is not an array`);
  const output=[];const seen=new Set();
  for(let i=0;i<values.length;i++){const value=opaque(values[i],`${name}[${i}]`);if(seen.has(value)) fail(`${name} contains a duplicate event identity`);seen.add(value);output.push(value);}
  return output;
}

export function createEventSnapshotRecoveryAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  const scopeFields=['provider','wfmTenantId','connectionId','sourceTenantId','apiVersion','facilityId','warehouseId','ownerId','resource','eventTopic'];
  const fingerprintFields=['queryFingerprint','eventSchemaFingerprint','snapshotSchemaFingerprint'];
  exactKeys(policy,new Set([...scopeFields,'apiOrigin','snapshotRoute',...fingerprintFields,'expectedCheckpointPredecessor','windowStart','windowEnd','maxHints','maxRecords']),'policy');
  for(const field of scopeFields) policy[field]=text(policy[field],field);
  policy.apiOrigin=exactOrigin(policy.apiOrigin);policy.snapshotRoute=exactRoute(policy.snapshotRoute);
  for(const field of fingerprintFields) policy[field]=fingerprint(policy[field],field);
  policy.expectedCheckpointPredecessor=text(policy.expectedCheckpointPredecessor,'expectedCheckpointPredecessor');
  policy.windowStart=instant(policy.windowStart,'windowStart');policy.windowEnd=instant(policy.windowEnd,'windowEnd');
  if(policy.windowStart>=policy.windowEnd) fail('recovery window must be a non-empty closed interval');
  policy.maxHints=integer(policy.maxHints,'maxHints',1);policy.maxRecords=integer(policy.maxRecords,'maxRecords',1);deepFreeze(policy);

  const scope=Object.fromEntries(scopeFields.map(field=>[field,policy[field]]));
  Object.assign(scope,{apiOrigin:policy.apiOrigin,snapshotRoute:policy.snapshotRoute,...Object.fromEntries(fingerprintFields.map(field=>[field,policy[field]]))});
  const checkpointNamespace=`event-snapshot-recovery:${digest(scope)}`;

  function admit(rawReceipt){
    const receipt=cloneInert(rawReceipt,'receipt');
    exactKeys(receipt,new Set([...scopeFields,'apiOrigin','snapshotRoute',...fingerprintFields,'checkpointPredecessor','coveredFrom','coveredTo','observedAt','eventGapDetected','failedEventIds','recoveredEventIds','snapshotSuccessful','snapshotComplete','terminalPage','hints','records']),'receipt');
    for(const field of scopeFields) same(text(receipt[field],field),policy[field],field);
    same(exactOrigin(receipt.apiOrigin),policy.apiOrigin,'api origin');same(exactRoute(receipt.snapshotRoute),policy.snapshotRoute,'snapshot route');
    for(const field of fingerprintFields) same(fingerprint(receipt[field],field),policy[field],field.replace('Fingerprint',' fingerprint'));
    same(text(receipt.checkpointPredecessor,'checkpointPredecessor'),policy.expectedCheckpointPredecessor,'checkpoint predecessor');
    same(instant(receipt.coveredFrom,'coveredFrom'),policy.windowStart,'recovery window start');same(instant(receipt.coveredTo,'coveredTo'),policy.windowEnd,'recovery window end');
    same(instant(receipt.observedAt,'observedAt'),policy.windowEnd,'observation horizon');
    if(receipt.eventGapDetected!==true) fail('event gap detection must be explicit');
    if(receipt.snapshotSuccessful!==true) fail('recovery snapshot failed');
    if(receipt.snapshotComplete!==true) fail('recovery snapshot is incomplete');
    if(receipt.terminalPage!==true) fail('recovery snapshot did not reach a terminal page');
    const failedEventIds=uniqueOpaqueList(receipt.failedEventIds,'failedEventIds',policy.maxHints);
    const recoveredEventIds=uniqueOpaqueList(receipt.recoveredEventIds,'recoveredEventIds',policy.maxHints);
    if(failedEventIds.length===0) fail('at least one failed event is required for recovery admission');
    const recoveredSet=new Set(recoveredEventIds);
    if(recoveredEventIds.length!==failedEventIds.length||failedEventIds.some(id=>!recoveredSet.has(id))) fail('every failed event must be explicitly recovered with no extra recovery claim');
    if(!Array.isArray(receipt.hints)||receipt.hints.length>policy.maxHints) fail('hints exceed the limit or are not an array');
    if(!Array.isArray(receipt.records)||receipt.records.length>policy.maxRecords) fail('records exceed the limit or are not an array');

    const hintsByEvent=new Map();let exactHintReplayCount=0;
    for(let i=0;i<receipt.hints.length;i++){
      const hint=receipt.hints[i],path=`hints[${i}]`;
      exactKeys(hint,new Set(['eventId','sourceId','sourceVersion','payloadDigest','occurredAt']),path);
      const normalized={eventId:opaque(hint.eventId,`${path}.eventId`),sourceId:opaque(hint.sourceId,`${path}.sourceId`),sourceVersion:opaque(hint.sourceVersion,`${path}.sourceVersion`),payloadDigest:fingerprint(hint.payloadDigest,`${path}.payloadDigest`),occurredAt:instant(hint.occurredAt,`${path}.occurredAt`)};
      if(normalized.occurredAt<policy.windowStart||normalized.occurredAt>policy.windowEnd) fail(`${path} is outside the recovery window`);
      const prior=hintsByEvent.get(normalized.eventId);
      if(prior){if(canonical(prior)!==canonical(normalized)) fail(`${path} is a conflicting event replay`);exactHintReplayCount++;continue;}
      hintsByEvent.set(normalized.eventId,normalized);
    }
    for(const eventId of failedEventIds) if(!hintsByEvent.has(eventId)) fail(`failed event ${eventId} has no recovery hint`);

    const recordsByVersion=new Map();const records=[];let exactRecordReplayCount=0;
    for(let i=0;i<receipt.records.length;i++){
      const record=receipt.records[i],path=`records[${i}]`;
      exactKeys(record,new Set(['sourceId','sourceVersion','payloadDigest']),path);
      const normalized={sourceId:opaque(record.sourceId,`${path}.sourceId`),sourceVersion:opaque(record.sourceVersion,`${path}.sourceVersion`),payloadDigest:fingerprint(record.payloadDigest,`${path}.payloadDigest`)};
      const identity=digest({sourceId:normalized.sourceId,sourceVersion:normalized.sourceVersion});const prior=recordsByVersion.get(identity);
      if(prior){if(prior.payloadDigest!==normalized.payloadDigest) fail(`${path} is a conflicting snapshot version`);exactRecordReplayCount++;continue;}
      normalized.scopedRecordFingerprint=`sha256:${digest({scope,sourceId:normalized.sourceId,sourceVersion:normalized.sourceVersion})}`;
      recordsByVersion.set(identity,normalized);records.push(normalized);
    }
    for(const eventId of failedEventIds){
      const hint=hintsByEvent.get(eventId);const identity=digest({sourceId:hint.sourceId,sourceVersion:hint.sourceVersion});const record=recordsByVersion.get(identity);
      if(!record||record.payloadDigest!==hint.payloadDigest) fail(`failed event ${eventId} was not recovered by the exact snapshot version`);
    }
    records.sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:a.sourceVersion<b.sourceVersion?-1:a.sourceVersion>b.sourceVersion?1:0);
    const recoveryHints=failedEventIds.map(eventId=>({...hintsByEvent.get(eventId)})).sort((a,b)=>a.eventId<b.eventId?-1:a.eventId>b.eventId?1:0);
    const decision={recoveryReconciliationCandidate:true,checkpointAdvanceAllowed:false,deletionAuthority:false,writeBackAuthority:false,payrollAuthority:false,attendanceAuthority:false,...scope,checkpointNamespace,checkpointPredecessor:policy.expectedCheckpointPredecessor,windowStart:policy.windowStart,windowEnd:policy.windowEnd,recoveredFailureCount:failedEventIds.length,recoveredEventIds:[...recoveredEventIds].sort(),uniqueHintCount:hintsByEvent.size,uniqueRecordVersionCount:records.length,exactHintReplayCount,exactRecordReplayCount,recoveryHints,records};
    decision.reconciliationFingerprint=`sha256:${digest(decision)}`;return deepFreeze(decision);
  }
  return Object.freeze({admit});
}
