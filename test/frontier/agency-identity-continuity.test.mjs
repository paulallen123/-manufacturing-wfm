import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createPostgresAgencyIdentityContinuityStore,evaluateAgencyIdentityContinuity} from '../../src/frontier/agency-identity-continuity.mjs';

const NOW='2026-10-05T06:10:00.000Z';
const ASSURANCE='a'.repeat(32);const SUBJECT='b'.repeat(32);
const REQUEST={requestId:'R1',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v,n=32)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
const assignmentFp=()=>digest(JSON.stringify(stable({roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'})),24);
const bindingFp=row=>digest(JSON.stringify(stable({tenantId:row.tenantId,siteId:row.siteId,requestId:row.requestId,sourceSystemId:row.sourceSystemId,agencyId:row.agencyId,workerId:row.workerId,assignmentFingerprint:row.assignmentFingerprint,assuranceVersionId:row.assuranceVersionId,subjectFingerprint:row.subjectFingerprint})));
const policy=(overrides={})=>({policyId:'S1-PACK-OP-v1',siteId:'S1',roleId:'PACK-OP',minutesBeforeStart:60,minutesAfterStart:90,minIndependentSources:1,requireDirectIdentity:false,allowedSources:{turnstile:['access_pass'],clocking:['attendance_clock_in'],supervisor:['supervised_identity_check'],dvsp:['rtw_dvsp_holder_check']},...overrides});
const observation=(overrides={})=>{
  const row={tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',workerId:'W1',assignmentFingerprint:assignmentFp(),assuranceVersionId:ASSURANCE,sourceSystemId:'turnstile',sourceEventFingerprint:digest(`event-${Math.random()}`),subjectFingerprint:SUBJECT,signalType:'access_pass',observedAt:'2026-10-05T05:58:00.000Z',rawBadgeNumber:'BADGE-123',photo:'raw-image',dateOfBirth:'1990-01-01',...overrides};
  if(!Object.hasOwn(overrides,'provenanceBindingFingerprints'))row.provenanceBindingFingerprints=[bindingFp(row)];
  return row;
};
const store=rows=>({async readObservations(){return {rows:structuredClone(rows)};}});
const input=(rows=[observation()],overrides={})=>({tenantId:'T1',siteId:'S1',agencyId:'A1',request:structuredClone(REQUEST),workerBinding:{workerId:'W1',assuranceVersionId:ASSURANCE},now:NOW,policy:policy(),continuityStore:store(rows),...overrides});

test('standard role/site policy accepts fresh trusted shift-start evidence with matching authenticated provenance and no mutation/ranking authority',async()=>{
  const result=await evaluateAgencyIdentityContinuity(input());
  assert.equal(result.continuityPassed,true);assert.equal(result.rankingImpact,'none');assert.equal(result.scheduleWriteAuthorized,false);assert.equal(result.payrollWriteAuthorized,false);assert.equal(result.clockingWriteAuthorized,false);
  assert.equal(result.independentSourceCount,1);assert.equal(result.directIdentityObserved,false);assert.match(result.continuityFingerprint,/^[0-9a-f]{32}$/);
  const serialized=JSON.stringify(result);assert.doesNotMatch(serialized,/BADGE-123|raw-image|1990-01-01/);assert.equal(serialized.includes(SUBJECT),false);assert.doesNotMatch(serialized,/provenanceBindingFingerprint/);
});

test('elevated role/site policy requires independent evidence including a direct identity observation',async()=>{
  const rows=[observation({sourceSystemId:'clocking',signalType:'attendance_clock_in',sourceEventFingerprint:'1'.repeat(32)}),observation({sourceSystemId:'supervisor',signalType:'supervised_identity_check',sourceEventFingerprint:'2'.repeat(32),observedAt:'2026-10-05T06:02:00.000Z'})];
  const result=await evaluateAgencyIdentityContinuity(input(rows,{policy:policy({policyId:'S1-PACK-HIGH-v1',minIndependentSources:2,requireDirectIdentity:true})}));
  assert.equal(result.continuityPassed,true);assert.equal(result.independentSourceCount,2);assert.equal(result.directIdentityObserved,true);
});

test('missing direct identity, insufficient independent sources and subject disagreement fail closed',async()=>{
  const single=[observation({sourceSystemId:'clocking',signalType:'attendance_clock_in',sourceEventFingerprint:'3'.repeat(32)})];
  const elevated=policy({minIndependentSources:2,requireDirectIdentity:true});
  const a=await evaluateAgencyIdentityContinuity(input(single,{policy:elevated}));
  assert.equal(a.continuityPassed,false);assert.ok(a.failures.includes('identity_continuity_independent_sources_insufficient'));assert.ok(a.failures.includes('identity_continuity_direct_identity_required'));
  const mismatch=[...single,observation({sourceSystemId:'supervisor',signalType:'supervised_identity_check',sourceEventFingerprint:'4'.repeat(32),subjectFingerprint:'c'.repeat(32)})];
  const b=await evaluateAgencyIdentityContinuity(input(mismatch,{policy:elevated}));
  assert.equal(b.continuityPassed,false);assert.ok(b.failures.includes('identity_continuity_subject_mismatch'));
});

test('untrusted source, stale/future evidence, duplicate events and assurance or assignment mismatches fail closed',async()=>{
  const cases=[
    [[observation({sourceSystemId:'unknown'})],'identity_continuity_untrusted_source_or_signal'],
    [[observation({observedAt:'2026-10-05T04:00:00.000Z'})],'identity_continuity_observation_outside_window'],
    [[observation({observedAt:'2026-10-05T06:30:00.000Z'})],'identity_continuity_observation_outside_window'],
    [[observation({sourceEventFingerprint:'5'.repeat(32)}),observation({sourceEventFingerprint:'5'.repeat(32)})],'identity_continuity_duplicate_observation'],
    [[observation({assuranceVersionId:'d'.repeat(32)})],'identity_continuity_observation_scope_mismatch'],
    [[observation({assignmentFingerprint:'e'.repeat(24)})],'identity_continuity_observation_scope_mismatch'],
  ];
  for(const [rows,reason] of cases){const result=await evaluateAgencyIdentityContinuity(input(rows));assert.equal(result.continuityPassed,false,reason);assert.ok(result.failures.includes(reason),JSON.stringify(result));}
});

test('missing or mismatched authenticated ingress provenance cannot satisfy continuity',async()=>{
  const missing=observation({sourceEventFingerprint:'9'.repeat(32),provenanceBindingFingerprints:[]});
  const bad=observation({sourceEventFingerprint:'a'.repeat(32),provenanceBindingFingerprints:['f'.repeat(32)]});
  for(const row of [missing,bad]){
    const result=await evaluateAgencyIdentityContinuity(input([row]));
    assert.equal(result.continuityPassed,false);
    assert.ok(result.failures.includes('identity_continuity_authenticated_provenance_missing_or_mismatched'));
    assert.equal(result.observations.length,0);
  }
});

test('policy must be explicitly role/site scoped and unavailable evidence store fails closed',async()=>{
  const badPolicy=await evaluateAgencyIdentityContinuity(input([observation()],{policy:policy({siteId:'OTHER'})}));
  assert.equal(badPolicy.continuityPassed,false);assert.equal(badPolicy.reason,'identity_continuity_policy_invalid');
  const unavailable=await evaluateAgencyIdentityContinuity(input([observation()],{continuityStore:{async readObservations(){throw new Error('down');}}}));
  assert.equal(unavailable.continuityPassed,false);assert.equal(unavailable.reason,'identity_continuity_store_unavailable');
});

test('PostgreSQL reader is SELECT-only, exactly scoped, and retrieves only binding fingerprints needed to prove authenticated provenance',async()=>{
  let captured=null;
  const base={tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',workerId:'W1',assignmentFingerprint:assignmentFp(),assuranceVersionId:ASSURANCE,sourceSystemId:'turnstile',sourceEventFingerprint:'6'.repeat(32),subjectFingerprint:SUBJECT,signalType:'access_pass',observedAt:'2026-10-05T05:58:00Z'};
  const pg=createPostgresAgencyIdentityContinuityStore({query:async(sql,values)=>{captured={sql,values};return {rows:[{tenant_id:base.tenantId,site_id:base.siteId,request_id:base.requestId,agency_id:base.agencyId,worker_id:base.workerId,assignment_fingerprint:base.assignmentFingerprint,assurance_version_id:base.assuranceVersionId,source_system_id:base.sourceSystemId,source_event_fingerprint:base.sourceEventFingerprint,subject_fingerprint:base.subjectFingerprint,signal_type:base.signalType,observed_at:base.observedAt,provenance_binding_fingerprints:[bindingFp(base)]}]};}});
  const result=await evaluateAgencyIdentityContinuity({...input([]),continuityStore:pg});
  assert.equal(result.continuityPassed,true);assert.ok(captured.sql.trim().startsWith('SELECT'));assert.doesNotMatch(captured.sql,/INSERT|UPDATE|DELETE/i);
  assert.match(captured.sql,/o\.tenant_id = \$1/);assert.match(captured.sql,/o\.site_id = \$2/);assert.match(captured.sql,/o\.request_id = \$3/);assert.match(captured.sql,/o\.agency_id = \$4/);assert.match(captured.sql,/o\.worker_id = \$5/);assert.match(captured.sql,/o\.assignment_fingerprint = \$6/);assert.match(captured.sql,/o\.assurance_version_id = \$7/);
  assert.match(captured.sql,/wfm_agency_identity_observation_ingress_receipts/);assert.match(captured.sql,/binding_fingerprint/);
  assert.doesNotMatch(captured.sql,/source_auth_fingerprint|badge|photo|biometric|date_of_birth|share_code|document/i);
});

test('5,000 replayed single-source observations cannot satisfy a two-source continuity policy',async()=>{
  const repeated=observation({sourceSystemId:'clocking',signalType:'attendance_clock_in',sourceEventFingerprint:'7'.repeat(32)});
  let passes=0;
  for(let i=0;i<5000;i+=1){const result=await evaluateAgencyIdentityContinuity(input([repeated],{policy:policy({minIndependentSources:2,requireDirectIdentity:false})}));if(result.continuityPassed)passes+=1;}
  assert.equal(passes,0);
});

test('5,000 direct-ledger observations without authenticated provenance produce zero continuity passes',async()=>{
  const row=observation({sourceEventFingerprint:'c'.repeat(32),provenanceBindingFingerprints:[]});
  let passes=0;
  for(let i=0;i<5000;i+=1){const result=await evaluateAgencyIdentityContinuity(input([row]));if(result.continuityPassed)passes+=1;}
  assert.equal(passes,0);
});

test('identical valid evidence produces deterministic privacy-minimised continuity evidence',async()=>{
  const row=observation({sourceEventFingerprint:'8'.repeat(32)});
  const [a,b]=await Promise.all([evaluateAgencyIdentityContinuity(input([row])),evaluateAgencyIdentityContinuity(input([row]))]);
  assert.equal(a.continuityPassed,true);assert.equal(b.continuityPassed,true);assert.equal(a.continuityFingerprint,b.continuityFingerprint);assert.equal(a.policyFingerprint,b.policyFingerprint);
  assert.deepEqual(Object.keys(a.observations[0]).sort(),['evidenceClass','observedAt','signalType','sourceEventFingerprint','sourceSystemId'].sort());
});
