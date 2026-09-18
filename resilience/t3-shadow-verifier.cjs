'use strict';

const { createHash } = require('node:crypto');

const POLICY_PREFIX = Object.freeze({
  'payroll-calculation-or-export-anomaly': 'payroll.',
  'timezone-dst-or-clock-skew': 'time.',
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

function fail(reason) {
  return { verified: false, reason, customerMutation: false, productionMutation: false, productionAuthorityGranted: false };
}

function containsReusableSecretSurface(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (/(password|secret|credential|api.?key|access.?token|refresh.?token)/i.test(key) && child != null && String(child) !== '') return true;
    if (child && typeof child === 'object' && containsReusableSecretSurface(child)) return true;
  }
  return false;
}

function createT3ShadowVerifier() {
  function verify(simulation, expected = {}) {
    if (!simulation || typeof simulation !== 'object') return fail('simulation-required');
    if (simulation.status !== 'customer_authorisation_required') return fail('terminal-status-invalid');
    if (simulation.simulationOnly !== true || simulation.requiresCustomerAuthorisation !== true) return fail('shadow-boundary-missing');
    if (simulation.automaticExecutionEligible !== false || simulation.graduatedAutomaticAction !== false) return fail('automatic-authority-escape');
    if (simulation.customerMutation !== false || simulation.productionMutation !== false || simulation.productionAuthorityGranted !== false || simulation.modelAuthorityGranted !== false) {
      return fail('mutation-or-authority-escape');
    }
    if (simulation.tenant !== simulation.targetTenant) return fail('cross-tenant-simulation');
    if (expected.tenant && simulation.tenant !== expected.tenant) return fail('tenant-mismatch');
    if (expected.scenarioId && simulation.scenarioId !== expected.scenarioId) return fail('scenario-mismatch');
    if (expected.evidenceDigest && simulation.evidenceDigest !== expected.evidenceDigest) return fail('evidence-mismatch');
    if (containsReusableSecretSurface(simulation)) return fail('reusable-secret-surface-detected');

    const actionPrefix = POLICY_PREFIX[simulation.scenarioId];
    if (!actionPrefix || typeof simulation.proposedAction !== 'string' || !simulation.proposedAction.startsWith(actionPrefix)) {
      return fail('scenario-action-family-mismatch');
    }
    if (!Number.isSafeInteger(simulation.affectedRecords) || simulation.affectedRecords < 1 || simulation.affectedRecords > simulation.maxAffectedRecords) {
      return fail('affected-record-cap-invalid');
    }

    const proposal = {
      incidentId: simulation.incidentId,
      tenant: simulation.tenant,
      scenarioId: simulation.scenarioId,
      evidenceDigest: simulation.evidenceDigest,
      proposedAction: simulation.proposedAction,
      beforeStateDigest: simulation.beforeStateDigest,
      afterStateDigest: simulation.afterStateDigest,
      compensationPlanDigest: simulation.compensationPlanDigest,
      affectedRecords: simulation.affectedRecords,
      actionPrefix,
      maxAffectedRecords: simulation.maxAffectedRecords,
    };
    if (simulation.proposalDigest !== digest(proposal)) return fail('proposal-digest-mismatch');

    const core = { ...simulation };
    const simulationDigest = core.simulationDigest;
    delete core.simulationDigest;
    if (simulationDigest !== digest(core)) return fail('simulation-digest-mismatch');

    const verificationCore = {
      incidentId: simulation.incidentId,
      tenant: simulation.tenant,
      scenarioId: simulation.scenarioId,
      evidenceDigest: simulation.evidenceDigest,
      proposalDigest: simulation.proposalDigest,
      simulationDigest,
      verifierRole: 'independent-read-only-t3-shadow-verifier',
      verified: true,
      customerMutation: false,
      productionMutation: false,
      productionAuthorityGranted: false,
    };
    return { ...verificationCore, verificationDigest: digest(verificationCore) };
  }

  return { verify };
}

module.exports = { createT3ShadowVerifier, canonical, digest };
