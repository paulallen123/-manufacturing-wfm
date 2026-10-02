import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:token|secret|password|authorization|cookie|session|privatekey|clientsecret|apikey)$/i;

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
    const length=descriptors.length.value;
    if(Reflect.ownKeys(descriptors).length!==length+1) fail(`${path} contains holes or hidden values`);
    const copy=[];
    for(let index=0;index<length;index++){
      const descriptor=descriptors[index];
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}[${index}] contains executable or hidden data`);
      copy.push(cloneInert(descriptor.value,`${path}[${index}]`,seen));
    }
    return copy;
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
  const normalized=value.normalize('NFC').trim();
  if(normalized.length>512) fail(`${name} exceeds the text length limit`);
  return normalized;
}

function integer(value,name,{minimum=0,maximum=Number.MAX_SAFE_INTEGER}={}){
  if(!Number.isSafeInteger(value)||value<minimum||value>maximum) fail(`${name} must be a safe integer from ${minimum} to ${maximum}`);
  return value;
}

function instant(value,name){
  const normalized=text(value,name);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)) fail(`${name} must be a real UTC ISO-8601 instant`);
  const canonical=normalized.includes('.')?normalized:normalized.replace('Z','.000Z');
  const parsed=Date.parse(normalized);
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==canonical) fail(`${name} must be a real UTC ISO-8601 instant`);
  return {ms:parsed,iso:canonical};
}

function localWall(value,name){
  const normalized=text(value,name);
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(normalized);
  if(!match) fail(`${name} must be a real local wall time without an offset`);
  const [,year,month,day,hour,minute,second]=match;
  const probe=new Date(Date.UTC(+year,+month-1,+day,+hour,+minute,+second));
  const expected=`${year}-${month}-${day}T${hour}:${minute}:${second}`;
  if(probe.toISOString().slice(0,19)!==expected) fail(`${name} must be a real local wall time without an offset`);
  return normalized;
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

function ianaZone(value){
  const normalized=text(value,'timeZone');
  try{
    const resolved=new Intl.DateTimeFormat('en',{timeZone:normalized}).resolvedOptions().timeZone;
    if(!resolved) fail('timeZone must be a valid IANA time zone');
  }catch{fail('timeZone must be a valid IANA time zone');}
  return normalized;
}

function zoneProjection(ms,timeZone){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone,calendar:'iso8601',numberingSystem:'latn',hourCycle:'h23',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'
  }).formatToParts(new Date(ms));
  const map={};
  for(const part of parts) if(part.type!=='literal') map[part.type]=part.value;
  const local=`${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`;
  const localAsUtc=Date.UTC(+map.year,+map.month-1,+map.day,+map.hour,+map.minute,+map.second);
  return {local,offsetMinutes:(localAsUtc-ms)/60000};
}

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}

export function createShiftTimeAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  exactKeys(policy,new Set([
    'provider','wfmTenantId','connectionId','sourcePortalId','siteId','departmentId','apiOrigin',
    'apiVersion','resource','schemaFingerprint','queryFingerprint','timeZone','maxWindowSeconds',
    'maxClockSkewSeconds','maxShiftSeconds','maxRecords'
  ]),'policy');
  for(const field of [
    'provider','wfmTenantId','connectionId','sourcePortalId','siteId','departmentId','apiVersion',
    'resource','schemaFingerprint','queryFingerprint'
  ]) policy[field]=text(policy[field],field);
  policy.apiOrigin=exactHttpsOrigin(policy.apiOrigin);
  policy.timeZone=ianaZone(policy.timeZone);
  policy.maxWindowSeconds=integer(policy.maxWindowSeconds,'maxWindowSeconds',{minimum:1});
  policy.maxClockSkewSeconds=integer(policy.maxClockSkewSeconds,'maxClockSkewSeconds');
  policy.maxShiftSeconds=integer(policy.maxShiftSeconds,'maxShiftSeconds',{minimum:1});
  policy.maxRecords=integer(policy.maxRecords,'maxRecords',{minimum:1});
  deepFreeze(policy);

  const scope={
    provider:policy.provider,wfmTenantId:policy.wfmTenantId,connectionId:policy.connectionId,
    sourcePortalId:policy.sourcePortalId,siteId:policy.siteId,departmentId:policy.departmentId,
    apiOrigin:policy.apiOrigin,apiVersion:policy.apiVersion,resource:policy.resource,
    schemaFingerprint:policy.schemaFingerprint,queryFingerprint:policy.queryFingerprint,timeZone:policy.timeZone
  };
  const checkpointNamespace=`shift-time:${digest(scope)}`;

  function admitBatch(rawBatch){
    const batch=cloneInert(rawBatch,'batch');
    exactKeys(batch,new Set([
      'provider','wfmTenantId','connectionId','sourcePortalId','siteId','departmentId','apiOrigin',
      'apiVersion','resource','schemaFingerprint','queryFingerprint','timeZone','windowStart','windowEnd',
      'observedAt','complete','paginationComplete','records'
    ]),'batch');
    for(const field of [
      'provider','wfmTenantId','connectionId','sourcePortalId','siteId','departmentId','apiVersion',
      'resource','schemaFingerprint','queryFingerprint','timeZone'
    ]) same(text(batch[field],field),policy[field],field);
    same(exactHttpsOrigin(batch.apiOrigin),policy.apiOrigin,'apiOrigin');

    const windowStart=instant(batch.windowStart,'windowStart');
    const windowEnd=instant(batch.windowEnd,'windowEnd');
    const observedAt=instant(batch.observedAt,'observedAt');
    if(windowEnd.ms<=windowStart.ms) fail('window end must be after window start');
    if((windowEnd.ms-windowStart.ms)/1000>policy.maxWindowSeconds) fail('window exceeds the approved window limit');
    if(windowEnd.ms>observedAt.ms+policy.maxClockSkewSeconds*1000) fail('window end exceeds observation clock-skew limit');
    if(batch.complete!==true) fail('shift batch is incomplete');
    if(batch.paginationComplete!==true) fail('shift batch pagination is incomplete');
    if(!Array.isArray(batch.records)) fail('records must be an array');
    if(batch.records.length>policy.maxRecords) fail('batch exceeds the record limit');

    const byVersion=new Map();
    const records=[];
    let exactReplayCount=0;
    for(let index=0;index<batch.records.length;index++){
      const item=batch.records[index];
      exactKeys(item,new Set([
        'shiftId','employeeId','localStart','localEnd','utcStart','utcEnd','startOffsetMinutes',
        'endOffsetMinutes','sourceVersion','payloadDigest'
      ]),`records[${index}]`);
      const shiftId=text(item.shiftId,`records[${index}].shiftId`);
      const employeeId=text(item.employeeId,`records[${index}].employeeId`);
      const localStart=localWall(item.localStart,`records[${index}].localStart`);
      const localEnd=localWall(item.localEnd,`records[${index}].localEnd`);
      const utcStart=instant(item.utcStart,`records[${index}].utcStart`);
      const utcEnd=instant(item.utcEnd,`records[${index}].utcEnd`);
      const startOffsetMinutes=integer(item.startOffsetMinutes,`records[${index}].startOffsetMinutes`,{minimum:-1440,maximum:1440});
      const endOffsetMinutes=integer(item.endOffsetMinutes,`records[${index}].endOffsetMinutes`,{minimum:-1440,maximum:1440});
      const startProjection=zoneProjection(utcStart.ms,policy.timeZone);
      const endProjection=zoneProjection(utcEnd.ms,policy.timeZone);
      if(startProjection.local!==localStart||startProjection.offsetMinutes!==startOffsetMinutes){
        fail(`records[${index}].localStart or startOffsetMinutes does not match the approved time zone`);
      }
      if(endProjection.local!==localEnd||endProjection.offsetMinutes!==endOffsetMinutes){
        fail(`records[${index}].localEnd or endOffsetMinutes does not match the approved time zone`);
      }
      if(utcEnd.ms<=utcStart.ms) fail(`records[${index}] shift end must be after start`);
      const elapsedSeconds=(utcEnd.ms-utcStart.ms)/1000;
      if(elapsedSeconds>policy.maxShiftSeconds) fail(`records[${index}] shift exceeds the approved shift limit`);
      if(utcStart.ms>=windowEnd.ms||utcEnd.ms<=windowStart.ms) fail(`records[${index}] is outside the approved window`);
      const sourceVersion=text(item.sourceVersion,`records[${index}].sourceVersion`);
      const payloadDigest=text(item.payloadDigest,`records[${index}].payloadDigest`);
      const normalized={
        shiftId,employeeId,scopedEmployeeFingerprint:`sha256:${digest({scope,employeeId})}`,
        localStart,localEnd,utcStart:utcStart.iso,utcEnd:utcEnd.iso,timeZone:policy.timeZone,
        startOffsetMinutes,endOffsetMinutes,elapsedSeconds,sourceVersion,payloadDigest
      };
      const versionKey=canonical([shiftId,sourceVersion]);
      const existing=byVersion.get(versionKey);
      if(existing){
        if(canonical(existing)!==canonical(normalized)) fail(`records[${index}] is a conflicting duplicate source version`);
        exactReplayCount++;
        continue;
      }
      byVersion.set(versionKey,normalized);
      records.push(normalized);
    }

    records.sort((left,right)=>Date.parse(left.utcStart)-Date.parse(right.utcStart)||left.shiftId.localeCompare(right.shiftId));
    const overlapConflicts=[];
    const byEmployee=new Map();
    for(const item of records){
      const list=byEmployee.get(item.employeeId)||[];
      list.push(item);
      byEmployee.set(item.employeeId,list);
    }
    for(const [employeeId,list] of byEmployee){
      for(let first=0;first<list.length;first++){
        const firstEnd=Date.parse(list[first].utcEnd);
        for(let second=first+1;second<list.length;second++){
          const secondStart=Date.parse(list[second].utcStart);
          if(secondStart>=firstEnd) break;
          const overlapMs=Math.min(firstEnd,Date.parse(list[second].utcEnd))-secondStart;
          if(overlapMs>0) overlapConflicts.push({
            employeeId,firstShiftId:list[first].shiftId,secondShiftId:list[second].shiftId,
            overlapSeconds:overlapMs/1000
          });
        }
      }
    }

    return deepFreeze({
      shiftTimeReconciliationCandidate:true,checkpointAdvanceAllowed:false,deletionAuthority:false,
      writeBackAuthority:false,payrollAuthority:false,attendanceAuthority:false,
      ...scope,checkpointNamespace,windowStart:windowStart.iso,windowEnd:windowEnd.iso,
      observedAt:observedAt.iso,reportedRecordCount:batch.records.length,uniqueRecordCount:records.length,
      exactReplayCount,overlapFree:overlapConflicts.length===0,overlapConflicts,records,
      reconciliationFingerprint:`sha256:${digest({scope,windowStart:windowStart.iso,windowEnd:windowEnd.iso,records,overlapConflicts})}`
    });
  }

  return Object.freeze({admitBatch});
}
