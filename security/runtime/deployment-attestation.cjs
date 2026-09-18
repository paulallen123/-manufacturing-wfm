'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const SHA256_RE = /^[a-f0-9]{64}$/i;
const IMAGE_DEPLOYMENT_ID_PATH = '/app/security-runtime/deployment-sha256';

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

function readImageDeploymentSha256() {
  try {
    return fs.readFileSync(IMAGE_DEPLOYMENT_ID_PATH, 'utf8');
  } catch {
    throw attestationError(
      'WFM_DEPLOYMENT_ATTESTATION_IMAGE_UNAVAILABLE',
      'Composed image deployment identity is unavailable.'
    );
  }
}

function assertDeploymentAttestation({
  imageDeploymentSha256 = readImageDeploymentSha256(),
  configuredDeploymentSha256 = process.env.WFM_DEPLOYMENT_SHA256
} = {}) {
  const imageDigest = normalizeDigest(
    imageDeploymentSha256,
    'WFM_DEPLOYMENT_ATTESTATION_IMAGE_INVALID',
    'Image deployment identity'
  );
  const configuredDigest = normalizeDigest(
    configuredDeploymentSha256,
    'WFM_DEPLOYMENT_ATTESTATION_CONFIG_INVALID',
    'Configured deployment identity'
  );

  const imageBytes = Buffer.from(imageDigest, 'hex');
  const configuredBytes = Buffer.from(configuredDigest, 'hex');
  if (!crypto.timingSafeEqual(imageBytes, configuredBytes)) {
    throw attestationError(
      'WFM_DEPLOYMENT_ATTESTATION_MISMATCH',
      'Configured deployment identity does not match the composed image content.'
    );
  }

  return Object.freeze({ ok: true, deploymentSha256: imageDigest });
}

module.exports = { assertDeploymentAttestation };
