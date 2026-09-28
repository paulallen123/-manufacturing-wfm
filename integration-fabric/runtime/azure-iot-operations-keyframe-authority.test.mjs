import test from 'node:test';
import assert from 'node:assert/strict';
import {createAzureIotOperationsKeyframeAuthority} from './azure-iot-operations-keyframe-authority.mjs';

const fp=c=>`sha256:${c.repeat(64)}`;
const common={
 provider:'azure-iot-operations',wfmTenantId:'tenant-uk-01',connectionId:'aio-factory-01',
 azureTenantId:'11111111-1111-4111-8111-111111111111',subscriptionId:'22222222-2222-4222-8222-222222222222',
 resourceGroup:'rg-aio-factory-01',region:'uksouth',arcClusterId:'/subscriptions/22222222-2222-4222-8222-222222222222/resourceGroups/rg-aio-factory-01/providers/Microsoft.Kubernetes/connectedClusters/arc-factory-01',
 customLocationId:'/subscriptions/22222222-2222-4222-8222-222222222222/resourceGroups/rg-aio-factory-01/providers/Microsoft.ExtendedLocation/customLocations/cl-factory-01',
 instanceName:'aio-factory-01',namespace:'azure-iot-operations',platformVersion:'1.2',mqttHost:'aio-broker',mqttPort:18883,mqttVersion:'5.0',mqttClientId:'wfm-fabric-tenant-uk-01-factory-01',qos:1,authMethod:'K8S-SAT',tlsEnabled:true,cleanStart:false,sessionExpirySeconds:7200,
 dataFlowName:'wfm-opcua-observe',sourceEndpointName:'default',topic:'azure-iot-operations/data/press-line-1',metricCategory:'wfm-fabric-reconcile',
 sourceType:'opc-ua',cloudEventSource:'urn:OpcPlc:opcplc-000000',assetExternalId:'33333333-3333-4333-8333-333333333333',datasetName:'press-state',requestDiskPersistence:true,brokerPersistenceEnabled:true,subscriberQueueStrategy:'None',
 principalFingerprint:fp('1'),brokerConfigFingerprint:fp('2'),dataFlowConfigFingerprint:fp('3'),opcEndpointFingerprint:fp('4'),assetModelFingerprint:fp('5'),schemaFingerprint:fp('6'),mappingFingerprint:fp('7'),sourceScopeFingerprint:fp('8')
};
const policy=()=>({...common,expectedWindowStart:'2026-09-27T11:00:00.000Z',expectedWindowEnd:'2026-09-27T12:00:00.000Z',expectedObservedAt:'2026-09-27T12:05:00.000Z',maxMessages:32,maxPointsPerMessage:16,maxSourceClockSkewSeconds:2,expectedPointNames:['cycleCount','temperature']});
const point=(name,sourceTimestamp,valueDigest)=>({name,sourceTimestamp,valueDigest:fp(valueDigest)});
const message=(sequence='9768',overrides={})=>({
 topic:common.topic,qos:1,retain:false,dup:false,cloudEventId:'1111bbbb-22cc-4ddd-8e33-ffffff444444',externalAssetId:common.assetExternalId,
 source:common.cloudEventSource,subject:common.assetExternalId,type:'ua-keyframe',specversion:'1.0',sequence,
 eventTime:'2026-09-27T11:59:58.8738457Z',recordedTime:'2026-09-27T11:59:58.8740000Z',payloadDigest:fp('a'),
 points:[point('cycleCount','2026-09-27T11:59:58.8737000Z','b'),point('temperature','2026-09-27T11:59:58.8738000Z','c')],...overrides
});
const receipt=()=>({...common,windowStart:'2026-09-27T11:00:00.000Z',windowEnd:'2026-09-27T12:00:00.000Z',observedAt:'2026-09-27T12:05:00.000Z',captureClosed:true,writePerformed:false,
 health:{metricCategory:common.metricCategory,windowStart:'2026-09-27T11:00:00.000Z',windowEnd:'2026-09-27T12:00:00.000Z',expiredDelta:0,filteredDelta:0,droppedProcessingErrorDelta:0,droppedWhenBusyDelta:0,errorDelta:0},messages:[message()]});
const admit=(p=policy(),r=receipt())=>createAzureIotOperationsKeyframeAuthority(p).admit(r);

test('admits a scoped OPC UA key frame as current-state evidence only',()=>{
 const result=admit();
 assert.equal(result.stateSnapshotCandidate,true);assert.equal(result.uniqueMessageCount,1);assert.equal(result.latestSequence,'9768');
 assert.equal(result.sourceCompletenessProven,false);assert.equal(result.deliveryCompletenessProven,false);assert.equal(result.checkpointAdvanceAllowed,false);
 assert.equal(result.writeBackAuthority,false);assert.equal(result.controlAuthority,false);assert.equal(result.payrollAuthority,false);assert.equal(result.attendanceAuthority,false);
 assert.match(result.reconciliationFingerprint,/^sha256:[a-f0-9]{64}$/);assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.latestKeyframe.points));
});

test('collapses semantic QoS replay without letting DUP change reconciliation identity',()=>{
 const baseline=admit();const r=receipt();r.messages.push(message('9768',{dup:true}));const result=admit(policy(),r);
 assert.equal(result.uniqueMessageCount,1);assert.equal(result.exactReplayCount,1);assert.equal(result.reconciliationFingerprint,baseline.reconciliationFingerprint);
});

test('rejects conflicting sequence replay and preserves arbitrary-precision sequence identity',()=>{
 const conflict=receipt();conflict.messages.push(message('9768',{payloadDigest:fp('d'),dup:true}));assert.throws(()=>admit(policy(),conflict),/conflicts at one source sequence/);
 const r=receipt();r.messages=[message('18446744073709551615')];assert.equal(admit(policy(),r).latestSequence,'18446744073709551615');
 const tooLarge=receipt();tooLarge.messages=[message('18446744073709551616')];assert.throws(()=>admit(policy(),tooLarge),/unsigned 64-bit/);
});

test('selects the latest key frame while allowing out-of-order arrival',()=>{
 const r=receipt();const later=message('9770',{cloudEventId:'2222bbbb-22cc-4ddd-8e33-ffffff444444',eventTime:'2026-09-27T11:59:59.8738457Z',recordedTime:'2026-09-27T11:59:59.8740000Z',payloadDigest:fp('d'),points:[point('cycleCount','2026-09-27T11:59:59.8737000Z','e'),point('temperature','2026-09-27T11:59:59.8738000Z','f')]});r.messages=[later,message()];
 const result=admit(policy(),r);assert.equal(result.uniqueMessageCount,2);assert.equal(result.latestSequence,'9770');assert.equal(result.outOfOrderArrivalCount,1);
});

test('requires the exact point set once in every key frame',()=>{
 const missing=receipt();missing.messages[0].points.pop();assert.throws(()=>admit(policy(),missing),/exact approved point set/);
 const duplicate=receipt();duplicate.messages[0].points.push(point('temperature','2026-09-27T11:59:58.8738000Z','c'));assert.throws(()=>admit(policy(),duplicate),/exact approved point set/);
 const unknown=receipt();unknown.messages[0].points[1].name='pressure';assert.throws(()=>admit(policy(),unknown),/exact approved point set/);
});

test('binds asset, topic, source metadata and every fabric fingerprint',()=>{
 for(const [field,value] of [['topic','azure-iot-operations/data/other'],['assetExternalId','44444444-4444-4444-8444-444444444444'],['dataFlowName','other'],['schemaFingerprint',fp('9')],['mappingFingerprint',fp('9')],['sourceScopeFingerprint',fp('9')],['brokerConfigFingerprint',fp('9')]]){
  const r=receipt();r[field]=value;assert.throws(()=>admit(policy(),r),/does not match approved authority/);
 }
 const wrongMessage=receipt();wrongMessage.messages[0].externalAssetId='44444444-4444-4444-8444-444444444444';assert.throws(()=>admit(policy(),wrongMessage),/does not match approved authority/);
 const wrongSource=receipt();wrongSource.messages[0].source='urn:Other:source';assert.throws(()=>admit(policy(),wrongSource),/does not match approved authority/);
});

test('requires MQTT v5 QoS 1, TLS, persistent delivery settings and no queue drop policy',()=>{
 for(const mutate of [p=>p.qos=0,p=>p.tlsEnabled=false,p=>p.requestDiskPersistence=false,p=>p.brokerPersistenceEnabled=false,p=>p.subscriberQueueStrategy='DropOldest',p=>p.authMethod='anonymous']){
  const p=policy();mutate(p);assert.throws(()=>createAzureIotOperationsKeyframeAuthority(p),/QoS 1|TLS|persistence|queue|authentication/);
 }
 const q0=receipt();q0.messages[0].qos=0;assert.throws(()=>admit(policy(),q0),/QoS 1/);
});

test('rejects retained snapshots, non-keyframes, writes and open captures',()=>{
 const retained=receipt();retained.messages[0].retain=true;assert.throws(()=>admit(policy(),retained),/retained/);
 const delta=receipt();delta.messages[0].type='ua-deltaframe';assert.throws(()=>admit(policy(),delta),/ua-keyframe/);
 const write=receipt();write.writePerformed=true;assert.throws(()=>admit(policy(),write),/writes are forbidden/);
 const open=receipt();open.captureClosed=false;assert.throws(()=>admit(policy(),open),/capture must be closed/);
});

test('rejects source, event and recorded times outside bounded clock policy',()=>{
 const outside=receipt();outside.messages[0].eventTime='2026-09-27T12:00:00.0000000Z';assert.throws(()=>admit(policy(),outside),/outside the approved window/);
 const late=receipt();late.messages[0].recordedTime='2026-09-27T12:05:00.0000001Z';assert.throws(()=>admit(policy(),late),/observation horizon/);
 const skew=receipt();skew.messages[0].points[0].sourceTimestamp='2026-09-27T11:59:55.0000000Z';assert.throws(()=>admit(policy(),skew),/clock-skew bound/);
});

test('requires zero scoped expiry, filter, processing, busy and error deltas',()=>{
 for(const field of ['expiredDelta','filteredDelta','droppedProcessingErrorDelta','droppedWhenBusyDelta','errorDelta']){const r=receipt();r.health[field]=1;assert.throws(()=>admit(policy(),r),/health evidence indicates loss or error/);}
 const category=receipt();category.health.metricCategory='other';assert.throws(()=>admit(policy(),category),/does not match approved authority/);
});

test('rejects secret-bearing, executable, sparse and unbounded evidence',()=>{
 const secret=receipt();secret.password='leak';assert.throws(()=>admit(policy(),secret),/secret or credential/);
 const executable=receipt();Object.defineProperty(executable,'observedAt',{enumerable:true,get(){return '2026-09-27T12:05:00.000Z';}});assert.throws(()=>admit(policy(),executable),/executable or hidden/);
 const sparse=receipt();sparse.messages.length=2;assert.throws(()=>admit(policy(),sparse),/sparse array/);
 const tooMany=receipt();tooMany.messages=Array.from({length:33},()=>message());assert.throws(()=>admit(policy(),tooMany),/messages exceed maxMessages/);
});

test('rejects identity ambiguity and malformed topic or point policy',()=>{
 const duplicatePointPolicy=policy();duplicatePointPolicy.expectedPointNames.push('temperature');assert.throws(()=>createAzureIotOperationsKeyframeAuthority(duplicatePointPolicy),/point names must be unique/);
 const wildcard=policy();wildcard.topic='azure-iot-operations/data/#';assert.throws(()=>createAzureIotOperationsKeyframeAuthority(wildcard),/exact MQTT topic/);
 const sameTime=receipt();sameTime.messages.push(message('9769',{cloudEventId:'2222bbbb-22cc-4ddd-8e33-ffffff444444',payloadDigest:fp('d')}));assert.throws(()=>admit(policy(),sameTime),/ambiguous latest key frame/);
 const crossSubscription=policy();crossSubscription.arcClusterId=crossSubscription.arcClusterId.replace(crossSubscription.subscriptionId,'55555555-5555-4555-8555-555555555555');assert.throws(()=>createAzureIotOperationsKeyframeAuthority(crossSubscription),/Azure resource scope/);
});

test('requires exact nonempty Azure resource ids without traversal suffixes',()=>{
 const emptyCluster=policy();emptyCluster.arcClusterId=emptyCluster.arcClusterId.replace('arc-factory-01','');assert.throws(()=>createAzureIotOperationsKeyframeAuthority(emptyCluster),/Azure resource scope/);
 const traversal=policy();traversal.arcClusterId+='/../../providers/Microsoft.Other/x';assert.throws(()=>createAzureIotOperationsKeyframeAuthority(traversal),/Azure resource scope/);
 const encoded=policy();encoded.customLocationId=encoded.customLocationId.replace('cl-factory-01','cl%2ffactory');assert.throws(()=>createAzureIotOperationsKeyframeAuthority(encoded),/Azure resource scope/);
});

test('rejects all-zero authority UUIDs',()=>{
 for(const field of ['azureTenantId','subscriptionId','assetExternalId']){const p=policy();p[field]='00000000-0000-0000-0000-000000000000';if(field==='subscriptionId'){p.arcClusterId=p.arcClusterId.replace(common.subscriptionId,p[field]);p.customLocationId=p.customLocationId.replace(common.subscriptionId,p[field]);}assert.throws(()=>createAzureIotOperationsKeyframeAuthority(p),/non-zero canonical UUIDs/);}
});

test('bounds exact topic and identity text by UTF-8 bytes',()=>{
 const hugeTopic=policy();hugeTopic.topic='x'.repeat(1_000_000);assert.throws(()=>createAzureIotOperationsKeyframeAuthority(hugeTopic),/topic exceeds/);
 const hugeSource=policy();hugeSource.cloudEventSource='x'.repeat(4097);assert.throws(()=>createAzureIotOperationsKeyframeAuthority(hugeSource),/cloudEventSource exceeds/);
 const hugeEvent=receipt();hugeEvent.messages[0].cloudEventId='😀'.repeat(2000);assert.throws(()=>admit(policy(),hugeEvent),/cloudEventId exceeds/);
});

test('binds every evidence cap into authority and reconciliation identity',()=>{
 const baseline=admit();
 for(const [field,value] of [['maxMessages',33],['maxPointsPerMessage',17],['maxSourceClockSkewSeconds',3]]){const p=policy();p[field]=value;const result=admit(p);assert.notEqual(result.authorityNamespace,baseline.authorityNamespace);assert.notEqual(result.reconciliationFingerprint,baseline.reconciliationFingerprint);}
});

test('allows the documented repeated CloudEvents id across distinct monotone sequences',()=>{
 const r=receipt();r.messages.push(message('9769',{eventTime:'2026-09-27T11:59:59.8738457Z',recordedTime:'2026-09-27T11:59:59.8740000Z',payloadDigest:fp('d'),points:[point('cycleCount','2026-09-27T11:59:59.8737000Z','e'),point('temperature','2026-09-27T11:59:59.8738000Z','f')]}));
 assert.equal(admit(policy(),r).uniqueMessageCount,2);
});

test('requires one stable persistent MQTT session for the full observation horizon',()=>{
 const clean=policy();clean.cleanStart=true;assert.throws(()=>createAzureIotOperationsKeyframeAuthority(clean),/persistent MQTT session/);
 const expired=policy();expired.sessionExpirySeconds=3600;assert.throws(()=>createAzureIotOperationsKeyframeAuthority(expired),/observation horizon/);
 const drift=receipt();drift.mqttClientId='other-client';assert.throws(()=>admit(policy(),drift),/does not match approved authority/);
});

test('quarantines chronological OPC UA sequence reset while retaining out-of-order arrival support',()=>{
 const r=receipt();r.messages.push(message('1',{eventTime:'2026-09-27T11:59:59.8738457Z',recordedTime:'2026-09-27T11:59:59.8740000Z',payloadDigest:fp('d'),points:[point('cycleCount','2026-09-27T11:59:59.8737000Z','e'),point('temperature','2026-09-27T11:59:59.8738000Z','f')]}));
 assert.throws(()=>admit(policy(),r),/sequence reset or regression/);
});
