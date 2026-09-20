import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';

const T=Date.parse('2026-09-18T06:00:00Z');
function setup(){
  const e=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:86_400_000});
  e.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  e.registerPerson({tenant:'acme',employee:'e2',sites:['s1']});
  e.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access'});
  e.registerSource({tenant:'acme',sourceId:'wifi',site:'s1',type:'radius'});
  e.registerSource({tenant:'acme',sourceId:'hmi',site:'s1',type:'mes'});
  e.registerSource({tenant:'acme',sourceId:'taa',site:'s1',type:'legacy',directAttendanceAuthority:true});
  return e;
}
function ingest(e,o){return e.ingest({tenant:'acme',employee:'e1',receivedAtMs:T+300_000,...o});}

test('access entry alone is review-required, not a guessed payroll clock',()=>{
  const e=setup();
  const r=ingest(e,{sourceId:'door',eventId:'door-in-0001',kind:'access_entry',observedAt:new Date(T).toISOString()});
  assert.equal(r.decision.status,'review_required');
  assert.equal(e.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');
});

test('independent access + authenticated wifi auto-confirms IN at the physical anchor',()=>{
  const e=setup();
  ingest(e,{sourceId:'door',eventId:'door-in-0002',kind:'access_entry',observedAt:new Date(T).toISOString()});
  const r=ingest(e,{sourceId:'wifi',eventId:'wifi-in-0002',kind:'wifi_authenticated',observedAt:new Date(T+20_000).toISOString()});
  assert.equal(r.decision.status,'authoritative');
  assert.equal(r.decision.direction,'in');
  assert.equal(r.decision.authoritativeAt,new Date(T).toISOString());
  assert.equal(e.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
});

test('wifi disappearance alone can never clock OUT',()=>{
  const e=setup();
  ingest(e,{sourceId:'door',eventId:'door-in-0003',kind:'access_entry',observedAt:new Date(T).toISOString()});
  ingest(e,{sourceId:'wifi',eventId:'wifi-in-0003',kind:'wifi_authenticated',observedAt:new Date(T+5_000).toISOString()});
  const r=ingest(e,{sourceId:'wifi',eventId:'wifi-out-0003',kind:'wifi_disconnected',observedAt:new Date(T+8*60*60_000).toISOString(),receivedAtMs:T+8*60*60_000+1000});
  assert.equal(r.decision.status,'evidence_only');
  assert.equal(r.decision.reason,'NEGATIVE_SIGNAL_CANNOT_STOP_PAY');
  assert.equal(e.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
});

test('explicit access exit plus independent HMI logout can auto-confirm OUT',()=>{
  const e=setup();
  ingest(e,{sourceId:'door',eventId:'door-in-0004',kind:'access_entry',observedAt:new Date(T).toISOString()});
  ingest(e,{sourceId:'wifi',eventId:'wifi-in-0004',kind:'wifi_authenticated',observedAt:new Date(T+10_000).toISOString()});
  const exit=T+8*60*60_000;
  const a=ingest(e,{sourceId:'door',eventId:'door-out-0004',kind:'access_exit',observedAt:new Date(exit).toISOString(),receivedAtMs:exit+30_000});
  assert.equal(a.decision.status,'review_required');
  const r=ingest(e,{sourceId:'hmi',eventId:'hmi-out-0004',kind:'hmi_logout',observedAt:new Date(exit-20_000).toISOString(),receivedAtMs:exit+30_000});
  assert.equal(r.decision.status,'authoritative');
  assert.equal(r.decision.direction,'out');
  assert.equal(e.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');
});

test('existing T&A can remain direct authority only when explicitly configured',()=>{
  const e=setup();
  const r=ingest(e,{sourceId:'taa',eventId:'legacy-in-001',kind:'legacy_clock_in',observedAt:new Date(T+15_000).toISOString()});
  assert.equal(r.decision.status,'authoritative');
  assert.equal(r.decision.reason,'DIRECT_EXISTING_TAA');
});

test('replay is idempotent and content collision is rejected',()=>{
  const e=setup();
  const payload={sourceId:'door',eventId:'door-replay-01',kind:'access_entry',observedAt:new Date(T).toISOString()};
  const a=ingest(e,payload); const b=ingest(e,payload);
  assert.equal(a.replayed,false); assert.equal(b.replayed,true);
  assert.throws(()=>ingest(e,{...payload,kind:'access_exit'}),/reused for different content/);
});

test('tenant/site/source boundaries fail closed',()=>{
  const e=setup();
  e.registerPerson({tenant:'other',employee:'e1',sites:['x']});
  e.registerSource({tenant:'other',sourceId:'door',site:'x',type:'access'});
  assert.throws(()=>e.ingest({tenant:'acme',sourceId:'door',eventId:'cross-tenant-01',employee:'missing',kind:'access_entry',observedAt:new Date(T).toISOString(),receivedAtMs:T+1000}),/not registered/);
  e.revokeSource({tenant:'acme',sourceId:'door'});
  assert.throws(()=>ingest(e,{sourceId:'door',eventId:'revoked-door-01',kind:'access_entry',observedAt:new Date(T).toISOString()}),/not active/);
});

test('revoked source cannot complete a previously pending attendance quorum',()=>{
  const e=setup();
  const pending=ingest(e,{sourceId:'door',eventId:'revoked-pending-01',kind:'access_entry',observedAt:new Date(T).toISOString()});
  assert.equal(pending.decision.status,'review_required');
  assert.equal(e.revokeSource({tenant:'acme',sourceId:'door'}),true);
  const r=ingest(e,{sourceId:'wifi',eventId:'revoked-pending-02',kind:'wifi_authenticated',observedAt:new Date(T+20_000).toISOString()});
  assert.notEqual(r.decision.status,'authoritative');
  assert.equal(r.decision.reason,'NO_TRUSTED_TIME_ANCHOR');
  assert.equal(e.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');
  assert.equal(e.audit.filter(x=>x.action==='attendance-in-authoritative').length,0);
});

test('source clock drift beyond configured future and offline bounds fails closed',()=>{
  const e=setup();
  assert.throws(()=>e.ingest({tenant:'acme',sourceId:'door',eventId:'future-drift-01',employee:'e1',kind:'access_entry',observedAt:new Date(T+130_001).toISOString(),receivedAtMs:T+10_000}),/too far in the future/);
  assert.throws(()=>e.ingest({tenant:'acme',sourceId:'door',eventId:'stale-drift-001',employee:'e1',kind:'access_entry',observedAt:new Date(T).toISOString(),receivedAtMs:T+86_400_001}),/outside the supported offline window/);
});

test('metadata minimisation drops coordinates, SSID and arbitrary surveillance detail',()=>{
  const e=setup();
  ingest(e,{sourceId:'door',eventId:'privacy-0001',kind:'access_entry',observedAt:new Date(T).toISOString(),metadata:{controllerId:'c1',lat:52.6,long:-1.6,ssid:'Factory',rawImage:'x',zoneId:'entrance'}});
  const [row]=e.getEvidence({tenant:'acme',employee:'e1',site:'s1'});
  assert.deepEqual(row.metadata,{controllerId:'c1',zoneId:'entrance'});
});

test('out-of-window corroboration does not create authority',()=>{
  const e=setup();
  ingest(e,{sourceId:'door',eventId:'door-late-001',kind:'access_entry',observedAt:new Date(T).toISOString()});
  const r=ingest(e,{sourceId:'wifi',eventId:'wifi-late-001',kind:'wifi_authenticated',observedAt:new Date(T+180_001).toISOString()});
  assert.notEqual(r.decision.status,'authoritative');
});

test('same domain cannot satisfy independent corroboration',()=>{
  const e=setup();
  e.registerSource({tenant:'acme',sourceId:'door2',site:'s1',type:'access'});
  ingest(e,{sourceId:'door',eventId:'door-a-0001',kind:'access_entry',observedAt:new Date(T).toISOString()});
  const r=ingest(e,{sourceId:'door2',eventId:'door-b-0001',kind:'access_entry',observedAt:new Date(T+1000).toISOString()});
  assert.equal(r.decision.status,'review_required');
});

test('wrong-site employee evidence is rejected',()=>{
  const e=new AutomaticAttendanceEvidenceEngine();
  e.registerPerson({tenant:'acme',employee:'e1',sites:['s2']});
  e.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access'});
  assert.throws(()=>e.ingest({tenant:'acme',sourceId:'door',eventId:'wrong-site-01',employee:'e1',kind:'access_entry',observedAt:new Date(T).toISOString(),receivedAtMs:T+1000}),/not assigned/);
});

test('randomized duplicate/reorder stream never creates duplicate authoritative IN/OUT transitions',()=>{
  for(let run=0;run<500;run++){
    const e=setup();
    const jitter=n=>T+n+(Math.floor(Math.random()*1000));
    const batch=[
      {sourceId:'door',eventId:`d-in-${run}-000`,kind:'access_entry',observedAt:new Date(jitter(0)).toISOString()},
      {sourceId:'wifi',eventId:`w-in-${run}-000`,kind:'wifi_authenticated',observedAt:new Date(jitter(1000)).toISOString()},
    ];
    for(const x of (Math.random()>.5?batch:[...batch].reverse())) ingest(e,x);
    const s=e.getState({tenant:'acme',employee:'e1',site:'s1'});
    assert.equal(s.status,'present');
    assert.equal(e.audit.filter(x=>x.action==='attendance-in-authoritative').length,1);
    for(const x of batch) ingest(e,x);
    assert.equal(e.audit.filter(x=>x.action==='attendance-in-authoritative').length,1);
  }
});

test('two ordinary logout/disappearance signals still cannot stop pay without a departure anchor',()=>{
  const e=setup();
  e.registerSource({tenant:'acme',sourceId:'pc',site:'s1',type:'windows'});
  ingest(e,{sourceId:'door',eventId:'door-in-safe-1',kind:'access_entry',observedAt:new Date(T).toISOString()});
  ingest(e,{sourceId:'wifi',eventId:'wifi-in-safe-1',kind:'wifi_authenticated',observedAt:new Date(T+1000).toISOString()});
  const end=T+8*60*60_000;
  const a=ingest(e,{sourceId:'hmi',eventId:'hmi-log-safe-1',kind:'hmi_logout',observedAt:new Date(end).toISOString(),receivedAtMs:end+2000});
  const b=ingest(e,{sourceId:'pc',eventId:'pc-log-safe-1',kind:'workstation_logout',observedAt:new Date(end+1000).toISOString(),receivedAtMs:end+2000});
  assert.equal(a.decision.status,'evidence_only');
  assert.equal(b.decision.status,'evidence_only');
  assert.equal(e.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
});

test('10,000 weak negative signals never create an authoritative OUT',()=>{
  const e=setup();
  e.registerSource({tenant:'acme',sourceId:'pc',site:'s1',type:'windows'});
  ingest(e,{sourceId:'door',eventId:'door-in-stress',kind:'access_entry',observedAt:new Date(T).toISOString()});
  ingest(e,{sourceId:'wifi',eventId:'wifi-in-stress',kind:'wifi_authenticated',observedAt:new Date(T+1000).toISOString()});
  const kinds=[['wifi','wifi_disconnected'],['hmi','hmi_logout'],['pc','workstation_logout']];
  for(let i=0;i<10_000;i++){
    const [sourceId,kind]=kinds[i%kinds.length];
    const at=T+3_600_000+(i%30_000);
    e.ingest({tenant:'acme',employee:'e1',sourceId,eventId:`weak-neg-${String(i).padStart(6,'0')}`,kind,observedAt:new Date(at).toISOString(),receivedAtMs:at+10});
  }
  assert.equal(e.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
  assert.equal(e.audit.filter(x=>x.action==='attendance-out-authoritative').length,0);
});
