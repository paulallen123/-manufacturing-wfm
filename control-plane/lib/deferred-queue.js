const SHA40 = /^[0-9a-f]{40}$/;

export const DEFERRED_STATUSES = Object.freeze([
  'QUEUED',
  'DEVELOPING_ISOLATED',
  'ACTIVATION_READY',
  'RELEASED',
]);

export const ACTIVATION_STRATEGIES = Object.freeze([
  'feature-flag',
  'cherry-pick-set',
  'fast-forward-pr',
  'deployment-switch',
]);

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateDeferredChange(change) {
  const errors = [];
  if (!change || typeof change !== 'object') return ['CHANGE_REQUIRED'];

  if (!text(change.id)) errors.push('ID_REQUIRED');
  if (!text(change.title)) errors.push('TITLE_REQUIRED');
  if (!text(change.branch)) errors.push('BRANCH_REQUIRED');
  if (!Number.isInteger(change.prNumber) || change.prNumber <= 0) errors.push('PR_NUMBER_REQUIRED');
  if (!DEFERRED_STATUSES.includes(change.status)) errors.push('INVALID_STATUS');
  if (change.isolated !== true) errors.push('ISOLATION_REQUIRED');
  if (change.touchesFrozenCandidate !== false) errors.push('FROZEN_CANDIDATE_MUTATION_FORBIDDEN');
  if (!SHA40.test(String(change.frozenBaseSha || ''))) errors.push('FROZEN_BASE_SHA_REQUIRED');

  const activation = change.activation || {};
  if (!Number.isInteger(activation.maxMinutes) || activation.maxMinutes < 1 || activation.maxMinutes > 60) {
    errors.push('ACTIVATION_SLO_MUST_BE_1_TO_60_MINUTES');
  }
  if (!ACTIVATION_STRATEGIES.includes(activation.strategy)) errors.push('INVALID_ACTIVATION_STRATEGY');
  if (!text(activation.testCommand)) errors.push('TEST_COMMAND_REQUIRED');
  if (!text(activation.rollback)) errors.push('ROLLBACK_REQUIRED');
  if (!['none', 'backward-compatible', 'prevalidated'].includes(activation.migrationRisk)) {
    errors.push('MIGRATION_RISK_NOT_BOUNDED');
  }

  return errors;
}

export function customerProofComplete(controlPlaneState) {
  if (!controlPlaneState?.gates || typeof controlPlaneState.gates !== 'object') return false;
  const gates = Object.values(controlPlaneState.gates).filter((gate) => gate?.id !== 'production_authority');
  return gates.length > 0 && gates.every((gate) => gate?.state === 'PASS');
}

export function activationPackageReady(change) {
  const activation = change?.activation || {};
  return (
    change?.readiness === 'ACTIVATION_READY'
    && activation.validatedAgainstFrozenSha === change.frozenBaseSha
    && activation.isolatedTestsPassed === true
    && activation.rollbackVerified === true
    && activation.deploymentRecipeReady === true
  );
}

export function assessDeferredChange(change, controlPlaneState) {
  const errors = validateDeferredChange(change);
  if (errors.length) {
    return { eligible: false, state: 'INVALID', errors };
  }

  if (!customerProofComplete(controlPlaneState)) {
    return {
      eligible: false,
      state: 'HELD_UNTIL_CUSTOMER_PROOF',
      reason: 'LIVE_CUSTOMER_ENVIRONMENT_NOT_YET_PROVEN',
    };
  }

  if (!activationPackageReady(change)) {
    return {
      eligible: false,
      state: 'PREPARE_ISOLATED',
      reason: 'ACTIVATION_PACKAGE_NOT_READY',
    };
  }

  return {
    eligible: true,
    state: 'PROMOTION_ELIGIBLE',
    maxActivationMinutes: change.activation.maxMinutes,
    strategy: change.activation.strategy,
  };
}

export function assertNoFrozenCandidateMutation(changes) {
  const offenders = (changes || []).filter((change) => change?.isolated !== true || change?.touchesFrozenCandidate !== false);
  if (offenders.length) {
    throw new Error(`FROZEN_CANDIDATE_MUTATION_FORBIDDEN:${offenders.map((change) => change?.id || 'unknown').join(',')}`);
  }
  return true;
}
