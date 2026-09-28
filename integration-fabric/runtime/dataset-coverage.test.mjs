import test from 'node:test';
import assert from 'node:assert/strict';
import {COVERAGE_KINDS,missingRecordDisposition,reconciliationRequirements,assertSafeTombstoneInference} from './dataset-coverage.mjs';

test('sparse Katana inventory signals never imply deleted variants',()=>{
  const coverage={dataset:'inventory_signals',kind:COVERAGE_KINDS.SPARSE_PROJECTION,absenceMeaning:'no-demand-in-30-day-window',entityUniverse:'variants-with-recent-demand',scopeProven:true,pageComplete:true,reconciliationComplete:true,authoritativeForExistence:false};
  assert.equal(missingRecordDisposition(coverage),'do-not-delete');
  assert.throws(()=>assertSafeTombstoneInference(coverage),/cannot imply deletion/);
});

test('incremental deltas require overlap replay and do not infer deletion',()=>{
  const coverage={dataset:'manufacturing_orders',kind:COVERAGE_KINDS.INCREMENTAL_DELTA,absenceMeaning:'unchanged-or-outside-window',scopeProven:true,pageComplete:true,reconciliationComplete:true,authoritativeForExistence:false};
  assert.equal(missingRecordDisposition(coverage),'do-not-delete');
  assert.equal(reconciliationRequirements(coverage).overlapReplayRequired,true);
});

test('event signals are never completeness evidence',()=>{
  const coverage={dataset:'webhook_events',kind:COVERAGE_KINDS.EVENT_SIGNAL,absenceMeaning:'no-event-observed',scopeProven:true,pageComplete:true,reconciliationComplete:true,authoritativeForExistence:false};
  const req=reconciliationRequirements(coverage);
  assert.equal(req.deletionBlocked,true);
  assert.equal(req.fullSnapshotRequiredForExistenceProof,true);
});

test('pagination gap blocks deletion even for an authoritative complete snapshot',()=>{
  const coverage={dataset:'inventory',kind:COVERAGE_KINDS.COMPLETE_SNAPSHOT,absenceMeaning:'record-not-present-in-authoritative-snapshot',scopeProven:true,pageComplete:false,reconciliationComplete:true,authoritativeForExistence:true};
  assert.equal(missingRecordDisposition(coverage),'do-not-delete');
  assert.equal(reconciliationRequirements(coverage).pageCompletionRequired,true);
});

test('unproven tenant/site scope blocks deletion',()=>{
  const coverage={dataset:'inventory',kind:COVERAGE_KINDS.COMPLETE_SNAPSHOT,absenceMeaning:'record-not-present-in-authoritative-snapshot',scopeProven:false,pageComplete:true,reconciliationComplete:true,authoritativeForExistence:true};
  assert.equal(missingRecordDisposition(coverage),'do-not-delete');
  assert.equal(reconciliationRequirements(coverage).scopeProofRequired,true);
});

test('only a reconciled authoritative complete snapshot may yield a tombstone candidate',()=>{
  const coverage={dataset:'inventory',kind:COVERAGE_KINDS.COMPLETE_SNAPSHOT,absenceMeaning:'record-not-present-in-authoritative-snapshot',scopeProven:true,pageComplete:true,reconciliationComplete:true,authoritativeForExistence:true};
  assert.equal(missingRecordDisposition(coverage),'tombstone-candidate');
  assert.equal(assertSafeTombstoneInference(coverage).dataset,'inventory');
});
