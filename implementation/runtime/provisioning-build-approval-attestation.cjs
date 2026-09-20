'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { createContractScopeBoundLaunchIntent, createContractScopeBoundProvisioningOutbox } = require('./provisioning-contract-scope-binding.cjs');

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

function requiredTime(value, code, message) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) fail(code, message, 400);
  return Math.trunc(ms);
}

function keyBuffer(value) {
  if (Buffer.isBuffer(value) && value.length >= 32) return Buffer.from(value);
  if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 32) return Buffer.from(value, 'utf8');
  fail('WFM_BUILD_APPROVAL_KEY_REQUIRED', 'Trusted build-approval key of at least 32 bytes is required.', 500);
}

function mac(core, key) {
  return createHmac('sha256', keyBuffer(key)).update(stable(core)).digest('hex');
}

function safeEqualHex(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(String(actual || '')) || !/^[a-f0-9]{64}$/i.test(String(expected || ''))) return false;
  return timingSafeEqual(Buffer.from(String(actual).toLowerCase(), 'hex'), Buffer.from(String(expected).toLowerCase(), 'hex'));
}

function normaliseBuildSubject(build) {
  if (!build || typeof build !== 'object') fail('WFM_BUILD_REQUIRED', 'Approved build is required.', 400);
  return {
    approvalId: requiredString(build.approvalId, 'WFM_BUILD_APPROVAL_REQUIRED', 'Build approval id is required.'),
    sourceRevision: requiredString(build.sourceRevision, 'WFM_BUILD_SOURCE_REQUIRED', 'Approved source revision is required.'),
    artifactSha256: requiredDigest(build.artifactSha256, 'WFM_BUILD_DIGEST_INVALID', 'Approved artifact SHA-256 is required.')
  };
}

function createBuildApprovalReceipt(build, {
  approvalKey,
  issuerKeyId,
  policyId = 'wfm-release-policy-v1',
  approvedAt,
  expiresAt
} = {}) {
  const subject = normaliseBuildSubject(build);
  const approvedAtMs = requiredTime(approvedAt, 'WFM_BUILD_APPROVED_AT_REQUIRED', 'Build approval time is required.');
  const expiresAtMs = requiredTime(expiresAt, 'WFM_BUILD_APPROVAL_EXPIRY_REQUIRED', 'Build approval expiry is required.');
  if (expiresAtMs <= approvedAtMs) fail('WFM_BUILD_APPROVAL_EXPIRY_INVALID', 'Build approval expiry must be after approval time.', 400);

  const core = {
    schemaVersion: 1,
    verifier: 'wfm-build-approval-v1',
    approvalId: subject.approvalId,
    sourceRevision: subject.sourceRevision,
    artifactSha256: subject.artifactSha256,
    policyId: requiredString(policyId, 'WFM_BUILD_POLICY_REQUIRED', 'Build approval policy is required.'),
    issuerKeyId: requiredString(issuerKeyId, 'WFM_BUILD_APPROVAL_ISSUER_REQUIRED', 'Build approval issuer identity is required.'),
    approvedAt: approvedAtMs,
    expiresAt: expiresAtMs
  };
  return Object.freeze({ ...core, mac: mac(core, approvalKey) });
}

function verifyBuildApprovalReceipt(receipt, build, approvalKey, {
  now = Date.now,
  trustedPolicyId = 'wfm-release-policy-v1',
  maxFutureSkewMs = 60 * 1000
} = {}) {
  if (!receipt || typeof receipt !== 'object') {
    fail('WFM_BUILD_APPROVAL_RECEIPT_REQUIRED', 'Provisioning requires a trusted build-approval receipt.', 403);
  }
  const subject = normaliseBuildSubject(build);
  const core = {
    schemaVersion: receipt.schemaVersion,
    verifier: receipt.verifier,
    approvalId: requiredString(receipt.approvalId, 'WFM_BUILD_APPROVAL_REQUIRED', 'Build approval receipt id is required.'),
    sourceRevision: requiredString(receipt.sourceRevision, 'WFM_BUILD_SOURCE_REQUIRED', 'Build approval source revision is required.'),
    artifactSha256: requiredDigest(receipt.artifactSha256, 'WFM_BUILD_DIGEST_INVALID', 'Build approval artifact SHA-256 is required.'),
    policyId: requiredString(receipt.policyId, 'WFM_BUILD_POLICY_REQUIRED', 'Build approval policy is required.'),
    issuerKeyId: requiredString(receipt.issuerKeyId, 'WFM_BUILD_APPROVAL_ISSUER_REQUIRED', 'Build approval issuer identity is required.'),
    approvedAt: requiredTime(receipt.approvedAt, 'WFM_BUILD_APPROVED_AT_REQUIRED', 'Build approval time is required.'),
    expiresAt: requiredTime(receipt.expiresAt, 'WFM_BUILD_APPROVAL_EXPIRY_REQUIRED', 'Build approval expiry is required.')
  };
  if (core.schemaVersion !== 1 || core.verifier !== 'wfm-build-approval-v1') {
    fail('WFM_BUILD_APPROVAL_SCHEMA_INVALID', 'Build approval schema or verifier is not trusted.', 403);
  }
  if (core.policyId !== trustedPolicyId) {
    fail('WFM_BUILD_APPROVAL_POLICY_UNTRUSTED', 'Build approval was issued under an untrusted release policy.', 403);
  }
  const nowMs = Number(now());
  if (!Number.isFinite(nowMs)) fail('WFM_BUILD_APPROVAL_CLOCK_INVALID', 'Build approval verifier clock is invalid.', 500);
  if (core.approvedAt > nowMs + maxFutureSkewMs) {
    fail('WFM_BUILD_APPROVAL_FROM_FUTURE', 'Build approval time is too far in the future.', 403);
  }
  if (core.expiresAt <= nowMs) {
    fail('WFM_BUILD_APPROVAL_EXPIRED', 'Build approval expired before provisioning.', 403);
  }
  if (
    core.approvalId !== subject.approvalId ||
    core.sourceRevision !== subject.sourceRevision ||
    core.artifactSha256 !== subject.artifactSha256
  ) {
    fail('WFM_BUILD_APPROVAL_SUBJECT_MISMATCH', 'Build approval does not match the exact source revision and artifact being provisioned.', 409);
  }
  const expectedMac = mac(core, approvalKey);
  if (!safeEqualHex(receipt.mac, expectedMac)) {
    fail('WFM_BUILD_APPROVAL_INVALID', 'Build approval receipt failed integrity verification.', 403);
  }
  const receiptSha256 = sha256(receipt);
  return Object.freeze({
    ok: true,
    receiptSha256,
    subjectDigest: sha256(subject),
    approvalId: subject.approvalId,
    sourceRevision: subject.sourceRevision,
    artifactSha256: subject.artifactSha256,
    policyId: core.policyId,
    issuerKeyId: core.issuerKeyId,
    approvedAt: core.approvedAt,
    expiresAt: core.expiresAt
  });
}

function createBuildAttestedLaunchIntent(input, options = {}) {
  if (!options.buildApprovalKey) fail('WFM_BUILD_APPROVAL_KEY_REQUIRED', 'Trusted build-approval verification key is required.', 500);
  if (!input || !input.buildApprovalEvidence || !input.buildApprovalEvidence.verificationReceipt) {
    fail('WFM_BUILD_APPROVAL_RECEIPT_REQUIRED', 'Build-attested launch requires trusted build-approval evidence.', 403);
  }
  const base = createContractScopeBoundLaunchIntent(input, options);
  const verified = verifyBuildApprovalReceipt(
    input.buildApprovalEvidence.verificationReceipt,
    base.build,
    options.buildApprovalKey,
    options.buildApprovalVerification
  );
  if (input.buildApprovalEvidence.receiptSha256 != null) {
    const declared = requiredDigest(
      input.buildApprovalEvidence.receiptSha256,
      'WFM_BUILD_APPROVAL_RECEIPT_DIGEST_INVALID',
      'Build approval receipt digest must be SHA-256.'
    );
    if (declared !== verified.receiptSha256) {
      fail('WFM_BUILD_APPROVAL_RECEIPT_DIGEST_MISMATCH', 'Build approval receipt changed before launch was sealed.', 409);
    }
  }
  const buildAttestedIntentDigest = sha256({
    contractBoundIntentDigest: base.contractBoundIntentDigest,
    buildApprovalReceiptSha256: verified.receiptSha256,
    buildApprovalSubjectDigest: verified.subjectDigest
  });
  return {
    ...base,
    buildApprovalEvidence: {
      receiptSha256: verified.receiptSha256,
      verificationReceipt: clone(input.buildApprovalEvidence.verificationReceipt)
    },
    buildApprovalSubjectDigest: verified.subjectDigest,
    buildAttestedIntentDigest
  };
}

function createBuildAttestedProvisioningOutbox(store, options = {}) {
  const {
    buildApprovalKey,
    buildApprovalVerification,
    baseOutboxFactory = createContractScopeBoundProvisioningOutbox,
    ...baseOptions
  } = options;
  keyBuffer(buildApprovalKey);
  if (typeof baseOutboxFactory !== 'function') throw new Error('Build-attested provisioning requires a base outbox factory.');
  const base = baseOutboxFactory(store, baseOptions);
  if (
    !base ||
    typeof base.enqueue !== 'function' ||
    typeof base.get !== 'function' ||
    typeof base.claim !== 'function' ||
    typeof base.beginMutation !== 'function' ||
    typeof base.recordProviderOutcome !== 'function' ||
    typeof base.recordReconciliation !== 'function' ||
    typeof base.recordIndependentVerification !== 'function'
  ) {
    throw new Error('Build-attested provisioning requires the standard contract-bound outbox interface.');
  }

  function verifyIntent(intent) {
    if (!intent || typeof intent !== 'object') fail('WFM_LAUNCH_INTENT_REQUIRED', 'Provisioning launch intent is required.', 400);
    const evidence = intent.buildApprovalEvidence;
    if (!evidence || !evidence.verificationReceipt) fail('WFM_BUILD_APPROVAL_RECEIPT_REQUIRED', 'Stored launch intent is missing build approval proof.', 403);
    const verified = verifyBuildApprovalReceipt(
      evidence.verificationReceipt,
      intent.build,
      buildApprovalKey,
      buildApprovalVerification
    );
    const declaredReceipt = requiredDigest(
      evidence.receiptSha256,
      'WFM_BUILD_APPROVAL_RECEIPT_DIGEST_INVALID',
      'Stored build approval receipt digest must be SHA-256.'
    );
    if (declaredReceipt !== verified.receiptSha256) {
      fail('WFM_BUILD_APPROVAL_RECEIPT_DIGEST_MISMATCH', 'Stored build approval receipt changed after launch was sealed.', 409);
    }
    if (String(intent.buildApprovalSubjectDigest || '').toLowerCase() !== verified.subjectDigest) {
      fail('WFM_BUILD_APPROVAL_SUBJECT_DIGEST_MISMATCH', 'Stored build approval subject changed after launch was sealed.', 409);
    }
    const expectedIntentDigest = sha256({
      contractBoundIntentDigest: requiredDigest(
        intent.contractBoundIntentDigest,
        'WFM_CONTRACT_SCOPE_BOUND_INTENT_REQUIRED',
        'Contract-bound launch digest is required.'
      ),
      buildApprovalReceiptSha256: verified.receiptSha256,
      buildApprovalSubjectDigest: verified.subjectDigest
    });
    if (String(intent.buildAttestedIntentDigest || '').toLowerCase() !== expectedIntentDigest) {
      fail('WFM_BUILD_ATTESTED_INTENT_MISMATCH', 'Build-attested launch identity changed after sealing.', 409);
    }
    return { ...verified, buildAttestedIntentDigest: expectedIntentDigest };
  }

  function verifyStored(queueKey) {
    const record = base.get(queueKey);
    if (!record || !record.payload) fail('WFM_BUILD_APPROVAL_QUEUE_RECORD_REQUIRED', 'Provisioning queue record or sealed payload is missing.', 409);
    return { record, verified: verifyIntent(record.payload) };
  }

  function withBuildProof(result, verified) {
    return {
      ...result,
      buildApprovalReceiptSha256: verified.receiptSha256,
      buildApprovalSubjectDigest: verified.subjectDigest,
      approvedArtifactSha256: verified.artifactSha256,
      buildAttestedIntentDigest: verified.buildAttestedIntentDigest
    };
  }

  function enqueue(intent) {
    const verified = verifyIntent(intent);
    const existing = intent && intent.queueKey ? base.get(intent.queueKey) : null;
    if (existing && existing.payload) {
      const stored = verifyIntent(existing.payload);
      if (stored.receiptSha256 !== verified.receiptSha256 || stored.subjectDigest !== verified.subjectDigest) {
        fail('WFM_BUILD_APPROVAL_DRIFT', 'This provisioning identity is already bound to a different approved build proof.', 409);
      }
    }
    return withBuildProof(base.enqueue(intent), verified);
  }

  function claim(queueKey, workerId) {
    verifyStored(queueKey);
    return base.claim(queueKey, workerId);
  }

  function beginMutation(token) {
    if (!token || typeof token !== 'object' || !token.queueKey) fail('WFM_BUILD_APPROVAL_TOKEN_REQUIRED', 'Provisioning mutation requires a queue token.', 400);
    verifyStored(token.queueKey);
    return base.beginMutation(token);
  }

  function recordProviderOutcome(token, outcome = {}) {
    if (!token || typeof token !== 'object' || !token.queueKey) fail('WFM_BUILD_APPROVAL_TOKEN_REQUIRED', 'Provisioning outcome requires a queue token.', 400);
    const { verified } = verifyStored(token.queueKey);
    return withBuildProof(base.recordProviderOutcome(token, outcome), verified);
  }

  function recordReconciliation(queueKey, result = {}) {
    const { verified } = verifyStored(queueKey);
    return withBuildProof(base.recordReconciliation(queueKey, result), verified);
  }

  function recordIndependentVerification(queueKey, verification = {}) {
    const { verified } = verifyStored(queueKey);
    const suppliedReceipt = requiredDigest(
      verification.buildApprovalReceiptSha256,
      'WFM_BUILD_APPROVAL_VERIFICATION_RECEIPT_REQUIRED',
      'Independent readiness verification must identify the exact build approval receipt.'
    );
    const observedArtifact = requiredDigest(
      verification.observedArtifactSha256,
      'WFM_BUILD_ARTIFACT_VERIFICATION_REQUIRED',
      'Independent readiness verification must report the deployed artifact SHA-256.'
    );
    if (suppliedReceipt !== verified.receiptSha256) {
      fail('WFM_BUILD_APPROVAL_VERIFICATION_MISMATCH', 'Independent readiness verification is detached from the approved build proof.', 409);
    }
    if (observedArtifact !== verified.artifactSha256) {
      fail('WFM_BUILD_ARTIFACT_MISMATCH', 'Independent readiness verification observed a different artifact from the approved build.', 409);
    }
    const checks = {
      ...(verification.checks || {}),
      buildApprovalVerified: true,
      buildApprovalReceiptSha256: verified.receiptSha256,
      approvedArtifactSha256: verified.artifactSha256,
      observedArtifactSha256: observedArtifact,
      buildAttestedIntentDigest: verified.buildAttestedIntentDigest
    };
    return withBuildProof(base.recordIndependentVerification(queueKey, { ...verification, checks }), verified);
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
  createBuildApprovalReceipt,
  verifyBuildApprovalReceipt,
  createBuildAttestedLaunchIntent,
  createBuildAttestedProvisioningOutbox,
  normaliseBuildSubject,
  sha256,
  stable
};
