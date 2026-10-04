'use strict';

const { createHash } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function clean(value, max = 160) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
}

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isAllowedTerminal(contract, tier, outcome) {
  return (contract?.tiers?.[tier]?.allowed_terminal_outcomes || []).includes(outcome);
}

function classify(contract, scenarios, scenarioId) {
  if (scenarioId === 'support-guidance') {
    return { scenario: null, tier: 'T0', reason: 'explicit-nonconsequential-guidance' };
  }
  const scenario = scenarios.find((item) => item.id === scenarioId) || null;
  if (!scenario) return { scenario: null, tier: 'T4', reason: 'unknown-scenario-fail-safe' };
  const override = contract?.scenario_tier_overrides?.[scenario.id];
  const fallback = contract?.category_defaults?.[scenario.category];
  return {
    scenario,
    tier: override || fallback || 'T4',
    reason: override ? 'scenario-override' : fallback ? 'category-default' : 'fail-safe-default',
  };
}

function createAutonomyControlLoop({
  contract,
  failureScenarios,
  selfHelp,
  recoveryExecutor,
  repairCoordinator,
  rollbackExecutor,
  now = Date.now,
  maxActions = 3,
  authorityDb,
} = {}) {
  if (!contract?.tiers) throw new Error('Autonomy control loop requires support tier contract.');
  const scenarios = Array.isArray(failureScenarios?.scenarios)
    ? failureScenarios.scenarios
    : Array.isArray(failureScenarios) ? failureScenarios : [];
  if (!Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > 20) {
    throw new Error('maxActions must be between 1 and 20.');
  }

  // Only an explicitly supplied durable database can authorize an executor.
  // A claimed-but-unfinished incident is never automatically retried: reconcile it first.
  const durableAuthority = authorityDb && authorityDb.prepare('PRAGMA database_list').all().some(r => r.name === 'main' && r.file);
  if (durableAuthority) authorityDb.exec(`CREATE TABLE IF NOT EXISTS autonomy_incident_claims (
    tenant TEXT NOT NULL, incident_id TEXT NOT NULL, input_digest TEXT NOT NULL,
    claim_token TEXT NOT NULL, receipt_json TEXT, PRIMARY KEY(tenant, incident_id));`);

  async function run(input = {}) {
    const incidentId = clean(input.incidentId, 120);
    const tenant = clean(input.tenant, 100);
    const targetTenant = clean(input.targetTenant || tenant, 100);
    const scenarioId = clean(input.scenarioId, 120);
    const evidenceDigest = clean(input.evidenceDigest, 64).toLowerCase();

    if (!incidentId || !tenant || !scenarioId) deny('WFM_AUTONOMY_INPUT', 'incidentId, tenant and scenarioId are required.');
    if (!/^[a-f0-9]{64}$/.test(evidenceDigest)) deny('WFM_AUTONOMY_EVIDENCE', 'SHA-256 evidence digest required.');

    const startedAt = Number(now());
    let actionCount = 0;
    let prev = digest({ incidentId, tenant, scenarioId, evidenceDigest, startedAt });
    const trace = [];

    const append = (type, detail = {}) => {
      const event = { seq: trace.length + 1, at: Number(now()), type, detail, previousDigest: prev };
      event.eventDigest = digest(event);
      prev = event.eventDigest;
      trace.push(event);
    };

    const consumeAction = (kind) => {
      actionCount += 1;
      append('action-budget-consumed', { kind, actionCount, maxActions });
      if (actionCount > maxActions) deny('WFM_AUTONOMY_BUDGET', 'Autonomous action budget exhausted.');
    };

    const { scenario, tier, reason } = classify(contract, scenarios, scenarioId);
    append('classified', { scenarioId, tier, reason, category: scenario?.category || null });

    let outcome = 'contained';
    let result = {};
    let claimToken = null;
    let deniedReport = null;
    const reported = { productionMutation: false, customerMutation: false, productionAuthorityGranted: false };
    const inputDigest = digest({ input, maxActions, contract, failureScenarios });
    const claim = () => {
      if (!durableAuthority) deny('WFM_AUTONOMY_AUTHORITY_REQUIRED', 'Durable incident authority is required before execution.');
      const token = require('node:crypto').randomUUID();
      const inserted = authorityDb.prepare('INSERT OR IGNORE INTO autonomy_incident_claims (tenant,incident_id,input_digest,claim_token) VALUES (?,?,?,?)').run(tenant,incidentId,inputDigest,token);
      if (Number(inserted.changes) === 1) { claimToken = token; return null; }
      const prior = authorityDb.prepare('SELECT * FROM autonomy_incident_claims WHERE tenant=? AND incident_id=?').get(tenant,incidentId);
      if (!prior || prior.input_digest !== inputDigest) deny('WFM_AUTONOMY_INCIDENT_CONFLICT', 'Incident authority cannot be reset by changed evidence or configuration.');
      if (!prior.receipt_json) deny('WFM_AUTONOMY_RECONCILIATION_REQUIRED', 'Incident action already claimed; reconcile its outcome before any further execution.');
      const receipt = JSON.parse(prior.receipt_json);
      if (!verifyReceipt(receipt)) deny('WFM_AUTONOMY_RECEIPT_INTEGRITY', 'Retained incident receipt failed integrity validation.');
      return receipt;
    };
    const retainReport = report => {
      const value = report || {};
      for (const key of Object.keys(reported)) reported[key] = value[key] === true;
      deniedReport = { reportDigest: digest(value), ...reported };
      for (const key of ['verificationDigest', 'rollbackDigest', 'violationEvidenceDigest']) {
        if (typeof value[key] === 'string' && /^[a-f0-9]{64}$/i.test(value[key])) deniedReport[key] = value[key];
      }
    };

    try {
      if (targetTenant !== tenant) {
        append('cross-tenant-denied', { tenant, targetTenant });
      } else if (tier === 'T0') {
        if (!selfHelp?.answer) {
          outcome = 'safe_abstention';
          append('t0-unavailable');
        } else {
          const answer = selfHelp.answer({ text: input.question, role: input.role, version: input.version });
          if (answer?.actionAuthority !== false) deny('WFM_AUTONOMY_T0_AUTHORITY', 'Tier 0 escaped action-authority boundary.');
          outcome = answer?.status === 'answered' ? 'answered' : 'safe_abstention';
          result = { answer };
          append('t0-result', { status: answer?.status || 'abstain', intent: answer?.intent || null });
        }
      } else if (tier === 'T1') {
        const action = scenario?.autonomous_action || null;
        const allowed = contract?.tiers?.T1?.allowlisted_action_prefixes || [];
        const actionAllowed = typeof action === 'string' && allowed.some((p) => action === p || action.startsWith(p + '.'));

        if (!action || !actionAllowed || !recoveryExecutor?.execute) {
          outcome = scenarioId === 'provider-credential-expiry'
            ? 'external_provider_authorisation_required'
            : 'contained';
          append('t1-contained', { action, actionAllowed, executorAvailable: Boolean(recoveryExecutor?.execute) });
        } else {
          const previous = claim(); if (previous) return previous;
          consumeAction(action);
          const recovery = await recoveryExecutor.execute({ incidentId, tenant, scenario, action, evidenceDigest, input });
          retainReport(recovery);
          if (recovery?.productionMutation === true || recovery?.productionAuthorityGranted === true || recovery?.customerMutation === true) {
            deny('WFM_AUTONOMY_T1_AUTHORITY', 'Tier 1 recovery exceeded authority.');
          }
          if (recovery?.verified !== true || !/^[a-f0-9]{64}$/i.test(recovery?.verificationDigest || '')) deny('WFM_AUTONOMY_T1_VERIFY', 'Tier 1 recovery must be independently verified.');
          if (!isAllowedTerminal(contract, tier, recovery?.status)) deny('WFM_AUTONOMY_TERMINAL', 'Invalid Tier 1 terminal outcome.');
          outcome = recovery.status;
          result = { recovery };
          append('t1-verified', { action, status: outcome, verificationDigest: recovery.verificationDigest || null });
        }
      } else if (tier === 'T2') {
        if (!repairCoordinator?.process) {
          append('t2-contained', { coordinatorAvailable: false });
        } else {
          const previous = claim(); if (previous) return previous;
          consumeAction('repair.process');
          const repair = await repairCoordinator.process({ incidentId, tenant, scenario, evidenceDigest, input });
          retainReport(repair);
          if (repair?.customerMutation === true || repair?.productionAuthorityGranted === true || repair?.productionMutation === true) {
            deny('WFM_AUTONOMY_T2_PRODUCTION', 'Tier 2 repair cannot grant production authority.');
          }
          if (!isAllowedTerminal(contract, tier, repair?.status)) deny('WFM_AUTONOMY_TERMINAL', 'Invalid Tier 2 terminal outcome.');
          if (repair.status === 'verified_candidate_staged' && (repair.independentlyVerified !== true || !/^[a-f0-9]{64}$/i.test(repair.verificationDigest || ''))) {
            deny('WFM_AUTONOMY_T2_VERIFY', 'Staged repair candidate must be independently verified.');
          }
          outcome = repair.status;
          result = { repair };
          append('t2-result', { status: outcome, independentlyVerified: repair.independentlyVerified === true });
        }
      } else if (tier === 'T3') {
        outcome = input.customerAuthorisationRequired === true ? 'customer_authorisation_required' : 'contained';
        append('t3-authority-boundary', { proposedAction: clean(input.proposedAction, 120) || null });
      } else if (input.knownGoodRollbackAvailable === true && rollbackExecutor?.rollback) {
        const previous = claim(); if (previous) return previous;
        consumeAction('known-good.rollback');
        const rollback = await rollbackExecutor.rollback({ incidentId, tenant, scenario, evidenceDigest, input });
        retainReport(rollback);
        if (rollback?.verified !== true || !/^[a-f0-9]{64}$/i.test(rollback?.rollbackDigest || '') || rollback?.productionAuthorityGranted === true || rollback?.productionMutation === true || rollback?.customerMutation === true) {
          deny('WFM_AUTONOMY_ROLLBACK_VERIFY', 'Known-good rollback must be independently verified and bounded.');
        }
        outcome = 'rolled_back_to_known_good';
        result = { rollback };
        append('t4-rollback', { verified: true, rollbackDigest: rollback.rollbackDigest || null });
      } else {
        outcome = input.securityOrLegalAuthorityRequired === true ? 'security_or_legal_authority_required' : 'contained';
        append('t4-contained', { rollbackAvailable: input.knownGoodRollbackAvailable === true });
      }
    } catch (error) {
      outcome = 'contained';
      result = { containedErrorCode: error.code || 'WFM_AUTONOMY_INTERNAL', ...(deniedReport ? { deniedReport } : {}) };
      append('control-failure-contained', {
        code: result.containedErrorCode,
        messageDigest: digest(String(error.message || 'error')),
      });
    }

    if (!isAllowedTerminal(contract, tier, outcome)) {
      append('terminal-coerced-to-containment', { rejectedOutcome: outcome, tier });
      outcome = isAllowedTerminal(contract, tier, 'contained')
        ? 'contained'
        : (contract.tiers[tier].allowed_terminal_outcomes || [])[0];
    }

    append('terminal', { tier, outcome, actionCount });
    const endedAt = Number(now());
    const core = {
      schemaVersion: 1,
      incidentId,
      tenant,
      scenarioId,
      tier,
      outcome,
      safeTerminal: true,
      actionCount,
      maxActions,
      evidenceDigest,
      ...reported,
      mutationObservationScope: 'Executor-reported flags; not independent observation of side effects',
      startedAt,
      endedAt,
      trace,
      traceHeadDigest: prev,
      resultDigest: digest(result),
    };
    const receipt = { ...core, receiptDigest: digest(core), ...result };
    if (claimToken) {
      const saved = authorityDb.prepare('UPDATE autonomy_incident_claims SET receipt_json=? WHERE tenant=? AND incident_id=? AND claim_token=? AND receipt_json IS NULL').run(JSON.stringify(receipt),tenant,incidentId,claimToken);
      if (Number(saved.changes) !== 1) deny('WFM_AUTONOMY_RECEIPT_COMMIT', 'Incident receipt could not be committed.');
    }
    return receipt;
  }

  function verifyReceipt(receipt) {
    if (!receipt || !Array.isArray(receipt.trace) || !receipt.receiptDigest) return false;
    let prev = digest({
      incidentId: receipt.incidentId,
      tenant: receipt.tenant,
      scenarioId: receipt.scenarioId,
      evidenceDigest: receipt.evidenceDigest,
      startedAt: receipt.startedAt,
    });

    for (const event of receipt.trace) {
      if (event.previousDigest !== prev) return false;
      const copy = { ...event };
      const eventDigest = copy.eventDigest;
      delete copy.eventDigest;
      if (eventDigest !== digest(copy)) return false;
      prev = eventDigest;
    }

    if (receipt.traceHeadDigest !== prev) return false;
    const result = {};
    for (const key of ['answer', 'recovery', 'repair', 'rollback', 'containedErrorCode', 'deniedReport']) {
      if (Object.prototype.hasOwnProperty.call(receipt, key)) result[key] = receipt[key];
    }
    if (receipt.resultDigest !== digest(result)) return false;
    const core = { ...receipt };
    for (const key of ['receiptDigest', 'answer', 'recovery', 'repair', 'rollback', 'containedErrorCode', 'deniedReport']) delete core[key];
    return receipt.receiptDigest === digest(core);
  }

  return { run, verifyReceipt, classify: (scenarioId) => classify(contract, scenarios, scenarioId) };
}

module.exports = { canonical, digest, createAutonomyControlLoop };
