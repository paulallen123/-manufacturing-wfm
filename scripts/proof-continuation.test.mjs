#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProofStages, buildProofPlan } from './run-proof-continuation.mjs';

test('continuation receipt stays fail-closed even when later independent proof passes',()=>{
  const receipt=summarizeProofStages([
    {id:'integrated-regression-suite',mandatory:true,status:'FAIL'},
    {id:'local-vector-proof',mandatory:true,status:'PASS'},
    {id:'portable-autonomy-proof',mandatory:true,status:'PASS'}
  ]);
  assert.equal(receipt.strategy,'FAIL_CLOSED_NOT_FAIL_STOP');
  assert.equal(receipt.continuedAfterFailure,true);
  assert.equal(receipt.allMandatoryStagesPassed,false);
  assert.equal(receipt.promotionBlocked,true);
  assert.equal(receipt.promotionClaim,'NONE');
  assert.equal(receipt.productionAuthorityGranted,false);
});

test('all proof stages remain mandatory and non-duplicated',()=>{
  const plan=buildProofPlan();
  assert.deepEqual(plan.map(x=>x.id),[
    'integrated-regression-suite',
    'local-vector-proof',
    'portable-autonomy-proof'
  ]);
  assert.ok(plan.every(x=>x.mandatory===true));
  assert.equal(new Set(plan.map(x=>x.id)).size,plan.length);
  const integrated=plan.find(x=>x.id==='integrated-regression-suite');
  assert.ok(integrated.args.includes('integration-fabric/runtime/connector-registry.test.mjs'));
  assert.ok(integrated.args.includes('operations/runtime/autopilot-execution-engine.test.cjs'));
  assert.ok(integrated.args.includes('learning/runtime/training-regeneration-planner.test.cjs'));
});

test('no passing diagnostic stage can erase an earlier mandatory failure',()=>{
  const receipt=summarizeProofStages([
    {id:'a',mandatory:true,status:'FAIL'},
    {id:'b',mandatory:false,status:'PASS'},
    {id:'c',mandatory:true,status:'PASS'}
  ]);
  assert.deepEqual(receipt.failedMandatoryStageIds,['a']);
  assert.equal(receipt.mandatoryFailureCount,1);
  assert.equal(receipt.promotionBlocked,true);
});
