#!/usr/bin/env node
import assert from 'node:assert/strict';
import {routeProofBlocker} from './proof-stage-router.mjs';

const isolated=routeProofBlocker({
  blocker:{blockerClass:'STALE_PROOF_CONTRACT'},
  affectedCapability:'integration-fabric',
  affectedStage:'exact-image'
});
assert.equal(isolated.globalStop,false);
assert.equal(isolated.globalDevelopment,'CONTINUE');
assert.equal(isolated.globalProof,'CONTINUE');
assert.equal(isolated.affectedCapabilityDevelopment,'CONTINUE');
assert.equal(isolated.affectedCapabilityProof,'DIAGNOSTIC_ONLY');
assert.equal(isolated.affectedCapabilityPromotion,'BLOCK_UNTIL_REPAIRED');
assert.equal(isolated.unaffectedCapabilities,'CONTINUE_ALL_STAGES');
assert.equal(isolated.propagate,false);
assert.deepEqual(isolated.quarantinedScopes,['integration-fabric']);

const dependent=routeProofBlocker({
  blocker:{blockerClass:'SECURITY_INVARIANT'},
  affectedCapability:'identity',
  affectedStage:'security-destructive',
  explicitDependencies:['payroll-release']
});
assert.equal(dependent.globalStop,false);
assert.equal(dependent.propagate,true);
assert.deepEqual(dependent.quarantinedScopes,['identity','payroll-release']);

const shared=routeProofBlocker({
  blocker:{blockerClass:'SECURITY_INVARIANT'},
  affectedCapability:'tenant-boundary',
  sharedCriticalInvariant:true
});
assert.equal(shared.globalStop,false);
assert.equal(shared.propagate,true);
assert.equal(shared.globalDevelopment,'CONTINUE');
assert.equal(shared.unaffectedCapabilities,'CONTINUE_ALL_STAGES');

console.log('VECTOR_PROOF_STAGE_ISOLATION=PASS');
