'use strict';

const { createHash } = require('node:crypto');

const T3_SCENARIO_POLICY = Object.freeze({
  'payroll-calculation-or-export-anomaly': Object.freeze({
    policyVersion: 't3-actions-v2',
    actionPrefix: 'payroll.',
    allowedActions: Object.freeze(['payroll.correct-export', 'payroll.release-corrected-export']),
    maxAffectedRecords: 5000,
    approverRoles: Object.freeze(['payroll', 'company-admin']),
  }),
  'timezone-dst-or-clock-skew': Object.freeze({
    policyVersion: 't3-actions-v2',
    actionPrefix: 'time.',
    allowedActions: Object.freeze(['time.apply-normalised-records']),
    maxAffectedRecords: 5000,
    approverRoles: Object.freeze(['manager', 'payroll', 'company-admin']),
  }),
});

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

function policyDigest(scenarioId) {
  const policy = T3_SCENARIO_POLICY[scenarioId];
  if (!policy) return null;
  return digest({
    scenarioId,
    policyVersion: policy.policyVersion,
    actionPrefix: policy.actionPrefix,
    allowedActions: [...policy.allowedActions],
    maxAffectedRecords: policy.maxAffectedRecords,
    approverRoles: [...policy.approverRoles],
  });
}

function clean(value, max = 160) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
}

function isDigest(value) {
  return /^[a-f0-9]{64}$/.test(clean(value, 64).toLowerCase());
}

function contained(reason, detail = {}) {
  return {
    schemaVersion: 1,
    status: 'contained',
    reason,
    simulationOnly: true,
    automaticExecutionEligible: false,
    customerMutation: false,
    productionMutation: false,
    productionAuthorityGranted: false,
    modelAuthorityGranted: false,
    ...detail,
  };
}

function createT3ShadowSimulator() {
  function simulate(input = {}) {
    const incidentId = clean(input.incidentId, 120);
    const tenant = clean(input.tenant, 100);
    const targetTenant = clean(input.targetTenant || tenant, 100);
    const scenarioId = clean(input.scenarioId, 120);
    const evidenceDigest = clean(input.evidenceDigest, 64).toLowerCase();
    const proposedAction = clean(input.proposedAction, 160);
    const beforeStateDigest = clean(input.beforeStateDigest, 64).toLowerCase();
    const afterStateDigest = clean(input.afterStateDigest, 64).toLowerCase();
    const compensationPlanDigest = clean(input.compensationPlanDigest, 64).toLowerCase();
    const affectedRecords = Number(input.affectedRecords);
    const policy = T3_SCENARIO_POLICY[scenarioId] || null;

    if (!incidentId || !tenant || !scenarioId) return contained('missing-identity');
    if (targetTenant !== tenant) return contained('cross-tenant-denied', { tenant, targetTenant, scenarioId });
    if (!policy) return contained('unsupported-t3-scenario', { tenant, scenarioId });
    if (!isDigest(evidenceDigest) || !isDigest(beforeStateDigest) || !isDigest(afterStateDigest) || !isDigest(compensationPlanDigest)) {
      return contained('deterministic-digests-required', { tenant, scenarioId });
    }
    if (!proposedAction || !policy.allowedActions.includes(proposedAction)) {
      return contained('scenario-action-family-mismatch', { tenant, scenarioId, proposedAction: proposedAction || null });
    }
    if (!Number.isSafeInteger(affectedRecords) || affectedRecords < 1 || affectedRecords > policy.maxAffectedRecords) {
      return contained('affected-record-cap-denied', { tenant, scenarioId, affectedRecords: Number.isFinite(affectedRecords) ? affectedRecords : null });
    }
    if (beforeStateDigest === afterStateDigest) {
      return contained('no-deterministic-state-change', { tenant, scenarioId });
    }

    const proposal = {
      incidentId,
      tenant,
      scenarioId,
      evidenceDigest,
      proposedAction,
      beforeStateDigest,
      afterStateDigest,
      compensationPlanDigest,
      affectedRecords,
      actionPrefix: policy.actionPrefix,
      maxAffectedRecords: policy.maxAffectedRecords,
    };
    const proposalDigest = digest(proposal);
    const core = {
      schemaVersion: 1,
      status: 'customer_authorisation_required',
      incidentId,
      tenant,
      targetTenant,
      scenarioId,
      evidenceDigest,
      proposedAction,
      beforeStateDigest,
      afterStateDigest,
      compensationPlanDigest,
      affectedRecords,
      maxAffectedRecords: policy.maxAffectedRecords,
      actionPolicyDigest: policyDigest(scenarioId),
      proposalDigest,
      simulationOnly: true,
      diagnosisBound: true,
      compensationBound: true,
      exactActionAllowlistBound: true,
      requiresCustomerAuthorisation: true,
      automaticExecutionEligible: false,
      graduatedAutomaticAction: false,
      customerMutation: false,
      productionMutation: false,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
    };

    return { ...core, simulationDigest: digest(core) };
  }

  return { simulate, policies: T3_SCENARIO_POLICY };
}

module.exports = { createT3ShadowSimulator, canonical, digest, policyDigest, T3_SCENARIO_POLICY };
