'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSecurityPolicyAttestedLaunchIntent,
  createSecurityPolicyAttestedProvisioningOutbox,
  verifyProvisioningSecurityPolicy,
  sha256
} = require('./provisioning-security-policy-attestation.cjs');

const NETWORK_DIGEST = 'a'.repeat(64);
const SECRETS_DIGEST = 'b'.repeat(64);
const BUILD_INTENT = 'c'.repeat(64);

function trustedPolicies() {
  return {
    network: { id: 'private-until-ready', version: '2026.09', sha256: NETWORK_DIGEST },
    secrets: { id: 'server-managed-per-tenant', version: '2026.09', sha256: SECRETS_DIGEST }
  };
}

function plan() {
  return {
    provider: 'railway',
    region: 'eu-west',
    creationMode: 'fresh-provider-create',
    isolated: true,
    networkPolicy: 'private-until-ready',
    networkPolicyVersion: '2026.09',
    networkPolicySha256: NETWORK_DIGEST,
    secretsPolicy: 'server-managed-per-tenant',
    secretsPolicyVersion: '2026.09',
    secretsPolicySha256: SECRETS_DIGEST
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

function baseLaunchFactory(input) {
  return {
    queueKey: 'queue-1',
    plan: {
      provider: input.plan.provider,
      region: input.plan.region,
      creationMode: input.plan.creationMode,
      isolated: input.plan.isolated,
      networkPolicy: input.plan.networkPolicy,
      secretsPolicy: input.plan.secretsPolicy
    },
    buildAttestedIntentDigest: BUILD_INTENT
  };
}

function stubOutboxFactory() {
  const records = new Map();
  return function createStubOutbox() {
    return {
      enqueue(intent) {
        if (records.has(intent.queueKey)) return { duplicate: true, record: structuredClone(records.get(intent.queueKey)) };
        const record = { queueKey: intent.queueKey, payload: structuredClone(intent), state: 'QUEUED' };
        records.set(intent.queueKey, record);
        return { duplicate: false, record: structuredClone(record) };
      },
      get(key) { return records.has(key) ? structuredClone(records.get(key)) : null; },
      claim(key, workerId) { return { queueKey: key, workerId }; },
      beginMutation(token) { return { ...token, mutationStarted: true }; },
      recordProviderOutcome(token, outcome) { return { ...token, outcome }; },
      recordReconciliation(key, result) { return { queueKey: key, result }; },
      recordIndependentVerification(key, verification) { return { queueKey: key, verification }; }
    };
  };
}

function intent() {
  return createSecurityPolicyAttestedLaunchIntent({ plan: plan() }, {
    trustedProvisioningPolicies: trustedPolicies(),
    baseLaunchFactory
  });
}

test('security baseline requires exact policy id, version and digest', () => {
  const verified = verifyProvisioningSecurityPolicy(plan(), trustedPolicies());
  assert.equal(verified.ok, true);
  assert.match(verified.policyDigest, /^[a-f0-9]{64}$/);

  expectCode(() => verifyProvisioningSecurityPolicy({ ...plan(), networkPolicyVersion: '2026.10' }, trustedPolicies()), 'WFM_NETWORK_POLICY_UNTRUSTED');
  expectCode(() => verifyProvisioningSecurityPolicy({ ...plan(), secretsPolicySha256: 'd'.repeat(64) }, trustedPolicies()), 'WFM_SECRETS_POLICY_UNTRUSTED');
});

test('launch identity is sealed to the exact trusted security policy baseline', () => {
  const sealed = intent();
  assert.equal(sealed.provisioningSecurityPolicyEvidence.subject.network.sha256, NETWORK_DIGEST);
  assert.equal(sealed.provisioningSecurityPolicyEvidence.subject.secrets.sha256, SECRETS_DIGEST);
  assert.equal(
    sealed.securityPolicyAttestedIntentDigest,
    sha256({
      buildAttestedIntentDigest: BUILD_INTENT,
      provisioningSecurityPolicyDigest: sealed.provisioningSecurityPolicyEvidence.policyDigest
    })
  );
});

test('queue transitions fail closed if the trusted baseline changes before mutation', () => {
  const sealed = intent();
  const factory = stubOutboxFactory();
  const outbox = createSecurityPolicyAttestedProvisioningOutbox({}, {
    trustedProvisioningPolicies: trustedPolicies(),
    baseOutboxFactory: factory
  });
  assert.equal(outbox.enqueue(sealed).duplicate, false);
  assert.equal(outbox.beginMutation({ queueKey: sealed.queueKey }).mutationStarted, true);

  const rotated = trustedPolicies();
  rotated.network.version = '2026.10';
  rotated.network.sha256 = 'e'.repeat(64);
  const afterRotation = createSecurityPolicyAttestedProvisioningOutbox({}, {
    trustedProvisioningPolicies: rotated,
    baseOutboxFactory: factory
  });
  expectCode(() => afterRotation.beginMutation({ queueKey: sealed.queueKey }), 'WFM_NETWORK_POLICY_UNTRUSTED');
});

test('independent readiness must observe the approved network and secrets policy digests', () => {
  const sealed = intent();
  const outbox = createSecurityPolicyAttestedProvisioningOutbox({}, {
    trustedProvisioningPolicies: trustedPolicies(),
    baseOutboxFactory: stubOutboxFactory()
  });
  outbox.enqueue(sealed);

  expectCode(() => outbox.recordIndependentVerification(sealed.queueKey, {
    observedNetworkPolicySha256: 'f'.repeat(64),
    observedSecretsPolicySha256: SECRETS_DIGEST,
    checks: { health: true, security: true, readiness: true }
  }), 'WFM_NETWORK_POLICY_VERIFICATION_MISMATCH');

  const verified = outbox.recordIndependentVerification(sealed.queueKey, {
    observedNetworkPolicySha256: NETWORK_DIGEST,
    observedSecretsPolicySha256: SECRETS_DIGEST,
    checks: { health: true, security: true, readiness: true }
  });
  assert.equal(verified.verification.checks.provisioningSecurityPolicyVerified, true);
});
