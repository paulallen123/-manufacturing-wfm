'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertDeploymentAttestation } = require('./deployment-attestation.cjs');

const A = '1ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
const B = '2ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';

test('accepts an exact composed image/configured deployment identity match', () => {
  assert.deepEqual(assertDeploymentAttestation({ imageDeploymentSha256: A, configuredDeploymentSha256: A }), {
    ok: true,
    deploymentSha256: A
  });
});

test('normalizes uppercase deployment identity without weakening equality', () => {
  assert.equal(assertDeploymentAttestation({ imageDeploymentSha256: A.toUpperCase(), configuredDeploymentSha256: A }).deploymentSha256, A);
});

test('fails closed when the image deployment identity is missing or malformed', () => {
  assert.throws(
    () => assertDeploymentAttestation({ imageDeploymentSha256: '', configuredDeploymentSha256: A }),
    error => error?.code === 'WFM_DEPLOYMENT_ATTESTATION_IMAGE_INVALID'
  );
});

test('fails closed when the external deployment identity is missing or malformed', () => {
  assert.throws(
    () => assertDeploymentAttestation({ imageDeploymentSha256: A, configuredDeploymentSha256: 'not-a-digest' }),
    error => error?.code === 'WFM_DEPLOYMENT_ATTESTATION_CONFIG_INVALID'
  );
});

test('fails closed on a valid but different deployment identity', () => {
  assert.throws(
    () => assertDeploymentAttestation({ imageDeploymentSha256: A, configuredDeploymentSha256: B }),
    error => error?.code === 'WFM_DEPLOYMENT_ATTESTATION_MISMATCH'
  );
});
