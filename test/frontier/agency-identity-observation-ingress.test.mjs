import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createHmacJsonAgencyIdentityObservationAdapter,
  createPostgresAgencyIdentityObservationIngressStore,
  ingestAgencyIdentityObservation,
} from '../../src/frontier/agency-identity-observation-ingress.mjs';

const SECRET='0123456789abcdef0123456789abcdef0123456789abcdef';
const RECEIVED='2026-10-05T05:58:10.000Z';
const TS=String(Math.floor(Date.parse(RECEIVED)/1000));
const ASSIGNMENT='a'.repeat(24);
const ASSURANCE='b'.repeat(32);
const SUBJECT='c'.repeat(32);
const payload=(overrides={})=>({eventId:'evt-001',sourceSubjectRef:'badge-raw-123',signalType:'access_pass',observedAt:'2026-10-05T05:58:00.000Z',rawBadgeNumber:'BADGE-123',photo:'RAW-PHOTO',...overrides});
const sign=body=>crypto.createHmac('sha256',SECRET).update(TS).update('.').update(body).digest('hex');
const adapter=createHmacJsonAgencyIdentityObservationAdapter({secret:SECRET});
const registry={async resolveSource(){return {sourceSystemId:'turnstile',adapter,allowedSignalTypes:['access_pass'],maxEventAgeMinutes:60,maxFutureSkewSeconds:30};}};
const binding=(overrides={})=>({tenantId:'T1',siteId:'S1',requestId:'R1',sourceSystemId:'turnstile',agencyId:'A1',workerId:'W1',assignmentFingerprint:ASSIGNMENT,assuranceVersionId:ASSURANCE,subjectFingerprint:SUBJECT,...overrides});
const resolver={async resolveBinding(){return binding();}};
function memoryStore(){
  const rows=new Map();
  return {rows,async appendObservation(row){const key=`${row.tenantId}|${row.sourceSystemId}|${row.sourceEventFingerprint}`;const before=rows.get(key);if(before){if(JSON.stringify(before)!==JSON.stringify(row))throw new Error('identity_observation_replay_conflict');return {duplicate:true,row:structuredClone(before)};}rows.set(key,structuredClone(row));return {duplicate:false,row:structuredClone(row)};}};
}
function makeInput(overrides={}){
  const body=JSON.stringify(payload());
  return {tenantId:'T1',siteId:'S1',requestId:'R1',sourceSystemId:'turnstile',rawBody:body,headers:{'x-wfm-timestamp':TS,'x-wfm-signature':sign(body)},receivedAt:RECEIVED,sourceRegistry:registry,bindingResolver:resolver,continuityStore:memoryStore(),...overrides};
}

test('authenticated raw webhook is bound server-side to exact assignment and RTW assurance without mutation authority',async()=>{
  const store=memoryStore();
  const result=await ingestAgencyIdentityObservation(makeInput({continuityStore:store}));
  assert.equal(result.accepted,true);assert.equal(result.duplicate,false);assert.equal(result.workerId,'W1');assert.equal(result.assuranceVersionId,ASSURANCE);assert.equal(result.assignmentFingerprint,ASSIGNMENT);
  assert.equal(result.rankingImpact,'none');assert.equal(result.scheduleWriteAuthorized,false);assert.equal(result.payrollWriteAuthorized,false);assert.equal(result.clockingWriteAuthorized,false);
  assert.match(result.sourceEventFingerprint,/^[0-9a-f]{32}$/);assert.match(result.authFingerprint,/^[0-9a-f]{32}$/);assert.match(result.bindingFingerprint,/^[0-9a-f]{32}$/);assert.equal(store.rows.size,1);
  const stored=[...store.rows.values()][0];assert.equal(stored.subjectFingerprint,SUBJECT);assert.equal(stored.sourceSystemId,'turnstile');assert.equal(stored.signalType,'access_pass');
});

test('tampered body, parsed-object substitution, bad signature and stale signature fail before binding or storage',async()=>{
  let resolves=0;let writes=0;
  const guardedResolver={async resolveBinding(){resolves+=1;return binding();}};
  const guardedStore={async appendObservation(){writes+=1;return {duplicate:false};}};
  const good=makeInput({bindingResolver:guardedResolver,continuityStore:guardedStore});
  const tampered=await ingestAgencyIdentityObservation({...good,rawBody:JSON.stringify(payload({eventId:'tampered'}))});
  const parsed=await ingestAgencyIdentityObservation({...good,rawBody:payload()});
  const badSig=await ingestAgencyIdentityObservation({...good,headers:{...good.headers,'x-wfm-signature':'0'.repeat(64)}});
  const staleAdapter=createHmacJsonAgencyIdentityObservationAdapter({secret:SECRET,toleranceSeconds:30});
  const staleRegistry={async resolveSource(){return {sourceSystemId:'turnstile',adapter:staleAdapter,allowedSignalTypes:['access_pass']};}};
  const stale=await ingestAgencyIdentityObservation({...good,receivedAt:'2026-10-05T06:10:00Z',sourceRegistry:staleRegistry});
  for(const result of [tampered,parsed,badSig,stale]){assert.equal(result.accepted,false);assert.equal(result.reason,'identity_observation_authentication_failed');}
  assert.equal(resolves,0);assert.equal(writes,0);
});

test('unknown source, source spoofing and unapproved signal fail closed',async()=>{
  const body=JSON.stringify(payload());const base=makeInput({rawBody:body,headers:{'x-wfm-timestamp':TS,'x-wfm-signature':sign(body)}});
  const unknown=await ingestAgencyIdentityObservation({...base,sourceRegistry:{async resolveSource(){return null;}}});
  const spoof=await ingestAgencyIdentityObservation({...base,sourceRegistry:{async resolveSource(){return {sourceSystemId:'other',adapter,allowedSignalTypes:['access_pass']};}}});
  const unapproved=await ingestAgencyIdentityObservation({...base,sourceRegistry:{async resolveSource(){return {sourceSystemId:'turnstile',adapter,allowedSignalTypes:['attendance_clock_in']};}}});
  assert.equal(unknown.reason,'identity_observation_source_untrusted');assert.equal(spoof.reason,'identity_observation_source_untrusted');assert.equal(unapproved.reason,'identity_observation_signal_untrusted');
});

test('binding resolver cannot move authenticated evidence across tenant/site/request/source or invent assurance scope',async()=>{
  const mismatches=[{tenantId:'OTHER'},{siteId:'OTHER'},{requestId:'OTHER'},{sourceSystemId:'other'},{assuranceVersionId:'not-hex'}];
  for(const override of mismatches){const result=await ingestAgencyIdentityObservation(makeInput({bindingResolver:{async resolveBinding(){return binding(override);}}}));assert.equal(result.accepted,false);assert.equal(result.reason,'identity_observation_binding_invalid');}
});

test('exact replays are idempotent but a validly signed changed payload reusing one event id fails closed',async()=>{
  const store=memoryStore();
  const first=makeInput({continuityStore:store});
  const a=await ingestAgencyIdentityObservation(first);const b=await ingestAgencyIdentityObservation(first);
  assert.equal(a.accepted,true);assert.equal(a.duplicate,false);assert.equal(b.accepted,true);assert.equal(b.duplicate,true);assert.equal(store.rows.size,1);
  const changedBody=JSON.stringify(payload({signalType:'attendance_clock_in'}));
  const registry2={async resolveSource(){return {sourceSystemId:'turnstile',adapter,allowedSignalTypes:['access_pass','attendance_clock_in'],maxEventAgeMinutes:60,maxFutureSkewSeconds:30};}};
  const conflict=await ingestAgencyIdentityObservation({...first,rawBody:changedBody,headers:{'x-wfm-timestamp':TS,'x-wfm-signature':sign(changedBody)},sourceRegistry:registry2});
  assert.equal(conflict.accepted,false);assert.equal(conflict.reason,'identity_observation_replay_conflict');assert.equal(store.rows.size,1);
});

test('stale and future observations are rejected after authentication and before storage',async()=>{
  for(const observedAt of ['2026-10-05T03:00:00Z','2026-10-05T06:10:00Z']){
    const body=JSON.stringify(payload({observedAt}));let writes=0;
    const result=await ingestAgencyIdentityObservation(makeInput({rawBody:body,headers:{'x-wfm-timestamp':TS,'x-wfm-signature':sign(body)},continuityStore:{async appendObservation(){writes+=1;return {duplicate:false};}}}));
    assert.equal(result.accepted,false);assert.equal(result.reason,'identity_observation_event_time_invalid');assert.equal(writes,0);
  }
});

test('privacy boundary keeps raw subject, badge, photo, signature, body and secret out of stored and returned evidence',async()=>{
  const store=memoryStore();const input=makeInput({continuityStore:store});const result=await ingestAgencyIdentityObservation(input);
  const serialized=JSON.stringify({result,stored:[...store.rows.values()]});
  assert.doesNotMatch(serialized,/badge-raw-123|BADGE-123|RAW-PHOTO/);assert.equal(serialized.includes(input.rawBody),false);assert.equal(serialized.includes(input.headers['x-wfm-signature']),false);assert.equal(serialized.includes(SECRET),false);
});

test('PostgreSQL store writes provenance before observation, uses fresh-read conflict handling and detects changed replay content',async()=>{
  const row={tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',workerId:'W1',assignmentFingerprint:ASSIGNMENT,assuranceVersionId:ASSURANCE,sourceSystemId:'turnstile',sourceEventFingerprint:'d'.repeat(32),subjectFingerprint:SUBJECT,signalType:'access_pass',observedAt:'2026-10-05T05:58:00Z',sourceAuthFingerprint:'e'.repeat(32),bindingFingerprint:'f'.repeat(32),ingressVersion:'agency-identity-observation-ingress-v0.1.0',receivedAt:RECEIVED};
  const calls=[];const dbRow={tenant_id:'T1',site_id:'S1',request_id:'R1',agency_id:'A1',worker_id:'W1',assignment_fingerprint:ASSIGNMENT,assurance_version_id:ASSURANCE,source_system_id:'turnstile',source_event_fingerprint:'d'.repeat(32),subject_fingerprint:SUBJECT,signal_type:'access_pass',observed_at:'2026-10-05T05:58:00Z'};
  const receiptRow={tenant_id:'T1',source_system_id:'turnstile',source_event_fingerprint:'d'.repeat(32),source_auth_fingerprint:'e'.repeat(32),binding_fingerprint:'f'.repeat(32),ingress_version:'agency-identity-observation-ingress-v0.1.0',received_at:RECEIVED};
  const store=createPostgresAgencyIdentityObservationIngressStore({query:async(sql,values)=>{calls.push({sql,values});if(calls.length===1)return {rows:[receiptRow]};if(calls.length===2)return {rows:[]};return {rows:[dbRow]};}});
  const result=await store.appendObservation(row);assert.equal(result.duplicate,true);assert.equal(calls.length,3);assert.match(calls[0].sql,/ingress_receipts/i);assert.match(calls[0].sql,/ON CONFLICT/i);assert.match(calls[1].sql,/ON CONFLICT/i);assert.match(calls[2].sql,/^\s*SELECT/i);
  let conflictCalls=0;
  const conflictStore=createPostgresAgencyIdentityObservationIngressStore({query:async(sql)=>{conflictCalls+=1;if(conflictCalls===1)return {rows:[receiptRow]};if(/INSERT INTO wfm_agency_identity_continuity_observations/i.test(sql))return {rows:[]};return {rows:[{...dbRow,worker_id:'OTHER'}]};}});
  await assert.rejects(()=>conflictStore.appendObservation(row),/identity_observation_replay_conflict/);
});

test('5,000 forged or replay-conflicting observations produce zero additional durable identities',async()=>{
  const store=memoryStore();const first=makeInput({continuityStore:store});const initial=await ingestAgencyIdentityObservation(first);assert.equal(initial.accepted,true);
  let forgedAccepted=0;let conflictAccepted=0;
  for(let i=0;i<5000;i+=1){const forged=await ingestAgencyIdentityObservation({...first,headers:{...first.headers,'x-wfm-signature':crypto.randomBytes(32).toString('hex')}});if(forged.accepted)forgedAccepted+=1;}
  const changedBody=JSON.stringify(payload({signalType:'attendance_clock_in'}));const registry2={async resolveSource(){return {sourceSystemId:'turnstile',adapter,allowedSignalTypes:['access_pass','attendance_clock_in'],maxEventAgeMinutes:60,maxFutureSkewSeconds:30};}};
  for(let i=0;i<100;i+=1){const conflict=await ingestAgencyIdentityObservation({...first,rawBody:changedBody,headers:{'x-wfm-timestamp':TS,'x-wfm-signature':sign(changedBody)},sourceRegistry:registry2});if(conflict.accepted)conflictAccepted+=1;}
  assert.equal(forgedAccepted,0);assert.equal(conflictAccepted,0);assert.equal(store.rows.size,1);
});
