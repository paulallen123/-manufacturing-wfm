'use strict';

const { createHash } = require('node:crypto');

const TIERS = new Set(['T0', 'T1', 'T2', 'T3', 'T4']);
const HEX64 = /^[a-f0-9]{64}$/;
const SENSITIVE_SCENARIO_PATTERN = /(payroll|identity|security|tenant|credential|destructive|legal|medical|health)/i;
const AUTHORITY_ERROR_PATTERN = /(AUTHORITY|TENANT|PRODUCTION|SECRET|CREDENTIAL|PROVENANCE|TAMPER|SECURITY)/i;

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
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') deny('WFM_LEARNING_RECEIPT', 'Terminal receipt is required.');
  const incidentId = clean(receipt.incidentId, 120);
  const tenant = clean(receipt.tenant, 100);
  const scenarioId = clean(receipt.scenarioId, 120);
  const tier = clean(receipt.tier, 8);
  const outcome = clean(receipt.outcome, 120);
  const evidenceDigest = clean(receipt.evidenceDigest, 64).toLowerCase();
  const receiptDigest = clean(receipt.receiptDigest, 64).toLowerCase();

  if (!incidentId || !tenant || !scenarioId || !outcome || !TIERS.has(tier)) {
    deny('WFM_LEARNING_RECEIPT', 'Receipt identity, scenario, tier and outcome are required.');
  }
  if (!HEX64.test(evidenceDigest) || !HEX64.test(receiptDigest)) {
    deny('WFM_LEARNING_RECEIPT', 'Receipt and evidence digests must be SHA-256.');
  }
  if (receipt.productionMutation === true || receipt.productionAuthorityGranted === true || receipt.customerMutation === true) {
    deny('WFM_LEARNING_AUTHORITY', 'Learning planner accepts evidence-only terminal receipts.');
  }
  return { incidentId, tenant, scenarioId, tier, outcome, evidenceDigest, receiptDigest };
}

function createIncidentLearningPlanner({ maxFixtureBytes = 4096 } = {}) {
  if (!Number.isSafeInteger(maxFixtureBytes) || maxFixtureBytes < 512 || maxFixtureBytes > 16384) {
    throw new Error('maxFixtureBytes must be between 512 and 16384.');
  }

  function plan(receipt, context = {}) {
    const base = validateReceipt(receipt);
    const errorCode = clean(receipt.containedErrorCode || context.errorCode, 120);
    const falseGreenDetected = context.falseGreenDetected === true;
    const defectDetected = context.defectDetected === true || Boolean(errorCode) || falseGreenDetected;
    const novelFailure = context.novelFailure === true || base.tier === 'T4' || base.scenarioId === 'never-seen-before';
    const historicalRegression = context.historicalRegression === true;
    const sensitive = base.tier === 'T3'
      || base.tier === 'T4'
      || SENSITIVE_SCENARIO_PATTERN.test(base.scenarioId)
      || AUTHORITY_ERROR_PATTERN.test(errorCode);
    const safeTerminal = receipt.safeTerminal === true;

    const regressionRequired = defectDetected
      || novelFailure
      || historicalRegression
      || base.outcome === 'contained'
      || base.outcome === 'safe_abstention'
      || base.tier === 'T2'
      || base.tier === 'T3'
      || base.tier === 'T4';

    const fixtureCore = {
      schemaVersion: 1,
      incidentReceiptDigest: base.receiptDigest,
      evidenceDigest: base.evidenceDigest,
      tier: base.tier,
      scenarioId: base.scenarioId,
      outcome: base.outcome,
      safeTerminal,
      containedErrorCode: errorCode || null,
      falseGreenDetected,
      defectDetected,
      novelFailure,
      historicalRegression,
    };
    const fixtureJson = canonical(fixtureCore);
    if (Buffer.byteLength(fixtureJson, 'utf8') > maxFixtureBytes) {
      deny('WFM_LEARNING_FIXTURE_SIZE', 'Regression fixture exceeds deterministic bounded size.');
    }

    const regressionFixture = {
      required: regressionRequired,
      fixtureId: regressionRequired ? `reg-${digest(fixtureCore).slice(0, 20)}` : null,
      fixtureDigest: regressionRequired ? digest(fixtureCore) : null,
      sourceReceiptDigest: base.receiptDigest,
      containsCustomerText: false,
      containsReusableSecret: false,
      deterministic: true,
    };

    const detectionSignal = errorCode || `${base.tier}:${base.scenarioId}:${base.outcome}`;
    const detectionRuleProposal = {
      required: regressionRequired,
      mode: 'proposal-only',
      signalClass: errorCode ? 'contained-error-code' : 'tier-scenario-outcome',
      signalDigest: digest(detectionSignal),
      tenantScoped: true,
      crossTenantMatching: false,
      deterministic: true,
      productionWriteAuthority: false,
    };

    const neverAutomate = sensitive || !safeTerminal;
    const runbookDecision = {
      decision: neverAutomate ? 'NEVER_AUTOMATE' : 'SAFE_RUNBOOK_CANDIDATE',
      reason: sensitive
        ? 'consequential-or-security-sensitive-class'
        : !safeTerminal
          ? 'safe-terminal-not-established'
          : 'bounded-safe-terminal-with-evidence',
      requiresIndependentReviewBeforeGraduation: true,
      automaticProductionAuthority: false,
      customerAuthorisationStillRequiredForT3: base.tier === 'T3',
    };

    const supportKnowledgeProposal = {
      required: defectDetected || novelFailure || base.outcome === 'safe_abstention' || base.outcome === 'contained',
      mode: 'proposal-only',
      updateClass: neverAutomate ? 'record-never-automate-boundary' : 'add-evidence-bound-resolution-pattern',
      sourceReceiptDigest: base.receiptDigest,
      evidenceDigest: base.evidenceDigest,
      includeRawCustomerText: false,
      includeModelOutputAsAuthority: false,
      includeReusableCredential: false,
    };

    const core = {
      schemaVersion: 1,
      incidentId: base.incidentId,
      tenant: base.tenant,
      scenarioId: base.scenarioId,
      tier: base.tier,
      outcome: base.outcome,
      sourceReceiptDigest: base.receiptDigest,
      sourceEvidenceDigest: base.evidenceDigest,
      safeTerminal,
      regressionFixture,
      detectionRuleProposal,
      supportKnowledgeProposal,
      runbookDecision,
      authority: {
        actionAuthority: false,
        productionAuthority: false,
        releaseAuthority: false,
        credentialAuthority: false,
        customerMutation: false,
        crossTenantMutation: false,
        writeScope: 'proposal-only',
      },
    };

    return { ...core, learningDigest: digest(core) };
  }

  function verify(planRecord) {
    if (!planRecord || !HEX64.test(String(planRecord.learningDigest || ''))) return false;
    if (planRecord.authority?.actionAuthority !== false
      || planRecord.authority?.productionAuthority !== false
      || planRecord.authority?.releaseAuthority !== false
      || planRecord.authority?.credentialAuthority !== false
      || planRecord.authority?.customerMutation !== false
      || planRecord.authority?.crossTenantMutation !== false
      || planRecord.authority?.writeScope !== 'proposal-only') return false;
    if (planRecord.regressionFixture?.containsCustomerText !== false
      || planRecord.regressionFixture?.containsReusableSecret !== false) return false;
    if (planRecord.supportKnowledgeProposal?.includeRawCustomerText !== false
      || planRecord.supportKnowledgeProposal?.includeModelOutputAsAuthority !== false
      || planRecord.supportKnowledgeProposal?.includeReusableCredential !== false) return false;
    const copy = { ...planRecord };
    delete copy.learningDigest;
    return digest(copy) === planRecord.learningDigest;
  }

  return { plan, verify };
}

module.exports = { createIncidentLearningPlanner };
