import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createPostgresAgencyWorkStartAuthorityStore,evaluateAgencyWorkStartReadiness} from '../../src/frontier/agency-work-start-readiness.mjs';
import {createPostgresAgencyIdentityContinuityStore} from '../../src/frontier/agency-identity-continuity.mjs';

// Synthetic query results through the real PostgreSQL reader adapters and real
// imported continuity evaluator. No DB, DDL, provider or business write occurs.
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=(v,n=32)=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex').slice(0,n);
const request={requestId:'SYNTHETIC-R1',roleId:'PACK',location:'Synthetic site',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'};
const assignment=hash({roleId:request.roleId,location:request.location,startAt:request.startAt,endAt:request.endAt},24);
const scope={tenantId:'SYNTHETIC-T1',siteId:'SYNTHETIC-S1',requestId:request.requestId,agencyId:'SYNTHETIC-A1',workerId:'SYNTHETIC-W1',assignmentFingerprint:assignment,assuranceVersionId:'a'.repeat(32)};
function fixture({coverageUntil='2026-10-05T14:00:00.000Z',observationChange=null,authorityChange=null}={}){
  const authority={...scope,checkedAt:'2026-10-04T10:00:00.000Z',coverageUntil,promotedAt:'2026-10-04T11:00:00.000Z',conflicted:false,
    acceptedResponseFingerprint:'1'.repeat(16),acceptedAction:'confirm_preferred_worker',acceptedAt:'2026-10-04T12:00:00.000Z'};
  const observation={...scope,sourceSystemId:'synthetic-turnstile',sourceEventFingerprint:'2'.repeat(32),subjectFingerprint:'3'.repeat(32),signalType:'access_pass',observedAt:'2026-10-05T05:58:00.000Z'};
  observation.provenanceBindingFingerprints=[hash({...scope,sourceSystemId:observation.sourceSystemId,subjectFingerprint:observation.subjectFingerprint})];
  observationChange?.(observation);authorityChange?.(authority);
  const calls=[];
  const authorityStore=createPostgresAgencyWorkStartAuthorityStore({query:async(sql,values)=>{
    calls.push({kind:'authority',sql,values});return {rows:[structuredClone(authority)]};
  }});
  const continuityStore=createPostgresAgencyIdentityContinuityStore({query:async(sql,values)=>{
    calls.push({kind:'continuity',sql,values});return {rows:[structuredClone(observation)]};
  }});
  return {calls,input:{tenantId:scope.tenantId,siteId:scope.siteId,agencyId:scope.agencyId,request:structuredClone(request),workerId:scope.workerId,
    now:'2026-10-05T06:10:00.000Z',policy:{policyId:'SYNTHETIC-POLICY',siteId:scope.siteId,roleId:'PACK',minutesBeforeStart:60,minutesAfterStart:90,
      minIndependentSources:1,requireDirectIdentity:false,allowedSources:{'synthetic-turnstile':['access_pass']}},authorityStore,continuityStore}};
}
function noWrites(result){
  for(const key of ['scheduleWriteAuthorized','payrollWriteAuthorized','clockingWriteAuthorized','workStartWriteAuthorized'])assert.equal(result[key],false);
  assert.equal(result.rankingImpact,'none');
}
test('both unchanged repaired modules compose through real reader adapters and preserve no-write authority',async()=>{
  const f=fixture(),result=await evaluateAgencyWorkStartReadiness(f.input);
  assert.equal(result.workStartReady,true);noWrites(result);
  assert.deepEqual(f.calls.map(c=>c.kind),['authority','continuity','authority']);
  assert.ok(f.calls.every(c=>!/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(c.sql)));
  assert.equal(result.workerId,scope.workerId);
});
test('explicit null unrestricted coverage remains distinct from a malformed supplied expiry',async()=>{
  const f=fixture({coverageUntil:null}),result=await evaluateAgencyWorkStartReadiness(f.input);
  assert.equal(result.workStartReady,true);noWrites(result);
});
test('expired finite coverage with real continuity consumer cannot satisfy work-start readiness',async()=>{
  const f=fixture({coverageUntil:'2026-10-05T07:00:00.000Z'}),result=await evaluateAgencyWorkStartReadiness(f.input);
  assert.equal(result.workStartReady,false);noWrites(result);assert.equal(f.calls.length,1);
});
for(const expiry of ['not-an-instant','', '2027-02-30T12:00:00.000Z']){
  test(`malformed supplied coverageUntil ${JSON.stringify(expiry)} must withhold advisory readiness`,async()=>{
    const f=fixture({coverageUntil:expiry}),result=await evaluateAgencyWorkStartReadiness(f.input);
    assert.equal(result.workStartReady,false,JSON.stringify(result));noWrites(result);
    assert.equal(f.calls.filter(c=>c.kind==='continuity').length,0);
  });
}
test('PR455 stored overlength worker denies before real continuity evaluation',async()=>{
  const f=fixture({authorityChange:r=>{r.workerId+='x'.repeat(100);}}),result=await evaluateAgencyWorkStartReadiness(f.input);
  assert.equal(result.workStartReady,false);noWrites(result);assert.equal(f.calls.length,1);
});
test('PR457 overlength observation denies through the imported real evaluator',async()=>{
  const f=fixture({observationChange:r=>{r.sourceEventFingerprint+='extra';}}),result=await evaluateAgencyWorkStartReadiness(f.input);
  assert.equal(result.workStartReady,false);noWrites(result);assert.equal(f.calls.filter(c=>c.kind==='continuity').length,1);
});
