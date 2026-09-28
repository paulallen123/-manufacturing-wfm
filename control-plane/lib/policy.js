export const GATE_DEFINITIONS = Object.freeze([
  { id: 'pre_freeze', deps: [], lanes: ['github-actions', 'railway-proof-workers'] },
  { id: 'hosted_runtime', deps: ['pre_freeze'], lanes: ['railway-proof-workers', 'non-railway-verifier'] },
  { id: 'exact_source_binding', deps: ['hosted_runtime'], lanes: ['railway-proof-workers', 'github-actions'] },
  { id: 'golden_journey', deps: ['exact_source_binding'], lanes: ['railway-proof-workers'] },
  { id: 'autonomous_implementation', deps: ['exact_source_binding'], lanes: ['railway-proof-workers'] },
  { id: 'competency_training', deps: ['autonomous_implementation'], lanes: ['railway-proof-workers'] },
  { id: 'integrations', deps: ['exact_source_binding'], lanes: ['railway-proof-workers'] },
  { id: 'security', deps: ['exact_source_binding'], lanes: ['github-actions', 'railway-proof-workers'] },
  { id: 'autopilot_execute', deps: ['golden_journey', 'security'], lanes: ['railway-proof-workers'] },
  { id: 'autopilot_rollback', deps: ['autopilot_execute'], lanes: ['railway-proof-workers'] },
  { id: 'persistence_restart', deps: ['hosted_runtime'], lanes: ['railway-proof-workers'] },
  { id: 'stale_restore_tamper_recovery', deps: ['persistence_restart', 'security'], lanes: ['railway-proof-workers'] },
  { id: 'outcome_learning_runtime', deps: ['golden_journey'], lanes: ['railway-proof-workers'] },
  { id: 'northstar_assault', deps: ['exact_source_binding', 'security'], lanes: ['northstar-railway'] },
  { id: 'failure_domain_independence', deps: ['hosted_runtime'], lanes: ['non-railway-verifier'] },
  {
    id: 'customer_proof_authority',
    deps: [
      'golden_journey',
      'autonomous_implementation',
      'competency_training',
      'integrations',
      'security',
      'autopilot_execute',
      'autopilot_rollback',
      'persistence_restart',
      'stale_restore_tamper_recovery',
      'outcome_learning_runtime',
      'northstar_assault',
      'failure_domain_independence',
    ],
    lanes: [],
    derived: true,
    authority: 'customer-proof-staging',
  },
]);

export const LANE_DEFINITIONS = Object.freeze({
  'github-actions': {
    provider: 'github',
    failureDomainId: 'github-actions',
    enabled: true,
  },
  'railway-proof-workers': {
    provider: 'railway',
    failureDomainId: 'railway',
    enabled: true,
  },
  'northstar-railway': {
    provider: 'railway',
    failureDomainId: 'railway',
    enabled: true,
    note: 'Northstar currently shares the Railway runtime failure domain and does not count as independent resilience.',
  },
  'non-railway-verifier': {
    provider: 'external',
    failureDomainId: 'non-railway-verifier',
    enabled: false,
    note: 'Intentionally disabled until a genuinely separate verifier is configured and proven.',
  },
});

export const ALLOWED_RECEIPT_RESULTS = new Set(['PASS', 'FAIL', 'BLOCKED', 'PROVIDER_DEGRADED']);
export const ACTIVE_TASK_STATES = new Set(['QUEUED', 'RUNNING']);
export const TERMINAL_TASK_STATES = new Set(['PASS', 'FAIL', 'BLOCKED', 'PROVIDER_DEGRADED', 'REJECTED']);

export function getGateDefinition(gateId) {
  return GATE_DEFINITIONS.find((gate) => gate.id === gateId) ?? null;
}


export function uniqueFailureDomainIds(laneIds) {
  return [...new Set(
    laneIds
      .map((laneId) => LANE_DEFINITIONS[laneId]?.failureDomainId)
      .filter(Boolean),
  )];
}
