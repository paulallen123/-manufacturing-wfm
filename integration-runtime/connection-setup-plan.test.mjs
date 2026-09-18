import assert from 'node:assert/strict';
import { approvalFingerprint } from './connection-contract.mjs';
import {
  evaluateGenuineProviderProof,
  missingProviderConfigRefs,
  planConnectionSetup,
  providerCompatibility,
  validateProviderManifest
} from './connection-setup-plan.mjs';
import { ORACLE_NETSUITE, SAP_SUCCESSFACTORS } from './provider-manifests.mjs';

function sapProfile() {
  const profile = {
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

test('provider manifest is metadata-only and valid', () => {
  assert.equal(validateProviderManifest(SAP_SUCCESSFACTORS).ok, true);
  assert.equal(validateProviderManifest(ORACLE_NETSUITE).ok, true);
});

test('provider compatibility keeps provider rules separate from transport implementation', () => {
  const profile = sapProfile();
  assert.equal(providerCompatibility(profile, SAP_SUCCESSFACTORS).compatible, true);
  profile.authentication.method = 'basic_ref';
  assert.match(providerCompatibility(profile, SAP_SUCCESSFACTORS).reasons.join('\n'), /not supported/);
});

test('missing provider config is explicit instead of accepting raw inline values', () => {
  const profile = sapProfile();
  delete profile.provider.configRefs.companyIdRef;
  assert.deepEqual(missingProviderConfigRefs(profile, SAP_SUCCESSFACTORS), ['companyIdRef']);
});

test('setup plan reduces connection onboarding to deterministic reviewable steps', () => {
  const plan = planConnectionSetup(sapProfile(), SAP_SUCCESSFACTORS);
  assert.equal(plan.status, 'activation_ready');
  assert.equal(plan.steps.length, 6);
  assert.equal(plan.steps.every((item) => item.status === 'complete'), true);
});

test('mapping drift makes activation the customer-visible blocker', () => {
  const profile = sapProfile();
  profile.mapping.status = 'draft';
  profile.activation.fingerprint = approvalFingerprint(profile);
  const plan = planConnectionSetup(profile, SAP_SUCCESSFACTORS);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.nextStep, 'mapping');
  assert.match(plan.steps.at(-1).blockers.join('\n'), /mapping must be reviewed/);
});

test('genuine provider proof cannot be claimed from metadata or synthetic evidence alone', () => {
  const result = evaluateGenuineProviderProof(sapProfile(), SAP_SUCCESSFACTORS, {
    authorised: true,
    nonProductionTargetVerified: true,
    providerCallObserved: false,
    providerIdentityVerified: true,
    authenticationObserved: true,
    boundedSampleObserved: true,
    mutationObserved: false,
    rawSensitiveDataPersisted: false,
    schemaEvidenceRef: 'evidence://sap/schema-reviewed',
    reconciliationPassed: true
  });
  assert.equal(result.achieved, false);
  assert.match(result.blockers.join('\n'), /no genuine provider call/);
});

test('genuine provider proof is achieved only when every non-mutating evidence gate is present', () => {
  const result = evaluateGenuineProviderProof(sapProfile(), SAP_SUCCESSFACTORS, {
    authorised: true,
    nonProductionTargetVerified: true,
    providerCallObserved: true,
    providerIdentityVerified: true,
    authenticationObserved: true,
    boundedSampleObserved: true,
    mutationObserved: false,
    rawSensitiveDataPersisted: false,
    schemaEvidenceRef: 'evidence://sap/schema-reviewed',
    reconciliationPassed: true
  });
  assert.equal(result.achieved, true);
  assert.equal(result.claim, 'genuine_authorised_non_mutating_provider_proof');
});

let passed = 0;
for (const [name, fn] of cases) {
  try { fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); console.error(error.stack || error.message); process.exitCode = 1; }
}
console.log(`${passed}/${cases.length} passed`);
if (passed !== cases.length) process.exit(1);
