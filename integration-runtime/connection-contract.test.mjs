import assert from 'node:assert/strict';
import {
  approvalFingerprint,
  activationReadiness,
  validateConnectionProfile
} from './connection-contract.mjs';

function baseProfile() {
  const profile = {
    schemaVersion: 1,
    connectionId: 'demo-connection',
    provider: { key: 'provider-neutral', mappingVersion: 'v1' },
    transport: { kind: 'rest_api', endpointRef: 'tenant-config://endpoint/hr-core' },
    authentication: { method: 'oauth2_client', credentialRef: 'vault://connection/hr-core' },
    mapping: { version: 'v1', status: 'reviewed' },
    safety: { mode: 'read_only', productionMutationAllowed: false },
    authority: { entityOwners: { employee: 'hcm', worked_time: 'wfm', payroll_result: 'payroll' } },
    recovery: { maxAttempts: 3, idempotencyKey: 'sourceEventId' },
    monitoring: { freshnessSeconds: 300, reconciliationRequired: true },
    connectionTest: { status: 'passed', mode: 'bounded_non_mutating' },
    recoveryProof: { status: 'passed' },
    reconciliation: { status: 'passed' },
    activation: { approved: true, approvedByRole: 'integration_admin', fingerprint: '' }
  };
  profile.activation.fingerprint = approvalFingerprint(profile);
  return profile;
}

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('accepts a safe reviewed connection profile', () => {
  const profile = baseProfile();
  assert.equal(validateConnectionProfile(profile).ok, true);
  assert.equal(activationReadiness(profile).ready, true);
});

test('rejects embedded raw secrets', () => {
  const profile = baseProfile();
  profile.authentication.clientSecret = 'do-not-store-this';
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /embedded secret-like value/);
});

test('permits a secret reference rather than a secret value', () => {
  const profile = baseProfile();
  profile.authentication.clientSecretRef = 'vault://connection/hr-core/client-secret';
  assert.equal(validateConnectionProfile(profile).ok, true);
});

test('blocks production mutation', () => {
  const profile = baseProfile();
  profile.safety.productionMutationAllowed = true;
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /productionMutationAllowed/);
});

test('enforces read-only database mode', () => {
  const profile = baseProfile();
  profile.transport.kind = 'readonly_database';
  profile.safety.mode = 'staging_only';
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /readonly_database requires read_only/);
});

test('requires deterministic authority', () => {
  const profile = baseProfile();
  profile.authority.entityOwners = {};
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /deterministic entity authority/);
});

test('requires idempotency before retry is enabled', () => {
  const profile = baseProfile();
  delete profile.recovery.idempotencyKey;
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /idempotencyKey/);
});

test('fails activation when recovery is unproven', () => {
  const profile = baseProfile();
  profile.recoveryProof.status = 'not_run';
  profile.activation.fingerprint = approvalFingerprint(profile);
  assert.equal(activationReadiness(profile).ready, false);
  assert.match(activationReadiness(profile).reasons.join('\n'), /retry\/recovery must be proven/);
});

test('fails activation when the mapping has not been reviewed', () => {
  const profile = baseProfile();
  profile.mapping.status = 'draft';
  profile.activation.fingerprint = approvalFingerprint(profile);
  assert.equal(activationReadiness(profile).ready, false);
  assert.match(activationReadiness(profile).reasons.join('\n'), /mapping must be reviewed/);
});

test('invalidates activation when reviewed configuration changes', () => {
  const profile = baseProfile();
  const approved = profile.activation.fingerprint;
  profile.monitoring.freshnessSeconds = 120;
  assert.notEqual(approvalFingerprint(profile), approved);
  assert.match(activationReadiness(profile).reasons.join('\n'), /stale/);
});

test('ignores runtime-only status when checking approval identity', () => {
  const profile = baseProfile();
  const approved = profile.activation.fingerprint;
  profile.runtime = { lastSeenAt: '2026-09-18T20:47:00Z', state: 'healthy' };
  assert.equal(approvalFingerprint(profile), approved);
});

test('keeps provider mapping independent from transport choice', () => {
  const a = baseProfile();
  const b = baseProfile();
  b.transport.kind = 'sftp';
  b.authentication = { method: 'ssh_key_ref', credentialRef: 'vault://connection/hr-core-sftp' };
  b.activation.fingerprint = approvalFingerprint(b);
  assert.equal(a.provider.mappingVersion, b.provider.mappingVersion);
  assert.equal(validateConnectionProfile(b).ok, true);
});

let passed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
console.log(`${passed}/${cases.length} passed`);
if (passed !== cases.length) process.exit(1);
