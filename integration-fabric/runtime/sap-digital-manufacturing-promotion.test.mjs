import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const url=new URL('../research-overlays/2026-09-26-2254-sap-digital-manufacturing.json',import.meta.url);
const overlay=fs.existsSync(url)?JSON.parse(fs.readFileSync(url,'utf8')):{overrides:[]};
const patch=overlay.overrides.find(entry=>entry.id==='sap-digital-manufacturing')?.patch;

test('SAP Digital Manufacturing remains documentation-only and mutation-denying',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.auth,/OAuth/i);
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
});

test('SAP Digital Manufacturing separates transactional reads from delayed analytics',()=>{
  assert.equal(patch.manufacturingObservationAuthority.derivedObservationGrantsTransactionalAuthority,false);
  assert.equal(patch.manufacturingObservationAuthority.writeBackAuthority,false);
  assert.equal(patch.manufacturingObservationAuthority.checkpointAdvanceAllowed,false);
  assert.equal(patch.manufacturingObservationAuthority.deletionAuthority,false);
  assert.equal(patch.manufacturingObservationAuthority.causalClaimAuthority,false);
  assert.match(patch.reconciliation,/MDO.*delay|delayed.*MDO/i);
});

test('SAP Digital Manufacturing records API bounds and read-only routes',()=>{
  assert.match(patch.paginationDeltaEventsFilesQueues.pagination,/1,?000/);
  assert.match(patch.paginationDeltaEventsFilesQueues.pagination,/5,?000/);
  assert.match(patch.rateLimits,/1,000.*second/i);
  assert.match(patch.rateLimits,/429/);
  assert.match(patch.reconciliation,/7 days/i);
  assert.match(patch.reconciliation,/5 resources/i);
  assert.match(patch.readCapability,/quantity.*posting/i);
  assert.match(patch.writeCapability,/denied|no .*authority/i);
});

test('SAP Digital Manufacturing maps factory outcomes without claiming labour causation',()=>{
  for(const object of [
    'production-orders','operations-and-sfcs','plants-work-centres-resources','yield-and-scrap',
    'activity-confirmations','availability-and-performance-losses','inventory-and-wip'
  ]) assert.ok(patch.dataObjects.includes(object),object);
  assert.match(patch.valueReview.customerValue.join(' '),/labour|staff/i);
  assert.match(patch.valueReview.constraintsRisks.join(' '),/caus|payroll|derived/i);
  assert.match(patch.nextBuildAction,/authorised SAP Digital Manufacturing/i);
});
