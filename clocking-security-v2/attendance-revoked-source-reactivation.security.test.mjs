import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';

const T=Date.parse('2026-09-20T06:00:00Z');

function setup(){
  const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:86_400_000});
  engine.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  engine.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access'});
  engine.registerSource({tenant:'acme',sourceId:'wifi',site:'s1',type:'radius'});
  return engine;
}

function ingest(engine,{sourceId,eventId,kind,at}){
  return engine.ingest({
    tenant:'acme',employee:'e1',sourceId,eventId,kind,
    observedAt:new Date(at).toISOString(),receivedAtMs:at+1000
  });
}

test('reactivating a revoked source cannot revive its pre-revocation evidence into a pending quorum',()=>{
  const engine=setup();

  const pending=ingest(engine,{sourceId:'door',eventId:'door-before-revoke-01',kind:'access_entry',at:T});
  assert.equal(pending.decision.status,'review_required');
  assert.equal(engine.revokeSource({tenant:'acme',sourceId:'door'}),true);

  // Re-registering the same logical connector is an authority-generation change,
  // not permission to reuse evidence accepted before revocation.
  engine.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access',active:true});

  const wifi=ingest(engine,{sourceId:'wifi',eventId:'wifi-after-reactivate-01',kind:'wifi_authenticated',at:T+20_000});
  assert.notEqual(wifi.decision.status,'authoritative');
  assert.equal(wifi.decision.reason,'NO_TRUSTED_TIME_ANCHOR');
  assert.equal(engine.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');
  assert.equal(engine.audit.filter(x=>x.action==='attendance-in-authoritative').length,0);

  // Fresh evidence from the reactivated generation may corroborate normally.
  const fresh=ingest(engine,{sourceId:'door',eventId:'door-after-reactivate-01',kind:'access_entry',at:T+25_000});
  assert.equal(fresh.decision.status,'authoritative');
  assert.equal(fresh.decision.direction,'in');
  assert.equal(engine.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
  assert.equal(engine.audit.filter(x=>x.action==='attendance-in-authoritative').length,1);
});
