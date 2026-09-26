import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const overlay=JSON.parse(fs.readFileSync(new URL('../research-overlays/2026-09-26-1927-quickbooks-online.json',import.meta.url),'utf8'));
const patch=overlay.overrides.find(entry=>entry.id==='quickbooks-online')?.patch;

test('QuickBooks Online remains documentation-only and mutation-denying',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
  assert.match(patch.auth,/OAuth/i);
});

test('QuickBooks webhook signals require signature verification and never become record authority',()=>{
  assert.equal(patch.changeSignalReconciliation.signatureVerificationRequired,true);
  assert.equal(patch.changeSignalReconciliation.webhookRecordAuthority,false);
  assert.equal(patch.changeSignalReconciliation.deletionAuthority,false);
  assert.ok(patch.changeSignalReconciliation.exactScopeDimensions.includes('realmId'));
  assert.ok(patch.changeSignalReconciliation.exactScopeDimensions.includes('apiMinorVersion'));
});

test('QuickBooks CDC recovery is bounded and fails closed beyond its provider horizon',()=>{
  assert.equal(patch.changeSignalReconciliation.cdcLookbackDays,30);
  assert.equal(patch.changeSignalReconciliation.maximumCdcObjects,1000);
  assert.equal(patch.changeSignalReconciliation.fullSnapshotRequiredBeyondLookback,true);
  assert.match(patch.reconciliation,/overlap/i);
  assert.match(patch.reconciliation,/full snapshot/i);
});

test('QuickBooks maps small-manufacturer finance, time and inventory without claiming manufacturing authority',()=>{
  for(const object of ['employees','time-activities','items-and-inventory','purchases-and-suppliers','journals-and-finance']){
    assert.ok(patch.dataObjects.includes(object),object);
  }
  assert.match(patch.valueReview.customerValue.join(' '),/small|micro/i);
  assert.match(patch.valueReview.constraintsRisks.join(' '),/manufacturing|production-order/i);
  assert.match(patch.nextBuildAction,/authorised QuickBooks Online sandbox/i);
});
