'use strict';

const { createHash } = require('node:crypto');
const { createIncidentLearningPlanner } = require('./incident-learning-planner.cjs');

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

function createLearningFailureRecord(receipt, errorCode) {
  const core = {
    schemaVersion: 1,
    status: 'LEARNING_FAILED_CLOSED',
    sourceReceiptDigest: receipt.receiptDigest,
    sourceEvidenceDigest: receipt.evidenceDigest,
    tier: receipt.tier,
    scenarioId: receipt.scenarioId,
    errorCode: clean(errorCode || 'WFM_AUTONOMY_LEARNING_INTERNAL', 120),
    requiresIncidentLearningRecovery: true,
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

function verifyLearningFailureRecord(record) {
  if (!record || record.status !== 'LEARNING_FAILED_CLOSED') return false;
  if (!/^[a-f0-9]{64}$/.test(String(record.sourceReceiptDigest || ''))) return false;
  if (!/^[a-f0-9]{64}$/.test(String(record.sourceEvidenceDigest || ''))) return false;
  if (!/^[a-f0-9]{64}$/.test(String(record.learningDigest || ''))) return false;
  if (record.requiresIncidentLearningRecovery !== true) return false;
  if (record.authority?.actionAuthority !== false
    || record.authority?.productionAuthority !== false
    || record.authority?.releaseAuthority !== false
    || record.authority?.credentialAuthority !== false
    || record.authority?.customerMutation !== false
    || record.authority?.crossTenantMutation !== false
    || record.authority?.writeScope !== 'proposal-only') return false;
  const copy = { ...record };
  delete copy.learningDigest;
  return digest(copy) === record.learningDigest;
}

function createAutonomyControlLoop({
  contract,
  failureScenarios,
  selfHelp,
  recoveryExecutor,
  recoveryVerifier,
  repairCoordinator,
  t3ShadowSimulator,
  t3ShadowVerifier,
  t4ContainmentController,
  rollbackExecutor,
  incidentLearningPlanner = createIncidentLearningPlanner(),
  now = Date.now,
  maxActions = 3,
} = {}) {
  if (!contract?.tiers) throw new Error('Autonomy control loop requires support tier contract.');
  const scenarios = Array.isArray(failureScenarios?.scenarios)
    ? failureScenarios.scenarios
    : Array.isArray(failureScenarios) ? failureScenarios : [];
  if (!Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > 20) {
    throw new Error('maxActions must be between 1 and 20.');
  }

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
    // T4 is fail-closed: the outer receipt may only claim a safe terminal after
    // the dedicated containment controller has completed and its receipt has
    // independently verified. Other tiers retain their existing contained/abstain semantics.
    let safeTerminalEstablished = tier !== 'T4';

    try {
      if (targetTenant !== tenant && tier !== 'T4') {
        outcome = tier === 'T0' ? 'safe_abstention' : 'contained';
        append('cross-tenant-denied', { tenant, targetTenant, outcome });
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
        const executorId = clean(recoveryExecutor?.executorId, 120);
        const verifierId = clean(recoveryVerifier?.verifierId, 120);

        if (!action || !actionAllowed || !recoveryExecutor?.execute || !recoveryVerifier?.verify) {
          outcome = scenarioId === 'provider-credential-expiry'
            ? 'external_provider_authorisation_required'
            : 'contained';
          append('t1-contained', {
            action,
            actionAllowed,
            executorAvailable: Boolean(recoveryExecutor?.execute),
            verifierAvailable: Boolean(recoveryVerifier?.verify),
          });
        } else {
          if (!executorId || !verifierId || executorId === verifierId) {
            deny('WFM_AUTONOMY_T1_SEPARATION', 'Tier 1 executor and verifier must be distinct identified principals.');
          }
          consumeAction(action);
          const recovery = await recoveryExecutor.execute({ incidentId, tenant, scenario, action, evidenceDigest, input });
          if (recovery?.productionAuthorityGranted === true || recovery?.customerMutation === true) {
            deny('WFM_AUTONOMY_T1_AUTHORITY', 'Tier 1 recovery exceeded authority.');
          }
          if (clean(recovery?.executorId, 120) !== executorId || !/^[a-f0-9]{64}$/.test(String(recovery?.executionDigest || ''))) {
            deny('WFM_AUTONOMY_T1_EXECUTION_EVIDENCE', 'Tier 1 recovery requires executor-bound execution evidence.');
          }
          if (!isAllowedTerminal(contract, tier, recovery?.status)) deny('WFM_AUTONOMY_TERMINAL', 'Invalid Tier 1 terminal outcome.');

          const recoveryVerification = await recoveryVerifier.verify(recovery, {
            incidentId,
            tenant,
            scenarioId,
            action,
            evidenceDigest,
          });
          if (
            recoveryVerification?.verified !== true
            || clean(recoveryVerification?.verifierId, 120) !== verifierId
            || clean(recoveryVerification?.verifierId, 120) === executorId
            || recoveryVerification?.executionDigest !== recovery.executionDigest
            || !/^[a-f0-9]{64}$/.test(String(recoveryVerification?.verificationDigest || ''))
          ) {
            deny('WFM_AUTONOMY_T1_VERIFY', 'Tier 1 recovery must be independently bound to the exact execution evidence.');
          }
          if (
            recoveryVerification?.productionAuthorityGranted !== false
            || recoveryVerification?.customerMutation !== false
            || recoveryVerification?.modelAuthorityGranted !== false
            || recoveryVerification?.actionAuthorityGranted !== false
          ) {
            deny('WFM_AUTONOMY_T1_VERIFIER_AUTHORITY', 'Tier 1 verifier must remain read-only and non-authoritative.');
          }
          outcome = recovery.status;
          result = { recovery, recoveryVerification };
          append('t1-verified', {
            action,
            status: outcome,
            executorId,
            verifierId,
            executionDigest: recovery.executionDigest,
            verificationDigest: recoveryVerification.verificationDigest,
          });
        }
      } else if (tier === 'T2') {
        if (!repairCoordinator?.process) {
          append('t2-contained', { coordinatorAvailable: false });
        } else {
          consumeAction('repair.process');
          const repair = await repairCoordinator.process({ incidentId, tenant, scenario, evidenceDigest, input });
          if (repair?.productionAuthorityGranted === true || repair?.productionMutation === true) {
            deny('WFM_AUTONOMY_T2_PRODUCTION', 'Tier 2 repair cannot grant production authority.');
          }
          if (!isAllowedTerminal(contract, tier, repair?.status)) deny('WFM_AUTONOMY_TERMINAL', 'Invalid Tier 2 terminal outcome.');
          if (repair.status === 'verified_candidate_staged' && repair.independentlyVerified !== true) {
            deny('WFM_AUTONOMY_T2_VERIFY', 'Staged repair candidate must be independently verified.');
          }
          outcome = repair.status;
          result = { repair };
          append('t2-result', { status: outcome, independentlyVerified: repair.independentlyVerified === true });
        }
      } else if (tier === 'T3') {
        if (!t3ShadowSimulator?.simulate || !t3ShadowVerifier?.verify) {
          outcome = 'contained';
          append('t3-shadow-unavailable', {
            simulatorAvailable: Boolean(t3ShadowSimulator?.simulate),
            verifierAvailable: Boolean(t3ShadowVerifier?.verify),
          });
        } else {
          const t3Shadow = t3ShadowSimulator.simulate({
            incidentId,
            tenant,
            targetTenant,
            scenarioId,
            evidenceDigest,
            proposedAction: input.proposedAction,
            beforeStateDigest: input.beforeStateDigest,
            afterStateDigest: input.afterStateDigest,
            compensationPlanDigest: input.compensationPlanDigest,
            affectedRecords: input.affectedRecords,
          });

          if (t3Shadow?.customerMutation !== false || t3Shadow?.productionMutation !== false || t3Shadow?.productionAuthorityGranted !== false || t3Shadow?.modelAuthorityGranted !== false) {
            deny('WFM_AUTONOMY_T3_AUTHORITY', 'Tier 3 shadow simulation exceeded authority.');
          }

          if (t3Shadow?.status !== 'customer_authorisation_required') {
            outcome = 'contained';
            result = { t3Shadow };
            append('t3-shadow-contained', { reason: t3Shadow?.reason || 'shadow-simulation-not-authorisable' });
          } else {
            const t3Verification = t3ShadowVerifier.verify(t3Shadow, { tenant, scenarioId, evidenceDigest });
            if (t3Verification?.productionAuthorityGranted === true || t3Verification?.productionMutation === true || t3Verification?.customerMutation === true) {
              deny('WFM_AUTONOMY_T3_AUTHORITY', 'Tier 3 shadow verifier exceeded authority.');
            }
            if (t3Verification?.verified !== true) {
              deny('WFM_AUTONOMY_T3_VERIFY', 'Tier 3 shadow proposal must be independently verified.');
            }
            outcome = 'customer_authorisation_required';
            result = { t3Shadow, t3Verification };
            append('t3-shadow-verified', {
              proposalDigest: t3Shadow.proposalDigest || null,
              simulationDigest: t3Shadow.simulationDigest || null,
              verificationDigest: t3Verification.verificationDigest || null,
              affectedRecords: t3Shadow.affectedRecords,
            });
          }
        }
      } else if (tier === 'T4' && t4ContainmentController?.handle) {
        consumeAction('t4.containment');
        const t4 = await t4ContainmentController.handle({
          incidentId,
          tenant,
          targetTenant,
          scenarioId,
          evidenceDigest,
          requestedAction: input.requestedAction,
          threat: input.threat,
          provenance: input.provenance,
          supportSystem: input.supportSystem,
          knownGood: input.knownGood,
          rollbackRequested: input.rollbackRequested === true || input.knownGoodRollbackAvailable === true,
        });
        if (
          t4?.safeTerminal !== true
          || t4?.productionAuthorityGranted === true
          || t4?.modelAuthorityGranted === true
          || t4?.customerMutation === true
          || t4?.crossTenantMutation === true
          || t4?.requestedActionExecuted === true
        ) {
          deny('WFM_AUTONOMY_T4_AUTHORITY', 'Tier 4 containment controller exceeded bounded authority.');
        }
        if (t4ContainmentController?.verifyReceipt && t4ContainmentController.verifyReceipt(t4) !== true) {
          deny('WFM_AUTONOMY_T4_VERIFY', 'Tier 4 containment receipt failed independent integrity verification.');
        }
        if (!isAllowedTerminal(contract, tier, t4?.outcome)) {
          deny('WFM_AUTONOMY_TERMINAL', 'Invalid Tier 4 terminal outcome.');
        }
        outcome = t4.outcome;
        result = { t4 };
        safeTerminalEstablished = true;
        append('t4-controller-terminal', {
          status: outcome,
          controllerReceiptDigest: t4.receiptDigest || null,
          controllerActions: Number.isSafeInteger(t4.actionCount) ? t4.actionCount : null,
        });
      } else if (input.knownGoodRollbackAvailable === true && rollbackExecutor?.rollback) {
        consumeAction('known-good.rollback');
        const rollback = await rollbackExecutor.rollback({ incidentId, tenant, scenario, evidenceDigest, input });
        if (rollback?.verified !== true || rollback?.productionAuthorityGranted === true) {
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
      result = { containedErrorCode: error.code || 'WFM_AUTONOMY_INTERNAL' };
      if (tier === 'T4') {
        safeTerminalEstablished = false;
        append('t4-safe-terminal-not-established', {
          code: result.containedErrorCode,
          reason: 'containment-or-forensic-verification-failed',
        });
      }
      append('control-failure-contained', {
        code: result.containedErrorCode,
        messageDigest: digest(String(error.message || 'error')),
      });
    }

    if (!isAllowedTerminal(contract, tier, outcome)) {
      const allowed = contract?.tiers?.[tier]?.allowed_terminal_outcomes || [];
      const fallback = allowed.includes('contained')
        ? 'contained'
        : allowed.includes('safe_abstention') ? 'safe_abstention' : (allowed[0] || outcome);
      if (fallback !== 'contained' && fallback !== 'safe_abstention') safeTerminalEstablished = false;
      append('terminal-coerced-to-safe-fallback', { rejectedOutcome: outcome, tier, fallback });
      outcome = fallback;
    }

    append('terminal', { tier, outcome, actionCount, safeTerminal: safeTerminalEstablished });
    const endedAt = Number(now());
    const core = {
      schemaVersion: 1,
      incidentId,
      tenant,
      scenarioId,
      tier,
      outcome,
      safeTerminal: safeTerminalEstablished,
      actionCount,
      maxActions,
      evidenceDigest,
      productionMutation: false,
      productionAuthorityGranted: false,
      customerMutation: false,
      startedAt,
      endedAt,
      trace,
      traceHeadDigest: prev,
      resultDigest: digest(result),
    };
    const terminalReceipt = { ...core, receiptDigest: digest(core), ...result };

    let learning;
    try {
      if (!incidentLearningPlanner?.plan || !incidentLearningPlanner?.verify) {
        deny('WFM_AUTONOMY_LEARNING_UNAVAILABLE', 'Incident learning planner is unavailable.');
      }
      learning = incidentLearningPlanner.plan(terminalReceipt, {
        defectDetected: Boolean(terminalReceipt.containedErrorCode) || outcome === 'contained',
        falseGreenDetected: input.falseGreenDetected === true,
        historicalRegression: input.historicalRegression === true,
        novelFailure: reason === 'unknown-scenario-fail-safe',
        errorCode: terminalReceipt.containedErrorCode,
      });
      if (learning?.sourceReceiptDigest !== terminalReceipt.receiptDigest || incidentLearningPlanner.verify(learning) !== true) {
        deny('WFM_AUTONOMY_LEARNING_VERIFY', 'Incident learning record failed deterministic verification.');
      }
    } catch (error) {
      learning = createLearningFailureRecord(terminalReceipt, error.code || 'WFM_AUTONOMY_LEARNING_INTERNAL');
    }

    return { ...terminalReceipt, learning };
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
    if (receipt.tier === 'T4' && receipt.safeTerminal === true) {
      if (!receipt.t4 || receipt.t4.safeTerminal !== true) return false;
      if (!t4ContainmentController?.verifyReceipt || t4ContainmentController.verifyReceipt(receipt.t4) !== true) return false;
    }
    const result = {};
    for (const key of ['answer', 'recovery', 'recoveryVerification', 'repair', 't3Shadow', 't3Verification', 't4', 'rollback', 'containedErrorCode']) {
      if (Object.prototype.hasOwnProperty.call(receipt, key)) result[key] = receipt[key];
    }
    if (receipt.resultDigest !== digest(result)) return false;
    const core = { ...receipt };
    for (const key of ['receiptDigest', 'answer', 'recovery', 'recoveryVerification', 'repair', 't3Shadow', 't3Verification', 't4', 'rollback', 'containedErrorCode', 'learning']) delete core[key];
    if (receipt.receiptDigest !== digest(core)) return false;

    if (!receipt.learning || receipt.learning.sourceReceiptDigest !== receipt.receiptDigest) return false;
    if (receipt.learning.status === 'LEARNING_FAILED_CLOSED') {
      return verifyLearningFailureRecord(receipt.learning);
    }
    try {
      return Boolean(incidentLearningPlanner?.verify && incidentLearningPlanner.verify(receipt.learning) === true);
    } catch {
      return false;
    }
  }

  return { run, verifyReceipt, classify: (scenarioId) => classify(contract, scenarios, scenarioId) };
}

module.exports = { canonical, digest, createAutonomyControlLoop };
