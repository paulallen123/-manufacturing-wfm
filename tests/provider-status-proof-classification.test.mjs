import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProofBlocker } from '../scripts/classify-proof-blocker.mjs';

test('provider success that explicitly skipped deployment is NO_PROOF', () => {
  const observedRailwayStatus = JSON.stringify({
    context: 'manufacturing-wfm-test - vector-forge-candidate',
    state: 'success',
    description: 'No deployment needed - watched paths not modified',
    sourceSha: '7a24662e55700f14eb6b46417cc9117d9dadddf3'
  });

  const result = classifyProofBlocker(observedRailwayStatus);

  assert.equal(result.blockerClass, 'PROVIDER_SKIPPED_NO_PROOF');
  assert.equal(result.blocking, true);
  assert.equal(result.countsAsProof, false);
  assert.equal(result.executedEvidence, false);
  assert.equal(result.affectedPromotion, 'QUARANTINED');
  assert.equal(result.developmentCanContinue, true);
});

test('provider success without a terminal proof receipt still fails closed', () => {
  const statusOnly = JSON.stringify({
    context: 'manufacturing-wfm-test - vector-forge-candidate',
    state: 'success',
    description: 'Deployment successful',
    sourceSha: '7a24662e55700f14eb6b46417cc9117d9dadddf3'
  });

  const result = classifyProofBlocker(statusOnly);

  assert.equal(result.blocking, true);
  assert.equal(result.countsAsProof, false);
  assert.equal(result.executedEvidence, false);
});
