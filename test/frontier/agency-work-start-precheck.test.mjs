import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createPostgresAgencyWorkStartPrecheck} from '../../src/frontier/agency-work-start-precheck.mjs';

const NOW='2026-10-05T06:10:00.000Z';
const ASSURANCE='a'.repeat(32);
const SUBJECT='c'.repeat(32);
const REQUEST=Object.freeze({requestId:'R-PRECHECK',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'});
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=(value,length=32)=>crypto.createHash('sha256').update(String(value??'')).digest('hex').slice(0,length);
const ASSIGNMENT=digest(JSON.stringify(stable({roleId:REQUEST.roleId,location:REQUEST.location,startAt:REQUEST.startAt,endAt:REQUEST.endAt})),24);
const SCOPE=Object.freeze({tenantId:'T-PRECHECK',siteId:'S-PRECHECK',requestId:REQUEST.requestId,agencyId:'A-PRECHECK',workerId:'W-PRECHECK'});
const POLICY=Object.freeze({policyId:'S-PRECHECK-PACK-v1',siteId:SCOPE.siteId,roleId:REQUEST.roleId,minutesBeforeStart:60,minutesAfterStart:90,minIndependentSources:1,requireDirectIdentity:false,allowedSources:Object.freeze({turnstile:Object.freeze(['access_pass'])})});
const BINDING=digest(JSON.stringify(stable({tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,requestId:SCOPE.requestId,sourceSystemId:'turnstile',agencyId:SCOPE.agencyId,workerId:SCOPE.workerId,assignmentFingerprint:ASSIGNMENT,assuranceVersionId:ASSURANCE,subjectFingerprint:SUBJECT})));

const authorityRow=Object.freeze({tenant_id:SCOPE.tenantId,site_id:SCOPE.siteId,request_id:SCOPE.requestId,agency_id:SCOPE.agencyId,worker_id:SCOPE.workerId,assurance_version_id:ASSURANCE,assignment_fingerprint:ASSIGNMENT,checked_at:'2026-10-04T10:00:00.000Z',coverage_until:'2027-12-31T23:59:59.000Z',promoted_at:'2026-10-04T11:00:00.000Z',conflicted:false,token_fingerprint:'1'.repeat(16),action:'confirm_preferred_worker',consumed_at:'2026-10-04T12:00:00.000Z'});
const continuityRow=Object.freeze({tenant_id:SCOPE.tenantId,site_id:SCOPE.siteId,request_id:SCOPE.requestId,agency_id:SCOPE.agencyId,worker_id:SCOPE.workerId,assignment_fingerprint:ASSIGNMENT,assurance_version_id:ASSURANCE,source_system_id:'turnstile',source_event_fingerprint:'2'.repeat(32),subject_fingerprint:SUBJECT,signal_type:'access_pass',observed_at:'2026-10-05T05:58:00.000Z',provenance_binding_fingerprints:[BINDING]});
const input=overrides=>({tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,agencyId:SCOPE.agencyId,request:structuredClone(REQUEST),workerId:SCOPE.workerId,now:NOW,policy:structuredClone(POLICY),...(overrides??{})});

function makeBoundary({failAuthority=false,queries=[]}={}){
  return createPostgresAgencyWorkStartPrecheck({withTransaction:async evaluate=>evaluate({query:async(sql,values=[])=>{
    queries.push({sql,values});
    if(/^\s*SET\s+LOCAL\s+ROLE\b/i.test(sql))return {rows:[]};
    if(sql.includes('wfm_read_agency_work_start_authority_v1')){
      if(failAuthority)throw new Error('db unavailable');
      return {rows:[structuredClone(authorityRow)]};
    }
    if(sql.includes('wfm_read_agency_work_start_identity_continuity_v1'))return {rows:[structuredClone(continuityRow)]};
    throw new Error(`unexpected SQL: ${sql}`);
  }})});
}

test('canonical precheck sets the restricted role first and reads only exact-scope security-definer functions',async()=>{
  const queries=[];const boundary=makeBoundary({queries});
  const result=await boundary.evaluate(input());
  assert.equal(result.workStartReady,true);assert.equal(result.rankingImpact,'none');assert.equal(result.scheduleWriteAuthorized,false);assert.equal(result.clockingWriteAuthorized,false);assert.equal(result.payrollWriteAuthorized,false);assert.equal(result.workStartWriteAuthorized,false);
  assert.equal(boundary.directTableSelectAllowed,false);assert.equal(boundary.evidenceBoundary,'exact_scope_security_definer_functions_only');
  assert.match(queries[0].sql,/^SET LOCAL ROLE wfm_agency_work_start_reader;/);
  assert.equal(queries.filter(item=>item.sql.includes('wfm_read_agency_work_start_authority_v1')).length,2);
  assert.equal(queries.filter(item=>item.sql.includes('wfm_read_agency_work_start_identity_continuity_v1')).length,1);
  for(const item of queries.slice(1)){
    assert.doesNotMatch(item.sql,/\bFROM\s+(?:public\.)?wfm_agency_(?:rtw_assurance_current|portal_token_consumptions|identity_continuity_observations|identity_observation_ingress_receipts)\b/i);
    assert.doesNotMatch(item.sql,/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i);
  }
});

test('caller-supplied raw evidence stores cannot override the canonical tenant-bound precheck stores',async()=>{
  let poisonCalls=0;const boundary=makeBoundary();
  const result=await boundary.evaluate(input({authorityStore:{async readAuthority(){poisonCalls+=1;throw new Error('unsafe authority store used');}},continuityStore:{async readObservations(){poisonCalls+=1;throw new Error('unsafe continuity store used');}}}));
  assert.equal(result.workStartReady,true);assert.equal(poisonCalls,0);assert.equal(result.rankingImpact,'none');
});

test('scoped evidence failure has no raw-table fallback and fails closed before work-start authority exists',async()=>{
  const queries=[];const boundary=makeBoundary({failAuthority:true,queries});
  const result=await boundary.evaluate(input());
  assert.equal(result.workStartReady,false);assert.equal(result.reason,'work_start_authority_store_unavailable');assert.equal(result.scheduleWriteAuthorized,false);assert.equal(result.clockingWriteAuthorized,false);assert.equal(result.payrollWriteAuthorized,false);assert.equal(result.workStartWriteAuthorized,false);
  assert.equal(queries.some(item=>/\bFROM\s+(?:public\.)?wfm_agency_(?:rtw_assurance_current|portal_token_consumptions|identity_continuity_observations|identity_observation_ingress_receipts)\b/i.test(item.sql)),false);
});

test('precheck requires a transactional query boundary so SET LOCAL ROLE cannot silently degrade',async()=>{
  const boundary=createPostgresAgencyWorkStartPrecheck({withTransaction:async evaluate=>evaluate({})});
  await assert.rejects(()=>boundary.evaluate(input()),/transaction\.query function is required/);
});
