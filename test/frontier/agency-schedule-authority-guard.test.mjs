import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {AGENCY_SCHEDULE_AUTHORITY_LOCK_SQL,createPostgresAgencyScheduleAuthorityGuardStore,guardAgencyScheduleAuthority} from '../../src/frontier/agency-schedule-authority-guard.mjs';

const NOW='2026-10-04T12:30:00.000Z';
const OLD='a'.repeat(32);const NEW='b'.repeat(32);
const REQUEST={requestId:'R1',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v,n=24)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
const assignmentFp=()=>digest(JSON.stringify(stable({roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'})));
const row=(overrides={})=>({action:'confirm_preferred_worker',consumedAt:'2026-10-04T12:00:00.000Z',workerId:'W1',acceptedAssuranceVersionId:OLD,currentAssuranceVersionId:OLD,currentSiteId:'S1',currentRequestId:'R1',assignmentFingerprint:assignmentFp(),checkedAt:'2026-10-04T10:00:00.000Z',coverageUntil:'2027-12-31T23:59:59.000Z',promotedAt:'2026-10-04T11:00:00.000Z',conflicted:false,...overrides});
const handoffFp=(rows=[row()])=>digest(JSON.stringify(stable({tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',acceptedResponseFingerprint:digest('TOK-1',16),assignmentFingerprint:assignmentFp(),bindings:rows.map(r=>({workerId:r.workerId,assuranceVersionId:r.currentAssuranceVersionId})).sort((a,b)=>a.workerId.localeCompare(b.workerId))})),32);
const preflight=(rows=[row()])=>({readyForScheduleHandoff:true,requestId:'R1',siteId:'S1',agencyId:'A1',acceptedResponseFingerprint:digest('TOK-1',16),scheduleHandoffFingerprint:handoffFp(rows)});
const store=rows=>({async withLockedAuthority(_scope,evaluate){return evaluate(structuredClone(rows));}});
const input=(rows=[row()])=>({tenantId:'T1',siteId:'S1',agencyId:'A1',tokenId:'TOK-1',request:structuredClone(REQUEST),now:NOW,preflight:preflight(rows),authorityStore:store(rows)});

test('exact accepted/current assurance passes the shadow atomic guard without granting schedule-write authority',async()=>{let seen=null;const result=await guardAgencyScheduleAuthority({...input(),shadowCriticalSection:async ctx=>{seen=ctx;assert.equal(ctx.scheduleMutationAuthority,false);}});assert.equal(result.guardPassed,true);assert.equal(result.scheduleWriteAuthorized,false);assert.equal(seen.workerAssuranceBindings[0].workerId,'W1');assert.match(result.guardFingerprint,/^[0-9a-f]{32}$/);assert.match(result.atomicityRule,/same_database_transaction/);assert.doesNotMatch(JSON.stringify(result),/TOK-1|share-code|1990-01-01|raw-right-to-work/);});

test('handoff fingerprint tampering or stale preflight evidence fails closed under the lock',async()=>{const tampered=await guardAgencyScheduleAuthority({...input(),preflight:{...preflight(),scheduleHandoffFingerprint:'c'.repeat(32)}});assert.equal(tampered.guardPassed,false);assert.equal(tampered.reason,'schedule_handoff_changed_since_preflight');const rows=[row({currentAssuranceVersionId:NEW})];const stale=await guardAgencyScheduleAuthority({...input(rows),preflight:preflight([row()])});assert.equal(stale.guardPassed,false);assert.ok(stale.failures.includes('accepted_worker_assurance_changed'));});

test('conflict, changed assignment, insufficient coverage and future consumption each fail closed',async()=>{for(const [override,reason] of [[{conflicted:true},'current_assurance_conflicted'],[{assignmentFingerprint:'c'.repeat(24)},'current_assurance_assignment_mismatch'],[{coverageUntil:'2026-10-05T12:00:00.000Z'},'current_assurance_does_not_cover_assignment'],[{consumedAt:'2026-10-04T13:00:00.000Z'},'accepted_response_consumed_at_invalid']]){const rows=[row(override)];const result=await guardAgencyScheduleAuthority({...input(rows),preflight:preflight(rows)});assert.equal(result.guardPassed,false,reason);assert.ok(result.failures.includes(reason),`${reason}: ${result.failures.join(',')}`);}});

test('missing store, failed transaction and non-scheduleable response fail closed',async()=>{const missing=await guardAgencyScheduleAuthority({...input(),authorityStore:null});assert.equal(missing.reason,'schedule_authority_store_unavailable');const failed=await guardAgencyScheduleAuthority({...input(),authorityStore:{async withLockedAuthority(){throw new Error('db down')}}});assert.equal(failed.reason,'schedule_authority_store_unavailable');const rows=[row({action:'decline_request'})];const decline=await guardAgencyScheduleAuthority({...input(rows),preflight:preflight(rows)});assert.equal(decline.reason,'accepted_response_not_scheduleable');});

test('PostgreSQL guard store requires a transaction wrapper and keeps evaluation inside it',async()=>{let active=false;let evaluatedWhileActive=false;let seenSql='';let seenValues=null;const pg=createPostgresAgencyScheduleAuthorityGuardStore({withTransaction:async fn=>{active=true;try{return await fn({query:async(sql,values)=>{seenSql=sql;seenValues=values;return {rows:[row()]};}});}finally{active=false;}}});const result=await pg.withLockedAuthority({tenantId:'T1',tokenId:'TOK-1',siteId:'S1',requestId:'R1',agencyId:'A1'},async rows=>{evaluatedWhileActive=active;return rows.length;});assert.equal(result,1);assert.equal(evaluatedWhileActive,true);assert.equal(active,false);assert.deepEqual(seenValues,['T1','TOK-1','S1','R1','A1']);assert.match(seenSql,/FOR SHARE/g);assert.doesNotMatch(seenSql,/\b(INSERT|UPDATE|DELETE)\b/i);});

test('invalid preflight scope/response fingerprint never reaches the locked store',async()=>{let calls=0;const authorityStore={async withLockedAuthority(){calls+=1;return null;}};const badScope=await guardAgencyScheduleAuthority({...input(),preflight:{...preflight(),siteId:'OTHER'},authorityStore});assert.equal(badScope.reason,'schedule_authority_preflight_scope_mismatch');const badResponse=await guardAgencyScheduleAuthority({...input(),preflight:{...preflight(),acceptedResponseFingerprint:'0'.repeat(16)},authorityStore});assert.equal(badResponse.reason,'schedule_authority_preflight_response_mismatch');assert.equal(calls,0);});

test('5,000 stale accepted assurance bindings produce zero passed schedule authority guards', async () => {
  let passed = 0;
  for (let i = 0; i < 5000; i += 1) {
    const rows = [row({workerId: `W-${i}`, currentAssuranceVersionId: NEW})];
    const stalePreflightRows = [row({workerId: `W-${i}`})];
    const result = await guardAgencyScheduleAuthority({
      ...input(rows),
      preflight: preflight(stalePreflightRows),
    });
    if (result.guardPassed) passed += 1;
  }
  assert.equal(passed, 0);
});

test('shadow critical section failures fail closed and never create schedule authority',async()=>{const result=await guardAgencyScheduleAuthority({...input(),shadowCriticalSection:async()=>{throw new Error('probe failed')}});assert.equal(result.guardPassed,false);assert.equal(result.reason,'shadow_critical_section_failed');assert.equal(result.scheduleWriteAuthorized,false);});

test('lock SQL protects accepted response and current assurance with shared locks',()=>{const matches=AGENCY_SCHEDULE_AUTHORITY_LOCK_SQL.match(/FOR SHARE/g)??[];assert.equal(matches.length,2);assert.match(AGENCY_SCHEDULE_AUTHORITY_LOCK_SQL,/wfm_agency_portal_token_consumptions/);assert.match(AGENCY_SCHEDULE_AUTHORITY_LOCK_SQL,/wfm_agency_rtw_assurance_current/);});
