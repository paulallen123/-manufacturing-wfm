'use strict';

const { createHash } = require('node:crypto');

const ACTION_TYPES = new Set(['CONFIG', 'TEST', 'DEPENDENCY', 'RISK', 'DECISION', 'NO_OP']);

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

function normaliseOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    fail('WFM_SCOPE_NOT_ACTIONABLE', 'Final scope must contain machine-actionable operations.', 400);
  }
  const cloned = operations.map((operation, index) => {
    if (!operation || typeof operation !== 'object' || !ACTION_TYPES.has(operation.type)) {
      fail('WFM_SCOPE_OPERATION_INVALID', `Scope operation ${index} is not machine-actionable.`, 400);
    }
    if (!operation.key) fail('WFM_SCOPE_OPERATION_INVALID', `Scope operation ${index} requires a key.`, 400);
    return clone(operation);
  });
  return cloned.sort((a, b) => stable(a).localeCompare(stable(b)));
}

function normaliseScope(scope) {
  if (!scope || typeof scope !== 'object') fail('WFM_SCOPE_REQUIRED', 'Final adaptive scope is required.', 400);
  requiredString(scope.graphVersion, 'WFM_SCOPE_VERSION_REQUIRED', 'Scope graph version is required.');
  requiredString(scope.revision, 'WFM_SCOPE_REVISION_REQUIRED', 'Scope revision is required.');
  if (!Array.isArray(scope.purchasedScope)) fail('WFM_SCOPE_PURCHASE_REQUIRED', 'Purchased scope is required.', 400);
  if (!Array.isArray(scope.questions)) fail('WFM_SCOPE_QUESTIONS_REQUIRED', 'Scope question state is required.', 400);
  if (scope.questions.length !== 0) fail('WFM_SCOPE_INCOMPLETE', 'Provisioning cannot start while launch questions remain unanswered.');

  const operations = normaliseOperations(scope.operations);
  return {
    graphVersion: scope.graphVersion,
    revision: scope.revision,
    purchasedScope: [...new Set(scope.purchasedScope.map(String))].sort(),
    operationsDigest: sha256(operations)
  };
}

function normaliseContract(contract) {
  if (!contract || typeof contract !== 'object') fail('WFM_CONTRACT_EVENT_REQUIRED', 'Completed-contract event is required.', 400);
  if (contract.authenticated !== true) fail('WFM_CONTRACT_EVENT_UNAUTHENTICATED', 'Contract completion event is not authenticated.', 403);
  if (String(contract.status || '').toLowerCase() !== 'completed') fail('WFM_CONTRACT_NOT_COMPLETED', 'Contract must be completed before provisioning.', 409);

  return {
    provider: requiredString(contract.provider, 'WFM_CONTRACT_PROVIDER_REQUIRED', 'Contract provider is required.'),
    contractId: requiredString(contract.contractId, 'WFM_CONTRACT_ID_REQUIRED', 'Contract id is required.'),
    contractVersion: requiredString(contract.contractVersion, 'WFM_CONTRACT_VERSION_REQUIRED', 'Contract version is required.'),
    tenantId: requiredString(contract.tenantId, 'WFM_TENANT_REQUIRED', 'Tenant id is required.'),
    completedAt: requiredString(contract.completedAt, 'WFM_CONTRACT_COMPLETED_AT_REQUIRED', 'Contract completion time is required.'),
    eventId: requiredString(contract.eventId, 'WFM_CONTRACT_EVENT_ID_REQUIRED', 'Contract event id is required.')
  };
}

function normaliseBuild(build) {
  if (!build || typeof build !== 'object') fail('WFM_BUILD_REQUIRED', 'Approved build is required.', 400);
  if (build.approved !== true) fail('WFM_BUILD_NOT_APPROVED', 'Build is not approved for provisioning.', 409);
  const sourceRevision = requiredString(build.sourceRevision, 'WFM_BUILD_SOURCE_REQUIRED', 'Approved source revision is required.');
  const artifactSha256 = requiredString(build.artifactSha256, 'WFM_BUILD_DIGEST_REQUIRED', 'Approved artifact SHA-256 is required.').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(artifactSha256)) fail('WFM_BUILD_DIGEST_INVALID', 'Approved artifact SHA-256 must be exactly 64 hexadecimal characters.', 400);
  return {
    sourceRevision,
    artifactSha256,
    approvalId: requiredString(build.approvalId, 'WFM_BUILD_APPROVAL_REQUIRED', 'Build approval id is required.')
  };
}

function normalisePlan(plan) {
  if (!plan || typeof plan !== 'object') fail('WFM_PROVISIONING_PLAN_REQUIRED', 'Provisioning plan is required.', 400);
  if (plan.creationMode !== 'fresh-provider-create') {
    fail('WFM_FRESH_CREATE_REQUIRED', 'Only a fresh provider-created customer environment can satisfy provisioning proof.');
  }
  if (plan.isolated !== true) fail('WFM_ENVIRONMENT_NOT_ISOLATED', 'Customer environment must be isolated before provisioning.');
  if (plan.preExistingEnvironmentId) fail('WFM_PRECREATED_ENVIRONMENT_REJECTED', 'A manually pre-created environment cannot satisfy autonomous provisioning proof.');
  return {
    provider: requiredString(plan.provider, 'WFM_CLOUD_PROVIDER_REQUIRED', 'Cloud provider is required.'),
    region: requiredString(plan.region, 'WFM_CLOUD_REGION_REQUIRED', 'Cloud region is required.'),
    creationMode: plan.creationMode,
    isolated: true,
    networkPolicy: requiredString(plan.networkPolicy, 'WFM_NETWORK_POLICY_REQUIRED', 'Network policy is required.'),
    secretsPolicy: requiredString(plan.secretsPolicy, 'WFM_SECRETS_POLICY_REQUIRED', 'Secrets policy is required.')
  };
}

function createLaunchIntent({ scope, contract, build, plan }) {
  const finalScope = normaliseScope(scope);
  const completedContract = normaliseContract(contract);
  const approvedBuild = normaliseBuild(build);
  const provisioningPlan = normalisePlan(plan);

  const semanticContract = {
    provider: completedContract.provider,
    contractId: completedContract.contractId,
    contractVersion: completedContract.contractVersion,
    tenantId: completedContract.tenantId,
    completedAt: completedContract.completedAt
  };

  const sealed = {
    schemaVersion: 1,
    contract: semanticContract,
    scope: finalScope,
    build: approvedBuild,
    plan: provisioningPlan
  };
  const intentDigest = sha256(sealed);
  const queueKey = 'wfm-provision:v1:' + sha256({
    provider: semanticContract.provider,
    contractId: semanticContract.contractId,
    contractVersion: semanticContract.contractVersion,
    tenantId: semanticContract.tenantId
  });

  return {
    ...sealed,
    completionEvidence: {
      authenticated: true,
      eventId: completedContract.eventId
    },
    intentDigest,
    queueKey
  };
}

function verifyLaunchIntent(intent, current) {
  if (!intent || typeof intent !== 'object') fail('WFM_LAUNCH_INTENT_REQUIRED', 'Provisioning launch intent is required.', 400);
  const expected = createLaunchIntent(current);

  if (intent.queueKey !== expected.queueKey) fail('WFM_LAUNCH_QUEUE_KEY_DRIFT', 'Provisioning business identity changed; do not reuse this queue item.');
  if (intent.intentDigest !== expected.intentDigest) fail('WFM_LAUNCH_INTENT_DRIFT', 'Contract, scope, approved build or isolated environment plan changed after provisioning was sealed.');

  return {
    ok: true,
    queueKey: intent.queueKey,
    intentDigest: intent.intentDigest,
    eventId: expected.completionEvidence.eventId
  };
}

module.exports = {
  ACTION_TYPES,
  createLaunchIntent,
  verifyLaunchIntent,
  sha256,
  stable
};
