import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { evaluateAgencyScheduleCommandPermit } from '../../src/frontier/agency-schedule-command-permit.mjs';
import { acceptAgencyScheduleCommandAtShadowIngress } from '../../src/frontier/agency-schedule-ingress-shadow.mjs';

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
const command=(overrides={})=>({type:'shadow_schedule_assignment',tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z',assignmentFingerprint:assignmentFp(),scheduleHandoffFingerprint:handoffFp(),workerAssuranceBindings:[{workerId:'W1',assuranceVersionId:OLD}],...overrides});
const input=(rows=[row()])=>({tenantId:'T1',siteId:'S1',agencyId:'A1',tokenId:'TOK-1',request:structuredClone(REQUEST),now:NOW,preflight:preflight(rows),authorityStore:store(rows)});

async function validRun(overrides={}){
  let ingress=null;
  const result=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{ingress=acceptAgencyScheduleCommandAtShadowIngress({permit,command:command(overrides)});}});
  return {result,ingress};
}

test('valid guarded capability reaches shadow scheduling ingress with no live schedule authority',async()=>{
  const {result,ingress}=await validRun();
  assert.equal(result.permitPassed,true);assert.equal(ingress.acceptedForShadowIngress,true);assert.equal(ingress.scheduleWriteAuthorized,false);assert.equal(result.scheduleWriteAuthorized,false);
  assert.match(ingress.ingressFingerprint,/^[0-9a-f]{32}$/);assert.equal(ingress.workerAssuranceBindings[0].assuranceVersionId,OLD);assert.equal(Object.isFrozen(ingress),true);
  assert.doesNotMatch(JSON.stringify(ingress),/TOK-1|share-code|1990-01-01|document-number|raw-right-to-work/);
});

test('fabricated permit objects cannot call scheduling ingress even when they expose a convincing consume method',()=>{
  let fakeConsumed=0;
  const fake=Object.freeze({version:'agency-schedule-command-permit-v0.1.1',consume(){fakeConsumed+=1;return {acceptedForShadow:true,scheduleWriteAuthorized:false};}});
  assert.throws(()=>acceptAgencyScheduleCommandAtShadowIngress({permit:fake,command:command()}),/schedule_command_permit_untrusted/);
  assert.equal(fakeConsumed,0);
});

test('copying a real permit object does not copy its unforgeable capability',async()=>{
  let ingress=null;
  const result=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{
    const copied={...permit};
    assert.throws(()=>acceptAgencyScheduleCommandAtShadowIngress({permit:copied,command:command()}),/schedule_command_permit_untrusted/);
    ingress=acceptAgencyScheduleCommandAtShadowIngress({permit,command:command()});
  }});
  assert.equal(result.permitPassed,true);assert.equal(ingress.acceptedForShadowIngress,true);
});

test('one transaction-scoped permit can enter scheduling ingress only once',async()=>{
  let first=null;
  const result=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{
    first=acceptAgencyScheduleCommandAtShadowIngress({permit,command:command()});
    assert.throws(()=>acceptAgencyScheduleCommandAtShadowIngress({permit,command:command()}),/schedule_command_permit_already_consumed/);
  }});
  assert.equal(result.permitPassed,true);assert.equal(first.acceptedForShadowIngress,true);
});

test('a permit cannot be retained and replayed after its locked transaction callback ends',async()=>{
  let captured=null;
  const {result}=await (async()=>{let ingress=null;const result=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{captured=permit;ingress=acceptAgencyScheduleCommandAtShadowIngress({permit,command:command()});}});return {result,ingress};})();
  assert.equal(result.permitPassed,true);
  assert.throws(()=>acceptAgencyScheduleCommandAtShadowIngress({permit:captured,command:command()}),/schedule_command_permit_expired/);
});

test('cross-scope, stale worker assurance and unexpected personal data fail before ingress acceptance',async()=>{
  for(const [override,reason] of [
    [{tenantId:'OTHER'},'schedule_command_tenant_id_mismatch'],
    [{siteId:'OTHER'},'schedule_command_site_id_mismatch'],
    [{requestId:'OTHER'},'schedule_command_request_id_mismatch'],
    [{agencyId:'OTHER'},'schedule_command_agency_id_mismatch'],
    [{workerAssuranceBindings:[{workerId:'W1',assuranceVersionId:NEW}]},'schedule_command_worker_bindings_mismatch'],
    [{dateOfBirth:'1990-01-01'},'schedule_command_unexpected_field'],
  ]){
    let accepted=0;
    const result=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{const ingress=acceptAgencyScheduleCommandAtShadowIngress({permit,command:command(override)});if(ingress.acceptedForShadowIngress)accepted+=1;}});
    assert.equal(result.permitPassed,false,reason);assert.equal(result.reason,reason);assert.equal(accepted,0);assert.equal(result.scheduleWriteAuthorized,false);
    assert.doesNotMatch(JSON.stringify(result),/1990-01-01/);
  }
});

test('5,000 fabricated direct-ingress attempts produce zero accepted schedule commands',()=>{
  let accepted=0;
  for(let i=0;i<5000;i+=1){
    const fake={version:'agency-schedule-command-permit-v0.1.1',consume(){return {acceptedForShadow:true,scheduleWriteAuthorized:false,requestId:'R1',siteId:'S1',agencyId:'A1'};},nonce:i};
    try{const result=acceptAgencyScheduleCommandAtShadowIngress({permit:fake,command:command()});if(result.acceptedForShadowIngress)accepted+=1;}catch(error){assert.equal(error.code,'schedule_command_permit_untrusted');}
  }
  assert.equal(accepted,0);
});

test('identical valid state produces deterministic privacy-minimised ingress evidence',async()=>{
  const [a,b]=await Promise.all([validRun(),validRun()]);
  assert.equal(a.result.permitPassed,true);assert.equal(b.result.permitPassed,true);assert.equal(a.ingress.ingressFingerprint,b.ingress.ingressFingerprint);assert.equal(a.ingress.shadowCommandFingerprint,b.ingress.shadowCommandFingerprint);
  assert.deepEqual(Object.keys(a.ingress).sort(),['acceptedForShadowIngress','agencyId','assignmentFingerprint','authorityBoundary','bypassRule','ingressFingerprint','privacyBoundary','reason','requestId','scheduleHandoffFingerprint','scheduleWriteAuthorized','shadowCommandFingerprint','siteId','version','workerAssuranceBindings'].sort());
});
