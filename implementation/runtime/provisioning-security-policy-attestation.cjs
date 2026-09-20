'use strict';

const { createHash } = require('node:crypto');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}

function fail(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function requiredString(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') fail(code, message, 400);
  return value.trim();
}

function requiredDigest(value, code, message) {
  const digest = requiredString(value, code, message).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) fail(code, message, 400);
  return digest;
}

function normalisePolicyDescriptor(value, prefix) {
  if (!value || typeof value !== 'object') fail(`WFM_${prefix}_POLICY_TRUST_REQUIRED`, `${prefix.toLowerCase()} policy trust descriptor is required.`, 500);
  return {
    id: requiredString(value.id, `WFM_${prefix}_POLICY_ID_REQUIRED`, `${prefix.toLowerCase()} policy id is required.`),
    version: requiredString(value.version, `WFM_${prefix}_POLICY_VERSION_REQUIRED`, `${prefix.toLowerCase()} policy version is required.`),
    sha256: requiredDigest(value.sha256, `WFM_${prefix}_POLICY_DIGEST_INVALID`, `${prefix.toLowerCase()} policy SHA-256 is required.`)
  };
}

function normaliseTrustedPolicies(trustedProvisioningPolicies) {
  if (!trustedProvisioningPolicies || typeof trustedProvisioningPolicies !== 'object') {
    fail('WFM_SECURITY_POLICY_TRUST_REQUIRED', 'Trusted provisioning security policy baseline is required.', 500);
  }
  return {
    network: normalisePolicyDescriptor(trustedProvisioningPolicies.network, 'NETWORK'),
    secrets: normalisePolicyDescriptor(trustedProvisioningPolicies.secrets, 'SECRETS')
  };
}

function normalisePlanPolicySubject(plan) {
  if (!plan || typeof plan !== 'object') fail('WFM_PROVISIONING_PLAN_REQUIRED', 'Provisioning plan is required.', 400);
  return {
    network: {
      id: requiredString(plan.networkPolicy, 'WFM_NETWORK_POLICY_REQUIRED', 'Network policy is required.'),
      version: requiredString(plan.networkPolicyVersion, 'WFM_NETWORK_POLICY_VERSION_REQUIRED', 'Network policy version is required.'),
      sha256: requiredDigest(plan.networkPolicySha256, 'WFM_NETWORK_POLICY_DIGEST_INVALID', 'Network policy SHA-256 is required.')
    },
    secrets: {
      id: requiredString(plan.secretsPolicy, 'WFM_SECRETS_POLICY_REQUIRED', 'Secrets policy is required.'),
      version: requiredString(plan.secretsPolicyVersion, 'WFM_SECRETS_POLICY_VERSION_REQUIRED', 'Secrets policy version is required.'),
      sha256: requiredDigest(plan.secretsPolicySha256, 'WFM_SECRETS_POLICY_DIGEST_INVALID', 'Secrets policy SHA-256 is required.')
    }
  };
}

function verifyProvisioningSecurityPolicy(plan, trustedProvisioningPolicies) {
  const subject = normalisePlanPolicySubject(plan);
  const trusted = normaliseTrustedPolicies(trustedProvisioningPolicies);
  if (stable(subject.network) !== stable(trusted.network)) {
    fail('WFM_NETWORK_POLICY_UNTRUSTED', 'Provisioning network policy is not the exact approved security baseline.', 403);
  }
  if (stable(subject.secrets) !== stable(trusted.secrets)) {
    fail('WFM_SECRETS_POLICY_UNTRUSTED', 'Provisioning secrets policy is not the exact approved security baseline.', 403);
  }
  return Object.freeze({
    ok: true,
    subject: clone(subject),
    policyDigest: sha256(subject),
    networkPolicySha256: subject.network.sha256,
    secretsPolicySha256: subject.secrets.sha256
  });
}

function defaultLaunchFactory() {
  return require('./provisioning-build-approval-attestation.cjs').createBuildAttestedLaunchIntent;
}

function defaultOutboxFactory() {
  return require('./provisioning-build-approval-attestation.cjs').createBuildAttestedProvisioningOutbox;
}

function createSecurityPolicyAttestedLaunchIntent(input, options = {}) {
  const verified = verifyProvisioningSecurityPolicy(input && input.plan, options.trustedProvisioningPolicies);
  const launchFactory = options.baseLaunchFactory || defaultLaunchFactory();
  if (typeof launchFactory !== 'function') throw new Error('Security-policy-attested provisioning requires a base launch factory.');
  const { baseLaunchFactory, baseOutboxFactory, trustedProvisioningPolicies, ...baseOptions } = options;
  const base = launchFactory(input, baseOptions);
  if (!base || typeof base !== 'object' || !base.buildAttestedIntentDigest) {
    fail('WFM_BUILD_ATTESTED_INTENT_REQUIRED', 'Security policy attestation requires a build-attested launch intent.', 500);
  }
  if (!base.plan || base.plan.networkPolicy !== verified.subject.network.id || base.plan.secretsPolicy !== verified.subject.secrets.id) {
    fail('WFM_SECURITY_POLICY_BASE_PLAN_MISMATCH', 'Base launch intent changed the approved provisioning security policy identity.', 409);
  }
  const securityPolicyAttestedIntentDigest = sha256({
    buildAttestedIntentDigest: base.buildAttestedIntentDigest,
    provisioningSecurityPolicyDigest: verified.policyDigest
  });
  return {
    ...base,
    provisioningSecurityPolicyEvidence: {
      subject: clone(verified.subject),
      policyDigest: verified.policyDigest
    },
    securityPolicyAttestedIntentDigest
  };
}

function createSecurityPolicyAttestedProvisioningOutbox(store, options = {}) {
  const trustedProvisioningPolicies = normaliseTrustedPolicies(options.trustedProvisioningPolicies);
  const outboxFactory = options.baseOutboxFactory || defaultOutboxFactory();
  if (typeof outboxFactory !== 'function') throw new Error('Security-policy-attested provisioning requires a base outbox factory.');
  const { baseLaunchFactory, baseOutboxFactory, trustedProvisioningPolicies: _trusted, ...baseOptions } = options;
  const base = outboxFactory(store, baseOptions);
  const requiredMethods = ['enqueue', 'get', 'claim', 'beginMutation', 'recordProviderOutcome', 'recordReconciliation', 'recordIndependentVerification'];
  for (const method of requiredMethods) {
    if (!base || typeof base[method] !== 'function') throw new Error('Security-policy-attested provisioning requires the standard build-attested outbox interface.');
  }

  function verifyIntent(intent) {
    if (!intent || typeof intent !== 'object') fail('WFM_LAUNCH_INTENT_REQUIRED', 'Provisioning launch intent is required.', 400);
    if (!intent.provisioningSecurityPolicyEvidence || !intent.provisioningSecurityPolicyEvidence.subject) {
      fail('WFM_SECURITY_POLICY_EVIDENCE_REQUIRED', 'Stored launch intent is missing provisioning security policy evidence.', 403);
    }
    const verified = verifyProvisioningSecurityPolicy({
      networkPolicy: intent.provisioningSecurityPolicyEvidence.subject.network && intent.provisioningSecurityPolicyEvidence.subject.network.id,
      networkPolicyVersion: intent.provisioningSecurityPolicyEvidence.subject.network && intent.provisioningSecurityPolicyEvidence.subject.network.version,
      networkPolicySha256: intent.provisioningSecurityPolicyEvidence.subject.network && intent.provisioningSecurityPolicyEvidence.subject.network.sha256,
      secretsPolicy: intent.provisioningSecurityPolicyEvidence.subject.secrets && intent.provisioningSecurityPolicyEvidence.subject.secrets.id,
      secretsPolicyVersion: intent.provisioningSecurityPolicyEvidence.subject.secrets && intent.provisioningSecurityPolicyEvidence.subject.secrets.version,
      secretsPolicySha256: intent.provisioningSecurityPolicyEvidence.subject.secrets && intent.provisioningSecurityPolicyEvidence.subject.secrets.sha256
    }, trustedProvisioningPolicies);
    if (!intent.plan || intent.plan.networkPolicy !== verified.subject.network.id || intent.plan.secretsPolicy !== verified.subject.secrets.id) {
      fail('WFM_SECURITY_POLICY_BASE_PLAN_MISMATCH', 'Stored launch plan no longer matches the approved security policy identity.', 409);
    }
    if (String(intent.provisioningSecurityPolicyEvidence.policyDigest || '').toLowerCase() !== verified.policyDigest) {
      fail('WFM_SECURITY_POLICY_DIGEST_MISMATCH', 'Stored provisioning security policy evidence changed after launch was sealed.', 409);
    }
    const expected = sha256({
      buildAttestedIntentDigest: requiredDigest(
        intent.buildAttestedIntentDigest,
        'WFM_BUILD_ATTESTED_INTENT_REQUIRED',
        'Build-attested launch digest is required.'
      ),
      provisioningSecurityPolicyDigest: verified.policyDigest
    });
    if (String(intent.securityPolicyAttestedIntentDigest || '').toLowerCase() !== expected) {
      fail('WFM_SECURITY_POLICY_INTENT_MISMATCH', 'Security-policy-attested launch identity changed after sealing.', 409);
    }
    return { ...verified, securityPolicyAttestedIntentDigest: expected };
  }

  function verifyStored(queueKey) {
    const record = base.get(queueKey);
    if (!record || !record.payload) fail('WFM_SECURITY_POLICY_QUEUE_RECORD_REQUIRED', 'Provisioning queue record or sealed payload is missing.', 409);
    return { record, verified: verifyIntent(record.payload) };
  }

  function withPolicyProof(result, verified) {
    return {
      ...result,
      provisioningSecurityPolicyDigest: verified.policyDigest,
      networkPolicySha256: verified.networkPolicySha256,
      secretsPolicySha256: verified.secretsPolicySha256,
      securityPolicyAttestedIntentDigest: verified.securityPolicyAttestedIntentDigest
    };
  }

  function enqueue(intent) {
    const verified = verifyIntent(intent);
    const existing = intent && intent.queueKey ? base.get(intent.queueKey) : null;
    if (existing && existing.payload) {
      const stored = verifyIntent(existing.payload);
      if (stored.policyDigest !== verified.policyDigest) {
        fail('WFM_SECURITY_POLICY_DRIFT', 'This provisioning identity is already bound to a different security policy baseline.', 409);
      }
    }
    return withPolicyProof(base.enqueue(intent), verified);
  }

  function claim(queueKey, workerId) {
    verifyStored(queueKey);
    return base.claim(queueKey, workerId);
  }

  function beginMutation(token) {
    if (!token || typeof token !== 'object' || !token.queueKey) fail('WFM_SECURITY_POLICY_TOKEN_REQUIRED', 'Provisioning mutation requires a queue token.', 400);
    verifyStored(token.queueKey);
    return base.beginMutation(token);
  }

  function recordProviderOutcome(token, outcome = {}) {
    if (!token || typeof token !== 'object' || !token.queueKey) fail('WFM_SECURITY_POLICY_TOKEN_REQUIRED', 'Provisioning outcome requires a queue token.', 400);
    const { verified } = verifyStored(token.queueKey);
    return withPolicyProof(base.recordProviderOutcome(token, outcome), verified);
  }

  function recordReconciliation(queueKey, result = {}) {
    const { verified } = verifyStored(queueKey);
    return withPolicyProof(base.recordReconciliation(queueKey, result), verified);
  }

  function recordIndependentVerification(queueKey, verification = {}) {
    const { verified } = verifyStored(queueKey);
    const observedNetwork = requiredDigest(
      verification.observedNetworkPolicySha256,
      'WFM_NETWORK_POLICY_VERIFICATION_REQUIRED',
      'Independent readiness verification must report the effective network policy SHA-256.'
    );
    const observedSecrets = requiredDigest(
      verification.observedSecretsPolicySha256,
      'WFM_SECRETS_POLICY_VERIFICATION_REQUIRED',
      'Independent readiness verification must report the effective secrets policy SHA-256.'
    );
    if (observedNetwork !== verified.networkPolicySha256) {
      fail('WFM_NETWORK_POLICY_VERIFICATION_MISMATCH', 'Independent verification observed a different network policy from the approved baseline.', 409);
    }
    if (observedSecrets !== verified.secretsPolicySha256) {
      fail('WFM_SECRETS_POLICY_VERIFICATION_MISMATCH', 'Independent verification observed a different secrets policy from the approved baseline.', 409);
    }
    const checks = {
      ...(verification.checks || {}),
      provisioningSecurityPolicyVerified: true,
      provisioningSecurityPolicyDigest: verified.policyDigest,
      observedNetworkPolicySha256: observedNetwork,
      observedSecretsPolicySha256: observedSecrets,
      securityPolicyAttestedIntentDigest: verified.securityPolicyAttestedIntentDigest
    };
    return withPolicyProof(base.recordIndependentVerification(queueKey, { ...verification, checks }), verified);
  }

  return {
    ...base,
    enqueue,
    claim,
    beginMutation,
    recordProviderOutcome,
    recordReconciliation,
    recordIndependentVerification
  };
}

module.exports = {
  createSecurityPolicyAttestedLaunchIntent,
  createSecurityPolicyAttestedProvisioningOutbox,
  normalisePlanPolicySubject,
  verifyProvisioningSecurityPolicy,
  sha256,
  stable
};
