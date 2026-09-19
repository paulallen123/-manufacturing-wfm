'use strict';

const { createHash } = require('node:crypto');
const { verifyContractCompletionReceipt } = require('./contract-completion-ingress.cjs');

const OUTBOX_STATES = Object.freeze({
  PENDING: 'PENDING',
  CLAIMED: 'CLAIMED',
  MUTATION_STARTED: 'MUTATION_STARTED',
  RECONCILE_REQUIRED: 'RECONCILE_REQUIRED',
  VERIFY_REQUIRED: 'VERIFY_REQUIRED',
  COMPLETED: 'COMPLETED',
  QUARANTINED: 'QUARANTINED'
});

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function fail(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function requireString(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') fail(code, message, 400);
  return value.trim();
}

function validateIntent(intent, contractReceiptKey) {
  if (!intent || typeof intent !== 'object') fail('WFM_OUTBOX_INTENT_REQUIRED', 'A sealed provisioning intent is required.', 400);
  const queueKey = requireString(intent.queueKey, 'WFM_OUTBOX_QUEUE_KEY_REQUIRED', 'Provisioning queue identity is required.');
  const intentDigest = requireString(intent.intentDigest, 'WFM_OUTBOX_DIGEST_REQUIRED', 'Provisioning intent digest is required.').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(intentDigest)) fail('WFM_OUTBOX_DIGEST_INVALID', 'Provisioning intent digest must be SHA-256.', 400);
  if (!intent.completionEvidence || intent.completionEvidence.authenticated !== true) {
    fail('WFM_OUTBOX_UNAUTHENTICATED_CONTRACT', 'Only an authenticated completed-contract intent can enter provisioning.', 403);
  }
  if (!intent.scope || !intent.build || !intent.plan || intent.plan.creationMode !== 'fresh-provider-create' || intent.plan.isolated !== true) {
    fail('WFM_OUTBOX_UNSAFE_INTENT', 'Provisioning intent is missing sealed scope/build/fresh-isolated plan evidence.', 400);
  }

  const evidence = intent.completionEvidence;
  const eventId = requireString(evidence.eventId, 'WFM_OUTBOX_CONTRACT_EVENT_ID_REQUIRED', 'Authenticated contract event id is required.');
  const receiptSha256 = requireString(evidence.receiptSha256, 'WFM_OUTBOX_CONTRACT_RECEIPT_DIGEST_REQUIRED', 'Contract completion receipt digest is required.').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(receiptSha256)) fail('WFM_OUTBOX_CONTRACT_RECEIPT_DIGEST_INVALID', 'Contract completion receipt digest must be SHA-256.', 400);
  if (!evidence.verificationReceipt || typeof evidence.verificationReceipt !== 'object') {
    fail('WFM_OUTBOX_CONTRACT_RECEIPT_REQUIRED', 'Durable queue admission requires the verified contract-completion receipt.', 403);
  }

  const verified = verifyContractCompletionReceipt({
    authenticated: true,
    provider: intent.contract && intent.contract.provider,
    eventId,
    contractId: intent.contract && intent.contract.contractId,
    contractVersion: intent.contract && intent.contract.contractVersion,
    tenantId: intent.contract && intent.contract.tenantId,
    completedAt: intent.contract && intent.contract.completedAt,
    verificationReceipt: evidence.verificationReceipt
  }, contractReceiptKey);
  if (verified.receiptSha256 !== receiptSha256) {
    fail('WFM_OUTBOX_CONTRACT_RECEIPT_DIGEST_MISMATCH', 'Contract completion receipt digest changed before durable queue admission.', 409);
  }

  return { queueKey, intentDigest, receiptSha256 };
}

function verificationSubject(record, providerResourceId = record.providerResourceId) {
  const resourceId = requireString(providerResourceId, 'WFM_OUTBOX_PROVIDER_RESOURCE_REQUIRED', 'Verification requires the exact provider resource identity.');
  const artifactSha256 = requireString(record.payload && record.payload.build && record.payload.build.artifactSha256, 'WFM_OUTBOX_BUILD_DIGEST_REQUIRED', 'Verification requires the approved build digest.').toLowerCase();
  const graphFingerprint = requireString(record.payload && record.payload.scope && record.payload.scope.graphFingerprint, 'WFM_OUTBOX_SCOPE_FINGERPRINT_REQUIRED', 'Verification requires the exact scoping graph fingerprint.').toLowerCase();
  return {
    queueKey: record.queueKey,
    intentDigest: record.intentDigest,
    providerResourceId: resourceId,
    artifactSha256,
    graphFingerprint
  };
}

function withVerificationSubject(record, providerResourceId) {
  const subject = verificationSubject(record, providerResourceId);
  return {
    ...record,
    providerResourceId: subject.providerResourceId,
    verificationSubject: subject,
    verificationSubjectDigest: sha256(subject)
  };
}

function assertVerificationSubject(record, supplied) {
  if (!supplied || typeof supplied !== 'object') {
    fail('WFM_OUTBOX_VERIFICATION_SUBJECT_REQUIRED', 'Independent verification must identify the exact environment, approved build and scoping definition.', 400);
  }
  const expected = record.verificationSubject || verificationSubject(record);
  const actual = {
    queueKey: String(supplied.queueKey || ''),
    intentDigest: String(supplied.intentDigest || '').toLowerCase(),
    providerResourceId: String(supplied.providerResourceId || ''),
    artifactSha256: String(supplied.artifactSha256 || '').toLowerCase(),
    graphFingerprint: String(supplied.graphFingerprint || '').toLowerCase()
  };
  if (canonical(actual) !== canonical(expected) || sha256(actual) !== record.verificationSubjectDigest) {
    fail('WFM_OUTBOX_VERIFICATION_SUBJECT_MISMATCH', 'Independent verification does not match the exact provisioned environment, sealed scope and approved build.', 409);
  }
  return expected;
}

function createProvisioningOutbox(store, { now = Date.now, leaseMs = 30000, contractReceiptKey } = {}) {
  if (!store || store.durability !== 'DURABLE_TRANSACTIONAL' || typeof store.transaction !== 'function') {
    throw new Error('Provisioning outbox requires a durable transactional store.');
  }
  if (!contractReceiptKey) throw new Error('Provisioning outbox requires a trusted contract receipt verification key.');
  const leaseDuration = Math.max(1000, Number(leaseMs) || 30000);
  const stamp = () => Number(now());

  function transact(work) {
    return store.transaction(tx => {
      if (!tx || typeof tx.get !== 'function' || typeof tx.insert !== 'function' || typeof tx.replace !== 'function') {
        throw new Error('Provisioning outbox transaction must support get/insert/replace.');
      }
      return work(tx);
    });
  }

  function enqueue(intent) {
    const { queueKey, intentDigest } = validateIntent(intent, contractReceiptKey);
    return transact(tx => {
      const existing = tx.get(queueKey);
      if (existing) {
        if (existing.intentDigest !== intentDigest) {
          fail('WFM_OUTBOX_IDENTITY_DRIFT', 'The same provisioning queue identity was reused for a different sealed intent.');
        }
        return { duplicate: true, record: clone(existing) };
      }

      const createdAt = stamp();
      const record = {
        schemaVersion: 1,
        queueKey,
        intentDigest,
        payloadDigest: sha256(intent),
        payload: clone(intent),
        state: OUTBOX_STATES.PENDING,
        version: 1,
        generation: 0,
        createdAt,
        updatedAt: createdAt,
        leaseOwner: null,
        leaseUntil: null,
        mutationWorkerId: null,
        providerRequestId: null,
        providerResourceId: null,
        verificationSubject: null,
        verificationSubjectDigest: null,
        lastDecision: 'ENQUEUED'
      };
      tx.insert(queueKey, clone(record));
      return { duplicate: false, record: clone(record) };
    });
  }

  function claim(queueKey, workerId) {
    const key = requireString(queueKey, 'WFM_OUTBOX_QUEUE_KEY_REQUIRED', 'Provisioning queue identity is required.');
    const worker = requireString(workerId, 'WFM_OUTBOX_WORKER_REQUIRED', 'Provisioning worker identity is required.');
    return transact(tx => {
      const record = tx.get(key);
      if (!record) fail('WFM_OUTBOX_NOT_FOUND', 'Provisioning queue item was not found.', 404);
      const nowMs = stamp();

      if (record.state === OUTBOX_STATES.MUTATION_STARTED || record.state === OUTBOX_STATES.RECONCILE_REQUIRED) {
        return { action: 'RECONCILE_ONLY', record: clone(record) };
      }
      if (record.state === OUTBOX_STATES.VERIFY_REQUIRED) return { action: 'VERIFY_ONLY', record: clone(record) };
      if (record.state === OUTBOX_STATES.COMPLETED) return { action: 'COMPLETE', record: clone(record) };
      if (record.state === OUTBOX_STATES.QUARANTINED) return { action: 'QUARANTINED', record: clone(record) };
      if (record.state === OUTBOX_STATES.CLAIMED && Number(record.leaseUntil) > nowMs) {
        fail('WFM_OUTBOX_LEASE_ACTIVE', 'Provisioning queue item is already leased to another worker.');
      }
      if (![OUTBOX_STATES.PENDING, OUTBOX_STATES.CLAIMED].includes(record.state)) {
        fail('WFM_OUTBOX_STATE_INVALID', 'Provisioning queue item is not claimable.');
      }

      const next = {
        ...record,
        state: OUTBOX_STATES.CLAIMED,
        version: Number(record.version || 0) + 1,
        generation: Number(record.generation || 0) + 1,
        updatedAt: nowMs,
        leaseOwner: worker,
        leaseUntil: nowMs + leaseDuration,
        lastDecision: record.state === OUTBOX_STATES.CLAIMED ? 'LEASE_RECOVERED' : 'CLAIMED'
      };
      tx.replace(key, clone(next));
      return {
        action: 'DISPATCH_ALLOWED',
        token: {
          queueKey: key,
          intentDigest: next.intentDigest,
          workerId: worker,
          generation: next.generation
        },
        record: clone(next)
      };
    });
  }

  function assertLiveToken(record, token, nowMs) {
    if (!token || typeof token !== 'object') fail('WFM_OUTBOX_TOKEN_REQUIRED', 'Provisioning lease token is required.', 400);
    if (record.queueKey !== token.queueKey || record.intentDigest !== token.intentDigest || record.leaseOwner !== token.workerId || Number(record.generation) !== Number(token.generation)) {
      fail('WFM_OUTBOX_STALE_WORKER', 'Provisioning worker no longer owns this queue item.');
    }
    if (record.state !== OUTBOX_STATES.CLAIMED) fail('WFM_OUTBOX_NOT_CLAIMED', 'Provider mutation cannot start from the current queue state.');
    if (Number(record.leaseUntil) <= nowMs) fail('WFM_OUTBOX_LEASE_EXPIRED', 'Provisioning worker lease expired before provider mutation started.');
  }

  function beginMutation(token) {
    return transact(tx => {
      const record = tx.get(token && token.queueKey);
      if (!record) fail('WFM_OUTBOX_NOT_FOUND', 'Provisioning queue item was not found.', 404);
      const nowMs = stamp();
      assertLiveToken(record, token, nowMs);
      const providerRequestId = 'wfm-create-' + sha256({ queueKey: record.queueKey, intentDigest: record.intentDigest }).slice(0, 40);
      const next = {
        ...record,
        state: OUTBOX_STATES.MUTATION_STARTED,
        version: Number(record.version || 0) + 1,
        updatedAt: nowMs,
        mutationWorkerId: token.workerId,
        providerRequestId,
        lastDecision: 'PROVIDER_MUTATION_INTENT_COMMITTED'
      };
      tx.replace(record.queueKey, clone(next));
      return { providerRequestId, record: clone(next) };
    });
  }

  function recordProviderOutcome(token, outcome = {}) {
    return transact(tx => {
      const record = tx.get(token && token.queueKey);
      if (!record) fail('WFM_OUTBOX_NOT_FOUND', 'Provisioning queue item was not found.', 404);
      if (!token || record.queueKey !== token.queueKey || record.intentDigest !== token.intentDigest || Number(record.generation) !== Number(token.generation) || record.leaseOwner !== token.workerId) {
        fail('WFM_OUTBOX_STALE_WORKER', 'Provisioning worker no longer owns this provider mutation.');
      }
      if (record.state !== OUTBOX_STATES.MUTATION_STARTED) fail('WFM_OUTBOX_MUTATION_NOT_STARTED', 'Provider mutation outcome cannot be recorded from the current state.');

      const result = String(outcome.result || '').toUpperCase();
      let state;
      let lastDecision;
      if (result === 'CONFIRMED_CREATED') {
        if (!outcome.providerResourceId) fail('WFM_OUTBOX_PROVIDER_RESOURCE_REQUIRED', 'Confirmed provider creation requires a resource identity.', 400);
        state = OUTBOX_STATES.VERIFY_REQUIRED;
        lastDecision = 'INDEPENDENT_VERIFICATION_REQUIRED';
      } else if (result === 'AMBIGUOUS') {
        state = OUTBOX_STATES.RECONCILE_REQUIRED;
        lastDecision = 'READ_ONLY_RECONCILIATION_REQUIRED';
      } else if (result === 'REJECTED') {
        state = OUTBOX_STATES.QUARANTINED;
        lastDecision = 'PROVIDER_REJECTED';
      } else {
        fail('WFM_OUTBOX_PROVIDER_OUTCOME_INVALID', 'Provider outcome must be confirmed-created, ambiguous or rejected.', 400);
      }

      const nowMs = stamp();
      let next = {
        ...record,
        state,
        version: Number(record.version || 0) + 1,
        updatedAt: nowMs,
        providerResourceId: outcome.providerResourceId || null,
        leaseUntil: null,
        lastDecision
      };
      if (state === OUTBOX_STATES.VERIFY_REQUIRED) next = withVerificationSubject(next, outcome.providerResourceId);
      tx.replace(record.queueKey, clone(next));
      return clone(next);
    });
  }

  function recordReconciliation(queueKey, result = {}) {
    const key = requireString(queueKey, 'WFM_OUTBOX_QUEUE_KEY_REQUIRED', 'Provisioning queue identity is required.');
    return transact(tx => {
      const record = tx.get(key);
      if (!record) fail('WFM_OUTBOX_NOT_FOUND', 'Provisioning queue item was not found.', 404);
      if (![OUTBOX_STATES.MUTATION_STARTED, OUTBOX_STATES.RECONCILE_REQUIRED].includes(record.state)) {
        fail('WFM_OUTBOX_RECONCILIATION_NOT_REQUIRED', 'Read-only provider reconciliation is not required for this item.');
      }
      const status = String(result.status || '').toUpperCase();
      const nowMs = stamp();
      let next;
      if (status === 'FOUND') {
        if (!result.providerResourceId) fail('WFM_OUTBOX_PROVIDER_RESOURCE_REQUIRED', 'Reconciliation found an environment but no resource identity.', 400);
        next = withVerificationSubject({ ...record, state: OUTBOX_STATES.VERIFY_REQUIRED, lastDecision: 'RECONCILED_FOUND_VERIFY', version: record.version + 1, updatedAt: nowMs, leaseUntil: null }, result.providerResourceId);
      } else if (status === 'NOT_FOUND') {
        // Safe default: absence does not authorize another create. Provider-specific retry authority is required.
        next = { ...record, state: OUTBOX_STATES.QUARANTINED, lastDecision: 'RECONCILED_NOT_FOUND_NO_BLIND_RETRY', version: record.version + 1, updatedAt: nowMs, leaseUntil: null };
      } else {
        next = { ...record, state: OUTBOX_STATES.RECONCILE_REQUIRED, lastDecision: 'RECONCILIATION_STILL_AMBIGUOUS', version: record.version + 1, updatedAt: nowMs, leaseUntil: null };
      }
      tx.replace(key, clone(next));
      return clone(next);
    });
  }

  function recordIndependentVerification(queueKey, verification = {}) {
    const key = requireString(queueKey, 'WFM_OUTBOX_QUEUE_KEY_REQUIRED', 'Provisioning queue identity is required.');
    return transact(tx => {
      const record = tx.get(key);
      if (!record) fail('WFM_OUTBOX_NOT_FOUND', 'Provisioning queue item was not found.', 404);
      if (record.state !== OUTBOX_STATES.VERIFY_REQUIRED) fail('WFM_OUTBOX_VERIFY_NOT_REQUIRED', 'Independent readiness verification is not required for this item.');
      const verifierId = requireString(verification.verifierId, 'WFM_OUTBOX_VERIFIER_NOT_INDEPENDENT', 'An independent verifier identity is required.');
      if (verification.independent !== true || verifierId === record.mutationWorkerId) {
        fail('WFM_OUTBOX_VERIFIER_NOT_INDEPENDENT', 'Readiness verification must be performed by a different identity from the cloud mutation worker.', 403);
      }
      const subject = assertVerificationSubject(record, verification.subject);
      const checks = verification.checks || {};
      const required = ['health', 'security', 'isolation', 'approvedBuild', 'secrets', 'network', 'readiness'];
      const passed = required.every(name => checks[name] === true);
      const nowMs = stamp();
      const next = {
        ...record,
        state: passed ? OUTBOX_STATES.COMPLETED : OUTBOX_STATES.QUARANTINED,
        version: Number(record.version || 0) + 1,
        updatedAt: nowMs,
        leaseOwner: null,
        leaseUntil: null,
        lastDecision: passed ? 'INDEPENDENTLY_VERIFIED_READY' : 'READINESS_CHECK_FAILED',
        verificationDigest: sha256({ subject, verifierId, checks })
      };
      tx.replace(key, clone(next));
      return clone(next);
    });
  }

  function get(queueKey) {
    const key = requireString(queueKey, 'WFM_OUTBOX_QUEUE_KEY_REQUIRED', 'Provisioning queue identity is required.');
    return transact(tx => clone(tx.get(key)));
  }

  return { enqueue, claim, beginMutation, recordProviderOutcome, recordReconciliation, recordIndependentVerification, get };
}

module.exports = {
  OUTBOX_STATES,
  createProvisioningOutbox,
  sha256,
  canonical
};
