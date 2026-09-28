import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const url=new URL('../research-overlays/2026-09-26-2238-hid-origo.json',import.meta.url);
const overlay=fs.existsSync(url)?JSON.parse(fs.readFileSync(url,'utf8')):{overrides:[]};
const patch=overlay.overrides.find(entry=>entry.id==='hid-origo')?.patch;

test('HID Origo remains documentation-only and mutation-denying',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.auth,/OAuth/i);
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
});

test('HID Origo presence evidence cannot become attendance, payroll or access authority',()=>{
  assert.equal(patch.presenceSignalReconciliation.attendanceAuthority,false);
  assert.equal(patch.presenceSignalReconciliation.payrollAuthority,false);
  assert.equal(patch.presenceSignalReconciliation.accessDecisionAuthority,false);
  assert.equal(patch.presenceSignalReconciliation.checkpointAdvanceAllowed,false);
  assert.equal(patch.presenceSignalReconciliation.deletionAuthority,false);
  assert.equal(patch.presenceSignalReconciliation.subjectsPseudonymizedPerTenantConnection,true);
});

test('HID Origo callback gaps recover through complete event history',()=>{
  assert.equal(patch.presenceSignalReconciliation.callbackIsSignalOnly,true);
  assert.equal(patch.presenceSignalReconciliation.completeHistoryRequired,true);
  assert.match(patch.reconciliation,/SUSPENDED|EXPIRED/);
  assert.match(patch.reconciliation,/event history/i);
  assert.match(patch.rateLimits,/300.*5 minutes/i);
  assert.match(patch.rateLimits,/403/);
});

test('HID Origo maps identity and location evidence without claiming exact presence',()=>{
  for(const object of ['users','credentials-and-passes','sites-buildings-floors-zones','occupancy-utilization','proximity-signals','lifecycle-events']){
    assert.ok(patch.dataObjects.includes(object),object);
  }
  assert.match(patch.valueReview.customerValue.join(' '),/safety|occupancy|presence/i);
  assert.match(patch.valueReview.constraintsRisks.join(' '),/attendance|payroll/i);
  assert.match(patch.nextBuildAction,/authorised HID Origo/i);
});
