import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartitionOffsetWindowAuthority} from './partition-offset-window-authority.mjs';

const fp=(c)=>`sha256:${c.repeat(64)}`;
const policy=()=>({
 provider:'apache-kafka',wfmTenantId:'tenant-uk-01',connectionId:'kafka-eu-west',clusterId:'MkU3OEVBNTcwNTJENDM2Qk',
 topic:'manufacturing.work-centre.events.v1',topicId:'cLx1mQ6bTj-bpPr6Yvko8A',consumerGroupId:'wfm-fabric-reconcile-v1',clientVersion:'4.3.1',assignmentMode:'manual',
 securityProtocol:'SASL_SSL',authMechanism:'SASL_SCRAM_SHA_512',isolationLevel:'read_committed',enableAutoCommit:false,
 brokerEndpointSetFingerprint:fp('1'),principalFingerprint:fp('2'),topicConfigFingerprint:fp('3'),schemaFingerprint:fp('4'),mappingFingerprint:fp('5'),sourceScopeFingerprint:fp('6'),brokerCompatibilityFingerprint:fp('7'),topicMetadataFingerprint:fp('8'),
 expectedCheckpointPredecessor:'checkpoint:41',expectedObservedAt:'2026-09-27T10:30:00.000Z',maxPartitions:8,maxPagesPerPartition:8,maxRecords:100,
 partitions:[
  {partition:0,expectedBeginningOffset:'90071992547409930',expectedEndOffset:'90071992547409936'},
  {partition:1,expectedBeginningOffset:'7',expectedEndOffset:'10'}
 ]
});
const scan=(partition,start,end,records,overrides={})=>({
 partition,beginningOffsetAtStart:start,endOffsetAtStart:end,beginningOffsetAtEnd:start,endOffsetAtEnd:end,
 finalPosition:end,complete:true,pages:[{pageIndex:0,records}],...overrides
});
const record=(offset,digest='a',timestamp='2026-09-27T10:00:00.000Z')=>({offset,timestamp,timestampType:'CREATE_TIME',payloadDigest:fp(digest)});
const receipt=()=>({
 provider:'apache-kafka',wfmTenantId:'tenant-uk-01',connectionId:'kafka-eu-west',clusterId:'MkU3OEVBNTcwNTJENDM2Qk',
 topic:'manufacturing.work-centre.events.v1',topicId:'cLx1mQ6bTj-bpPr6Yvko8A',consumerGroupId:'wfm-fabric-reconcile-v1',clientVersion:'4.3.1',assignmentMode:'manual',
 securityProtocol:'SASL_SSL',authMechanism:'SASL_SCRAM_SHA_512',isolationLevel:'read_committed',enableAutoCommit:false,
 brokerEndpointSetFingerprint:fp('1'),principalFingerprint:fp('2'),topicConfigFingerprint:fp('3'),schemaFingerprint:fp('4'),mappingFingerprint:fp('5'),sourceScopeFingerprint:fp('6'),brokerCompatibilityFingerprint:fp('7'),topicMetadataFingerprint:fp('8'),
 checkpointPredecessor:'checkpoint:41',observedAt:'2026-09-27T10:30:00.000Z',complete:true,commitPerformed:false,
 partitionScans:[
  scan(0,'90071992547409930','90071992547409936',[record('90071992547409930'),record('90071992547409933','b'),record('90071992547409935','c')]),
  scan(1,'7','10',[record('7','d'),record('9','e')])
 ]
});
const admit=(p=policy(),r=receipt())=>createPartitionOffsetWindowAuthority(p).admit(r);

test('admits stable partition windows without inventing gapless record semantics',()=>{
 const result=admit();
 assert.equal(result.partitionOffsetWindowCandidate,true);
 assert.equal(result.partitionCount,2);assert.equal(result.uniqueRecordCount,5);assert.equal(result.offsetGapCount,'4');
 assert.equal(result.checkpointAdvanceAllowed,false);assert.equal(result.offsetCommitAuthority,false);assert.equal(result.writeBackAuthority,false);
 assert.equal(result.payrollAuthority,false);assert.equal(result.attendanceAuthority,false);assert.match(result.reconciliationFingerprint,/^sha256:[a-f0-9]{64}$/);
 assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.partitions));
});

test('preserves offsets larger than Number.MAX_SAFE_INTEGER exactly',()=>{
 const result=admit();
 assert.equal(result.partitions[0].beginningOffset,'90071992547409930');
 assert.equal(result.partitions[0].endOffset,'90071992547409936');
 assert.deepEqual(result.partitions[0].records.map(x=>x.offset),['90071992547409930','90071992547409933','90071992547409935']);
});

test('collapses byte-equivalent offset replay but rejects conflicting replay',()=>{
 const baseline=admit();
 const r=receipt();r.partitionScans[0].pages.push({pageIndex:1,records:[record('90071992547409935','c')]});
 const result=admit(policy(),r);assert.equal(result.exactReplayCount,1);assert.equal(result.uniqueRecordCount,5);assert.equal(result.reconciliationFingerprint,baseline.reconciliationFingerprint);
 r.partitionScans[0].pages[1].records[0].payloadDigest=fp('f');
 assert.throws(()=>admit(policy(),r),/conflicts at one topic-partition offset/);
});

test('rejects out-of-order records while allowing compaction and transaction gaps',()=>{
 const r=receipt();r.partitionScans[0].pages[0].records=[record('90071992547409933'),record('90071992547409930','b')];
 assert.throws(()=>admit(policy(),r),/out of offset order/);
 const sparse=receipt();sparse.partitionScans[1].pages[0].records=[];
 assert.equal(admit(policy(),sparse).partitions[1].uniqueRecordCount,0);
});

test('requires exact partition coverage and exact broker start watermarks',()=>{
 const missing=receipt();missing.partitionScans.pop();assert.throws(()=>admit(policy(),missing),/exact approved partition set/);
 const extra=receipt();extra.partitionScans.push(scan(2,'0','0',[]));assert.throws(()=>admit(policy(),extra),/exact approved partition set/);
 const shifted=receipt();shifted.partitionScans[0].beginningOffsetAtStart='90071992547409931';assert.throws(()=>admit(policy(),shifted),/beginning offset/);
});

test('rejects retention loss, truncation and incomplete final position',()=>{
 const retained=receipt();retained.partitionScans[0].beginningOffsetAtEnd='90071992547409931';assert.throws(()=>admit(policy(),retained),/beginning offset advanced/);
 const truncated=receipt();truncated.partitionScans[0].endOffsetAtEnd='90071992547409935';assert.throws(()=>admit(policy(),truncated),/end offset moved backwards/);
 const partial=receipt();partial.partitionScans[0].finalPosition='90071992547409935';assert.throws(()=>admit(policy(),partial),/final position/);
});

test('permits appends after the bounded end without widening the admitted window',()=>{
 const r=receipt();r.partitionScans[1].endOffsetAtEnd='14';
 const result=admit(policy(),r);assert.equal(result.partitions[1].endOffset,'10');assert.equal(result.partitions[1].brokerEndOffsetAtObservation,'14');
});

test('requires read_committed manual assignment and proves no offset commit occurred',()=>{
 const p=policy();p.isolationLevel='read_uncommitted';assert.throws(()=>createPartitionOffsetWindowAuthority(p),/read_committed/);
 const subscribed=policy();subscribed.assignmentMode='subscribe';assert.throws(()=>createPartitionOffsetWindowAuthority(subscribed),/manual/);
 const autoPolicy=policy();autoPolicy.enableAutoCommit=true;assert.throws(()=>createPartitionOffsetWindowAuthority(autoPolicy),/automatic offset commits are forbidden/);
 const autoReceipt=receipt();autoReceipt.enableAutoCommit=true;assert.throws(()=>admit(policy(),autoReceipt),/automatic offset commits are forbidden|does not match approved authority/);
 const committed=receipt();committed.commitPerformed=true;assert.throws(()=>admit(policy(),committed),/offset commits are forbidden/);
});

test('binds cluster, topic, consumer, security and every fabric fingerprint',()=>{
 for(const [field,value] of [['clusterId','other'],['topic','other'],['topicId','other'],['consumerGroupId','other'],['clientVersion','4.2.0'],['securityProtocol','SSL'],['authMechanism','mTLS'],['schemaFingerprint',fp('9')],['sourceScopeFingerprint',fp('9')],['brokerCompatibilityFingerprint',fp('9')],['topicMetadataFingerprint',fp('9')]]){
  const r=receipt();r[field]=value;assert.throws(()=>admit(policy(),r),/does not match approved authority|security protocol|auth mechanism/);
 }
});

test('rejects records outside the bounded window and timestamp evidence beyond observation',()=>{
 const outside=receipt();outside.partitionScans[1].pages[0].records.push(record('10','f'));assert.throws(()=>admit(policy(),outside),/outside the bounded offset window/);
 const future=receipt();future.partitionScans[1].pages[0].records[0].timestamp='2026-09-27T10:31:00.000Z';assert.throws(()=>admit(policy(),future),/beyond observation horizon/);
});

test('rejects malformed, secret-bearing, sparse, executable and unbounded evidence',()=>{
 const secret=receipt();secret.password='leak';assert.throws(()=>admit(policy(),secret),/secret or credential/);
 const sparse=receipt();sparse.partitionScans.length=3;assert.throws(()=>admit(policy(),sparse),/sparse array/);
 const executable=receipt();Object.defineProperty(executable,'observedAt',{get(){return '2026-09-27T10:30:00.000Z';},enumerable:true});assert.throws(()=>admit(policy(),executable),/executable or hidden/);
 const tooMany=receipt();tooMany.partitionScans[0].pages=Array.from({length:9},(_,i)=>({pageIndex:i,records:[]}));assert.throws(()=>admit(policy(),tooMany),/pages exceed/);
});

test('applies maxRecords across the whole multi-partition receipt',()=>{
 const p=policy();p.maxRecords=5;const r=receipt();r.partitionScans[0].pages.push({pageIndex:1,records:[record('90071992547409935','c')]});
 assert.throws(()=>admit(p,r),/records exceed maxRecords/);
});

test('rejects Kafka-reserved topic names and offsets outside signed int64',()=>{
 for(const topic of ['.','..']){const p=policy();p.topic=topic;assert.throws(()=>createPartitionOffsetWindowAuthority(p),/topic name/);}
 const zeroTopicId=policy();zeroTopicId.topicId='AAAAAAAAAAAAAAAAAAAAAA';assert.throws(()=>createPartitionOffsetWindowAuthority(zeroTopicId),/topic UUID/);
 const tooLargePolicy=policy();tooLargePolicy.partitions[1].expectedEndOffset='9223372036854775808';assert.throws(()=>createPartitionOffsetWindowAuthority(tooLargePolicy),/signed 64-bit/);
 const tooLargeRecord=receipt();tooLargeRecord.partitionScans[1].pages[0].records[0].offset='9223372036854775808';assert.throws(()=>admit(policy(),tooLargeRecord),/signed 64-bit/);
});

test('rejects forged array prototypes and old replays after newer offsets',()=>{
 const forged=receipt();Object.setPrototypeOf(forged.partitionScans,Object.create(Array.prototype));assert.throws(()=>admit(policy(),forged),/array prototype/);
 const staleReplay=receipt();staleReplay.partitionScans[1].pages.push({pageIndex:1,records:[record('7','d')]});assert.throws(()=>admit(policy(),staleReplay),/out of offset order/);
});
