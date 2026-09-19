import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createPostgresAgencyWorkStartPermitStore,consumeAgencyWorkStartPermitAtIngress,evaluateAgencyWorkStartPermit} from '../../src/frontier/agency-work-start-permit.mjs';

const NOW='2026-10-05T06:10:00.000Z';
const ASSURANCE='a'.repeat(32);
const REQUEST={requestId:'R1',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v,n=32)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
const ASSIGNMENT=digest(JSON.stringify(stable({roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'})),24);
const policy={policyId:'S1-PACK-v1',siteId:'S1',roleId:'PACK-OP',minutesBeforeStart:60,minutesAfterStart:90,minIndependentSources:1,requireDirectIdentity:false,allowedSources:{turnstile:['access_pass']}};
const readiness=(overrides={})=>({version:'agency-work-start-readiness-v0.1.0',workStartReady:true,reason:null,requestId:'R1',siteId:'S1',agencyId:'A1',workerId:'W1',assuranceVersionId:ASSURANCE,assignmentFingerprint:ASSIGNMENT,acceptedResponseFingerprint:'1'.repeat(16),authorityFingerprint:'2'.repeat(32),continuityFingerprint:'3'.repeat(32),policyFingerprint:'4'.repeat(24),readinessFingerprint:'5'.repeat(32),rankingImpact:'none',scheduleWriteAuthorized:false,payrollWriteAuthorized:false,clockingWriteAuthorized:false,workStartWriteAuthorized:false,...overrides});
const command=(r=readiness(),overrides={})=>({type:'shadow_work_start_admission',tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',workerId:'W1',assuranceVersionId:r.assuranceVersionId,assignmentFingerprint:r.assignmentFingerprint,acceptedResponseFingerprint:r.acceptedResponseFingerprint,authorityFingerprint:r.authorityFingerprint,continuityFingerprint:r.continuityFingerprint,policyFingerprint:r.policyFingerprint,readinessFingerprint:r.readinessFingerprint,...overrides});
function fakeStore(onState=()=>{}){return {async withLockedSnapshot(scope,evaluate){onState(true,scope);try{return await evaluate({query:async()=>({rows:[]}),lockRow:{}});}finally{onState(false,scope);}}};}
const input=(overrides={})=>{const r=readiness();return {tenantId:'T1',siteId:'S1',agencyId:'A1',request:structuredClone(REQUEST),workerId:'W1',now:NOW,policy:structuredClone(policy),readiness:r,permitStore:fakeStore(),evaluateReadiness:async()=>structuredClone(r),shadowWorkStartCommand:async permit=>permit.consume(command(r)),...overrides};};

test('valid work-start permit is one-shot, transaction-scoped, privacy-minimised and grants no ranking or mutation authority',async()=>{
  let active=false;let capturedPermit=null;
  const r=readiness();
  const result=await evaluateAgencyWorkStartPermit(input({readiness:r,evaluateReadiness:async()=>structuredClone(r),permitStore:fakeStore(value=>{active=value;}),shadowWorkStartCommand:async permit=>{capturedPermit=permit;assert.equal(active,true);const envelope=permit.consume(command(r));assert.equal(envelope.acceptedForShadow,true);assert.equal(envelope.workStartWriteAuthorized,false);assert.equal(envelope.clockingWriteAuthorized,false);}}));
  assert.equal(result.permitPassed,true);assert.equal(active,false);assert.equal(result.rankingImpact,'none');assert.equal(result.scheduleWriteAuthorized,false);assert.equal(result.payrollWriteAuthorized,false);assert.equal(result.clockingWriteAuthorized,false);assert.equal(result.workStartWriteAuthorized,false);assert.match(result.shadowAdmissionFingerprint,/^[0-9a-f]{32}$/);
  assert.throws(()=>capturedPermit.consume(command(r)),/work_start_permit_expired/);
  assert.doesNotMatch(JSON.stringify(result),/BADGE-123|provider-subject|signature-value|raw-image|1990-01-01|document-number|share-code|portal-token|raw-right-to-work/);
});

test('forged or copied permit objects cannot reach ingress; exact permit remains usable once',async()=>{
  let forgedAccepted=0;const r=readiness();
  const result=await evaluateAgencyWorkStartPermit(input({readiness:r,evaluateReadiness:async()=>structuredClone(r),shadowWorkStartCommand:async permit=>{
    for(const fake of [{consume:permit.consume},{...permit},Object.freeze({version:permit.version})]){try{consumeAgencyWorkStartPermitAtIngress(fake,command(r));forgedAccepted+=1;}catch(error){assert.equal(error.code,'work_start_permit_untrusted');}}
    permit.consume(command(r));assert.throws(()=>permit.consume(command(r)),/work_start_permit_already_consumed/);
  }}));
  assert.equal(forgedAccepted,0);assert.equal(result.permitPassed,true);
});

test('stale or changed locked readiness fails before a work-start permit is exposed',async()=>{
  const r=readiness();let exposed=0;
  for(const changed of [readiness({assuranceVersionId:'b'.repeat(32)}),readiness({continuityFingerprint:'c'.repeat(32)}),readiness({readinessFingerprint:'d'.repeat(32)})]){
    const result=await evaluateAgencyWorkStartPermit(input({readiness:r,evaluateReadiness:async()=>changed,shadowWorkStartCommand:async()=>{exposed+=1;}}));
    assert.equal(result.permitPassed,false);assert.equal(result.reason,'work_start_readiness_changed_since_precheck');
  }
  assert.equal(exposed,0);
});

test('precheck must be exact-scope, evidence-complete and carry zero ranking/write authority',async()=>{
  const cases=[
    [readiness({workStartReady:false}),'work_start_permit_precheck_not_ready'],
    [readiness({workerId:'OTHER'}),'work_start_permit_precheck_scope_mismatch'],
    [readiness({assignmentFingerprint:'e'.repeat(24)}),'work_start_permit_precheck_assignment_mismatch'],
    [readiness({continuityFingerprint:'bad'}),'work_start_permit_precheck_evidence_invalid'],
    [readiness({rankingImpact:'score_bonus'}),'work_start_permit_precheck_authority_invalid'],
    [readiness({clockingWriteAuthorized:true}),'work_start_permit_precheck_authority_invalid'],
  ];
  for(const [r,reason] of cases){const result=await evaluateAgencyWorkStartPermit(input({readiness:r}));assert.equal(result.permitPassed,false,reason);assert.equal(result.reason,reason);assert.equal(result.workStartWriteAuthorized,false);}
});

test('unexpected personal/raw evidence fields fail closed and consume no permit',async()=>{
  const r=readiness();
  const result=await evaluateAgencyWorkStartPermit(input({readiness:r,evaluateReadiness:async()=>structuredClone(r),shadowWorkStartCommand:async permit=>permit.consume(command(r,{rawBadgeId:'BADGE-123'}))}));
  assert.equal(result.permitPassed,false);assert.equal(result.reason,'work_start_command_unexpected_field');assert.equal(result.shadowAdmissionFingerprint,null);
});

test('missing dependencies, locked-readiness failures and unconsumed permits fail closed',async()=>{
  assert.equal((await evaluateAgencyWorkStartPermit(input({permitStore:null}))).reason,'work_start_permit_store_unavailable');
  assert.equal((await evaluateAgencyWorkStartPermit(input({shadowWorkStartCommand:null}))).reason,'shadow_work_start_command_required');
  const failed=readiness({workStartReady:false,reason:'work_start_current_assurance_conflicted'});
  const locked=await evaluateAgencyWorkStartPermit(input({evaluateReadiness:async()=>failed}));assert.equal(locked.reason,'work_start_current_assurance_conflicted');
  const unconsumed=await evaluateAgencyWorkStartPermit(input({shadowWorkStartCommand:async()=>{}}));assert.equal(unconsumed.reason,'work_start_permit_not_consumed');
});

test('PostgreSQL permit store locks exact current RTW and accepted-response scope with SELECT-only SQL',async()=>{
  let captured=null;let transactionActive=false;
  const store=createPostgresAgencyWorkStartPermitStore({withTransaction:async evaluate=>{transactionActive=true;try{return await evaluate({query:async(sql,values)=>{captured={sql,values};return {rows:[{assurance_version_id:ASSURANCE,assignment_fingerprint:ASSIGNMENT,conflicted:false,token_fingerprint:'1'.repeat(16),action:'confirm_preferred_worker',consumed_at:'2026-10-04T12:00:00Z'}]};}});}finally{transactionActive=false;}}});
  const result=await store.withLockedSnapshot({tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',workerId:'W1',now:NOW},async()=>{assert.equal(transactionActive,true);return 'ok';});
  assert.equal(result,'ok');assert.equal(transactionActive,false);assert.ok(captured.sql.trim().startsWith('SELECT current.assurance_version_id'));assert.match(captured.sql,/FOR SHARE/g);assert.doesNotMatch(captured.sql,/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);assert.match(captured.sql,/wfm_agency_rtw_assurance_current/);assert.match(captured.sql,/wfm_agency_portal_token_consumptions/);assert.deepEqual(captured.values,['T1','S1','R1','A1','W1',NOW]);assert.doesNotMatch(captured.sql,/badge|photo|biometric|date_of_birth|share_code|document_number|raw_payload|signature/i);
});

test('5,000 fabricated direct-ingress capabilities produce zero shadow work-start admissions',async()=>{
  let forgedAccepted=0;const r=readiness();
  const result=await evaluateAgencyWorkStartPermit(input({readiness:r,evaluateReadiness:async()=>structuredClone(r),shadowWorkStartCommand:async permit=>{
    for(let i=0;i<5000;i+=1){const fake=Object.freeze({version:permit.version,nonce:i});try{consumeAgencyWorkStartPermitAtIngress(fake,command(r));forgedAccepted+=1;}catch(error){assert.equal(error.code,'work_start_permit_untrusted');}}
    permit.consume(command(r));
  }}));
  assert.equal(forgedAccepted,0);assert.equal(result.permitPassed,true);
});
