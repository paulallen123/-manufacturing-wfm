const REQUIREMENTS = Object.freeze({
  rest_api: ['endpoint_identity', 'non_mutating_request'],
  webhook: ['endpoint_identity', 'request_verification', 'replay_protection'],
  queue: ['endpoint_identity', 'checkpoint_or_ack_safety', 'replay_safe'],
  stream: ['endpoint_identity', 'checkpoint_or_ack_safety', 'replay_safe'],
  sftp: ['endpoint_identity', 'read_only_source', 'path_allowlist', 'stable_object_identity', 'complete_object_observed'],
  https_file: ['endpoint_identity', 'read_only_source', 'path_allowlist', 'stable_object_identity', 'complete_object_observed'],
  readonly_database: ['endpoint_identity', 'read_only_session', 'select_only_plan', 'consistent_read_snapshot', 'statement_timeout'],
  onprem_agent: ['agent_identity', 'outbound_only_channel', 'scope_allowlist'],
  ipaas: ['workspace_identity', 'read_only_flow', 'scope_allowlist'],
  identity: ['issuer_identity', 'metadata_only_probe', 'replay_protection']
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function transportSafetyRequirements(kind) {
  return [...(REQUIREMENTS[kind] || [])];
}

export function validateTransportSafetyEvidence(profile, result) {
  const errors = [];
  const kind = profile?.transport?.kind;
  const required = transportSafetyRequirements(kind);
  if (!required.length) return [`transport safety policy is not defined for ${kind || 'unknown transport'}`];

  const evidence = result?.transportSafety;
  if (!isObject(evidence)) return [`transport safety evidence is missing for ${kind}`];
  if (evidence.transportKind !== kind) errors.push('transport safety evidence does not match the requested transport');
  if (evidence.mutationObserved !== false) errors.push('transport safety proof did not show zero provider/source mutation');
  if (evidence.scopeExceeded !== false) errors.push('transport safety proof did not show that approved scope was preserved');

  const observed = new Set(Array.isArray(evidence.observedControls) ? evidence.observedControls : []);
  for (const control of required) {
    if (!observed.has(control)) errors.push(`transport safety proof is missing required control: ${control}`);
  }

  if (kind === 'readonly_database') {
    if (evidence.sessionReadOnly !== true) errors.push('read-only database proof must observe a read-only session');
    if (evidence.queryPlanClass !== 'select_only') errors.push('read-only database proof must use a select-only query plan');
    if (evidence.writeAttempted === true) errors.push('read-only database proof must not attempt a write');
    if (evidence.consistentReadSnapshotObserved !== true) errors.push('read-only database proof must use a consistent read snapshot');
    if (evidence.statementTimeoutObserved !== true) errors.push('read-only database proof must enforce a bounded statement timeout');
  }

  if (kind === 'sftp' || kind === 'https_file') {
    if (evidence.sourceObjectChanged !== false) errors.push('secure-file proof must show the source object was not changed');
    if (evidence.pathAllowlistObserved !== true) errors.push('secure-file proof must observe the approved path allowlist');
    if (evidence.stableObjectIdentityObserved !== true) errors.push('secure-file proof must bind reconciliation to a stable source-object identity');
    if (evidence.completeObjectObserved !== true) errors.push('secure-file proof must reject incomplete or still-changing source objects');
  }

  if (kind === 'onprem_agent') {
    if (evidence.inboundNetworkExposureObserved !== false) errors.push('on-prem agent proof must show no new inbound network exposure');
  }

  return errors;
}
