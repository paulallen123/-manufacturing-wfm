import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createPostgresAgencyWorkStartRuntime} from '../../src/frontier/agency-work-start-runtime.mjs';

const NOW='2026-10-05T06:10:00.000Z';
const ASSURANCE='a'.repeat(32),SUBJECT='c'.repeat(32);
const REQUEST=Object.freeze({requestId:'R-RUNTIME',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'});
const SCOPE=Object.freeze({tenantId:'T-RUNTIME',siteId:'S-RUNTIME',requestId:REQUEST.requestId,agencyId:'A-RUNTIME',workerId:'W-RUNTIME'});
const POLICY=Object.freeze({policyId:'S-RUNTIME-PACK-v1',siteId:SCOPE.siteId,roleId:REQUEST.roleId,minutesBeforeStart:60,minutesAfterStart:90,minIndependentSources:1,requireDirectIdentity:false,allowedSources:Object.freeze({turnstile:Object.freeze(['access_pass'])})});
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=(value,length=32)=>crypto.createHash('sha256').update(String(value??'')).digest('hex').slice(0,length);
const ASSIGNMENT=digest(JSON.stringify(stable({roleId:REQUEST.roleId,location:REQUEST.location,startAt:REQUEST.startAt,endAt:REQUEST.endAt})),24);
const BINDING=digest(JSON.stringify(stable({tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,requestId:SCOPE.requestId,sourceSystemId:'turnstile',agencyId:SCOPE.agencyId,workerId:SCOPE.workerId,assignmentFingerprint:ASSIGNMENT,assuranceVersionId:ASSURANCE,subjectFingerprint:SUBJECT})));
const authorityRow=Object.freeze({tenant_id:SCOPE.tenantId,site_id:SCOPE.siteId,request_id:SCOPE.requestId,agency_id:SCOPE.agencyId,worker_id:SCOPE.workerId,assurance_version_id:ASSURANCE,assignment_fingerprint:ASSIGNMENT,checked_at:'2026-10-04T10:00:00.000Z',coverage_until:'2027-12-31T23:59:59.000Z',promoted_at:'2026-10-04T11:00:00.000Z',conflicted:false,token_fingerprint:'1'.repeat(16),action:'confirm_preferred_worker',consumed_at:'2026-10-04T12:00:00.000Z'});
const continuityRow=Object.freeze({tenant_id:SCOPE.tenantId,site_id:SCOPE.siteId,request_id:SCOPE.requestId,agency_id:SCOPE.agencyId,worker_id:SCOPE.workerId,assignment_fingerprint:ASSIGNMENT,assurance_version_id:ASSURANCE,source_system_id:'turnstile',source_event_fingerprint:'2'.repeat(32),subject_fingerprint:SUBJECT,signal_type:'access_pass',observed_at:'2026-10-05T05:58:00.000Z',provenance_binding_fingerprints:[BINDING]});
const input=overrides=>({tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,agencyId:SCOPE.agencyId,request:structuredClone(REQUEST),workerId:SCOPE.workerId,now:NOW,policy:structuredClone(POLICY),...(overrides??{})});
const command=readiness=>({type:'shadow_work_start_admission',tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,requestId:SCOPE.requestId,agencyId:SCOPE.agencyId,workerId:SCOPE.workerId,assuranceVersionId:readiness.assuranceVersionId,assignmentFingerprint:readiness.assignmentFingerprint,acceptedResponseFingerprint:readiness.acceptedResponseFingerprint,authorityFingerprint:readiness.authorityFingerprint,continuityFingerprint:readiness.continuityFingerprint,policyFingerprint:readiness.policyFingerprint,readinessFingerprint:readiness.readinessFingerprint});

function harness(){
  const transactions=[];
  const withTransaction=async evaluate=>{
    const calls=[];transactions.push(calls);
    return evaluate({query:async(sql,values=[])=>{
      calls.push({sql,values});
      if(/^\s*SET\s+LOCAL\s+ROLE\b/i.test(sql))return {rows:[]};
      if(sql.includes('wfm_read_agency_work_start_locked_snapshot_v1'))return {rows:[{scope_fingerprint:'6'.repeat(24)}]};
      if(sql.includes('wfm_read_agency_work_start_authority_v1'))return {rows:[structuredClone(authorityRow)]};
      if(sql.includes('wfm_read_agency_work_start_identity_continuity_v1'))return {rows:[structuredClone(continuityRow)]};
      throw new Error(`unexpected SQL: ${sql}`);
    }});
  };
  return {transactions,runtime:createPostgresAgencyWorkStartRuntime({withTransaction})};
}

test('canonical runtime carries tenant-bound function-only readiness into the locked one-shot permit with no raw evidence path',async()=>{
  const {runtime,transactions}=harness();let poisonCalls=0;
  const readiness=await runtime.evaluateReadiness(input({authorityStore:{async readAuthority(){poisonCalls+=1;}},continuityStore:{async readObservations(){poisonCalls+=1;}}}));
  assert.equal(readiness.workStartReady,true);assert.equal(readiness.rankingImpact,'none');assert.equal(poisonCalls,0);
  let envelope=null;
  const result=await runtime.evaluatePermit(input({readiness,evaluateReadiness:async()=>{poisonCalls+=1;throw new Error('caller evaluator must not run');},permitStore:{async withLockedSnapshot(){poisonCalls+=1;}},shadowWorkStartCommand:async permit=>{envelope=permit.consume(command(readiness));}}));
  assert.equal(result.permitPassed,true);assert.equal(envelope.acceptedForShadow,true);assert.equal(poisonCalls,0);
  assert.equal(runtime.credentialBoundary,'same_tenant_bound_session_user_transaction_factory_for_precheck_and_permit');assert.equal(runtime.precheckTrustBoundary,'same_runtime_instance_object_identity_one_use');assert.equal(runtime.eligibilityBeforeRanking,true);assert.equal(runtime.directTableSelectAllowed,false);assert.equal(runtime.rankingImpact,'none');assert.equal(runtime.workStartWriteAuthorized,false);
  assert.equal(result.scheduleWriteAuthorized,false);assert.equal(result.clockingWriteAuthorized,false);assert.equal(result.payrollWriteAuthorized,false);assert.equal(result.workStartWriteAuthorized,false);
  assert.equal(transactions.length,2);
  for(const calls of transactions){assert.match(calls[0].sql,/^SET LOCAL ROLE wfm_agency_work_start_reader;/i);for(const call of calls.slice(1)){assert.doesNotMatch(call.sql,/\bFROM\s+(?:public\.)?wfm_agency_(?:rtw_assurance_current|portal_token_consumptions|identity_continuity_observations|identity_observation_ingress_receipts)\b/i);assert.doesNotMatch(call.sql,/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i);}}
  assert.doesNotMatch(JSON.stringify({readiness,result,envelope}),/BADGE-123|provider-subject|signature-value|raw-image|1990-01-01|document-number|share-code|portal-token|raw-right-to-work/i);
});

test('copied or fabricated readiness cannot cross the canonical runtime trust boundary',async()=>{
  const {runtime,transactions}=harness();const readiness=await runtime.evaluateReadiness(input());const afterPrecheck=transactions.length;
  for(const forged of [structuredClone(readiness),Object.freeze({...readiness}),Object.freeze({workStartReady:true,readinessFingerprint:readiness.readinessFingerprint})]){
    const result=await runtime.evaluatePermit(input({readiness:forged,shadowWorkStartCommand:async()=>{throw new Error('permit must not be exposed');}}));
    assert.equal(result.permitPassed,false);assert.equal(result.reason,'work_start_runtime_precheck_untrusted');assert.equal(result.rankingImpact,'none');assert.equal(result.workStartWriteAuthorized,false);
  }
  assert.equal(transactions.length,afterPrecheck);
});

test('a trusted readiness object is single-use even when its first permit succeeds',async()=>{
  const {runtime,transactions}=harness();const readiness=await runtime.evaluateReadiness(input());
  const first=await runtime.evaluatePermit(input({readiness,shadowWorkStartCommand:async permit=>permit.consume(command(readiness))}));assert.equal(first.permitPassed,true);
  const afterFirst=transactions.length;
  const replay=await runtime.evaluatePermit(input({readiness,shadowWorkStartCommand:async()=>{throw new Error('replayed readiness must not expose a permit');}}));
  assert.equal(replay.permitPassed,false);assert.equal(replay.reason,'work_start_runtime_precheck_already_used');assert.equal(replay.workStartWriteAuthorized,false);assert.equal(transactions.length,afterFirst);
});

test('runtime dependency absence fails at construction rather than silently falling back to privileged or raw-table reads',()=>{
  assert.throws(()=>createPostgresAgencyWorkStartRuntime(),/withTransaction function is required/);
});

test('real postgres runtime-race proof is pinned to canonical runtime composition and cannot regress to generic evidence readers',async()=>{
  const source=await readFile(new URL('./agency-postgres-work-start-runtime-race.test.mjs',import.meta.url),'utf8');
  assert.match(source,/createPostgresAgencyWorkStartRuntime/);
  assert.doesNotMatch(source,/createPostgresAgencyWorkStartPermitStore|evaluateAgencyWorkStartPermit|createPostgresAgencyWorkStartAuthorityStore|evaluateAgencyWorkStartReadiness|createPostgresAgencyIdentityContinuityStore/);
  assert.match(source,/same_tenant_bound_session_user_transaction_factory_for_precheck_and_permit/);
  assert.match(source,/rejects wrong-tenant, unbound and revoked production-style credentials during readiness before any permit path exists/);
});
