import test from 'node:test';
import assert from 'node:assert/strict';
import {createIntegrationInstanceObservationAuthority} from './integration-instance-observation-authority.mjs';

const sha=c=>`sha256:${c.repeat(64)}`;
const policy=()=>({provider:'oracle-integration-cloud',wfmTenantId:'tenant-uk',connectionId:'oic-1',endpointOrigin:'https://acme.integration.uk-london-1.ocp.oraclecloud.com',serviceInstance:'acme-oic',integrationId:'WFM_FACTORY_SYNC',integrationVersion:'01.00.0000',primaryTrackingName:'WFM_BATCH_ID',primaryTrackingValue:'batch-2026-09-27-01',dataset:'manufacturing-workforce-events',sourceScopeFingerprint:sha('a'),principalFingerprint:sha('b'),schemaFingerprint:sha('c'),mappingFingerprint:sha('d'),expectedCheckpointPredecessor:'cp:88',windowStart:'2026-09-27T08:00:00.000Z',windowEnd:'2026-09-27T09:00:00.000Z',expectedObservedAt:'2026-09-27T09:10:00.000Z',maxObservations:8,maxRecords:10000});
const observation=(status,observedAt,lastTrackedTime,digest)=>({instanceId:'XkDtR_wnEeypSFfBhM5b3Q',integrationId:'WFM_FACTORY_SYNC',integrationVersion:'01.00.0000',status,pkName:'WFM_BATCH_ID',pkValue:'batch-2026-09-27-01',trackings:[{name:'WFM_BATCH_ID',value:'batch-2026-09-27-01',primary:true}],creationDate:'2026-09-27T09:00:10.000Z',lastTrackedTime,isDataAccurate:status==='COMPLETED',providerPayloadDigest:digest,observedAt});
const receipt=()=>({provider:'oracle-integration-cloud',wfmTenantId:'tenant-uk',connectionId:'oic-1',endpointOrigin:'https://acme.integration.uk-london-1.ocp.oraclecloud.com',serviceInstance:'acme-oic',method:'GET',resource:'/ic/api/integration/v1/monitoring/instances/XkDtR_wnEeypSFfBhM5b3Q',integrationId:'WFM_FACTORY_SYNC',integrationVersion:'01.00.0000',primaryTrackingName:'WFM_BATCH_ID',primaryTrackingValue:'batch-2026-09-27-01',principalFingerprint:sha('b'),schemaFingerprint:sha('c'),mappingFingerprint:sha('d'),sourceScopeFingerprint:sha('a'),checkpointPredecessor:'cp:88',windowStart:'2026-09-27T08:00:00.000Z',windowEnd:'2026-09-27T09:00:00.000Z',observedAt:'2026-09-27T09:10:00.000Z',observations:[observation('IN_PROGRESS','2026-09-27T09:01:00.000Z','2026-09-27T09:00:59.000Z',sha('e')),observation('COMPLETED','2026-09-27T09:02:00.000Z','2026-09-27T09:01:50.000Z',sha('f'))],deliveryReceipt:{dataset:'manufacturing-workforce-events',instanceId:'XkDtR_wnEeypSFfBhM5b3Q',successful:true,complete:true,recordCount:240,payloadDigest:sha('9'),schemaFingerprint:sha('c'),mappingFingerprint:sha('d'),sourceScopeFingerprint:sha('a'),windowStart:'2026-09-27T08:00:00.000Z',windowEnd:'2026-09-27T09:00:00.000Z',observedAt:'2026-09-27T09:03:00.000Z'}});

test('admits exact completed instance plus complete downstream delivery as reconciliation evidence only',()=>{
 const decision=createIntegrationInstanceObservationAuthority(policy()).admit(receipt());
 assert.equal(decision.integrationDeliveryReconciliationCandidate,true);assert.equal(decision.instanceId,'XkDtR_wnEeypSFfBhM5b3Q');assert.equal(decision.deliveryRecordCount,240);assert.equal(decision.observationCount,2);
 for(const field of ['checkpointAdvanceAllowed','deletionAuthority','operationalDecisionAuthority','causalClaimAuthority','writeBackAuthority','payrollAuthority','attendanceAuthority','providerRecoveryAuthority']) assert.equal(decision[field],false);
 assert.equal(Object.isFrozen(decision),true);assert.equal(Object.isFrozen(decision.delivery),true);
});

test('binds Oracle origin service route integration business identity fingerprints predecessor and window',()=>{
 const authority=createIntegrationInstanceObservationAuthority(policy());
 for(const mutate of [v=>v.endpointOrigin='https://other.integration.uk-london-1.ocp.oraclecloud.com',v=>v.serviceInstance='other',v=>v.method='POST',v=>v.resource='/ic/api/integration/v1/monitoring/instances/other',v=>v.integrationId='OTHER',v=>v.integrationVersion='02.00.0000',v=>v.primaryTrackingValue='other-batch',v=>v.principalFingerprint=sha('0'),v=>v.checkpointPredecessor='cp:87',v=>v.windowEnd='2026-09-27T09:01:00.000Z']){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/origin|service|method|resource|instance|integration|version|tracking|principal|predecessor|window/i);}
 assert.throws(()=>createIntegrationInstanceObservationAuthority({...policy(),endpointOrigin:'https://acme.integration.uk-london-1.ocp.oraclecloud.com:8443'}),/origin|port/i);
});

test('requires a monotone nonterminal to completed lifecycle with exact replay collapse',()=>{
 const authority=createIntegrationInstanceObservationAuthority(policy());
 const replay=receipt();replay.observations.splice(1,0,{...replay.observations[0],observedAt:'2026-09-27T09:01:10.000Z'});assert.equal(authority.admit(replay).uniqueObservationCount,2);
 const terminalReplay=receipt();terminalReplay.observations.push({...terminalReplay.observations[1],observedAt:'2026-09-27T09:02:30.000Z'});assert.equal(authority.admit(terminalReplay).uniqueObservationCount,2);
 const terminalConflict=receipt();terminalConflict.observations.push({...terminalConflict.observations[1],lastTrackedTime:'2026-09-27T09:02:10.000Z',providerPayloadDigest:sha('8'),observedAt:'2026-09-27T09:02:30.000Z'});assert.throws(()=>authority.admit(terminalConflict),/terminal|completed|conflict/i);
 const accuracyConflict=receipt();accuracyConflict.observations.splice(1,0,{...accuracyConflict.observations[0],isDataAccurate:true,observedAt:'2026-09-27T09:01:10.000Z'});assert.throws(()=>authority.admit(accuracyConflict),/accuracy|conflict|digest/i);
 for(const mutate of [v=>v.observations=[v.observations[1]],v=>v.observations[0].status='FAILED',v=>v.observations[1].status='ABORTED',v=>v.observations.reverse(),v=>v.observations[1].observedAt=v.observations[0].observedAt,v=>v.observations[1].providerPayloadDigest=v.observations[0].providerPayloadDigest,v=>v.observations[1].lastTrackedTime=v.observations[0].lastTrackedTime]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/observation|lifecycle|status|completed|order|time|conflict|digest/i);}
});

test('rejects identity drift inaccurate completion ambiguous tracking and impossible provider time',()=>{
 const authority=createIntegrationInstanceObservationAuthority(policy());
 for(const mutate of [v=>v.observations[1].instanceId='other',v=>v.observations[1].integrationVersion='02.00.0000',v=>v.observations[1].pkValue='other',v=>v.observations[1].trackings[0].primary=false,v=>v.observations[1].trackings.push({name:'PII',value:'hidden',primary:false}),v=>v.observations[1].isDataAccurate=false,v=>v.observations[1].lastTrackedTime='2026-09-27T09:02:01.000Z',v=>v.observations[1].creationDate='2026-09-27T09:03:00.000Z']){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/instance|version|tracking|primary|accurate|time|creation/i);}
});

test('preserves exact Unicode business identifiers without normalization collisions',()=>{
 const unicode='作業班 é';const approved=policy();approved.primaryTrackingValue=unicode;const value=receipt();value.primaryTrackingValue=unicode;
 for(const item of value.observations){item.pkValue=unicode;item.trackings[0].value=unicode;}
 const decision=createIntegrationInstanceObservationAuthority(approved).admit(value);assert.equal(decision.primaryTrackingValue,unicode);
 const normalized=receipt();normalized.primaryTrackingValue='作業班 é';for(const item of normalized.observations){item.pkValue='作業班 é';item.trackings[0].value='作業班 é';}
 assert.throws(()=>createIntegrationInstanceObservationAuthority(approved).admit(normalized),/tracking|scope/i);
});

test('binds provider creation time and authority caps into the decision fingerprint',()=>{
 const base=createIntegrationInstanceObservationAuthority(policy()).admit(receipt());
 const changedCreation=receipt();for(const item of changedCreation.observations)item.creationDate='2026-09-27T09:00:11.000Z';
 const creationDecision=createIntegrationInstanceObservationAuthority(policy()).admit(changedCreation);assert.notEqual(base.reconciliationFingerprint,creationDecision.reconciliationFingerprint);assert.equal(creationDecision.creationDate,'2026-09-27T09:00:11.000Z');
 const wider={...policy(),maxObservations:64,maxRecords:999999};const capDecision=createIntegrationInstanceObservationAuthority(wider).admit(receipt());assert.notEqual(base.reconciliationFingerprint,capDecision.reconciliationFingerprint);assert.equal(capDecision.maxObservations,64);assert.equal(capDecision.maxRecords,999999);
});

test('requires complete successful scope-bound delivery after provider completion',()=>{
 const authority=createIntegrationInstanceObservationAuthority(policy());
 for(const mutate of [v=>delete v.deliveryReceipt,v=>v.deliveryReceipt.successful=false,v=>v.deliveryReceipt.complete=false,v=>v.deliveryReceipt.instanceId='other',v=>v.deliveryReceipt.dataset='other',v=>v.deliveryReceipt.recordCount=10001,v=>v.deliveryReceipt.schemaFingerprint=sha('0'),v=>v.deliveryReceipt.sourceScopeFingerprint=sha('0'),v=>v.deliveryReceipt.observedAt='2026-09-27T09:02:00.000Z',v=>v.deliveryReceipt.observedAt='2026-09-27T09:01:00.000Z']){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/delivery|successful|complete|instance|dataset|record|schema|scope|after/i);}
});

test('rejects oversized sparse secret executable and hidden evidence deterministically',()=>{
 const authority=createIntegrationInstanceObservationAuthority(policy());
 const sparse=receipt();sparse.observations=new Array(2);assert.throws(()=>authority.admit(sparse),/sparse|array/i);
 let getterHits=0;const accessorArray=receipt();const first=accessorArray.observations[0];Object.defineProperty(accessorArray.observations,'0',{enumerable:true,get(){getterHits++;return first;}});assert.throws(()=>authority.admit(accessorArray),/executable|array/i);assert.equal(getterHits,0);
 const hiddenArray=receipt();Object.defineProperty(hiddenArray.observations,'0',{enumerable:false,value:hiddenArray.observations[0]});assert.throws(()=>authority.admit(hiddenArray),/hidden|array/i);
 const inheritedArray=receipt();Object.setPrototypeOf(inheritedArray.observations,Object.create(Array.prototype));assert.throws(()=>authority.admit(inheritedArray),/prototype|array/i);
 const numericAlias=receipt();numericAlias.observations['00']=numericAlias.observations[0];assert.throws(()=>authority.admit(numericAlias),/custom|array/i);
 const secret=receipt();secret.accessToken='nope';assert.throws(()=>authority.admit(secret),/secret|allowed/i);
 const accessor=receipt();Object.defineProperty(accessor,'clientSecret',{enumerable:true,get(){throw new Error('executed');}});assert.throws(()=>authority.admit(accessor),/secret|credential/i);
 const hidden=receipt();Object.defineProperty(hidden.observations[0],'hidden',{enumerable:false,value:true});assert.throws(()=>authority.admit(hidden),/hidden|allowed/i);
 const a=authority.admit(receipt()),b=authority.admit(receipt());assert.equal(a.reconciliationFingerprint,b.reconciliationFingerprint);
});
