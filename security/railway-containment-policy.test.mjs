import assert from 'node:assert/strict';
import { assessRailwayContainment } from './railway-containment-policy.mjs';

const weakHold = assessRailwayContainment({
  credentialBearing: true,
  sourceProtected: false,
  sourceVerified: false,
  sourceChecksRequired: false,
  watchHeld: true,
  immutableArtifact: false,
  redeployAuthorityIndependent: false
});
assert.equal(weakHold.automaticSourceTriggerContained, true);
assert.equal(weakHold.manualRedeployContained, false);
assert.equal(weakHold.fullContainment, false);
assert.equal(weakHold.promotionAllowed, false);
assert.ok(weakHold.residualRisks.includes('manual_redeploy_bypasses_watch_hold'));

const noHold = assessRailwayContainment({
  credentialBearing: true,
  sourceProtected: false,
  sourceVerified: false,
  sourceChecksRequired: false,
  watchHeld: false,
  immutableArtifact: false,
  redeployAuthorityIndependent: false
});
assert.equal(noHold.automaticSourceTriggerContained, false);
assert.equal(noHold.fullContainment, false);

const trustedButMutable = assessRailwayContainment({
  credentialBearing: true,
  sourceProtected: true,
  sourceVerified: true,
  sourceChecksRequired: true,
  watchHeld: false,
  immutableArtifact: false,
  redeployAuthorityIndependent: true
});
assert.equal(trustedButMutable.sourceTrusted, true);
assert.equal(trustedButMutable.promotionAllowed, false);

const releasable = assessRailwayContainment({
  credentialBearing: true,
  sourceProtected: true,
  sourceVerified: true,
  sourceChecksRequired: true,
  watchHeld: false,
  immutableArtifact: true,
  redeployAuthorityIndependent: true
});
assert.equal(releasable.fullContainment, true);
assert.equal(releasable.promotionAllowed, true);
assert.deepEqual(releasable.residualRisks, []);

console.log('railway containment policy: 4/4 passed');
