import {createHash} from 'node:crypto';

const SECRET=/(?:password|passwd|secret|token|credential|authorization|cookie|api[_-]?key|client[_-]?secret)/i;
function fail(message){throw new Error(message);}
function clone(value,path='value',seen=new WeakSet()){
 if(value===null||['string','number','boolean'].includes(typeof value))return value;
 if(typeof value!=='object')fail(`${path} contains executable or unsupported data`);
 if(seen.has(value))fail(`${path} contains cyclic data`);seen.add(value);
 if(Array.isArray(value)){if(Object.getPrototypeOf(value)!==Array.prototype)fail(`${path} has an invalid array prototype`);const out=[];let count=0;for(const key of Reflect.ownKeys(value)){if(key==='length')continue;if(typeof key!=='string'||!/^(?:0|[1-9]\d*)$/.test(key))fail(`${path} contains invalid array data`);const d=Object.getOwnPropertyDescriptor(value,key);if(!d?.enumerable||!('value' in d))fail(`${path}[${key}] contains executable or hidden data`);out[key]=clone(d.value,`${path}[${key}]`,seen);count++;}if(count!==value.length)fail(`${path} contains sparse array data`);seen.delete(value);return out;}
 if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(`${path} must be plain data`);const out=Object.create(null);for(const key of Reflect.ownKeys(value)){if(typeof key!=='string')fail(`${path} contains symbol data`);if(SECRET.test(key))fail(`${path}.${key} contains secret or credential material`);const d=Object.getOwnPropertyDescriptor(value,key);if(!d?.enumerable||!('value' in d))fail(`${path}.${key} contains executable or hidden data`);out[key]=clone(d.value,`${path}.${key}`,seen);}seen.delete(value);return out;
}
function exact(value,keys,path){for(const key of Object.keys(value))if(!keys.has(key))fail(`${path}.${key} is not allowed`);for(const key of keys)if(!Object.hasOwn(value,key))fail(`${path}.${key} is required`);}
function text(v,n){if(typeof v!=='string'||!v||v.trim()!==v||/[\u0000-\u001f\u007f]/.test(v))fail(`${n} must be a clean non-empty string`);return v;}
function fp(v,n){v=text(v,n);if(!/^sha256:[a-f0-9]{64}$/.test(v))fail(`${n} must be a canonical sha256 fingerprint`);return v;}
function integer(v,n,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(v)||v<min||v>max)fail(`${n} must be an integer from ${min} to ${max}`);return v;}
function offset(v,n){if(typeof v!=='string'||v.length>19||!(/^(?:0|[1-9]\d*)$/).test(v))fail(`${n} must be a canonical unsigned decimal offset string in Kafka's signed 64-bit range`);if(BigInt(v)>9223372036854775807n)fail(`${n} must fit Kafka's signed 64-bit offset range`);return v;}
function instant(v,n){v=text(v,n);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||new Date(v).toISOString()!==v)fail(`${n} must be a canonical UTC instant`);return v;}
function canonical(v){if(Array.isArray(v))return`[${v.map(canonical).join(',')}]`;if(v&&typeof v==='object')return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;return JSON.stringify(v);}
function hash(v){return createHash('sha256').update(canonical(v)).digest('hex');}
function same(a,b,n){if(a!==b)fail(`${n} does not match approved authority`);}
function freeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;}
function secureAuth(protocol,mechanism){
 if(!['SSL','SASL_SSL'].includes(protocol))fail('security protocol must be SSL or SASL_SSL');
 const allowed=protocol==='SSL'?['mTLS']:['SASL_PLAIN','SASL_SCRAM_SHA_256','SASL_SCRAM_SHA_512','SASL_GSSAPI','SASL_OAUTHBEARER'];
 if(!allowed.includes(mechanism))fail('auth mechanism is not valid for the approved security protocol');
}

export function createPartitionOffsetWindowAuthority(rawPolicy){
 const p=clone(rawPolicy,'policy');
 const scope=['provider','wfmTenantId','connectionId','clusterId','topic','topicId','consumerGroupId','clientVersion','assignmentMode','securityProtocol','authMechanism','isolationLevel'];
 const fps=['brokerEndpointSetFingerprint','principalFingerprint','topicConfigFingerprint','topicMetadataFingerprint','schemaFingerprint','mappingFingerprint','sourceScopeFingerprint','brokerCompatibilityFingerprint'];
 exact(p,new Set([...scope,...fps,'enableAutoCommit','expectedCheckpointPredecessor','expectedObservedAt','maxPartitions','maxPagesPerPartition','maxRecords','partitions']),'policy');
 for(const k of scope)p[k]=text(p[k],k);for(const k of fps)p[k]=fp(p[k],k);
 if(p.provider!=='apache-kafka')fail('provider must be apache-kafka');if(!/^[A-Za-z0-9._-]{1,249}$/.test(p.topic)||p.topic==='.'||p.topic==='..')fail('topic must be an exact non-reserved Kafka topic name');if(!/^[A-Za-z0-9_-]{22}$/.test(p.topicId)||p.topicId==='AAAAAAAAAAAAAAAAAAAAAA')fail('topicId must be an exact non-zero Kafka topic UUID');if(!/^\d+\.\d+\.\d+$/.test(p.clientVersion))fail('clientVersion must be an exact semantic version');
 if(p.assignmentMode!=='manual')fail('manual partition assignment is required');if(p.isolationLevel!=='read_committed')fail('isolationLevel must be read_committed');if(p.enableAutoCommit!==false)fail('automatic offset commits are forbidden');secureAuth(p.securityProtocol,p.authMechanism);
 p.expectedCheckpointPredecessor=text(p.expectedCheckpointPredecessor,'expectedCheckpointPredecessor');p.expectedObservedAt=instant(p.expectedObservedAt,'expectedObservedAt');
 p.maxPartitions=integer(p.maxPartitions,'maxPartitions',1,100000);p.maxPagesPerPartition=integer(p.maxPagesPerPartition,'maxPagesPerPartition',1,100000);p.maxRecords=integer(p.maxRecords,'maxRecords',1,10000000);
 if(!Array.isArray(p.partitions)||p.partitions.length===0||p.partitions.length>p.maxPartitions)fail('partitions exceed maxPartitions or are missing');
 const partitionSet=new Set();p.partitions=p.partitions.map((raw,i)=>{exact(raw,new Set(['partition','expectedBeginningOffset','expectedEndOffset']),`partitions[${i}]`);const partition=integer(raw.partition,`partitions[${i}].partition`,0,2147483647);if(partitionSet.has(partition))fail('policy partitions must be unique');partitionSet.add(partition);const expectedBeginningOffset=offset(raw.expectedBeginningOffset,`partitions[${i}].expectedBeginningOffset`),expectedEndOffset=offset(raw.expectedEndOffset,`partitions[${i}].expectedEndOffset`);if(BigInt(expectedBeginningOffset)>BigInt(expectedEndOffset))fail('partition beginning offset must not exceed end offset');return{partition,expectedBeginningOffset,expectedEndOffset};}).sort((a,b)=>a.partition-b.partition);
 freeze(p);
 const approved={...Object.fromEntries(scope.map(k=>[k,p[k]])),...Object.fromEntries(fps.map(k=>[k,p[k]])),enableAutoCommit:false,partitions:p.partitions,maxPartitions:p.maxPartitions,maxPagesPerPartition:p.maxPagesPerPartition,maxRecords:p.maxRecords,observedAt:p.expectedObservedAt};
 const namespace=`partition-offset-window:${hash(approved)}`;
 function normalizeScan(rawScan,approvedPartition,scanIndex,countRecord){
  const path=`partitionScans[${scanIndex}]`;exact(rawScan,new Set(['partition','beginningOffsetAtStart','endOffsetAtStart','beginningOffsetAtEnd','endOffsetAtEnd','finalPosition','complete','pages']),path);
  same(integer(rawScan.partition,`${path}.partition`,0,2147483647),approvedPartition.partition,'partition');
  const beginningStart=offset(rawScan.beginningOffsetAtStart,`${path}.beginningOffsetAtStart`),endStart=offset(rawScan.endOffsetAtStart,`${path}.endOffsetAtStart`),beginningEnd=offset(rawScan.beginningOffsetAtEnd,`${path}.beginningOffsetAtEnd`),endEnd=offset(rawScan.endOffsetAtEnd,`${path}.endOffsetAtEnd`),finalPosition=offset(rawScan.finalPosition,`${path}.finalPosition`);
  same(beginningStart,approvedPartition.expectedBeginningOffset,'partition beginning offset');same(endStart,approvedPartition.expectedEndOffset,'partition end offset');
  if(beginningEnd!==beginningStart)fail(`${path} broker beginning offset advanced during the read`);if(BigInt(endEnd)<BigInt(endStart))fail(`${path} broker end offset moved backwards during the read`);if(finalPosition!==endStart)fail(`${path} final position does not prove the bounded end offset was reached`);if(rawScan.complete!==true)fail(`${path} is incomplete`);
  if(!Array.isArray(rawScan.pages)||rawScan.pages.length===0||rawScan.pages.length>p.maxPagesPerPartition)fail(`${path} pages exceed maxPagesPerPartition or are missing`);
  const records=[],byOffset=new Map();let lastOffset=null,exactReplayCount=0;
  rawScan.pages.forEach((page,pageIndex)=>{const pagePath=`${path}.pages[${pageIndex}]`;exact(page,new Set(['pageIndex','records']),pagePath);same(integer(page.pageIndex,`${pagePath}.pageIndex`),pageIndex,'page index');if(!Array.isArray(page.records))fail(`${pagePath}.records must be an array`);
   page.records.forEach((rawRecord,recordIndex)=>{countRecord();const recordPath=`${pagePath}.records[${recordIndex}]`;exact(rawRecord,new Set(['offset','timestamp','timestampType','payloadDigest']),recordPath);const recordOffset=offset(rawRecord.offset,`${recordPath}.offset`),n=BigInt(recordOffset);if(n<BigInt(beginningStart)||n>=BigInt(endStart))fail(`${recordPath} is outside the bounded offset window`);const timestamp=instant(rawRecord.timestamp,`${recordPath}.timestamp`);if(timestamp>p.expectedObservedAt)fail(`${recordPath}.timestamp is beyond observation horizon`);const timestampType=text(rawRecord.timestampType,`${recordPath}.timestampType`);if(!['CREATE_TIME','LOG_APPEND_TIME'].includes(timestampType))fail(`${recordPath}.timestampType is not supported`);const normalized={offset:recordOffset,timestamp,timestampType,payloadDigest:fp(rawRecord.payloadDigest,`${recordPath}.payloadDigest`)};if(lastOffset!==null&&n<BigInt(lastOffset))fail(`${recordPath} is out of offset order`);const prior=byOffset.get(recordOffset);if(prior){if(canonical(prior)!==canonical(normalized))fail(`${recordPath} conflicts at one topic-partition offset`);exactReplayCount++;return;}lastOffset=recordOffset;byOffset.set(recordOffset,normalized);records.push(normalized);
   });
  });
  const windowSize=BigInt(endStart)-BigInt(beginningStart),gapCount=windowSize-BigInt(records.length);if(gapCount<0n)fail(`${path} contains more unique records than its offset window`);
  return{partition:approvedPartition.partition,beginningOffset:beginningStart,endOffset:endStart,brokerEndOffsetAtObservation:endEnd,finalPosition,uniqueRecordCount:records.length,exactReplayCount,offsetGapCount:gapCount.toString(),records};
 }
 function admit(rawReceipt){
  const r=clone(rawReceipt,'receipt');exact(r,new Set([...scope,...fps,'enableAutoCommit','checkpointPredecessor','observedAt','complete','commitPerformed','partitionScans']),'receipt');for(const k of scope)same(text(r[k],k),p[k],k);for(const k of fps)same(fp(r[k],k),p[k],k);if(r.enableAutoCommit!==false)fail('automatic offset commits are forbidden');secureAuth(r.securityProtocol,r.authMechanism);same(text(r.checkpointPredecessor,'checkpointPredecessor'),p.expectedCheckpointPredecessor,'checkpoint predecessor');same(instant(r.observedAt,'observedAt'),p.expectedObservedAt,'observation horizon');if(r.complete!==true)fail('receipt is incomplete');if(r.commitPerformed!==false)fail('offset commits are forbidden for reconciliation reads');if(!Array.isArray(r.partitionScans)||r.partitionScans.length!==p.partitions.length)fail('receipt must contain the exact approved partition set');
  const scansByPartition=new Map();r.partitionScans.forEach((scan,i)=>{if(!scan||typeof scan!=='object'||!Object.hasOwn(scan,'partition'))fail(`partitionScans[${i}] is invalid`);const id=integer(scan.partition,`partitionScans[${i}].partition`,0,2147483647);if(scansByPartition.has(id))fail('receipt must contain the exact approved partition set');scansByPartition.set(id,{scan,index:i});});if([...scansByPartition.keys()].some(id=>!partitionSet.has(id)))fail('receipt must contain the exact approved partition set');
  let rawRecordCount=0;const countRecord=()=>{rawRecordCount++;if(rawRecordCount>p.maxRecords)fail('records exceed maxRecords');};
  const partitions=p.partitions.map(ap=>{const found=scansByPartition.get(ap.partition);if(!found)fail('receipt must contain the exact approved partition set');return normalizeScan(found.scan,ap,found.index,countRecord);});
  const uniqueRecordCount=partitions.reduce((n,x)=>n+x.uniqueRecordCount,0),exactReplayCount=partitions.reduce((n,x)=>n+x.exactReplayCount,0),offsetGapCount=partitions.reduce((n,x)=>n+BigInt(x.offsetGapCount),0n).toString();
  const authority={partitionOffsetWindowCandidate:true,checkpointAdvanceAllowed:false,offsetCommitAuthority:false,deletionAuthority:false,operationalDecisionAuthority:false,causalClaimAuthority:false,writeBackAuthority:false,payrollAuthority:false,attendanceAuthority:false};
  const identity={...Object.fromEntries(scope.map(k=>[k,p[k]])),...Object.fromEntries(fps.map(k=>[k,p[k]])),enableAutoCommit:false,checkpointNamespace:namespace,checkpointPredecessor:p.expectedCheckpointPredecessor,observedAt:p.expectedObservedAt};
  const normalizedPartitions=partitions.map(({exactReplayCount:ignored,...partition})=>partition);
  const fingerprintEvidence={...authority,...identity,partitionCount:partitions.length,uniqueRecordCount,offsetGapCount,partitions:normalizedPartitions};
  const decision={...authority,...identity,partitionCount:partitions.length,uniqueRecordCount,exactReplayCount,offsetGapCount,partitions,reconciliationFingerprint:`sha256:${hash(fingerprintEvidence)}`};return freeze(decision);
 }
 return Object.freeze({admit});
}
