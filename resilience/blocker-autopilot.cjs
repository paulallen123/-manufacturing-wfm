'use strict';

const { createHash } = require('node:crypto');

const FAILURE_CLASSES = Object.freeze([
  'PROVIDER_DEGRADED',
  'CAPACITY_OR_QUEUE',
  'PRODUCT_DEFECT',
  'TEST_DEFECT',
  'EVIDENCE_OR_CATALOG_DRIFT',
  'PROOF_GUARD_DEFECT',
  'BRANCH_OR_CONVERGENCE_DRIFT',
  'PACKAGING_DEFECT',
  'CREDENTIAL_OR_SECRET',
  'EXTERNAL_DEPENDENCY',
  'STALE_PROOF',
  'UNKNOWN'
]);

const PROOF_STATES = Object.freeze([
  'PASS',
  'PRODUCT_FAIL',
  'INFRA_FAIL',
  'GUARD_FAIL',
  'NO_RUNNER',
  'SKIPPED',
  'CANCELLED',
  'STALE',
  'EXPIRED',
  'UNKNOWN'
]);

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function strings(input) {
  const values = [
    input?.message,
    input?.error,
    input?.reason,
    ...(Array.isArray(input?.messages) ? input.messages : [])
  ];
  return values.filter(Boolean).map(v => String(v)).join('\n');
}

function result({
  failureClass,
  proofState,
  retry,
  reroute,
  promotionBlocked = true,
  reason,
  deterministic = false,
  owner = 'platform',
  safeToContinueDevelopment = true
}) {
  if (!FAILURE_CLASSES.includes(failureClass)) throw new Error('Unknown blocker class.');
  if (!PROOF_STATES.includes(proofState)) throw new Error('Unknown proof state.');
  return Object.freeze({
    failureClass,
    proofState,
    retry,
    reroute,
    promotionBlocked,
    reason,
    deterministic,
    owner,
    safeToContinueDevelopment,
    productionMutation: false,
    productionAuthorityGranted: false,
    customerMutation: false
  });
}

function classifyObservation(input = {}) {
  const provider = String(input.provider || '').toLowerCase();
  const status = String(input.status || input.deploymentStatus || '').toUpperCase();
  const conclusion = String(input.conclusion || '').toLowerCase();
  const phase = String(input.phase || '').toLowerCase();
  const text = strings(input);
  const lower = text.toLowerCase();
  const steps = Array.isArray(input.steps) ? input.steps.length : Number(input.stepsExecuted || 0);
  const runnerId = Number(input.runnerId ?? input.runner_id ?? 0);
  const behind = Number(input.branchBehindCommits || 0);
  const driftLimit = Number(input.branchDriftLimit || 10);

  if (input.proofFresh === false || status === 'STALE' || status === 'EXPIRED') {
    return result({
      failureClass: 'STALE_PROOF',
      proofState: status === 'EXPIRED' ? 'EXPIRED' : 'STALE',
      retry: 'REPROVE_EXACT_CANDIDATE',
      reroute: true,
      reason: 'proof-does-not-bind-current-candidate',
      owner: 'release'
    });
  }

  if (behind > driftLimit || input.branchDiverged === true) {
    return result({
      failureClass: 'BRANCH_OR_CONVERGENCE_DRIFT',
      proofState: 'PRODUCT_FAIL',
      retry: 'SYNC_THEN_REPROVE',
      reroute: false,
      deterministic: true,
      reason: 'branch-drift-budget-exceeded',
      owner: 'development'
    });
  }

  if ((provider.includes('github') || input.kind === 'github-job') &&
      conclusion === 'failure' && steps === 0 && runnerId === 0) {
    return result({
      failureClass: 'PROVIDER_DEGRADED',
      proofState: 'NO_RUNNER',
      retry: 'BOUNDED_RETRY_ONCE_THEN_OPEN_CIRCUIT',
      reroute: true,
      reason: 'github-job-never-received-runner'
    });
  }

  if (status === 'SKIPPED' || conclusion === 'skipped') {
    return result({
      failureClass: 'CAPACITY_OR_QUEUE',
      proofState: 'SKIPPED',
      retry: 'DO_NOT_TREAT_AS_PROOF',
      reroute: true,
      reason: 'execution-skipped-no-evidence'
    });
  }

  if (/usage limit|quota exceeded|rate limit|no runner|runner_id\s*[=:]\s*0|provider unavailable/.test(lower)) {
    return result({
      failureClass: 'PROVIDER_DEGRADED',
      proofState: 'INFRA_FAIL',
      retry: 'BOUNDED_RETRY_WITH_BACKOFF',
      reroute: true,
      reason: 'provider-control-plane-degraded'
    });
  }

  if (/(scheduling build on metal builder|waiting for runner|\b(?:build|job|runner|deployment)\s+(?:is\s+)?queued\b|\bqueued for (?:runner|builder)\b)/.test(lower) &&
      input.productExecutionStarted !== true) {
    return result({
      failureClass: 'CAPACITY_OR_QUEUE',
      proofState: 'INFRA_FAIL',
      retry: 'OPEN_CIRCUIT_AFTER_BUDGET',
      reroute: true,
      reason: 'execution-capacity-not-obtained'
    });
  }

  if (/(401|403|unauthori[sz]ed|credential|secret|token expired|authentication failed)/i.test(text) &&
      input.expectedAuthFailure !== true) {
    return result({
      failureClass: 'CREDENTIAL_OR_SECRET',
      proofState: 'INFRA_FAIL',
      retry: 'STOP_RETRY_AND_ROTATE_OR_REAUTHORISE',
      reroute: input.alternateCredentialBoundaryAvailable === true,
      reason: 'credential-or-secret-boundary-failed',
      owner: 'security'
    });
  }

  if (/duplicate system id|testlevel|spec-verified|value\/data review|evidence.*missing|catalog|canonical.*mismatch|version.*mismatch|research overlay|protocol family/i.test(text)) {
    return result({
      failureClass: 'EVIDENCE_OR_CATALOG_DRIFT',
      proofState: 'PRODUCT_FAIL',
      retry: 'REPAIR_CANONICAL_SOURCE_ONCE_THEN_REGENERATE',
      reroute: false,
      deterministic: true,
      reason: 'typed-evidence-or-catalog-contract-drift',
      owner: 'integration'
    });
  }

  if (/enoent|fixture|expected.*selector|artifact is not defined|referenceerror|test fixture/i.test(text) &&
      (phase.includes('test') || lower.includes('/proof/') || lower.includes('/tmp/'))) {
    return result({
      failureClass: 'TEST_DEFECT',
      proofState: 'PRODUCT_FAIL',
      retry: 'FIX_TEST_OR_FIXTURE_THEN_REPROVE',
      reroute: false,
      deterministic: true,
      reason: 'test-harness-or-fixture-defect',
      owner: 'quality'
    });
  }

  if (/module_not_found|cannot find module|dockerfile|copy .* not found|build context|packag|provenance_mismatch/i.test(text)) {
    return result({
      failureClass: 'PACKAGING_DEFECT',
      proofState: 'PRODUCT_FAIL',
      retry: 'FIX_PACKAGE_GRAPH_THEN_REBUILD',
      reroute: false,
      deterministic: true,
      reason: 'candidate-packaging-or-provenance-defect',
      owner: 'platform'
    });
  }

  if (/assertionerror|err_assertion|not ok \d+|testcodefailure/i.test(text)) {
    const reproduced = Number(input.independentReproductions || 0) >= 2 || input.reproducedAcrossIndependentLanes === true;
    return result({
      failureClass: reproduced ? 'PRODUCT_DEFECT' : 'UNKNOWN',
      proofState: 'PRODUCT_FAIL',
      retry: reproduced ? 'DO_NOT_BLIND_RETRY' : 'RUN_ONE_INDEPENDENT_REPRODUCER',
      reroute: !reproduced,
      deterministic: reproduced,
      reason: reproduced ? 'deterministic-failure-reproduced-independently' : 'assertion-needs-independent-classification',
      owner: reproduced ? 'development' : 'platform'
    });
  }

  if (/dns|connection reset|timeout|temporary 5\d\d|upstream unavailable|dependency unavailable/i.test(text)) {
    return result({
      failureClass: 'EXTERNAL_DEPENDENCY',
      proofState: 'INFRA_FAIL',
      retry: 'BOUNDED_BACKOFF_AND_REROUTE_WHERE_EQUIVALENT',
      reroute: true,
      reason: 'external-dependency-unavailable'
    });
  }

  if (status === 'PASS' || conclusion === 'success') {
    return Object.freeze({
      failureClass: null,
      proofState: 'PASS',
      retry: 'NONE',
      reroute: false,
      promotionBlocked: false,
      reason: 'executed-proof-pass',
      deterministic: true,
      owner: null,
      safeToContinueDevelopment: true,
      productionMutation: false,
      productionAuthorityGranted: false,
      customerMutation: false
    });
  }

  return result({
    failureClass: 'UNKNOWN',
    proofState: 'UNKNOWN',
    retry: 'RUN_INDEPENDENT_REPRODUCER_AND_PRESERVE_EVIDENCE',
    reroute: true,
    reason: 'unclassified-blocker'
  });
}


function classifyWithBaseline(observation = {}, baseline = {}) {
  const initial = classifyObservation(observation);
  const candidateOverlayFiles = Number(baseline.candidateOverlayFiles);
  const canonicalOverlayFiles = Number(baseline.canonicalOverlayFiles);
  const declaredOverlayFloor = Number(baseline.declaredOverlayFloor);
  const sameRepositoryShape = Number.isFinite(candidateOverlayFiles) &&
    Number.isFinite(canonicalOverlayFiles) &&
    candidateOverlayFiles === canonicalOverlayFiles;
  const guardContradictsCanonicalBaseline = Number.isFinite(declaredOverlayFloor) &&
    Number.isFinite(canonicalOverlayFiles) &&
    declaredOverlayFloor > canonicalOverlayFiles;
  const capabilitySetPreserved = baseline.canonicalCapabilitySetPasses === true &&
    baseline.candidateCapabilitySetPasses === true;

  if (
    (initial.failureClass === 'EVIDENCE_OR_CATALOG_DRIFT' || initial.failureClass === 'UNKNOWN') &&
    capabilitySetPreserved &&
    sameRepositoryShape &&
    guardContradictsCanonicalBaseline
  ) {
    return result({
      failureClass: 'PROOF_GUARD_DEFECT',
      proofState: 'GUARD_FAIL',
      retry: 'FIX_GUARD_CONTRACT_THEN_REPROVE',
      reroute: false,
      deterministic: true,
      reason: 'proof-guard-requires-more-than-canonical-baseline',
      owner: 'quality',
      safeToContinueDevelopment: true
    });
  }

  return initial;
}

function createPreventionCandidate({ classification, observation, baseline = null }) {
  if (!classification?.failureClass) throw new Error('classification with failureClass required.');
  const proposedControl = classification.failureClass === 'PROOF_GUARD_DEFECT'
    ? 'prefer-effective-capability-set-over-repository-shape'
    : classification.failureClass === 'PROVIDER_DEGRADED' || classification.failureClass === 'CAPACITY_OR_QUEUE'
      ? 'persist-provider-fingerprint-and-bounded-reroute-envelope'
      : 'persist-fingerprint-and-add-regression-before-policy-change';

  const core = {
    schemaVersion: 1,
    contract: 'VECTOR_BLOCKER_PREVENTION_CANDIDATE_V1',
    failureClass: classification.failureClass,
    reason: classification.reason,
    observationDigest: digest(observation || {}),
    baselineDigest: baseline ? digest(baseline) : null,
    proposedControl,
    status: 'REVIEW_REQUIRED',
    autoApply: false,
    productionMutation: false,
    productionAuthorityGranted: false,
    customerMutation: false
  };
  return Object.freeze({ ...core, candidateDigest: digest(core) });
}

function laneEligible(lane, requiredScopes = []) {
  if (!(lane &&
    lane.exactSourceSha === true &&
    lane.requiredForDevelopment !== true &&
    lane.provider &&
    lane.id)) return false;
  const scopes = new Set(Array.isArray(lane.proofScopes) ? lane.proofScopes : []);
  return requiredScopes.every(scope => scopes.has(scope));
}

function selectAlternativeLane(policy, classification, observation = {}) {
  if (!classification?.reroute) return null;
  const failedProvider = String(observation.provider || '').toLowerCase();
  const requiredScopes = Array.isArray(observation.requiredProofScopes)
    ? [...new Set(observation.requiredProofScopes.map(String))]
    : [];
  const lanes = new Map((policy?.lanes || [])
    .filter(lane => laneEligible(lane, requiredScopes))
    .map(l => [l.id, l]));
  for (const id of policy?.fallbackOrder || []) {
    const lane = lanes.get(id);
    if (!lane) continue;
    if (String(lane.provider).toLowerCase() === failedProvider) continue;
    if (lane.class === 'supplemental') continue;
    return Object.freeze({
      laneId: lane.id,
      provider: lane.provider,
      class: lane.class,
      proofScopes: Object.freeze([...(lane.proofScopes || [])]),
      requiredProofScopes: Object.freeze(requiredScopes),
      runtimeMode: lane.runtimeMode || null,
      exactSourceSha: true,
      productionAuthorityGranted: false
    });
  }
  return null;
}


function normalizeFailureField(value = '') {
  return String(value)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b[a-f0-9]{7,64}\b/gi, '<sha>')
    .replace(/\bduration_ms\s*[:=]\s*\d+(?:\.\d+)?/gi, 'duration_ms=<duration>')
    .replace(/\b\d+(?:\.\d+)?\s*ms\b/gi, '<duration>')
    .replace(/:\d+:\d+\b/g, ':<line>:<column>')
    .replace(/\\/g, '/')
    .trim();
}

function failureFingerprint(failure = {}) {
  const identity = {
    testName: normalizeFailureField(failure.testName || failure.name || failure.id || ''),
    file: normalizeFailureField(failure.file || failure.path || ''),
    code: normalizeFailureField(failure.code || failure.errorCode || ''),
    signature: normalizeFailureField(failure.signature || failure.error || failure.reason || '')
  };
  if (!identity.testName && !identity.file && !identity.code && !identity.signature) {
    throw new Error('Failure identity requires at least one stable field.');
  }
  return digest(identity);
}

function attributeFailureProvenance({ candidateFailures = [], baselineFailures = [], candidateSourceSha, baselineSourceSha } = {}) {
  if (!/^[a-f0-9]{7,64}$/i.test(String(candidateSourceSha || ''))) throw new Error('candidateSourceSha required.');
  if (!/^[a-f0-9]{7,64}$/i.test(String(baselineSourceSha || ''))) throw new Error('baselineSourceSha required.');

  const enrich = failure => Object.freeze({
    ...failure,
    fingerprint: failureFingerprint(failure)
  });
  const candidate = candidateFailures.map(enrich);
  const baseline = baselineFailures.map(enrich);
  const candidateByFingerprint = new Map(candidate.map(f => [f.fingerprint, f]));
  const baselineByFingerprint = new Map(baseline.map(f => [f.fingerprint, f]));

  const inherited = candidate.filter(f => baselineByFingerprint.has(f.fingerprint));
  const candidateOnly = candidate.filter(f => !baselineByFingerprint.has(f.fingerprint));
  const baselineResolved = baseline.filter(f => !candidateByFingerprint.has(f.fingerprint));

  let state = 'PASS';
  if (candidateOnly.length > 0) state = 'CANDIDATE_REGRESSION';
  else if (inherited.length > 0 && baselineResolved.length > 0) state = 'INHERITED_WITH_BASELINE_IMPROVEMENT';
  else if (inherited.length > 0) state = 'INHERITED_BASELINE_FAILURES';
  else if (baselineResolved.length > 0) state = 'BASELINE_FAILURES_RESOLVED';

  return Object.freeze({
    contract: 'VECTOR_FAILURE_PROVENANCE_V1',
    state,
    candidateSourceSha: String(candidateSourceSha).toLowerCase(),
    baselineSourceSha: String(baselineSourceSha).toLowerCase(),
    candidateFailureCount: candidate.length,
    baselineFailureCount: baseline.length,
    inheritedFailureCount: inherited.length,
    candidateRegressionCount: candidateOnly.length,
    baselineResolvedCount: baselineResolved.length,
    inheritedFingerprints: Object.freeze(inherited.map(f => f.fingerprint).sort()),
    candidateRegressionFingerprints: Object.freeze(candidateOnly.map(f => f.fingerprint).sort()),
    baselineResolvedFingerprints: Object.freeze(baselineResolved.map(f => f.fingerprint).sort()),
    candidateCausal: candidateOnly.length > 0,
    promotionBlocked: candidate.length > 0,
    featureScopeMayContinue: candidateOnly.length === 0,
    productionMutation: false,
    productionAuthorityGranted: false,
    customerMutation: false
  });
}

function groupFailureBatch(observations = []) {
  const groups = new Map();
  for (const observation of observations) {
    const classification = classifyObservation(observation);
    const material = {
      failureClass: classification.failureClass,
      reason: classification.reason,
      normalized: strings(observation)
        .replace(/[a-f0-9]{7,64}/gi, '<sha>')
        .replace(/\b\d{3,}\b/g, '<n>')
        .slice(0, 2000)
    };
    const fingerprint = digest(material);
    const current = groups.get(fingerprint) || {
      fingerprint,
      failureClass: classification.failureClass,
      reason: classification.reason,
      count: 0,
      observations: []
    };
    current.count += 1;
    current.observations.push(observation);
    groups.set(fingerprint, current);
  }
  return [...groups.values()].sort((a,b) => b.count - a.count || a.fingerprint.localeCompare(b.fingerprint));
}

function fiveMinutePlan(classification, alternateLane) {
  return Object.freeze({
    first30Seconds: [
      'capture immutable candidate and failure evidence',
      'classify provider/product/test/evidence/branch/packaging state',
      'never translate SKIPPED or NO_RUNNER into PASS'
    ],
    byTwoMinutes: classification.reroute
      ? [
          alternateLane ? 'dispatch exact candidate to equivalent proof lane ' + alternateLane.laneId : 'no equivalent proof lane: preserve evidence and keep only the uncovered scope blocked',
          'open bounded circuit on impaired provider after retry budget',
          'continue unrelated development'
        ]
      : [
          'reproduce deterministic failure once if not already independently proven',
          'assign owning subsystem from classification',
          'prepare minimal bounded repair'
        ],
    byFiveMinutes: [
      'verify an executable proof path is active or explicitly record NO_EXECUTION_LANE',
      'batch same-root-cause failures before another expensive build',
      'escalate only unresolved authority/security/zero-lane conditions',
      'keep production promotion fail-closed'
    ]
  });
}

function createBlockerReceipt({ candidateId, sourceSha, observation, classification, alternateLane, at = new Date().toISOString() }) {
  if (!/^[a-f0-9]{7,64}$/i.test(String(sourceSha || ''))) throw new Error('sourceSha required.');
  if (!/^[a-f0-9]{64}$/i.test(String(candidateId || ''))) throw new Error('candidateId SHA-256 required.');
  const core = {
    schemaVersion: 1,
    contract: 'VECTOR_BLOCKER_AUTOPILOT_RECEIPT_V1',
    candidateId: String(candidateId).toLowerCase(),
    sourceSha: String(sourceSha).toLowerCase(),
    at,
    observationDigest: digest(observation || {}),
    classification,
    alternateLane: alternateLane || null,
    safeTerminal: true,
    productionMutation: false,
    productionAuthorityGranted: false,
    customerMutation: false
  };
  return Object.freeze({ ...core, receiptDigest: digest(core) });
}

module.exports = Object.freeze({
  FAILURE_CLASSES,
  PROOF_STATES,
  canonical,
  digest,
  classifyObservation,
  classifyWithBaseline,
  createPreventionCandidate,
  failureFingerprint,
  attributeFailureProvenance,
  selectAlternativeLane,
  groupFailureBatch,
  fiveMinutePlan,
  createBlockerReceipt
});
