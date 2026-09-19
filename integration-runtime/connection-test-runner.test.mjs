import assert from 'node:assert/strict';
import { activationReadiness, approvalFingerprint } from './connection-contract.mjs';
import { runRecoveryProof, runSafeConnectionTest } from './connection-test-runner.mjs';
import { SAP_SUCCESSFACTORS } from './provider-manifests.mjs';

function profile() {
  return {
    schemaVersion: 1,
    connectionId: 'sf-tenant-a',
    scope: { tenantId: 'tenant-a', siteIds: ['site-1'] },
    provider: {
      key: 'sap_successfactors', mappingVersion: 'sf-v1',
      configRefs: {
        companyIdRef: 'tenant-config://sap/company-id',
        clientIdRef: 'tenant-config://sap/client-id',
        tokenEndpointRef: 'tenant-config://sap/token-endpoint',
        odataPlanRef: 'tenant-config://sap/odata-plan',
        schemaEvidenceRef: 'evidence://sap/schema-reviewed'
      }
    },
    direction: 'inbound',
    transport: { kind: 'rest_api', endpointRef: 'tenant-config://sap/odata-endpoint' },
    authentication: { method: 'signed_assertion', credentialRef: 'vault://sap/saml-assertion' },
    mapping: { version: 'sf-v1', status: 'reviewed' },
    safety: { mode: 'read_only', productionMutationAllowed: false },
    authority: { entityOwners: { employee: 'sap_successfactors', worked_time: 'wfm' } },
    recovery: { maxAttempts: 3, idempotencyKey: 'sourceRevision' },
    monitoring: { freshnessSeconds: 300, reconciliationRequired: true },
    activation: { approved: false, approvedByRole: 'integration_admin', fingerprint: '' }
  };
}

function goodProbe(overrides = {}) {
  return {
    connectionId: 'sf-tenant-a',
    providerCallObserved: true,
    providerIdentity: { verified: true, providerKey: 'sap_successfactors' },
    authenticationObserved: true,
    schemaObserved: true,
    schemaEvidenceRef: 'evidence://sap/schema-observed',
    sampleRecordCount: 3,
    sampleBytes: 2048,
    mutationObserved: false,
    rawSensitiveDataPersisted: false,
    workforceApplyObserved: false,
    evidenceRef: 'evidence://sap/connection-test',
    transportSafety: {
      transportKind: 'rest_api',
      observedControls: ['endpoint_identity', 'non_mutating_request'],
      mutationObserved: false,
      scopeExceeded: false
    },
    reconciliation: { status: 'passed', sourceCount: 3, stagedCount: 3, evidenceRef: 'evidence://sap/reconciliation' },
    ...overrides
  };
}

function executor(overrides = {}) {
  return {
    trustClass: 'trusted_executor',
    identityRef: 'runtime://integration/trusted-worker',
    probe: async (request) => {
      assert.equal(request.safety.mutationAllowed, false);
      assert.equal(request.safety.productionMutationAllowed, false);
      assert.equal(request.safety.persistRawSensitiveData, false);
      assert.equal(request.safety.applyToWorkforce, false);
      assert.equal(request.limits.maxRecords, 5);
      assert.deepEqual(request.transport.requiredSafetyEvidence, ['endpoint_identity', 'non_mutating_request']);
      return goodProbe();
    },
    proveRecovery: async () => ({
      transientFailureObserved: true,
      successfulRecoveryObserved: true,
      sameOperationRecovered: true,
      attempts: 2,
      duplicateApplicationCount: 0,
      mutationObserved: false,
      rawSensitiveDataPersisted: false,
      evidenceRef: 'evidence://sap/recovery',
      reconciliation: { status: 'passed', evidenceRef: 'evidence://sap/recovery-reconciliation' }
    }),
    ...overrides
  };
}

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('safe connection test returns evidence only after a bounded non-mutating provider observation', async () => {
  const result = await runSafeConnectionTest(profile(), SAP_SUCCESSFACTORS, executor());
  assert.equal(result.status, 'passed');
  assert.equal(result.observedBy, 'trusted_executor');
  assert.equal(result.mutationObserved, false);
  assert.equal(result.rawSensitiveDataPersisted, false);
});

test('lookalike browser executor is rejected', async () => {
  const result = await runSafeConnectionTest(profile(), SAP_SUCCESSFACTORS, executor({ trustClass: 'browser' }));
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join('\n'), /trusted_executor/);
});

test('raw provider records cannot leak through proof output', async () => {
  const result = await runSafeConnectionTest(profile(), SAP_SUCCESSFACTORS, executor({ probe: async () => goodProbe({ records: [{ id: 1 }] }) }));
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join('\n'), /raw\/sensitive payload/);
});

test('provider identity mismatch fails closed', async () => {
  const result = await runSafeConnectionTest(profile(), SAP_SUCCESSFACTORS, executor({
    probe: async () => goodProbe({ providerIdentity: { verified: true, providerKey: 'other_provider' } })
  }));
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join('\n'), /provider identity/);
});

test('sample exceeding provider policy is rejected', async () => {
  const result = await runSafeConnectionTest(profile(), SAP_SUCCESSFACTORS, executor({ probe: async () => goodProbe({ sampleRecordCount: 6 }) }));
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join('\n'), /exceeds policy/);
});

test('missing transport safety evidence fails closed', async () => {
  const result = await runSafeConnectionTest(profile(), SAP_SUCCESSFACTORS, executor({ probe: async () => goodProbe({ transportSafety: undefined }) }));
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join('\n'), /transport safety evidence is missing/);
});

test('recovery cannot pass without an actually observed failure', async () => {
  const result = await runRecoveryProof(profile(), SAP_SUCCESSFACTORS, executor({
    proveRecovery: async () => ({
      transientFailureObserved: false, successfulRecoveryObserved: true, sameOperationRecovered: true,
      attempts: 2, duplicateApplicationCount: 0, mutationObserved: false, rawSensitiveDataPersisted: false,
      evidenceRef: 'evidence://sap/recovery', reconciliation: { status: 'passed', evidenceRef: 'evidence://sap/recovery-reconciliation' }
    })
  }));
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join('\n'), /observed transient failure/);
});

test('recovery requires same-operation success and reconciliation', async () => {
  const result = await runRecoveryProof(profile(), SAP_SUCCESSFACTORS, executor());
  assert.equal(result.status, 'passed');
  assert.equal(result.sameOperationRecovered, true);
  assert.equal(result.reconciliationPassed, true);
});

test('simple passed flags cannot activate without trusted evidence', () => {
  const p = profile();
  p.connectionTest = { status: 'passed', mode: 'bounded_non_mutating' };
  p.recoveryProof = { status: 'passed' };
  p.reconciliation = { status: 'passed' };
  p.activation.approved = true;
  p.activation.fingerprint = approvalFingerprint(p);
  assert.equal(activationReadiness(p).ready, false);
  assert.match(activationReadiness(p).reasons.join('\n'), /trusted executor/);
});

test('trusted connection and recovery evidence can reach explicit approval', async () => {
  const p = profile();
  p.connectionTest = await runSafeConnectionTest(p, SAP_SUCCESSFACTORS, executor());
  p.recoveryProof = await runRecoveryProof(p, SAP_SUCCESSFACTORS, executor());
  p.reconciliation = p.connectionTest.reconciliation;
  p.activation.approved = true;
  p.activation.fingerprint = approvalFingerprint(p);
  assert.equal(activationReadiness(p).ready, true);
});

let passed = 0;
for (const [name, fn] of cases) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); console.error(error.stack || error.message); process.exitCode = 1; }
}
console.log(`${passed}/${cases.length} passed`);
if (passed !== cases.length) process.exit(1);
