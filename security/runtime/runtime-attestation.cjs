'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const SHA256_RE = /^[a-f0-9]{64}$/i;
const IMAGE_RUNTIME_ID_PATH = '/app/security-runtime/runtime-sha256';

function attestationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeDigest(value, code, label) {
  const digest = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(digest)) {
    throw attestationError(code, `${label} must be an exact SHA-256 digest.`);
  }
  return digest;
}

function readImageRuntimeSha256() {
  try {
    return fs.readFileSync(IMAGE_RUNTIME_ID_PATH, 'utf8');
  } catch {
    throw attestationError(
      'WFM_RUNTIME_ATTESTATION_IMAGE_UNAVAILABLE',
      'Sealed image runtime identity is unavailable.'
    );
  }
}

function assertRuntimeAttestation({
  imageRuntimeSha256 = readImageRuntimeSha256(),
  configuredRuntimeSha256 = process.env.WFM_RUNTIME_SHA256
} = {}) {
  const imageDigest = normalizeDigest(
    imageRuntimeSha256,
    'WFM_RUNTIME_ATTESTATION_IMAGE_INVALID',
    'Image runtime identity'
  );
  const configuredDigest = normalizeDigest(
    configuredRuntimeSha256,
    'WFM_RUNTIME_ATTESTATION_CONFIG_INVALID',
    'Configured runtime identity'
  );

  const imageBytes = Buffer.from(imageDigest, 'hex');
  const configuredBytes = Buffer.from(configuredDigest, 'hex');
  if (!crypto.timingSafeEqual(imageBytes, configuredBytes)) {
    throw attestationError(
      'WFM_RUNTIME_ATTESTATION_MISMATCH',
      'Configured runtime identity does not match the sealed runtime in this image.'
    );
  }

  return Object.freeze({ ok: true, runtimeSha256: imageDigest });
}

module.exports = { assertRuntimeAttestation };
