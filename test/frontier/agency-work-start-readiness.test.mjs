import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createPostgresAgencyWorkStartAuthorityStore,evaluateAgencyWorkStartReadiness} from '../../src/frontier/agency-work-start-readiness.mjs';

const NOW='2026-10-05T06:10:00.000Z';
const ASSURANCE='a'.repeat(32);const NEW='b'.repeat(32);
const REQUEST={requestId:'R1',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v,n=32)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
const assignmentFp=()=>digest(JSON.stringify(stable({roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'})),24);
const authority=(overrides={})=>({tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',workerId:'W1',assuranceVersionId:ASSURANCE,assignmentFingerprint:assignmentFp(),checkedAt:'2026-10-04T10:00:00.000Z',coverageUntil:'2027-12-31T23:59:59.000Z',promotedAt:'2026-10-04T11:00:00.000Z',conflicted:false,acceptedResponseFingerprint:'1'.repeat(16),acceptedAction:'confirm_preferred_worker',acceptedAt:'2026-10-04T12:00:00.000Z',...overrides});
const authorityStore=(reads=[[authority()],[authority()]])=>{let i=0;return {async readAuthority(){return {rows:structuredClone(reads[Math.min(i++,reads.length-1)])};}};};
const continuity=(overrides={})=>({continuityPassed:true,reason:null,requestId:'R1',siteId:'S1',agencyId:'A1',workerId:'W1',assuranceVersionId:ASSURANCE,assignmentFingerprint:assignmentFp(),policyFingerprint:'c'.repeat(24),continuityFingerprint:'d'.repeat(32),independentSourceCount:2,directIdentityObserved:true,rankingImpact:'none',scheduleWriteAuthorized:false,payrollWriteAuthorized:false,clockingWriteAuthorized:false,...overrides});
const continuityStore={async readObservations(){return {rows:[]};}};
const policy={policyId:'S1-PACK-v1',siteId:'S1',roleId:'PACK-OP',minutesBeforeStart:60,minutesAfterStart:90,minIndependentSources:1,requireDirectIdentity:false,allowedSources:{turnstile:['access_pass']}};
const input=(overrides={})=>({tenantId:'T1',siteId:'S1',agencyId:'A1',request:structuredClone(REQUEST),workerId:'W1',now:NOW,policy:structuredClone(policy),authorityStore:authorityStore(),continuityStore,evaluateContinuity:async()=>continuity(),...overrides});

test('valid shift-start evidence is bound to the exact accepted/current RTW authority and grants no mutation or ranking authority',async()=>{
  let continuityInput=null;
  const result=await evaluateAgencyWorkStartReadiness(input({evaluateContinuity:async args=>{continuityInput=args;return continuity();}}));
  assert.equal(result.workStartReady,true);assert.equal(result.rankingImpact,'none');assert.equal(result.scheduleWriteAuthorized,false);assert.equal(result.payrollWriteAuthorized,false);assert.equal(result.clockingWriteAuthorized,false);assert.equal(result.workStartWriteAuthorized,false);
  assert.equal(continuityInput.workerBinding.workerId,'W1');assert.equal(continuityInput.workerBinding.assuranceVersionId,ASSURANCE);assert.equal(continuityInput.siteId,'S1');assert.match(result.readinessFingerprint,/^[0-9a-f]{32}$/);
  assert.doesNotMatch(JSON.stringify(result),/BADGE-123|provider-subject|signature-value|raw-image|1990-01-01|document-number|share-code|portal-token|raw-right-to-work/);
});

test('missing, conflicting, expired, and unaccepted authority fail before continuity evaluation',async()=>{
  const cases=[
    [[], 'work_start_authority_missing'],
    [[authority({conflicted:true})], 'work_start_current_assurance_conflicted'],
    [[authority({coverageUntil:'2026-10-05T07:00:00.000Z'})], 'work_start_current_assurance_does_not_cover_assignment'],
    [[authority({acceptedResponseFingerprint:'',acceptedAction:'',acceptedAt:null})], 'work_start_accepted_response_missing'],
  ];
  for(const [rows,reason] of cases){let calls=0;const result=await evaluateAgencyWorkStartReadiness(input({authorityStore:authorityStore([rows,rows]),evaluateContinuity:async()=>{calls+=1;return continuity();}}));assert.equal(result.workStartReady,false,reason);assert.equal(result.reason,reason);assert.equal(calls,0);assert.equal(result.scheduleWriteAuthorized,false);}
});

test('unknown assurance conflict evidence withholds readiness before continuity evaluation',async()=>{
  for(const value of [undefined,null,'unknown','',0,1,{},[], 'False','f ']){
    for(const postgres of [false,true]){
      let calls=0;
      const row=authority({conflicted:value});
      const reader=postgres?createPostgresAgencyWorkStartAuthorityStore({query:async()=>({rows:[row]})}):authorityStore([[row],[row]]);
      const result=await evaluateAgencyWorkStartReadiness(input({authorityStore:reader,evaluateContinuity:async()=>{calls++;return continuity();}}));
      assert.equal(result.workStartReady,false,`${String(value)} postgres=${postgres}`);
      assert.equal(result.reason,'work_start_current_assurance_conflict_unknown');
      assert.equal(calls,0);
      assert.equal(result.workStartWriteAuthorized,false);
    }
  }
});

test('explicit supported conflict booleans retain their meaning',async()=>{
  for(const value of [false,'f','false']){
    const row=authority({conflicted:value});
    const result=await evaluateAgencyWorkStartReadiness(input({authorityStore:authorityStore([[row],[row]])}));
    assert.equal(result.workStartReady,true);
  }
  for(const value of [true,'t','true']){
    const row=authority({conflicted:value});
    const result=await evaluateAgencyWorkStartReadiness(input({authorityStore:authorityStore([[row],[row]])}));
    assert.equal(result.reason,'work_start_current_assurance_conflicted');
  }
});

test('conflict evidence becoming unknown on the second authority read invalidates readiness',async()=>{
  const result=await evaluateAgencyWorkStartReadiness(input({authorityStore:authorityStore([[authority()],[authority({conflicted:null})]])}));
  assert.equal(result.workStartReady,false);
  assert.equal(result.reason,'work_start_current_assurance_conflict_unknown');
});

test('malformed coverage expiry cannot become open-ended assurance through either reader',async()=>{
  for(const value of ['', 'not-a-date', false, true, NaN, Infinity, {}, []]){
    for(const postgres of [false,true]){
      let calls=0;
      const row=authority({coverageUntil:value});
      const reader=postgres?createPostgresAgencyWorkStartAuthorityStore({query:async()=>({rows:[row]})}):authorityStore([[row],[row]]);
      const result=await evaluateAgencyWorkStartReadiness(input({authorityStore:reader,evaluateContinuity:async()=>{calls++;return continuity();}}));
      assert.equal(result.workStartReady,false,`${String(value)} postgres=${postgres}`);
      assert.equal(result.reason,'work_start_current_assurance_does_not_cover_assignment');
      assert.equal(calls,0);
    }
  }
});

test('explicit open-ended coverage and parseable future expiry retain compatibility',async()=>{
  for(const value of [null,'2027-12-31T23:59:59.000Z',new Date('2027-12-31T23:59:59.000Z')]){
    const row=authority({coverageUntil:value});
    const result=await evaluateAgencyWorkStartReadiness(input({authorityStore:authorityStore([[row],[row]])}));
    assert.equal(result.workStartReady,true);
  }
});

test('coverage expiry becoming malformed during continuity evaluation invalidates readiness',async()=>{
  const result=await evaluateAgencyWorkStartReadiness(input({authorityStore:authorityStore([[authority({coverageUntil:null})],[authority({coverageUntil:'not-a-date'})]])}));
  assert.equal(result.workStartReady,false);
  assert.equal(result.reason,'work_start_current_assurance_does_not_cover_assignment');
});

test('overlength authority identifiers cannot match a permitted prefix or mint work-start readiness',async()=>{
  const workerId='W'.repeat(100);
  const valid=authority({workerId});
  const accepted=await evaluateAgencyWorkStartReadiness(input({workerId,authorityStore:authorityStore([[valid],[valid]]),evaluateContinuity:async()=>continuity({workerId})}));
  assert.equal(accepted.workStartReady,true);
  for(const field of ['workerId','siteId','requestId','agencyId']){
    const scoped=field==='workerId'?{workerId}:{[field]:field==='siteId'?'S'.repeat(100):field==='requestId'?'R'.repeat(100):'A'.repeat(100)};
    const request={...REQUEST,requestId:scoped.requestId??REQUEST.requestId};
    const row=authority({...scoped,[field]:(scoped[field]??valid[field]).concat('-forged')});
    const args=input({...scoped,request,authorityStore:authorityStore([[row],[row]]),evaluateContinuity:async()=>continuity({...scoped})});
    const result=await evaluateAgencyWorkStartReadiness(args);
    assert.equal(result.workStartReady,false,field);
    assert.equal(result.reason,'work_start_authority_scope_mismatch',field);
    const padded=authority({...scoped,[field]:(scoped[field]??valid[field])+' '.repeat(20)});
    const paddedResult=await evaluateAgencyWorkStartReadiness(input({...scoped,request,authorityStore:authorityStore([[padded],[padded]]),evaluateContinuity:async()=>continuity({...scoped})}));
    assert.equal(paddedResult.workStartReady,false,`${field} padded`);
  }
  for(const field of ['assuranceVersionId','assignmentFingerprint','acceptedResponseFingerprint']){
    const row=authority({[field]:valid[field]+'forged'});
    const result=await evaluateAgencyWorkStartReadiness(input({authorityStore:authorityStore([[row],[row]])}));
    assert.equal(result.workStartReady,false,field);
  }
});

test('identity continuity must match exact worker, assignment and authoritative assurance and must itself carry no write/ranking authority',async()=>{
  const cases=[
    [continuity({workerId:'OTHER'}),'work_start_identity_continuity_scope_mismatch'],
    [continuity({assuranceVersionId:NEW}),'work_start_identity_continuity_authority_mismatch'],
    [continuity({assignmentFingerprint:'e'.repeat(24)}),'work_start_identity_continuity_authority_mismatch'],
    [continuity({continuityFingerprint:null}),'work_start_identity_continuity_evidence_invalid'],
    [continuity({rankingImpact:'score_bonus'}),'work_start_identity_continuity_authority_invalid'],
    [continuity({clockingWriteAuthorized:true}),'work_start_identity_continuity_authority_invalid'],
  ];
  for(const [evidence,reason] of cases){const result=await evaluateAgencyWorkStartReadiness(input({evaluateContinuity:async()=>evidence}));assert.equal(result.workStartReady,false,reason);assert.equal(result.reason,reason);assert.equal(result.workStartWriteAuthorized,false);}
});

test('a current RTW/acceptance change during identity evaluation invalidates an otherwise valid continuity result',async()=>{
  const first=authority();const second=authority({assuranceVersionId:NEW,acceptedResponseFingerprint:'2'.repeat(16)});
  const result=await evaluateAgencyWorkStartReadiness(input({authorityStore:authorityStore([[first],[second]])}));
  assert.equal(result.workStartReady,false);assert.equal(result.reason,'work_start_authority_changed_during_continuity_evaluation');assert.equal(result.scheduleWriteAuthorized,false);
});

test('unavailable authority or continuity dependencies and evaluation failures fail closed',async()=>{
  const noAuth=await evaluateAgencyWorkStartReadiness(input({authorityStore:null}));assert.equal(noAuth.reason,'work_start_authority_store_unavailable');
  const noContinuity=await evaluateAgencyWorkStartReadiness(input({continuityStore:null}));assert.equal(noContinuity.reason,'work_start_identity_continuity_unavailable');
  const readFailure=await evaluateAgencyWorkStartReadiness(input({authorityStore:{async readAuthority(){throw new Error('db down');}}}));assert.equal(readFailure.reason,'work_start_authority_store_unavailable');
  const evalFailure=await evaluateAgencyWorkStartReadiness(input({evaluateContinuity:async()=>{throw new Error('continuity down');}}));assert.equal(evalFailure.reason,'work_start_identity_continuity_unavailable');
});

test('PostgreSQL authority reader is SELECT-only, exact-scope, privacy-minimised and joins current assurance to accepted response evidence',async()=>{
  let captured=null;
  const pg=createPostgresAgencyWorkStartAuthorityStore({query:async(sql,values)=>{captured={sql,values};return {rows:[{tenant_id:'T1',site_id:'S1',request_id:'R1',agency_id:'A1',worker_id:'W1',assurance_version_id:ASSURANCE,assignment_fingerprint:assignmentFp(),checked_at:'2026-10-04T10:00:00Z',coverage_until:'2027-12-31T23:59:59Z',promoted_at:'2026-10-04T11:00:00Z',conflicted:false,token_fingerprint:'1'.repeat(16),action:'confirm_preferred_worker',consumed_at:'2026-10-04T12:00:00Z'}]};}});
  const result=await evaluateAgencyWorkStartReadiness(input({authorityStore:pg}));assert.equal(result.workStartReady,true);
  assert.ok(captured.sql.trim().startsWith('WITH current AS MATERIALIZED'));assert.doesNotMatch(captured.sql,/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);assert.match(captured.sql,/wfm_agency_rtw_assurance_current/);assert.match(captured.sql,/wfm_agency_portal_token_consumptions/);
  assert.deepEqual(captured.values.slice(0,5),['T1','S1','R1','A1','W1']);assert.equal(captured.values[5],NOW);
  assert.doesNotMatch(captured.sql,/badge|photo|biometric|date_of_birth|share_code|document_number|raw_payload|signature/i);
});

test('5,000 forged or stale continuity decisions produce zero work-start-ready outcomes',async()=>{
  let passes=0;
  for(let i=0;i<5000;i+=1){const evidence=i%2===0?continuity({assuranceVersionId:NEW}):continuity({continuityFingerprint:'f'.repeat(31)+'x'});const result=await evaluateAgencyWorkStartReadiness(input({evaluateContinuity:async()=>evidence}));if(result.workStartReady)passes+=1;}
  assert.equal(passes,0);
});

test('identical authoritative and continuity evidence produces deterministic privacy-minimised readiness evidence',async()=>{
  const [a,b]=await Promise.all([evaluateAgencyWorkStartReadiness(input()),evaluateAgencyWorkStartReadiness(input())]);
  assert.equal(a.workStartReady,true);assert.equal(b.workStartReady,true);assert.equal(a.readinessFingerprint,b.readinessFingerprint);assert.equal(a.authorityFingerprint,b.authorityFingerprint);assert.equal(a.continuityFingerprint,b.continuityFingerprint);
  assert.deepEqual(Object.keys(a).sort(),['acceptedResponseFingerprint','agencyId','assignmentFingerprint','assuranceVersionId','authorityBoundary','authorityFingerprint','clockingWriteAuthorized','consistencyRule','continuityFingerprint','directIdentityObserved','independentSourceCount','payrollWriteAuthorized','policyFingerprint','privacyBoundary','rankingImpact','readinessFingerprint','reason','requestId','scheduleWriteAuthorized','siteId','version','workStartReady','workStartWriteAuthorized','workerId'].sort());
});
