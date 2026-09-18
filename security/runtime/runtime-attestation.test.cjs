'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertRuntimeAttestation } = require('./runtime-attestation.cjs');

const A = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
const B = '4ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';

test('accepts an exact image/configured runtime identity match', () => {
  assert.deepEqual(assertRuntimeAttestation({ imageRuntimeSha256: A, configuredRuntimeSha256: A }), {
    ok: true,
    runtimeSha256: A
  });
});

test('normalizes valid uppercase runtime identity without weakening equality', () => {
  assert.equal(assertRuntimeAttestation({ imageRuntimeSha256: A.toUpperCase(), configuredRuntimeSha256: A }).runtimeSha256, A);
});

test('fails closed when the image-baked runtime identity is missing or malformed', () => {
  assert.throws(
    () => assertRuntimeAttestation({ imageRuntimeSha256: '', configuredRuntimeSha256: A }),
    error => error?.code === 'WFM_RUNTIME_ATTESTATION_IMAGE_INVALID'
  );
});

test('fails closed when the independently configured runtime identity is missing or malformed', () => {
  assert.throws(
    () => assertRuntimeAttestation({ imageRuntimeSha256: A, configuredRuntimeSha256: 'not-a-digest' }),
    error => error?.code === 'WFM_RUNTIME_ATTESTATION_CONFIG_INVALID'
  );
});

test('fails closed on a valid but different configured runtime identity', () => {
  assert.throws(
    () => assertRuntimeAttestation({ imageRuntimeSha256: A, configuredRuntimeSha256: B }),
    error => error?.code === 'WFM_RUNTIME_ATTESTATION_MISMATCH'
  );
});
