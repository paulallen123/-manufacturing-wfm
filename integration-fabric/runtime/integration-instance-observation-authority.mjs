import {createHash} from 'node:crypto';

const SECRET=/secret|token|password|credential|cookie|authorization|private.?key/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const INSTANCE=/^[A-Za-z0-9_-]{1,128}$/;
const INTEGRATION=/^[A-Z0-9_]{1,128}$/;
const VERSION=/^\d{2}\.\d{2}\.\d{4}$/;
const SIMPLE=/^[A-Za-z0-9._:-]{1,256}$/;
const STATUSES=new Map([['SCHEDULE_WAITING',0],['IN_PROGRESS',1],['COMPLETED',2]]);

function record(value,label,allowed){
 if(value===null||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype) throw new TypeError(`${label} must be a plain object`);
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value);
 for(const key of keys){
  if(typeof key!=='string') throw new TypeError(`${label} symbols are not allowed`);
  if(SECRET.test(key)) throw new TypeError(`${label} secret or credential fields are not allowed`);
  const descriptor=descriptors[key];
  if(!descriptor.enumerable||!('value' in descriptor)) throw new TypeError(`${label}.${key} hidden or executable evidence is not allowed`);
  if(!allowed.includes(key)) throw new TypeError(`${label}.${key} is not allowed`);
 }
 for(const key of allowed) if(!Object.hasOwn(value,key)) throw new TypeError(`${label}.${key} is required`);
 return value;
}

function array(value,label,min,max){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length<min||value.length>max) throw new TypeError(`${label} must be a plain array with ${min}-${max} items`);
 const descriptors=Object.getOwnPropertyDescriptors(value);
 for(let index=0;index<value.length;index++){
  if(!Object.hasOwn(value,index)) throw new TypeError(`${label} cannot be sparse`);
  const descriptor=descriptors[index];if(!descriptor?.enumerable||!('value' in descriptor)) throw new TypeError(`${label}[${index}] hidden or executable array evidence is not allowed`);
 }
 const expectedKeys=new Set(['length',...Array.from({length:value.length},(_,index)=>String(index))]);
 if(Reflect.ownKeys(value).some(key=>typeof key==='symbol'||!expectedKeys.has(key))) throw new TypeError(`${label} custom or hidden array evidence is not allowed`);
 return value;
}

function text(value,label,max=256,pattern){
 if(typeof value!=='string'||value.length<1||value.length>max||/[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} must be bounded text`);
 if(pattern&&!pattern.test(value)) throw new TypeError(`${label} has invalid format`);
 return value;
}

function fingerprint(value,label){if(typeof value!=='string'||!SHA.test(value)) throw new TypeError(`${label} must be a canonical sha256 fingerprint`);return value;}
function boolean(value,label){if(typeof value!=='boolean') throw new TypeError(`${label} must be boolean`);return value;}
function integer(value,label,max){if(!Number.isSafeInteger(value)||value<0||value>max) throw new TypeError(`${label} must be a bounded non-negative integer`);return value;}
function instant(value,label){text(value,label,32);const time=Date.parse(value);if(!Number.isFinite(time)||new Date(time).toISOString()!==value) throw new TypeError(`${label} must be a canonical UTC instant`);return time;}
function same(actual,expected,label){if(actual!==expected) throw new TypeError(`${label} does not match approved scope`);}

function origin(value){
 text(value,'endpointOrigin',512);
 let parsed;try{parsed=new URL(value);}catch{throw new TypeError('endpointOrigin must be an exact URL origin');}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.origin!==value||!parsed.hostname.endsWith('.oraclecloud.com')) throw new TypeError('endpointOrigin must be an exact HTTPS Oracle origin with no port path query fragment or credentials');
 return value;
}

function canonical(value){
 if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
 return JSON.stringify(value);
}
function digest(value){return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value)) freeze(child);Object.freeze(value);}return value;}

const POLICY_KEYS=['provider','wfmTenantId','connectionId','endpointOrigin','serviceInstance','integrationId','integrationVersion','primaryTrackingName','primaryTrackingValue','dataset','sourceScopeFingerprint','principalFingerprint','schemaFingerprint','mappingFingerprint','expectedCheckpointPredecessor','windowStart','windowEnd','expectedObservedAt','maxObservations','maxRecords'];
const RECEIPT_KEYS=['provider','wfmTenantId','connectionId','endpointOrigin','serviceInstance','method','resource','integrationId','integrationVersion','primaryTrackingName','primaryTrackingValue','principalFingerprint','schemaFingerprint','mappingFingerprint','sourceScopeFingerprint','checkpointPredecessor','windowStart','windowEnd','observedAt','observations','deliveryReceipt'];
const OBSERVATION_KEYS=['instanceId','integrationId','integrationVersion','status','pkName','pkValue','trackings','creationDate','lastTrackedTime','isDataAccurate','providerPayloadDigest','observedAt'];
const TRACKING_KEYS=['name','value','primary'];
const DELIVERY_KEYS=['dataset','instanceId','successful','complete','recordCount','payloadDigest','schemaFingerprint','mappingFingerprint','sourceScopeFingerprint','windowStart','windowEnd','observedAt'];

export function createIntegrationInstanceObservationAuthority(inputPolicy){
 const policy=record(inputPolicy,'policy',POLICY_KEYS);
 same(policy.provider,'oracle-integration-cloud','provider');
 for(const key of ['wfmTenantId','connectionId','serviceInstance','primaryTrackingName','dataset','expectedCheckpointPredecessor']) text(policy[key],`policy.${key}`,256,SIMPLE);
 text(policy.primaryTrackingValue,'policy.primaryTrackingValue',512);
 origin(policy.endpointOrigin);text(policy.integrationId,'policy.integrationId',128,INTEGRATION);text(policy.integrationVersion,'policy.integrationVersion',32,VERSION);
 for(const key of ['sourceScopeFingerprint','principalFingerprint','schemaFingerprint','mappingFingerprint']) fingerprint(policy[key],`policy.${key}`);
 const windowStart=instant(policy.windowStart,'policy.windowStart'),windowEnd=instant(policy.windowEnd,'policy.windowEnd'),horizon=instant(policy.expectedObservedAt,'policy.expectedObservedAt');
 if(windowStart>=windowEnd||windowEnd>horizon) throw new TypeError('policy window must be non-empty and within observation horizon');
 integer(policy.maxObservations,'policy.maxObservations',64);if(policy.maxObservations<2) throw new TypeError('policy.maxObservations must allow a lifecycle');integer(policy.maxRecords,'policy.maxRecords',1_000_000_000);
 const approved={...policy};

 return freeze({admit(inputReceipt){
  const receipt=record(inputReceipt,'receipt',RECEIPT_KEYS);
  for(const key of ['provider','wfmTenantId','connectionId','endpointOrigin','serviceInstance','integrationId','integrationVersion','primaryTrackingName','primaryTrackingValue','principalFingerprint','schemaFingerprint','mappingFingerprint','sourceScopeFingerprint','windowStart','windowEnd']) same(receipt[key],approved[key],key);
  same(receipt.checkpointPredecessor,approved.expectedCheckpointPredecessor,'checkpoint predecessor');same(receipt.method,'GET','method');same(receipt.observedAt,approved.expectedObservedAt,'observation horizon');
  const receiptTime=instant(receipt.observedAt,'receipt.observedAt');
  const observations=array(receipt.observations,'observations',2,approved.maxObservations);
  let instanceId,creationTime=-1,previousObserved=-1,previousTracked=-1,previousRank=-1,terminalSignature;
  const unique=[],signatures=new Set(),trackedDigests=new Map(),payloadDigests=new Map();
  for(let index=0;index<observations.length;index++){
   const item=record(observations[index],`observations[${index}]`,OBSERVATION_KEYS);
   text(item.instanceId,`observations[${index}].instanceId`,128,INSTANCE);instanceId??=item.instanceId;same(item.instanceId,instanceId,'instance identity');
   same(item.integrationId,approved.integrationId,'integration identity');same(item.integrationVersion,approved.integrationVersion,'integration version');same(item.pkName,approved.primaryTrackingName,'primary tracking name');same(item.pkValue,approved.primaryTrackingValue,'primary tracking value');
   if(!STATUSES.has(item.status)) throw new TypeError('status is outside the admitted lifecycle');
   const rank=STATUSES.get(item.status);if(rank<previousRank) throw new TypeError('lifecycle status order cannot regress');
   const tracking=array(item.trackings,`observations[${index}].trackings`,1,1)[0];record(tracking,`observations[${index}].trackings[0]`,TRACKING_KEYS);same(tracking.name,approved.primaryTrackingName,'tracking name');same(tracking.value,approved.primaryTrackingValue,'tracking value');if(tracking.primary!==true) throw new TypeError('tracking must be the single primary business identifier');
   const created=instant(item.creationDate,`observations[${index}].creationDate`),tracked=instant(item.lastTrackedTime,`observations[${index}].lastTrackedTime`),observed=instant(item.observedAt,`observations[${index}].observedAt`);
   if(index===0) creationTime=created;else if(created!==creationTime) throw new TypeError('creation time cannot drift');
   if(tracked<created||tracked>observed||observed>receiptTime||observed<=previousObserved||tracked<previousTracked) throw new TypeError('provider and observation times must be monotone and bounded');
   boolean(item.isDataAccurate,`observations[${index}].isDataAccurate`);fingerprint(item.providerPayloadDigest,`observations[${index}].providerPayloadDigest`);
   const priorTracked=trackedDigests.get(item.lastTrackedTime);if(priorTracked&&priorTracked!==item.providerPayloadDigest) throw new TypeError('conflicting payload digest at one provider tracking time');
   const payloadState=`${item.status}|${item.lastTrackedTime}|${item.isDataAccurate}`;
   const priorPayload=payloadDigests.get(item.providerPayloadDigest);if(priorPayload&&priorPayload!==payloadState) throw new TypeError('payload digest cannot represent different provider states or accuracy');
   trackedDigests.set(item.lastTrackedTime,item.providerPayloadDigest);payloadDigests.set(item.providerPayloadDigest,payloadState);
   const signature=`${item.status}|${item.lastTrackedTime}|${item.isDataAccurate}|${item.providerPayloadDigest}`;
   if(item.status==='COMPLETED'){if(terminalSignature&&terminalSignature!==signature) throw new TypeError('post-terminal COMPLETED evidence conflicts with the terminal state');terminalSignature??=signature;}else if(terminalSignature) throw new TypeError('nonterminal evidence cannot follow COMPLETED');
   if(!signatures.has(signature)){signatures.add(signature);unique.push({status:item.status,lastTrackedTime:item.lastTrackedTime,isDataAccurate:item.isDataAccurate,providerPayloadDigest:item.providerPayloadDigest});}
   previousObserved=observed;previousTracked=tracked;previousRank=rank;
  }
  if(unique.length<2||observations[0].status==='COMPLETED'||observations.at(-1).status!=='COMPLETED') throw new TypeError('lifecycle must progress from nonterminal evidence to COMPLETED');
  if(observations.at(-1).isDataAccurate!==true) throw new TypeError('COMPLETED instance must report accurate data');
  same(receipt.resource,`/ic/api/integration/v1/monitoring/instances/${instanceId}`,'resource instance route');

  const delivery=record(receipt.deliveryReceipt,'deliveryReceipt',DELIVERY_KEYS);
  same(delivery.dataset,approved.dataset,'delivery dataset');same(delivery.instanceId,instanceId,'delivery instance');if(delivery.successful!==true) throw new TypeError('delivery must be successful');if(delivery.complete!==true) throw new TypeError('delivery must be complete');
  integer(delivery.recordCount,'deliveryReceipt.recordCount',approved.maxRecords);fingerprint(delivery.payloadDigest,'deliveryReceipt.payloadDigest');same(delivery.schemaFingerprint,approved.schemaFingerprint,'delivery schema');same(delivery.mappingFingerprint,approved.mappingFingerprint,'delivery mapping');same(delivery.sourceScopeFingerprint,approved.sourceScopeFingerprint,'delivery source scope');same(delivery.windowStart,approved.windowStart,'delivery window start');same(delivery.windowEnd,approved.windowEnd,'delivery window end');
  const deliveryTime=instant(delivery.observedAt,'deliveryReceipt.observedAt');if(deliveryTime<=previousObserved||deliveryTime>receiptTime) throw new TypeError('delivery evidence must be observed after provider completion and within the horizon');
  const evidence={provider:approved.provider,wfmTenantId:approved.wfmTenantId,connectionId:approved.connectionId,endpointOrigin:approved.endpointOrigin,serviceInstance:approved.serviceInstance,method:'GET',resource:receipt.resource,instanceId,integrationId:approved.integrationId,integrationVersion:approved.integrationVersion,primaryTrackingName:approved.primaryTrackingName,primaryTrackingValue:approved.primaryTrackingValue,dataset:approved.dataset,sourceScopeFingerprint:approved.sourceScopeFingerprint,principalFingerprint:approved.principalFingerprint,schemaFingerprint:approved.schemaFingerprint,mappingFingerprint:approved.mappingFingerprint,checkpointPredecessor:approved.expectedCheckpointPredecessor,windowStart:approved.windowStart,windowEnd:approved.windowEnd,creationDate:observations[0].creationDate,observedAt:approved.expectedObservedAt,maxObservations:approved.maxObservations,maxRecords:approved.maxRecords,observations:unique,delivery:{recordCount:delivery.recordCount,payloadDigest:delivery.payloadDigest,observedAt:delivery.observedAt}};
  return freeze({...evidence,integrationDeliveryReconciliationCandidate:true,observationCount:observations.length,uniqueObservationCount:unique.length,deliveryRecordCount:delivery.recordCount,reconciliationFingerprint:digest(evidence),checkpointAdvanceAllowed:false,deletionAuthority:false,operationalDecisionAuthority:false,causalClaimAuthority:false,writeBackAuthority:false,payrollAuthority:false,attendanceAuthority:false,providerRecoveryAuthority:false});
 }});
}
