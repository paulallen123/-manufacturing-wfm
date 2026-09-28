import { createHash } from 'node:crypto';

const SAFE_ADAPTERS = new Set([
  'http-json', 'odata', 'soap-wsdl', 'graphql', 'scim2', 'signed-events',
  'file-batch', 'database-readmodel', 'event-stream', 'message-bus',
  'jms-message-bus', 'schema-registry', 'vendor-thin'
]);

const RECOVERY_REQUIRED_ADAPTERS = new Set([
  'signed-events', 'file-batch', 'event-stream', 'message-bus', 'jms-message-bus'
]);

const NEVER_AUTOMATICALLY_ACTIVATE_ADAPTERS = new Set([
  'scim2'
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function fingerprint(value) {
  return sha256(JSON.stringify(canonical(value)));
}

function clean(value, max = 180) {
  return String(value ?? '').trim().slice(0, max);
}

function requireNonEmpty(name, value) {
  const text = clean(value);
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

function safeAuthReference(value) {
  return /^(vault|secret|managed|merge|kombo|workato):\/\/[A-Za-z0-9._:/-]{3,200}$/.test(String(value || ''));
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(x => clean(x, 80)).filter(Boolean))].sort();
}

function buildSafeConnectionTest(input = {}) {
  const providerKey = requireNonEmpty('providerKey', input.providerKey);
  const sourceInstanceId = requireNonEmpty('sourceInstanceId', input.sourceInstanceId);
  const environment = requireNonEmpty('environment', input.environment).toLowerCase();
  const adapter = requireNonEmpty('adapter', input.adapter);
  const authMethod = requireNonEmpty('authMethod', input.authMethod);
  const credentialRef = requireNonEmpty('credentialRef', input.credentialRef);
  if (!SAFE_ADAPTERS.has(adapter)) throw new Error('Adapter is not approved for safe enterprise connection proof.');
  if (!safeAuthReference(credentialRef)) throw new Error('credentialRef must be an opaque managed secret reference.');
  if (environment === 'production' && input.productionApproved !== true) {
    throw new Error('Production connection proof requires explicit approval.');
  }
  if (input.allowWrites === true) throw new Error('Safe connection proof cannot include write authority.');

  const capabilities = normalizeCapabilities(input.capabilities);
  const requestedSemanticScopes = normalizeCapabilities(input.requestedSemanticScopes);
  const dataProbeApproved = input.dataProbeApproved === true;
  const mappingVersion = Number.isInteger(input.mappingVersion) && input.mappingVersion >= 0 ? input.mappingVersion : 0;

  const configuration = {
    providerKey,
    sourceInstanceId,
    environment,
    adapter,
    authMethod,
    capabilities,
    requestedSemanticScopes,
    mappingVersion,
    allowWrites: false,
    dataProbeApproved
  };

  const steps = [
    { id: 'target-identity', purpose: 'Confirm the exact provider tenant/system and environment.', dataClass: 'metadata', required: true },
    { id: 'authentication', purpose: 'Confirm managed authentication works without exposing the credential.', dataClass: 'metadata', required: true },
    { id: 'capability-discovery', purpose: 'Confirm the supported read-only surfaces and limits.', dataClass: 'metadata', required: true },
    { id: 'latency-measurement', purpose: 'Measure connection latency from a safe read-only operation.', dataClass: 'metadata', required: true }
  ];

  if (dataProbeApproved) {
    steps.push({ id: 'bounded-data-read', purpose: 'Read only the minimum approved sample needed to validate mapping.', dataClass: 'approved-business-data', required: true, maxRecords: 10 });
  }

  return Object.freeze({
    schemaVersion: 1,
    configuration,
    configurationFingerprint: fingerprint(configuration),
    credentialFingerprint: sha256(credentialRef),
    recoveryProofRequired: RECOVERY_REQUIRED_ADAPTERS.has(adapter),
    automaticActivationAllowed: !NEVER_AUTOMATICALLY_ACTIVATE_ADAPTERS.has(adapter),
    steps
  });
}

function validateConnectionEvidence(plan, evidence = {}, options = {}) {
  if (!plan?.configurationFingerprint) throw new Error('A safe connection-test plan is required.');
  const observedAt = Date.parse(evidence.observedAt || '');
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : 15 * 60 * 1000;
  const reasons = [];

  if (evidence.configurationFingerprint !== plan.configurationFingerprint) reasons.push('configuration-changed');
  if (clean(evidence.providerKey) !== plan.configuration.providerKey) reasons.push('provider-mismatch');
  if (clean(evidence.sourceInstanceId) !== plan.configuration.sourceInstanceId) reasons.push('source-instance-mismatch');
  if (clean(evidence.environment).toLowerCase() !== plan.configuration.environment) reasons.push('environment-mismatch');
  if (evidence.readOnly !== true) reasons.push('read-only-not-proven');
  if (evidence.rawCredentialObserved === true) reasons.push('raw-credential-observed');
  if (evidence.employeeOrPayrollDataObserved === true && plan.configuration.dataProbeApproved !== true) reasons.push('unapproved-business-data-observed');
  if (evidence.latencyMs === null || evidence.latencyMs === undefined || evidence.latencyMs === '' || !Number.isFinite(Number(evidence.latencyMs)) || Number(evidence.latencyMs) < 0) reasons.push('latency-not-measured');
  if (!Number.isFinite(observedAt) || observedAt > nowMs + 60_000 || nowMs - observedAt > maxAgeMs) reasons.push('evidence-stale-or-invalid');

  const results = new Map(Array.isArray(evidence.steps) ? evidence.steps.map(step => [step.id, step]) : []);
  for (const step of plan.steps.filter(step => step.required)) {
    const result = results.get(step.id);
    if (!result || result.status !== 'PASS') reasons.push(`step-failed:${step.id}`);
  }

  return {
    status: reasons.length ? 'REJECTED' : (plan.configuration.dataProbeApproved ? 'CONNECTION_AND_SAMPLE_VERIFIED' : 'CONNECTION_VERIFIED'),
    reasons,
    configurationFingerprint: plan.configurationFingerprint,
    observedAt: Number.isFinite(observedAt) ? new Date(observedAt).toISOString() : null
  };
}

function evaluateActivation(input = {}, options = {}) {
  const reasons = [];
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const maxEvidenceAgeMs = Number.isFinite(options.maxEvidenceAgeMs) ? options.maxEvidenceAgeMs : 30 * 60 * 1000;
  const connection = input.connectionEvidence;
  const mapping = input.mappingApproval;
  const reconciliation = input.reconciliation;
  const activation = input.activationApproval;

  if (!connection || !['CONNECTION_AND_SAMPLE_VERIFIED', 'CONNECTION_VERIFIED'].includes(connection.status)) reasons.push('connection-not-verified');
  if (!mapping || mapping.status !== 'APPROVED' || !mapping.mappingFingerprint) reasons.push('mapping-not-approved');
  if (!activation || activation.status !== 'APPROVED') reasons.push('activation-not-approved');
  if (activation?.configurationFingerprint !== connection?.configurationFingerprint) reasons.push('activation-config-mismatch');
  if (activation?.mappingFingerprint !== mapping?.mappingFingerprint) reasons.push('activation-mapping-mismatch');

  const reconciledAt = Date.parse(reconciliation?.observedAt || '');
  if (!reconciliation || reconciliation.status !== 'PASS') reasons.push('reconciliation-not-passed');
  if (!Number.isFinite(reconciledAt) || reconciledAt > nowMs + 60_000 || nowMs - reconciledAt > maxEvidenceAgeMs) reasons.push('reconciliation-stale-or-invalid');
  if (reconciliation?.configurationFingerprint !== connection?.configurationFingerprint) reasons.push('reconciliation-config-mismatch');
  if (reconciliation?.mappingFingerprint !== mapping?.mappingFingerprint) reasons.push('reconciliation-mapping-mismatch');

  if (input.recoveryProofRequired === true) {
    if (!input.recoveryEvidence || input.recoveryEvidence.status !== 'PASS' || input.recoveryEvidence.sameOperationRecovered !== true || input.recoveryEvidence.reconciledAfterRecovery !== true) {
      reasons.push('recovery-not-proven');
    }
  }

  if (input.automaticActivationAllowed === false) reasons.push('manual-activation-required');

  return {
    status: reasons.length ? 'BLOCKED' : 'READY_FOR_ACTIVATION',
    reasons
  };
}

export {
  buildSafeConnectionTest,
  validateConnectionEvidence,
  evaluateActivation,
  fingerprint,
  safeAuthReference
};
