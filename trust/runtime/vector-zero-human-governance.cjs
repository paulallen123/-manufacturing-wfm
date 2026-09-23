'use strict';

const { createHash } = require('node:crypto');

const RISK_ORDER = Object.freeze({
  READ_ONLY: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4
});

const TERMINALS = Object.freeze({
  AUTONOMOUS_EXECUTION: 'AUTONOMOUS_EXECUTION',
  AUTONOMOUS_CONTAINMENT: 'AUTONOMOUS_CONTAINMENT',
  EXTERNAL_MANDATE_BLOCKED: 'EXTERNAL_MANDATE_BLOCKED'
});

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function text(value, max = 180) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function uniquePrincipals(input = {}) {
  const ids = [
    input.proposerId,
    input.policyEngineId,
    input.executorId,
    input.verifierId,
    input.securityVerifierId
  ].map(value => text(value, 120)).filter(Boolean);
  return ids.length === 5 && new Set(ids).size === ids.length;
}

function evaluateMachineQuorum(input = {}) {
  const reasons = [];
  const riskClass = text(input.action?.riskClass || 'READ_ONLY', 40).toUpperCase();
  const riskCeiling = text(input.policy?.riskCeiling || 'READ_ONLY', 40).toUpperCase();
  const actionType = text(input.action?.actionType, 180);
  const blastRadius = Number(input.action?.blastRadius ?? 0);
  const blastRadiusCeiling = Number(input.policy?.maxBlastRadius ?? 0);

  if (!(riskClass in RISK_ORDER) || !(riskCeiling in RISK_ORDER)) reasons.push('INVALID_RISK_CLASS');
  if (!actionType) reasons.push('ACTION_TYPE_REQUIRED');
  if (input.policy?.preAuthorised !== true) reasons.push('POLICY_NOT_PREAUTHORISED');
  if (Array.isArray(input.policy?.allowedActionTypes) && !input.policy.allowedActionTypes.includes(actionType)) {
    reasons.push('ACTION_NOT_ALLOWLISTED');
  }
  if ((riskClass in RISK_ORDER) && (riskCeiling in RISK_ORDER) && RISK_ORDER[riskClass] > RISK_ORDER[riskCeiling]) {
    reasons.push('RISK_EXCEEDS_POLICY');
  }
  if (!Number.isSafeInteger(blastRadius) || blastRadius < 0 || !Number.isSafeInteger(blastRadiusCeiling) || blastRadius > blastRadiusCeiling) {
    reasons.push('BLAST_RADIUS_EXCEEDS_POLICY');
  }
  if (!uniquePrincipals(input.principals)) reasons.push('INDEPENDENT_PRINCIPALS_REQUIRED');
  if (input.evidence?.simulationPassed !== true) reasons.push('SIMULATION_NOT_PROVED');
  if (input.evidence?.policyEnginePassed !== true) reasons.push('POLICY_CHECK_NOT_PROVED');
  if (input.evidence?.tenantInvariantPassed !== true) reasons.push('TENANT_INVARIANT_NOT_PROVED');
  if (input.evidence?.independentVerifierPassed !== true) reasons.push('INDEPENDENT_VERIFICATION_NOT_PROVED');
  if (input.evidence?.securityVerifierPassed !== true) reasons.push('SECURITY_VERIFICATION_NOT_PROVED');
  if (input.action?.reversibility !== 'REVERSIBLE' && input.evidence?.rollbackOrCompensationProved !== true) {
    reasons.push('RECOVERY_NOT_PROVED');
  }
  if (input.action?.class === 'REPAIR' && input.evidence?.certifiedPlaybookMatch !== true) {
    reasons.push('REPAIR_PLAYBOOK_NOT_CERTIFIED');
  }

  return Object.freeze({
    passed: reasons.length === 0,
    reasons,
    quorumDigest: digest({ actionType, riskClass, blastRadius, reasons, principals: input.principals || {} })
  });
}

function decideZeroHumanAction(input = {}) {
  const action = input.action || {};
  const externalMandate = input.policy?.externalHumanActionRequired === true;
  const quorum = evaluateMachineQuorum(input);
  const unknownOrNovel = input.incident?.novel === true || input.incident?.knownFailureClass !== true;
  const containmentAction = action.class === 'CONTAINMENT';

  let terminal;
  let allowed = false;
  const reasons = [...quorum.reasons];

  if (externalMandate) {
    terminal = TERMINALS.EXTERNAL_MANDATE_BLOCKED;
    reasons.push('EXTERNAL_HUMAN_ACTION_MANDATED');
  } else if (quorum.passed && (!unknownOrNovel || containmentAction)) {
    terminal = TERMINALS.AUTONOMOUS_EXECUTION;
    allowed = true;
  } else {
    terminal = TERMINALS.AUTONOMOUS_CONTAINMENT;
    allowed = containmentAction && input.evidence?.tenantInvariantPassed === true;
    if (unknownOrNovel && !containmentAction) reasons.push('NOVEL_INCIDENT_REPAIR_BLOCKED');
  }

  const core = {
    contractVersion: 'VECTOR_ZERO_HUMAN_GOVERNANCE_V1',
    humanOperationalTouchBudget: 0,
    terminal,
    allowed,
    externalMandate,
    zeroHumanOperationalEffortAchievable: !externalMandate,
    quorum,
    reasons: [...new Set(reasons)],
    humanEscalationFallbackAllowed: false
  };
  return Object.freeze({ ...core, decisionDigest: digest(core) });
}

function evaluateHumanTouchReleaseGate(input = {}) {
  const humanTouches = Number(input.humanTouches ?? 0);
  const customerDays = Number(input.customerDays ?? 0);
  if (!Number.isSafeInteger(humanTouches) || humanTouches < 0) throw new Error('humanTouches must be a non-negative integer.');
  if (!Number.isFinite(customerDays) || customerDays < 0) throw new Error('customerDays must be non-negative.');
  const rate = customerDays > 0 ? (humanTouches / customerDays) * 1000 : (humanTouches === 0 ? 0 : Infinity);
  return Object.freeze({
    contractVersion: 'VECTOR_ZERO_HUMAN_RELEASE_GATE_V1',
    humanTouches,
    customerDays,
    humanTouchesPer1000CustomerDays: rate,
    passed: humanTouches === 0,
    releaseBlocker: humanTouches !== 0,
    defectClass: humanTouches === 0 ? null : 'HUMAN_OPERATIONAL_TOUCH'
  });
}

module.exports = Object.freeze({
  RISK_ORDER,
  TERMINALS,
  stable,
  digest,
  evaluateMachineQuorum,
  decideZeroHumanAction,
  evaluateHumanTouchReleaseGate
});
