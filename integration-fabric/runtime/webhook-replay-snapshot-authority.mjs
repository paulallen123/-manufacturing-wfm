import {createHash} from 'node:crypto';

const SECRET_KEY=/(?:^|_)(?:password|passwd|secret|token|credential|authorization|cookie|api[_-]?key|client[_-]?secret)(?:$|_)/i;
const encoder=new TextEncoder();
const DAY_MS=24*60*60*1000;
function fail(message){throw new Error(message);}

function cloneInert(value,path='value',seen=new WeakSet()){
  if(value===null||['string','number','boolean'].includes(typeof value)) return value;
  if(typeof value!=='object') fail(`${path} contains executable or unsupported data`);
  if(seen.has(value)) fail(`${path} contains cyclic data`);
  seen.add(value);
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype) fail(`${path} must use a plain array`);
    const output=[];let count=0;
    for(const key of Reflect.ownKeys(value)){
      if(key==='length') continue;
      if(typeof key!=='string') fail(`${path} contains symbol data`);
      if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret material`);
      if(!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=4294967295) fail(`${path}.${key} is not an array index`);
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}[${key}] contains executable or hidden data`);
      output[key]=cloneInert(descriptor.value,`${path}[${key}]`,seen);count++;
    }
    if(count!==value.length) fail(`${path} contains sparse array data`);
    seen.delete(value);return output;
  }
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null) fail(`${path} must be plain data`);
  const output=Object.create(null);
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string') fail(`${path} contains symbol data`);
    if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret material`);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}.${key} contains executable or hidden data`);
    output[key]=cloneInert(descriptor.value,`${path}.${key}`,seen);
  }
  seen.delete(value);return output;
}

function exactKeys(value,allowed,path){
  if(!value||typeof value!=='object'||Array.isArray(value)) fail(`${path} must be an object`);
  for(const key of Object.keys(value)) if(!allowed.has(key)) fail(`${path}.${key} is not allowed`);
  for(const key of allowed) if(!Object.hasOwn(value,key)) fail(`${path}.${key} is required`);
}
function text(value,name,maxBytes){
  if(typeof value!=='string'||value.length===0||value.trim()!==value||value.includes('\0')) fail(`${name} must be a non-empty string without surrounding whitespace`);
  if(encoder.encode(value).byteLength>maxBytes) fail(`${name} exceeds the text byte limit`);
  return value;
}
function integer(value,name,{minimum=0,maximum=Number.MAX_SAFE_INTEGER}={}){
  if(!Number.isSafeInteger(value)||value<minimum||value>maximum) fail(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}
function fingerprint(value,name,maxBytes){
  const result=text(value,name,maxBytes);
  if(!/^sha256:[a-f0-9]{64}$/.test(result)) fail(`${name} must be a canonical sha256 fingerprint`);
  return result;
}
function instant(value,name,maxBytes){
  const source=text(value,name,maxBytes);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(source)) fail(`${name} must be a real UTC instant`);
  const milliseconds=Date.parse(source);const canonical=source.includes('.')?source:source.replace('Z','.000Z');
  if(!Number.isFinite(milliseconds)||new Date(milliseconds).toISOString()!==canonical) fail(`${name} must be a real UTC instant`);
  return {source,canonical,milliseconds};
}
function exactOrigin(value,maxBytes){
  const source=text(value,'apiOrigin',maxBytes);let parsed;
  try{parsed=new URL(source);}catch{fail('apiOrigin must be an exact HTTPS origin');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.origin!==source||source.includes('*')) fail('apiOrigin must be an exact HTTPS origin');
  return parsed.origin.toLowerCase();
}
function exactRoute(value,name,maxBytes,{template=false}={}){
  const source=text(value,name,maxBytes);
  if(!source.startsWith('/')||source.includes('*')||source.includes('?')||source.includes('#')||source.includes('%')||source.includes('\\')||source.includes('//')||/\s|[\u0000-\u001f\u007f]/.test(source)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(source)) fail(`${name} must be an exact safe read path`);
  const normalized=template?source.replace('{replayId}','replay-id'):source;
  if(normalized.includes('{')||normalized.includes('}')) fail(`${name} has an unsupported route template`);
  return source;
}
function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match approved authority`);}
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value)) deepFreeze(child);Object.freeze(value);}return value;}

export function createWebhookReplaySnapshotAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  const scopeFields=['provider','wfmTenantId','connectionId','sourceTenantId','subscriptionId','region','apiVersion'];
  const fingerprintFields=['principalFingerprint','hmacKeyRevisionFingerprint','eventSchemaFingerprint','snapshotSchemaFingerprint','queryFingerprint'];
  exactKeys(policy,new Set([
    ...scopeFields,'apiOrigin','replayRoute','auditRoute','snapshotRoute','eventAliases',...fingerprintFields,
    'expectedCheckpointPredecessor','windowStart','windowEnd','expectedObservedAt','retentionDays','pageCount',
    'maxAuditPages','maxMessages','maxRecords','maxTextBytes'
  ]),'policy');
  policy.maxTextBytes=integer(policy.maxTextBytes,'maxTextBytes',{minimum:64,maximum:65536});
  for(const field of scopeFields) policy[field]=text(policy[field],field,policy.maxTextBytes);
  policy.apiOrigin=exactOrigin(policy.apiOrigin,policy.maxTextBytes);
  policy.replayRoute=exactRoute(policy.replayRoute,'replayRoute',policy.maxTextBytes);
  policy.auditRoute=exactRoute(policy.auditRoute,'auditRoute',policy.maxTextBytes,{template:true});
  policy.snapshotRoute=exactRoute(policy.snapshotRoute,'snapshotRoute',policy.maxTextBytes);
  for(const field of fingerprintFields) policy[field]=fingerprint(policy[field],field,policy.maxTextBytes);
  policy.expectedCheckpointPredecessor=text(policy.expectedCheckpointPredecessor,'expectedCheckpointPredecessor',policy.maxTextBytes);
  if(!Array.isArray(policy.eventAliases)||policy.eventAliases.length===0) fail('eventAliases must contain at least one alias');
  policy.eventAliases=policy.eventAliases.map((value,index)=>text(value,`eventAliases[${index}]`,policy.maxTextBytes)).sort();
  if(new Set(policy.eventAliases).size!==policy.eventAliases.length) fail('eventAliases must be unique');
  const windowStart=instant(policy.windowStart,'windowStart',policy.maxTextBytes);
  const windowEnd=instant(policy.windowEnd,'windowEnd',policy.maxTextBytes);
  const observedAt=instant(policy.expectedObservedAt,'expectedObservedAt',policy.maxTextBytes);
  policy.windowStart=windowStart.canonical;policy.windowEnd=windowEnd.canonical;policy.expectedObservedAt=observedAt.canonical;
  if(windowEnd.milliseconds<=windowStart.milliseconds||windowEnd.milliseconds-windowStart.milliseconds>=DAY_MS) fail('replay window must be non-empty and less than 24 hours');
  if(observedAt.milliseconds<windowEnd.milliseconds) fail('observation horizon must not precede the replay window');
  policy.retentionDays=integer(policy.retentionDays,'retentionDays',{minimum:1,maximum:14});
  if(policy.retentionDays!==14) fail('retentionDays must match the documented 14-day retention');
  if(observedAt.milliseconds-windowStart.milliseconds>policy.retentionDays*DAY_MS) fail('replay window exceeds provider retention');
  policy.pageCount=integer(policy.pageCount,'pageCount',{minimum:1,maximum:1000});
  policy.maxAuditPages=integer(policy.maxAuditPages,'maxAuditPages',{minimum:1,maximum:10000});
  policy.maxMessages=integer(policy.maxMessages,'maxMessages',{minimum:1,maximum:1000000});
  policy.maxRecords=integer(policy.maxRecords,'maxRecords',{minimum:1,maximum:1000000});
  deepFreeze(policy);

  const scope={...Object.fromEntries(scopeFields.map(field=>[field,policy[field]])),apiOrigin:policy.apiOrigin,
    replayRoute:policy.replayRoute,auditRoute:policy.auditRoute,snapshotRoute:policy.snapshotRoute,eventAliases:policy.eventAliases,
    ...Object.fromEntries(fingerprintFields.map(field=>[field,policy[field]]))};
  const caps={retentionDays:policy.retentionDays,pageCount:policy.pageCount,maxAuditPages:policy.maxAuditPages,
    maxMessages:policy.maxMessages,maxRecords:policy.maxRecords,maxTextBytes:policy.maxTextBytes};
  const authorityFingerprint=`sha256:${digest({scope,caps,windowStart:policy.windowStart,windowEnd:policy.windowEnd,observedAt:policy.expectedObservedAt})}`;
  const checkpointNamespace=`webhook-replay-snapshot:${digest(scope)}`;

  function admit(rawReceipt){
    const receipt=cloneInert(rawReceipt,'receipt');
    exactKeys(receipt,new Set([
      ...scopeFields,'apiOrigin','replayRoute','auditRoute','snapshotRoute','eventAliases',...fingerprintFields,
      'checkpointPredecessor','observedAt','replayRequest','auditPages','deliveries','fallbackSnapshot'
    ]),'receipt');
    for(const field of scopeFields) same(text(receipt[field],field,policy.maxTextBytes),policy[field],field);
    same(exactOrigin(receipt.apiOrigin,policy.maxTextBytes),policy.apiOrigin,'api origin');
    same(exactRoute(receipt.replayRoute,'replayRoute',policy.maxTextBytes),policy.replayRoute,'replay route');
    same(exactRoute(receipt.auditRoute,'auditRoute',policy.maxTextBytes,{template:true}),policy.auditRoute,'audit route');
    same(exactRoute(receipt.snapshotRoute,'snapshotRoute',policy.maxTextBytes),policy.snapshotRoute,'snapshot route');
    for(const field of fingerprintFields) same(fingerprint(receipt[field],field,policy.maxTextBytes),policy[field],field);
    if(!Array.isArray(receipt.eventAliases)) fail('eventAliases must be an array');
    const receiptAliases=receipt.eventAliases.map((value,index)=>text(value,`eventAliases[${index}]`,policy.maxTextBytes)).sort();
    same(canonical(receiptAliases),canonical(policy.eventAliases),'event aliases');
    same(text(receipt.checkpointPredecessor,'checkpointPredecessor',policy.maxTextBytes),policy.expectedCheckpointPredecessor,'checkpoint predecessor');
    const observedAt=instant(receipt.observedAt,'observedAt',policy.maxTextBytes);
    same(observedAt.canonical,policy.expectedObservedAt,'observation horizon');
    const policyStart=instant(policy.windowStart,'policy.windowStart',policy.maxTextBytes);
    const policyEnd=instant(policy.windowEnd,'policy.windowEnd',policy.maxTextBytes);
    if(observedAt.milliseconds-policyStart.milliseconds>policy.retentionDays*DAY_MS) fail('replay window exceeds provider retention');

    exactKeys(receipt.replayRequest,new Set(['status','sinceDateTime','untilDateTime','accepted','replayId','requestedAt']),'replayRequest');
    if(receipt.replayRequest.status!=='failed') fail('replay request must target failed messages only');
    same(instant(receipt.replayRequest.sinceDateTime,'replayRequest.sinceDateTime',policy.maxTextBytes).canonical,policy.windowStart,'replay window start');
    same(instant(receipt.replayRequest.untilDateTime,'replayRequest.untilDateTime',policy.maxTextBytes).canonical,policy.windowEnd,'replay window end');
    if(receipt.replayRequest.accepted!==true) fail('replay request was not accepted');
    const replayId=text(receipt.replayRequest.replayId,'replayRequest.replayId',policy.maxTextBytes);
    const requestedAt=instant(receipt.replayRequest.requestedAt,'replayRequest.requestedAt',policy.maxTextBytes);
    if(requestedAt.milliseconds<policyEnd.milliseconds||requestedAt.milliseconds>observedAt.milliseconds) fail('replay request time is outside the observation boundary');

    if(!Array.isArray(receipt.auditPages)||receipt.auditPages.length===0||receipt.auditPages.length>policy.maxAuditPages) fail('audit pages exceed the page limit or are empty');
    const auditByMessage=new Map();const usedCursors=new Set();let expectedToken=null;
    for(let pageIndex=0;pageIndex<receipt.auditPages.length;pageIndex++){
      const page=receipt.auditPages[pageIndex];const path=`auditPages[${pageIndex}]`;
      exactKeys(page,new Set(['currentToken','nextToken','successful','replayStatus','auditLogs']),path);
      const currentToken=page.currentToken===null?null:text(page.currentToken,`${path}.currentToken`,policy.maxTextBytes);
      if(currentToken!==expectedToken) fail(`${path} cursor is not gapless`);
      if(currentToken!==null){if(usedCursors.has(currentToken)) fail(`${path} cursor loop detected`);usedCursors.add(currentToken);}
      if(page.successful!==true) fail(`${path} failed`);
      if(page.replayStatus!=='success') fail(`${path} replay status is not success`);
      if(!Array.isArray(page.auditLogs)) fail(`${path}.auditLogs must be an array`);
      if(page.auditLogs.length>policy.pageCount) fail(`${path} exceeds the configured provider page count limit`);
      for(let logIndex=0;logIndex<page.auditLogs.length;logIndex++){
        if(auditByMessage.size>=policy.maxMessages) fail('audit message limit exceeded');
        const log=page.auditLogs[logIndex];const logPath=`${path}.auditLogs[${logIndex}]`;
        exactKeys(log,new Set(['messageId','firstAttemptedAt','lastAttemptedAt','status']),logPath);
        const messageId=text(log.messageId,`${logPath}.messageId`,policy.maxTextBytes);
        const firstAttemptedAt=instant(log.firstAttemptedAt,`${logPath}.firstAttemptedAt`,policy.maxTextBytes);
        const lastAttemptedAt=instant(log.lastAttemptedAt,`${logPath}.lastAttemptedAt`,policy.maxTextBytes);
        if(log.status!=='success') fail(`${logPath} status is not success`);
        if(firstAttemptedAt.milliseconds>lastAttemptedAt.milliseconds) fail(`${logPath} attempt chronology is invalid`);
        if(lastAttemptedAt.milliseconds>observedAt.milliseconds) fail(`${logPath} exceeds the observation horizon`);
        if(auditByMessage.has(messageId)) fail(`${logPath} contains a duplicate or conflicting message identity`);
        auditByMessage.set(messageId,{messageId,firstAttemptedAt:firstAttemptedAt.canonical,lastAttemptedAt:lastAttemptedAt.canonical});
      }
      const nextToken=page.nextToken===null?null:text(page.nextToken,`${path}.nextToken`,policy.maxTextBytes);
      if(pageIndex<receipt.auditPages.length-1&&nextToken===null) fail(`${path} ended before the terminal page chain`);
      if(pageIndex===receipt.auditPages.length-1&&nextToken!==null) fail(`${path} did not reach a terminal page`);
      if(nextToken!==null&&usedCursors.has(nextToken)) fail(`${path} cursor loop detected`);
      expectedToken=nextToken;
    }
    if(auditByMessage.size===0) fail('replay audit contains no successful messages');

    if(!Array.isArray(receipt.deliveries)||receipt.deliveries.length===0||receipt.deliveries.length>policy.maxMessages) fail('deliveries exceed the message limit or are empty');
    const deliveriesByWebhook=new Map();const deliveredAuditMessages=new Set();let exactDeliveryReplayCount=0;
    for(let index=0;index<receipt.deliveries.length;index++){
      const item=receipt.deliveries[index];const path=`deliveries[${index}]`;
      exactKeys(item,new Set(['auditMessageId','webhookId','eventAlias','eventTime','hmacVerified','hmacKeyRevisionFingerprint','sourceId','sourceVersion','payloadDigest']),path);
      const auditMessageId=text(item.auditMessageId,`${path}.auditMessageId`,policy.maxTextBytes);
      if(!auditByMessage.has(auditMessageId)) fail(`${path} references an unknown audit message`);
      const webhookId=text(item.webhookId,`${path}.webhookId`,policy.maxTextBytes);
      const eventAlias=text(item.eventAlias,`${path}.eventAlias`,policy.maxTextBytes);
      if(!policy.eventAliases.includes(eventAlias)) fail(`${path} event alias is not approved`);
      const eventTime=instant(item.eventTime,`${path}.eventTime`,policy.maxTextBytes);
      if(eventTime.milliseconds<policyStart.milliseconds||eventTime.milliseconds>=policyEnd.milliseconds) fail(`${path} event time is outside the replay window`);
      if(item.hmacVerified!==true) fail(`${path} HMAC verification failed`);
      const hmacKeyRevisionFingerprint=fingerprint(item.hmacKeyRevisionFingerprint,`${path}.hmacKeyRevisionFingerprint`,policy.maxTextBytes);
      same(hmacKeyRevisionFingerprint,policy.hmacKeyRevisionFingerprint,'delivery HMAC key revision');
      const sourceId=text(item.sourceId,`${path}.sourceId`,policy.maxTextBytes);
      const sourceVersion=text(item.sourceVersion,`${path}.sourceVersion`,policy.maxTextBytes);
      const payloadDigest=fingerprint(item.payloadDigest,`${path}.payloadDigest`,policy.maxTextBytes);
      const normalized={auditMessageId,webhookId,eventAlias,eventTime:eventTime.canonical,sourceId,sourceVersion,payloadDigest};
      if(deliveriesByWebhook.has(webhookId)){
        if(canonical(deliveriesByWebhook.get(webhookId))!==canonical(normalized)) fail(`${path} is a conflicting delivery replay`);
        exactDeliveryReplayCount++;continue;
      }
      deliveriesByWebhook.set(webhookId,normalized);deliveredAuditMessages.add(auditMessageId);
    }
    if(deliveredAuditMessages.size!==auditByMessage.size||[...auditByMessage.keys()].some(id=>!deliveredAuditMessages.has(id))) fail('delivery coverage does not match every successful replay message');

    exactKeys(receipt.fallbackSnapshot,new Set(['successful','complete','terminalPage','coveredFrom','coveredTo','records']),'fallbackSnapshot');
    if(receipt.fallbackSnapshot.successful!==true) fail('fallback snapshot failed');
    if(receipt.fallbackSnapshot.complete!==true) fail('fallback snapshot is incomplete');
    if(receipt.fallbackSnapshot.terminalPage!==true) fail('fallback snapshot did not reach a terminal page');
    same(instant(receipt.fallbackSnapshot.coveredFrom,'fallbackSnapshot.coveredFrom',policy.maxTextBytes).canonical,policy.windowStart,'snapshot window start');
    same(instant(receipt.fallbackSnapshot.coveredTo,'fallbackSnapshot.coveredTo',policy.maxTextBytes).canonical,policy.windowEnd,'snapshot window end');
    if(!Array.isArray(receipt.fallbackSnapshot.records)||receipt.fallbackSnapshot.records.length>policy.maxRecords) fail('snapshot records exceed the record limit or are not an array');
    const snapshotBySource=new Map();
    for(let index=0;index<receipt.fallbackSnapshot.records.length;index++){
      const record=receipt.fallbackSnapshot.records[index];const path=`fallbackSnapshot.records[${index}]`;
      exactKeys(record,new Set(['sourceId','sourceVersion','payloadDigest']),path);
      const sourceId=text(record.sourceId,`${path}.sourceId`,policy.maxTextBytes);
      const normalized={sourceId,sourceVersion:text(record.sourceVersion,`${path}.sourceVersion`,policy.maxTextBytes),payloadDigest:fingerprint(record.payloadDigest,`${path}.payloadDigest`,policy.maxTextBytes)};
      if(snapshotBySource.has(sourceId)&&canonical(snapshotBySource.get(sourceId))!==canonical(normalized)) fail(`${path} conflicts with another snapshot record`);
      snapshotBySource.set(sourceId,normalized);
    }

    const latestBySource=new Map();
    for(const item of deliveriesByWebhook.values()){
      const prior=latestBySource.get(item.sourceId);
      if(!prior||item.eventTime>prior.eventTime){latestBySource.set(item.sourceId,item);continue;}
      if(item.eventTime===prior.eventTime&&(item.sourceVersion!==prior.sourceVersion||item.payloadDigest!==prior.payloadDigest)) fail('latest delivery is ambiguous for one source identity');
    }
    for(const item of latestBySource.values()){
      const snapshot=snapshotBySource.get(item.sourceId);
      if(!snapshot) fail('fallback snapshot is missing a latest replayed source');
      if(snapshot.sourceVersion!==item.sourceVersion) fail('fallback snapshot latest source version does not match the replayed delivery');
      if(snapshot.payloadDigest!==item.payloadDigest) fail('fallback snapshot latest payload does not match the replayed delivery');
    }

    const auditFingerprints=[...auditByMessage.values()].map(item=>`sha256:${digest({scope,replayId,...item})}`).sort();
    const deliveryFingerprints=[...deliveriesByWebhook.values()].map(item=>`sha256:${digest({scope,...item})}`).sort();
    const sourceCoverage=[...latestBySource.values()].map(item=>({
      scopedSourceFingerprint:`sha256:${digest({scope,sourceId:item.sourceId})}`,
      latestEventAt:item.eventTime,latestVersionFingerprint:`sha256:${digest({scope,sourceId:item.sourceId,sourceVersion:item.sourceVersion})}`,
      payloadDigest:item.payloadDigest
    })).sort((a,b)=>a.scopedSourceFingerprint.localeCompare(b.scopedSourceFingerprint));
    const decision={
      recoveryReconciliationCandidate:true,checkpointAdvanceAllowed:false,deletionAuthority:false,payrollAuthority:false,
      attendanceAuthority:false,operationalAuthority:false,writeBackAuthority:false,replayAuthority:false,causalAuthority:false,
      ...scope,authorityFingerprint,checkpointNamespace,checkpointPredecessor:policy.expectedCheckpointPredecessor,
      windowStart:policy.windowStart,windowEnd:policy.windowEnd,observedAt:observedAt.canonical,replayRequestedAt:requestedAt.canonical,
      replayedMessageCount:auditByMessage.size,deliveryCount:deliveriesByWebhook.size,exactDeliveryReplayCount,
      snapshotRecordCount:snapshotBySource.size,auditFingerprints,deliveryFingerprints,sourceCoverage
    };
    decision.reconciliationFingerprint=`sha256:${digest(decision)}`;
    return deepFreeze(decision);
  }
  return Object.freeze({admit});
}
