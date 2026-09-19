import crypto from 'node:crypto';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function configurationMaterial(profile) {
  const value = clone(profile);
  delete value.activation;
  delete value.runtime;
  delete value.connectionTest;
  delete value.recoveryProof;
  delete value.reconciliation;
  return canonicalize(value);
}

export function configurationFingerprint(profile) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(configurationMaterial(profile)))
    .digest('hex');
}

export function evidenceMatchesConfiguration(evidence, profile) {
  return evidence?.configurationFingerprint === configurationFingerprint(profile);
}
