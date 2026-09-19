import assert from 'node:assert/strict';
import { assessRailwayContainment } from './railway-containment-policy.mjs';

const watchOnly = assessRailwayContainment({
  credentialBearing: true,
  watchHeld: true
});
assert.equal(watchOnly.automaticSourceTriggerContained, true);
assert.equal(watchOnly.manualRedeployRuntimeContained, false);
assert.equal(watchOnly.fullContainment, false);
assert.ok(watchOnly.residualRisks.includes('manual_redeploy_can_reuse_snapshot_build'));

const unprovenPreDeploy = assessRailwayContainment({
  credentialBearing: true,
  watchHeld: true,
  preDeployCandidateBound: true
});
assert.equal(unprovenPreDeploy.manualRedeployRuntimeContained, false);
assert.ok(unprovenPreDeploy.residualRisks.includes('manual_redeploy_runtime_guard_unproven'));

const observedRuntimeBlock = assessRailwayContainment({
  credentialBearing: true,
  watchHeld: true,
  preDeployCandidateBound: true,
  manualRedeployRuntimeProbeBlocked: true
});
assert.equal(observedRuntimeBlock.boundedRuntimeContainment, true);
assert.equal(observedRuntimeBlock.manualRedeployBuildSafe, false);
assert.equal(observedRuntimeBlock.fullContainment, false);
assert.equal(observedRuntimeBlock.promotionAllowed, false);
assert.ok(observedRuntimeBlock.residualRisks.includes('manual_build_executes_before_runtime_block'));

const noHold = assessRailwayContainment({
  credentialBearing: true
});
assert.equal(noHold.automaticSourceTriggerContained, false);
assert.equal(noHold.boundedRuntimeContainment, false);

const releasable = assessRailwayContainment({
  credentialBearing: true,
  sourceProtected: true,
  sourceVerified: true,
  sourceChecksRequired: true,
  immutableArtifact: true,
  redeployAuthorityIndependent: true
});
assert.equal(releasable.sourceTrusted, true);
assert.equal(releasable.manualRedeployBuildSafe, true);
assert.equal(releasable.manualRedeployRuntimeContained, true);
assert.equal(releasable.fullContainment, true);
assert.equal(releasable.promotionAllowed, true);
assert.deepEqual(releasable.residualRisks, []);

console.log('railway containment policy: 5/5 passed');
