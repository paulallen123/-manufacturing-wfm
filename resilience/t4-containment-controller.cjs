'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function clean(value, max = 160) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
}

function validDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? '').toLowerCase());
}

function forensicError(code, message) {
  return Object.assign(new Error(message), { code });
}

function assertSafeDirectory(directory, code) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw forensicError(code, 'Forensic storage path must be a real directory, not a symlink.');
  }
}

function createWriteOnceForensicStore({ rootDir, now = Date.now } = {}) {
  if (!rootDir) throw forensicError('WFM_T4_FORENSICS_ROOT', 'Write-once forensic storage requires an explicit root directory.');
  const root = path.resolve(String(rootDir));
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  assertSafeDirectory(root, 'WFM_T4_FORENSICS_ROOT');

  function locate(tenantDigest, storageKey) {
    if (!validDigest(tenantDigest) || !validDigest(storageKey)) {
      throw forensicError('WFM_T4_FORENSICS_KEY', 'Forensic tenant/storage keys must be SHA-256 digests.');
    }
    return path.join(root, tenantDigest, `${storageKey}.json`);
  }

  function verify(receipt = {}) {
    try {
      const file = locate(receipt.tenantDigest, receipt.storageKey);
      const tenantDir = path.dirname(file);
      assertSafeDirectory(root, 'WFM_T4_FORENSICS_ROOT');
      assertSafeDirectory(tenantDir, 'WFM_T4_FORENSICS_TENANT_DIR');
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return false;
      const raw = fs.readFileSync(file, 'utf8');
      if (digest(raw) !== receipt.forensicDigest) return false;
      const envelope = JSON.parse(raw);
      if (!envelope?.record || envelope.recordDigest !== digest(envelope.record)) return false;
      if (envelope.record.tenantDigest !== receipt.tenantDigest) return false;
      if (envelope.storageKey !== receipt.storageKey) return false;
      return true;
    } catch {
      return false;
    }
  }

  function preserve({ incidentId, tenant, scenarioId, evidenceDigest, eventHeadDigest }) {
    const safeIncidentId = clean(incidentId, 120);
    const safeTenant = clean(tenant, 100);
    const safeScenarioId = clean(scenarioId || 'unknown', 120);
    const safeEvidenceDigest = clean(evidenceDigest, 64).toLowerCase();
    const safeEventHeadDigest = clean(eventHeadDigest, 64).toLowerCase();
    if (!safeIncidentId || !safeTenant || !validDigest(safeEvidenceDigest) || !validDigest(safeEventHeadDigest)) {
      throw forensicError('WFM_T4_FORENSICS_INPUT', 'Forensic preservation requires incident, tenant and valid evidence/trace digests.');
    }

    const tenantDigest = digest(`tenant:${safeTenant}`);
    const storageKey = digest({
      incidentId: safeIncidentId,
      tenant: safeTenant,
      scenarioId: safeScenarioId,
      evidenceDigest: safeEvidenceDigest,
      eventHeadDigest: safeEventHeadDigest,
    });
    const tenantDir = path.join(root, tenantDigest);
    try {
      fs.mkdirSync(tenantDir, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    assertSafeDirectory(tenantDir, 'WFM_T4_FORENSICS_TENANT_DIR');

    const file = locate(tenantDigest, storageKey);
    const record = {
      schemaVersion: 1,
      incidentIdDigest: digest(`incident:${safeIncidentId}`),
      tenantDigest,
      scenarioId: safeScenarioId,
      evidenceDigest: safeEvidenceDigest,
      eventHeadDigest: safeEventHeadDigest,
      createdAt: Number(now()),
    };
    const envelope = { schemaVersion: 1, storageKey, record, recordDigest: digest(record) };
    const raw = canonical(envelope) + '\n';
    const expectedDigest = digest(raw);

    let existing = false;
    let fd = null;
    try {
      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
      fd = fs.openSync(file, flags, 0o400);
      fs.writeFileSync(fd, raw, { encoding: 'utf8' });
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.chmodSync(file, 0o400);
      const dirFd = fs.openSync(tenantDir, fs.constants.O_RDONLY);
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (error) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }
      if (error?.code !== 'EEXIST') throw error;
      existing = true;
    }

    let forensicDigest = expectedDigest;
    if (existing) {
      const existingRaw = fs.readFileSync(file, 'utf8');
      const existingEnvelope = JSON.parse(existingRaw);
      const sameCore = existingEnvelope?.storageKey === storageKey
        && existingEnvelope?.record?.incidentIdDigest === record.incidentIdDigest
        && existingEnvelope?.record?.tenantDigest === tenantDigest
        && existingEnvelope?.record?.scenarioId === safeScenarioId
        && existingEnvelope?.record?.evidenceDigest === safeEvidenceDigest
        && existingEnvelope?.record?.eventHeadDigest === safeEventHeadDigest
        && existingEnvelope?.recordDigest === digest(existingEnvelope.record);
      if (!sameCore) {
        throw forensicError('WFM_T4_FORENSICS_COLLISION', 'Existing forensic record does not match the idempotent preservation request.');
      }
      forensicDigest = digest(existingRaw);
    }

    const receipt = {
      verified: false,
      immutable: true,
      storageMode: 'write-once-exclusive',
      forensicDigest,
      tenantDigest,
      storageKey,
    };
    receipt.verified = verify(receipt);
    if (!receipt.verified) {
      throw forensicError('WFM_T4_FORENSICS_VERIFY', 'Write-once forensic evidence failed read-back verification.');
    }
    return receipt;
  }

  return { preserve, verify, rootDigest: digest(root) };
}

const ALLOWED_SCENARIOS = Object.freeze(new Set([
  'permission-or-identity-anomaly',
  'cross-tenant-access-attempt',
  'prompt-injection-or-untrusted-influence',
  'runaway-repair-loop',
  'external-advisory-poisoning',
  'known-exploited-vulnerability-match',
  'new-cve-component-match',
  'artifact-tampering-or-provenance-drift',
  'unsafe-production-mode-attempt',
  'data-integrity-mismatch',
  'audit-trail-degraded',
  'database-unavailable',
  'database-latency-spike',
  'support-system-failure',
  'bad-release',
  'unknown',
]));

const PROHIBITED_REQUEST_PREFIXES = Object.freeze([
  'payroll.release',
  'payroll.rule',
  'payroll.write',
  'identity.grant',
  'identity.disable',
  'security.policy',
  'security.secret',
  'tenant.boundary',
  'data.delete',
  'audit.delete',
  'backup.delete',
  'legal.override',
  'compliance.override',
  'production.force-promote',
]);

function createT4ContainmentController({ containmentExecutor, rollbackExecutor, forensicStore, now = Date.now, maxActions = 4 } = {}) {
  if (!Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > 12) {
    throw new Error('maxActions must be between 1 and 12.');
  }

  const forensicPreserve = typeof forensicStore?.preserve === 'function' ? forensicStore.preserve.bind(forensicStore) : null;
  const forensicVerify = typeof forensicStore?.verify === 'function' ? forensicStore.verify.bind(forensicStore) : null;

  async function handle(input = {}) {
    const incidentId = clean(input.incidentId, 120);
    const tenant = clean(input.tenant, 100);
    const targetTenant = clean(input.targetTenant || tenant, 100);
    const scenarioId = clean(input.scenarioId || 'unknown', 120);
    const evidenceDigest = clean(input.evidenceDigest, 64).toLowerCase();
    const requestedAction = clean(input.requestedAction, 180);

    if (!incidentId || !tenant || !validDigest(evidenceDigest)) {
      throw Object.assign(new Error('incidentId, tenant and SHA-256 evidence digest are required.'), { code: 'WFM_T4_INPUT' });
    }

    const startedAt = Number(now());
    const events = [];
    let previousDigest = digest({ incidentId, tenant, scenarioId, evidenceDigest, startedAt });
    let actionCount = 0;

    const record = (type, detail = {}) => {
      const event = { seq: events.length + 1, at: Number(now()), type, detail, previousDigest };
      event.eventDigest = digest(event);
      previousDigest = event.eventDigest;
      events.push(event);
    };

    const consume = (kind) => {
      actionCount += 1;
      record('action-budget-consumed', { kind, actionCount, maxActions });
      if (actionCount > maxActions) {
        throw Object.assign(new Error('T4 containment action budget exhausted.'), { code: 'WFM_T4_BUDGET' });
      }
    };

    const threat = input.threat && typeof input.threat === 'object' ? input.threat : {};
    const provenance = input.provenance && typeof input.provenance === 'object' ? input.provenance : {};
    const supportSystem = input.supportSystem && typeof input.supportSystem === 'object' ? input.supportSystem : {};
    const knownGood = input.knownGood && typeof input.knownGood === 'object' ? input.knownGood : {};

    const crossTenant = targetTenant !== tenant;
    const promptPoisoned = threat.promptInjection === true || threat.untrustedToolInstruction === true;
    const memoryPoisoned = threat.memoryPoisoning === true;
    const egressAttempt = threat.credentialExfiltrationAttempt === true || threat.unapprovedEgressAttempt === true;
    const credentialDisclosureConfirmed = threat.credentialDisclosureConfirmed === true && validDigest(threat.credentialReferenceDigest);
    const provenanceMismatch = validDigest(provenance.expectedArtifactDigest)
      && validDigest(provenance.observedArtifactDigest)
      && provenance.expectedArtifactDigest !== provenance.observedArtifactDigest;
    const signatureInvalid = provenance.signatureVerified === false;
    const supportUnavailable = supportSystem.available === false || supportSystem.contextIntegrity === false;
    const runawayRepair = scenarioId === 'runaway-repair-loop' || threat.repairBudgetExceeded === true;
    const prohibitedRequestedAction = PROHIBITED_REQUEST_PREFIXES.some((prefix) => requestedAction === prefix || requestedAction.startsWith(prefix + '.'));
    const scenarioKnown = ALLOWED_SCENARIOS.has(scenarioId);

    record('classified', {
      scenarioId,
      scenarioKnown,
      crossTenant,
      promptPoisoned,
      memoryPoisoned,
      egressAttempt,
      credentialDisclosureConfirmed,
      provenanceMismatch,
      signatureInvalid,
      supportUnavailable,
      runawayRepair,
      prohibitedRequestedAction,
    });

    const planned = new Set(['preserve-forensics']);
    planned.add('freeze-promotion');

    if (crossTenant) planned.add('deny-cross-tenant-action');
    if (promptPoisoned || memoryPoisoned || egressAttempt || prohibitedRequestedAction) {
      planned.add('deny-model-tool-authority');
      planned.add('quarantine-support-context');
    }
    if (credentialDisclosureConfirmed) planned.add('quarantine-confirmed-credential-reference');
    if (provenanceMismatch || signatureInvalid) planned.add('quarantine-candidate-artifact');
    if (runawayRepair) planned.add('halt-repair-mutations');
    if (supportUnavailable) planned.add('use-static-safe-runbook');
    if (!scenarioKnown) planned.add('unknown-fault-isolation');

    const plan = [...planned];
    record('containment-plan', { actions: plan });

    if (!forensicPreserve || !forensicVerify) {
      record('forensics-preservation-required', {
        preserveAvailable: Boolean(forensicPreserve),
        independentVerifierAvailable: Boolean(forensicVerify),
      });
      throw Object.assign(new Error('T4 cannot claim a safe terminal without independently verifiable forensic preservation.'), { code: 'WFM_T4_FORENSICS_UNAVAILABLE' });
    }

    consume('forensics.preserve');
    const preserved = await forensicPreserve({
      incidentId,
      tenant,
      scenarioId,
      evidenceDigest,
      eventHeadDigest: previousDigest,
    });
    if (preserved?.verified !== true
      || preserved?.immutable !== true
      || !validDigest(preserved?.forensicDigest)
      || !validDigest(preserved?.tenantDigest)
      || !validDigest(preserved?.storageKey)) {
      throw Object.assign(new Error('Forensic preservation must be independently verified, tenant-bound and write-once.'), { code: 'WFM_T4_FORENSICS_VERIFY' });
    }
    const forensicReceipt = {
      verified: true,
      forensicDigest: preserved.forensicDigest,
      tenantDigest: preserved.tenantDigest,
      immutable: true,
      storageMode: clean(preserved.storageMode || 'verified-write-once', 80),
      storageKey: preserved.storageKey,
      selectedStoreId: preserved.selectedStoreId ? clean(preserved.selectedStoreId, 80) : null,
      selectedStoreCapabilityDigest: validDigest(preserved.selectedStoreCapabilityDigest) ? preserved.selectedStoreCapabilityDigest : null,
      failoverUsed: preserved.failoverUsed === true,
      attemptCount: Number.isSafeInteger(preserved.attemptCount) && preserved.attemptCount >= 1 ? preserved.attemptCount : null,
      attemptDigest: validDigest(preserved.attemptDigest) ? preserved.attemptDigest : null,
      failoverContractDigest: validDigest(preserved.failoverContractDigest) ? preserved.failoverContractDigest : null,
      failoverDigest: validDigest(preserved.failoverDigest) ? preserved.failoverDigest : null,
      finalReadbackVerified: false,
      finalReadbackDigest: null,
    };
    record('forensics-preserved', {
      forensicDigest: forensicReceipt.forensicDigest,
      tenantDigest: forensicReceipt.tenantDigest,
      immutable: true,
      storageMode: forensicReceipt.storageMode,
      storageKey: forensicReceipt.storageKey,
      selectedStoreId: forensicReceipt.selectedStoreId,
      failoverContractDigest: forensicReceipt.failoverContractDigest,
    });

    let containmentReceipt = null;
    if (containmentExecutor?.execute) {
      consume('containment.execute');
      const containment = await containmentExecutor.execute({
        incidentId,
        tenant,
        scenarioId,
        evidenceDigest,
        actions: plan,
        credentialReferenceDigest: credentialDisclosureConfirmed ? threat.credentialReferenceDigest : null,
      });
      if (containment?.verified !== true || containment?.productionAuthorityGranted === true || containment?.crossTenantMutation === true) {
        throw Object.assign(new Error('T4 containment executor exceeded or failed its bounded authority.'), { code: 'WFM_T4_CONTAINMENT_VERIFY' });
      }
      containmentReceipt = {
        verified: true,
        containmentDigest: validDigest(containment.containmentDigest) ? containment.containmentDigest : digest(containment),
      };
      record('containment-verified', { containmentDigest: containmentReceipt.containmentDigest });
    } else {
      record('containment-executor-unavailable', { deterministicPlanRetained: true });
    }

    const rollbackEligible = input.rollbackRequested === true
      && knownGood.available === true
      && knownGood.schemaCompatible === true
      && knownGood.independentlyVerified === true
      && knownGood.signatureVerified === true
      && validDigest(knownGood.artifactDigest)
      && validDigest(knownGood.verificationDigest)
      && !crossTenant;

    let rollbackReceipt = null;
    let outcome = 'contained';
    if (rollbackEligible && rollbackExecutor?.rollback) {
      consume('known-good.rollback');
      const rollback = await rollbackExecutor.rollback({
        incidentId,
        tenant,
        scenarioId,
        evidenceDigest,
        knownGoodArtifactDigest: knownGood.artifactDigest,
        knownGoodVerificationDigest: knownGood.verificationDigest,
      });
      if (rollback?.verified !== true || rollback?.productionAuthorityGranted === true || rollback?.crossTenantMutation === true || !validDigest(rollback?.rollbackDigest)) {
        throw Object.assign(new Error('Known-good rollback was not independently verified and bounded.'), { code: 'WFM_T4_ROLLBACK_VERIFY' });
      }
      rollbackReceipt = { verified: true, rollbackDigest: rollback.rollbackDigest };
      outcome = 'rolled_back_to_known_good';
      record('known-good-rollback-verified', { rollbackDigest: rollback.rollbackDigest });
    } else if (input.rollbackRequested === true) {
      record('rollback-denied', {
        rollbackExecutorAvailable: Boolean(rollbackExecutor?.rollback),
        knownGoodAvailable: knownGood.available === true,
        schemaCompatible: knownGood.schemaCompatible === true,
        independentlyVerified: knownGood.independentlyVerified === true,
        signatureVerified: knownGood.signatureVerified === true,
        sameTenant: !crossTenant,
      });
    }

    const finalReadbackVerified = await forensicVerify(forensicReceipt);
    if (finalReadbackVerified !== true) {
      record('forensics-final-readback-failed', {
        storageKey: forensicReceipt.storageKey,
        selectedStoreId: forensicReceipt.selectedStoreId,
      });
      throw Object.assign(new Error('T4 cannot claim a safe terminal because final forensic read-back verification failed.'), { code: 'WFM_T4_FORENSICS_FINAL_VERIFY' });
    }
    forensicReceipt.finalReadbackVerified = true;
    forensicReceipt.finalReadbackDigest = digest({
      forensicDigest: forensicReceipt.forensicDigest,
      tenantDigest: forensicReceipt.tenantDigest,
      storageKey: forensicReceipt.storageKey,
      selectedStoreId: forensicReceipt.selectedStoreId,
      selectedStoreCapabilityDigest: forensicReceipt.selectedStoreCapabilityDigest,
      attemptDigest: forensicReceipt.attemptDigest,
      failoverContractDigest: forensicReceipt.failoverContractDigest,
      failoverDigest: forensicReceipt.failoverDigest,
    });
    record('forensics-final-readback-verified', {
      storageKey: forensicReceipt.storageKey,
      selectedStoreId: forensicReceipt.selectedStoreId,
      finalReadbackDigest: forensicReceipt.finalReadbackDigest,
    });

    const requiresSecurityAuthority = credentialDisclosureConfirmed && threat.revocationPreauthorised !== true;
    if (outcome === 'contained' && requiresSecurityAuthority) outcome = 'security_or_legal_authority_required';

    record('terminal', { outcome, actionCount });
    const endedAt = Number(now());
    const result = {
      schemaVersion: 2,
      incidentId,
      tenant,
      scenarioId,
      evidenceDigest,
      outcome,
      safeTerminal: true,
      actionCount,
      maxActions,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      crossTenantMutation: false,
      requestedActionExecuted: false,
      plannedContainmentActions: plan,
      credentialMaterialExposedToModel: false,
      forensicReceipt,
      containmentReceipt,
      rollbackReceipt,
      startedAt,
      endedAt,
      events,
      traceHeadDigest: previousDigest,
    };
    result.receiptDigest = digest(result);
    return result;
  }

  function verifyReceipt(receipt) {
    if (!receipt || !Array.isArray(receipt.events) || !validDigest(receipt.receiptDigest)) return false;
    if (receipt.safeTerminal === true) {
      const forensicReceipt = receipt.forensicReceipt;
      if (forensicReceipt?.verified !== true
        || forensicReceipt?.immutable !== true
        || forensicReceipt?.finalReadbackVerified !== true
        || !validDigest(forensicReceipt?.forensicDigest)
        || !validDigest(forensicReceipt?.tenantDigest)
        || !validDigest(forensicReceipt?.storageKey)
        || !validDigest(forensicReceipt?.finalReadbackDigest)) return false;
      const expectedReadbackDigest = digest({
        forensicDigest: forensicReceipt.forensicDigest,
        tenantDigest: forensicReceipt.tenantDigest,
        storageKey: forensicReceipt.storageKey,
        selectedStoreId: forensicReceipt.selectedStoreId || null,
        selectedStoreCapabilityDigest: forensicReceipt.selectedStoreCapabilityDigest || null,
        attemptDigest: forensicReceipt.attemptDigest || null,
        failoverContractDigest: forensicReceipt.failoverContractDigest || null,
        failoverDigest: forensicReceipt.failoverDigest || null,
      });
      if (forensicReceipt.finalReadbackDigest !== expectedReadbackDigest) return false;
    }
    let previousDigest = digest({
      incidentId: receipt.incidentId,
      tenant: receipt.tenant,
      scenarioId: receipt.scenarioId,
      evidenceDigest: receipt.evidenceDigest,
      startedAt: receipt.startedAt,
    });
    for (const event of receipt.events) {
      if (event.previousDigest !== previousDigest) return false;
      const copy = { ...event };
      const eventDigest = copy.eventDigest;
      delete copy.eventDigest;
      if (eventDigest !== digest(copy)) return false;
      previousDigest = eventDigest;
    }
    if (receipt.traceHeadDigest !== previousDigest) return false;
    const copy = { ...receipt };
    const receiptDigest = copy.receiptDigest;
    delete copy.receiptDigest;
    return receiptDigest === digest(copy);
  }

  return { handle, verifyReceipt };
}

module.exports = { createT4ContainmentController, createWriteOnceForensicStore, digest };
