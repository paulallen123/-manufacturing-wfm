import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  proofHealthCode,
  validateProofRegistry,
  assertRuntimeIdentity
} from './proof-integrity-contract.mjs';

const SHA = '486606c4269bc8f1a2f24056fec22a6d6ffc7aad';

function runner(overrides = {}) {
  return {
    id: 'browser-e2e',
    service: 'vector-2000-browser-proof',
    claim: 'browser-role-e2e',
    role: 'canonical',
    lifecycle: 'active',
    promotionEligible: true,
    identityBinding: 'runtime-identity-endpoint',
    terminalProofOwnsHealth: true,
    deploymentSuccessCountsAsPass: false,
    failureDomain: 'railway:workspace:e70c27e3-38a3-47d9-acce-db6029d9f2ac',
    ...overrides
  };
}

function registry(runners) {
  return {
    schemaVersion: 1,
    name: 'VECTOR_PROOF_INTEGRITY_REGISTRY_V1',
    candidateIdentity: {
      authority: 'runtime-identity-endpoint',
      endpoint: '/api/runtime-identity',
      requiredSourceBinding: 'build-file-matched',
      manualExpectedShaAuthoritative: false
    },
    railwayStatus: {
      deploymentSuccessCountsAsProofPass: false,
      healthRequiresTerminalPass: true,
      nonPassHealthCode: 503
    },
    runners
  };
}

test('Railway health is green only for terminal proof PASS', () => {
  assert.equal(proofHealthCode('PASS'), 200);
  for (const status of ['PENDING', 'FAIL', 'BLOCKED', 'UNPROVEN', 'PARTIAL', 'SUCCESS', null, undefined]) {
    assert.equal(proofHealthCode(status), 503, String(status));
  }
});

test('active promotion runners must bind identity from the runtime endpoint', () => {
  assert.throws(
    () => validateProofRegistry(registry([runner({ identityBinding: 'manual-env-sha' })])),
    /runtime-identity-endpoint/
  );
});

test('Railway deployment success can never be configured as proof success', () => {
  assert.throws(
    () => validateProofRegistry(registry([runner({ deploymentSuccessCountsAsPass: true })])),
    /deployment success/
  );
});

test('each proof claim has exactly one active canonical owner', () => {
  assert.throws(
    () => validateProofRegistry(registry([
      runner(),
      runner({ id: 'browser-e2e-copy', service: 'vector-fresh-browser-c5f-proof' })
    ])),
    /canonical owner/
  );
});

test('retired, negative and helper services cannot be promotion gates', () => {
  for (const lifecycle of ['retired', 'negative', 'helper']) {
    assert.throws(
      () => validateProofRegistry(registry([runner({ lifecycle, promotionEligible: true })])),
      /cannot be promotion eligible/
    );
  }
});

test('runtime identity must be sealed to the build, not merely configured', () => {
  assert.equal(
    assertRuntimeIdentity({
      schemaVersion: 1,
      candidateSha: SHA,
      sourceBinding: 'build-file-matched',
      fixtureOnly: true,
      productionApproved: false
    }),
    SHA
  );
  assert.throws(
    () => assertRuntimeIdentity({ candidateSha: SHA, sourceBinding: 'configured-only' }),
    /build-file-matched/
  );
  assert.throws(
    () => assertRuntimeIdentity({ candidateSha: 'not-a-sha', sourceBinding: 'build-file-matched' }),
    /candidate SHA/
  );
});

test('repository proof registry satisfies the integrity contract', () => {
  const file = new URL('../release/proof-integrity-registry.json', import.meta.url);
  const live = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.doesNotThrow(() => validateProofRegistry(live));
});
