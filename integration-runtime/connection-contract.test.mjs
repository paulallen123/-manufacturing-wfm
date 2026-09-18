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
    scope: { tenantId: 'tenant-a', siteIds: ['site-1'] },
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

test('accepts a safe reviewed tenant-scoped connection profile', () => {
  const profile = baseProfile();
  assert.equal(validateConnectionProfile(profile).ok, true);
  assert.equal(activationReadiness(profile).ready, true);
});

test('rejects missing tenant scope', () => {
  const profile = baseProfile();
  delete profile.scope;
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /tenant isolation/);
});

test('rejects duplicate or malformed site scope', () => {
  const profile = baseProfile();
  profile.scope.siteIds = ['site-1', 'site-1'];
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /must not contain duplicates/);
});

test('tenant scope changes invalidate prior activation approval', () => {
  const profile = baseProfile();
  const approved = profile.activation.fingerprint;
  profile.scope.tenantId = 'tenant-b';
  assert.notEqual(approvalFingerprint(profile), approved);
  assert.match(activationReadiness(profile).reasons.join('\n'), /stale/);
});

test('rejects embedded raw secrets', () => {
  const profile = baseProfile();
  profile.authentication.clientSecret = 'do-not-store-this';
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /embedded secret-like value/);
});

test('permits an opaque secret reference rather than a secret value', () => {
  const profile = baseProfile();
  profile.authentication.clientSecretRef = 'vault://connection/hr-core/client-secret';
  assert.equal(validateConnectionProfile(profile).ok, true);
});

test('rejects a raw credential disguised as credentialRef', () => {
  const profile = baseProfile();
  profile.authentication.credentialRef = 'super-secret-value';
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /opaque secret reference/);
});

test('rejects raw network endpoints in endpointRef', () => {
  const profile = baseProfile();
  profile.transport.endpointRef = 'https://hr.example.test/api?token=secret';
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /opaque configuration reference/);
});

test('requires separately referenced verification for unauthenticated webhook ingress', () => {
  const profile = baseProfile();
  profile.transport.kind = 'webhook';
  profile.authentication = { method: 'none' };
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /verifierRef/);
  profile.authentication.verifierRef = 'tenant-config://webhooks/provider-signature';
  profile.activation.fingerprint = approvalFingerprint(profile);
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

test('requires bounded integer retries', () => {
  const profile = baseProfile();
  profile.recovery.maxAttempts = 1000;
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /integer between 1 and 10/);
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

test('provider-specific setup metadata must use opaque references', () => {
  const profile = baseProfile();
  profile.provider.configRefs = { companyIdRef: 'tenant-config://sap/company-id', schemaEvidenceRef: 'evidence://sap/schema-reviewed' };
  profile.activation.fingerprint = approvalFingerprint(profile);
  assert.equal(validateConnectionProfile(profile).ok, true);
  profile.provider.configRefs.schemaEvidenceRef = 'https://example.test/schema';
  assert.match(validateConnectionProfile(profile).errors.join('\n'), /provider.configRefs.schemaEvidenceRef/);
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
