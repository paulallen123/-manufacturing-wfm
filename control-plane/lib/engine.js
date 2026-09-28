import crypto from 'node:crypto';
import {
  ACTIVE_TASK_STATES,
  ALLOWED_RECEIPT_RESULTS,
  GATE_DEFINITIONS,
  LANE_DEFINITIONS,
  getGateDefinition,
} from './policy.js';

export const CANDIDATE_IDENTITY_FIELDS = Object.freeze([
  'repository',
  'ref',
  'commitSha',
  'deploymentId',
  'runtimeSha',
  'releaseId',
  'environment',
  'provider',
  'failureDomainId',
  'claimBoundary',
]);

function clone(value) {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

function digest(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

export function validateCandidateIdentity(identity) {
  if (!identity || typeof identity !== 'object') {
    return { ok: false, reason: 'CANDIDATE_IDENTITY_MISSING', missingFields: [...CANDIDATE_IDENTITY_FIELDS] };
  }
  const missingFields = CANDIDATE_IDENTITY_FIELDS.filter((field) => {
    const value = identity[field];
    return typeof value !== 'string' || value.trim() === '';
  });
  if (missingFields.length > 0) {
    return { ok: false, reason: 'CANDIDATE_IDENTITY_INCOMPLETE', missingFields };
  }
  if (identity.commitSha !== identity.runtimeSha) {
    return { ok: false, reason: 'SOURCE_RUNTIME_SHA_MISMATCH', commitSha: identity.commitSha, runtimeSha: identity.runtimeSha };
  }
  if (identity.claimBoundary !== 'customer-proof-staging') {
    return { ok: false, reason: 'UNSUPPORTED_CLAIM_BOUNDARY', claimBoundary: identity.claimBoundary };
  }
  return { ok: true };
}

export function candidateToken(identity) {
  return digest(CANDIDATE_IDENTITY_FIELDS.map((field) => String(identity[field] ?? ''))).slice(0, 40);
}

export function identitiesMatch(expected, observed) {
  if (!expected || !observed) return false;
  return CANDIDATE_IDENTITY_FIELDS.every((field) => String(expected[field] ?? '') === String(observed[field] ?? ''));
}

export function createInitialState(candidate) {
  const validation = validateCandidateIdentity(candidate);
  if (!validation.ok) {
    const details = validation.missingFields?.length ? `: ${validation.missingFields.join(',')}` : '';
    throw new Error(`${validation.reason}${details}`);
  }

  const gates = Object.fromEntries(
    GATE_DEFINITIONS.map((definition) => [
      definition.id,
      {
        id: definition.id,
        state: 'UNPROVEN',
        latestReceiptId: null,
        latestReceiptSequence: -1,
        blockingReason: null,
        lastEvidenceDigest: null,
        attempt: 0,
      },
    ]),
  );

  return {
    schemaVersion: 2,
    mode: 'SHADOW',
    candidate: clone(candidate),
    candidateToken: candidateToken(candidate),
    gates,
    tasks: {},
    providerHealth: {},
    seenEventIds: [],
    rejectedReceipts: [],
    audit: [],
    breaches: [],
    retention: {
      cleanupRequested: false,
      cleanupAllowed: false,
      violations: [],
    },
    lastEvent: null,
    updatedAt: nowIso(),
  };
}

function appendAudit(state, entry) {
  state.audit.push({ at: nowIso(), ...entry });
  if (state.audit.length > 500) state.audit = state.audit.slice(-500);
}

function rememberEvent(state, eventId) {
  state.seenEventIds.push(eventId);
  if (state.seenEventIds.length > 5000) state.seenEventIds = state.seenEventIds.slice(-5000);
}

function dependenciesPass(state, gateId) {
  const definition = getGateDefinition(gateId);
  if (!definition) return false;
  return definition.deps.every((dep) => state.gates[dep]?.state === 'PASS');
}

function activeTaskForGate(state, gateId) {
  return Object.values(state.tasks).find((task) => task.gateId === gateId && ACTIVE_TASK_STATES.has(task.status));
}

function selectLane(state, definition, excludedFailureDomainId = null) {
  const admitted = definition.lanes
    .map((laneId) => {
      const lane = LANE_DEFINITIONS[laneId];
      if (!lane?.enabled) return null;
      if (state.providerHealth[lane.provider]?.state === 'DEGRADED') return null;
      return { laneId, ...lane };
    })
    .filter(Boolean);
  return admitted.find((lane) => lane.failureDomainId !== excludedFailureDomainId) ?? admitted[0] ?? null;
}

function createProofTask(state, gateId, lane, kind = 'proof') {
  const gate = state.gates[gateId];
  const attempt = Number(gate.attempt ?? 0) + 1;
  gate.attempt = attempt;
  const idempotencyKey = digest([
    state.candidateToken,
    gateId,
    kind,
    lane.laneId,
    String(attempt),
  ]);
  const task = {
    taskId: `task_${idempotencyKey.slice(0, 24)}`,
    candidateToken: state.candidateToken,
    candidateSha: state.candidate.commitSha,
    gateId,
    taskKind: kind,
    targetDeploymentId: state.candidate.deploymentId,
    targetRuntimeSha: state.candidate.runtimeSha,
    failureDomainId: lane.failureDomainId,
    provider: lane.provider,
    laneId: lane.laneId,
    idempotencyKey,
    attempt,
    status: 'QUEUED',
    createdAt: nowIso(),
    retentionToken: state.candidateToken,
    exactCandidate: clone(state.candidate),
  };
  state.tasks[idempotencyKey] = task;
  appendAudit(state, { type: 'TASK_QUEUED', gateId, taskId: task.taskId, laneId: lane.laneId, kind });
  return task;
}

function closeBoundTask(state, task, terminalState) {
  const current = state.tasks[task.idempotencyKey];
  if (!current) return;
  current.status = terminalState;
  current.completedAt = nowIso();
}

function boundTaskForReceipt(state, gate, receipt) {
  if (!receipt.idempotencyKey || !receipt.taskId) return { ok: false, reason: 'MISSING_TASK_BINDING' };
  const task = state.tasks[receipt.idempotencyKey];
  if (!task || task.taskId !== receipt.taskId) return { ok: false, reason: 'UNKNOWN_TASK_BINDING' };
  if (task.gateId !== gate.id || task.candidateToken !== state.candidateToken) return { ok: false, reason: 'TASK_GATE_OR_CANDIDATE_MISMATCH' };
  if (!ACTIVE_TASK_STATES.has(task.status)) return { ok: false, reason: 'TASK_NOT_ACTIVE' };
  const lane = receipt.proofLane;
  if (!lane || lane.laneId !== task.laneId || lane.provider !== task.provider || lane.failureDomainId !== task.failureDomainId) {
    return { ok: false, reason: 'PROOF_LANE_MISMATCH' };
  }
  if (task.targetDeploymentId !== state.candidate.deploymentId || task.targetRuntimeSha !== state.candidate.runtimeSha) {
    return { ok: false, reason: 'TASK_TARGET_DRIFT' };
  }
  return { ok: true, task };
}

function markAcceptedReceipt(gate, receipt, sequence) {
  gate.latestReceiptSequence = sequence;
  gate.latestReceiptId = receipt.receiptId;
  gate.lastEvidenceDigest = receipt.evidenceDigest;
}

function rejectReceipt(state, gate, receipt, reason) {
  state.rejectedReceipts.push({
    receiptId: receipt.receiptId ?? null,
    gateId: receipt.gateId ?? gate?.id ?? null,
    reason,
    at: nowIso(),
  });
  if (state.rejectedReceipts.length > 500) state.rejectedReceipts = state.rejectedReceipts.slice(-500);
  appendAudit(state, { type: 'RECEIPT_REJECTED', gateId: gate?.id ?? receipt.gateId, reason, receiptId: receipt.receiptId });
}

function processReceipt(state, receipt, emittedTasks) {
  const gate = state.gates[receipt.gateId];
  if (!gate) {
    rejectReceipt(state, null, receipt, 'UNKNOWN_GATE');
    return;
  }
  if (!ALLOWED_RECEIPT_RESULTS.has(receipt.result)) {
    rejectReceipt(state, gate, receipt, 'INVALID_RESULT');
    return;
  }
  if (!identitiesMatch(state.candidate, receipt.candidate)) {
    rejectReceipt(state, gate, receipt, 'EXACT_CANDIDATE_MISMATCH');
    return;
  }
  const sequence = Number(receipt.sequence);
  if (!Number.isInteger(sequence) || sequence < 0) {
    rejectReceipt(state, gate, receipt, 'INVALID_SEQUENCE');
    return;
  }
  if (sequence <= gate.latestReceiptSequence) {
    rejectReceipt(state, gate, receipt, 'STALE_RECEIPT');
    return;
  }
  if (!receipt.receiptId || !receipt.evidenceDigest) {
    rejectReceipt(state, gate, receipt, 'MISSING_PROVENANCE');
    return;
  }
  const binding = boundTaskForReceipt(state, gate, receipt);
  if (!binding.ok) {
    rejectReceipt(state, gate, receipt, binding.reason);
    return;
  }
  const task = binding.task;
  if (receipt.result === 'PASS' && receipt.applicationState !== 'PASS') {
    closeBoundTask(state, task, 'REJECTED');
    rejectReceipt(state, gate, receipt, 'FALSE_GREEN_PROVIDER_STATUS');
    return;
  }
  if (receipt.result === 'FAIL' && receipt.applicationState !== 'FAIL') {
    closeBoundTask(state, task, 'REJECTED');
    rejectReceipt(state, gate, receipt, 'FAIL_WITHOUT_TERMINAL_APPLICATION_FAIL');
    return;
  }
  markAcceptedReceipt(gate, receipt, sequence);
  if (receipt.result === 'PASS') {
    closeBoundTask(state, task, 'PASS');
    gate.state = 'PASS';
    gate.blockingReason = null;
    appendAudit(state, { type: 'GATE_PASS', gateId: gate.id, receiptId: receipt.receiptId, taskId: task.taskId });
    return;
  }
  if (receipt.result === 'FAIL') {
    closeBoundTask(state, task, 'FAIL');
    gate.state = 'FAIL';
    gate.blockingReason = 'PRODUCT_ASSERTION_FAILED_AWAITING_REPAIR_REGRESSION';
    appendAudit(state, { type: 'GATE_FAIL', gateId: gate.id, receiptId: receipt.receiptId, taskId: task.taskId });
    const definition = getGateDefinition(gate.id);
    const repairLane = definition ? selectLane(state, definition, task.failureDomainId) : null;
    if (repairLane) emittedTasks.push(createProofTask(state, gate.id, repairLane, 'repair_regression'));
    return;
  }
  if (receipt.result === 'BLOCKED') {
    closeBoundTask(state, task, 'BLOCKED');
    gate.state = 'BLOCKED';
    gate.blockingReason = receipt.blockingReason || 'EXPLICIT_SAFETY_OR_EVIDENCE_BLOCK';
    appendAudit(state, { type: 'GATE_BLOCKED', gateId: gate.id, reason: gate.blockingReason, taskId: task.taskId });
    return;
  }
  if (receipt.result === 'PROVIDER_DEGRADED') {
    closeBoundTask(state, task, 'PROVIDER_DEGRADED');
    state.providerHealth[task.provider] = { state: 'DEGRADED', at: nowIso(), reason: receipt.blockingReason || 'PROOF_LANE_PREEXECUTION_FAILURE' };
    gate.state = 'UNPROVEN';
    gate.blockingReason = null;
    appendAudit(state, { type: 'PROVIDER_DEGRADED', provider: task.provider, gateId: gate.id, taskId: task.taskId });
  }
}

function scheduleRunnable(state, emittedTasks) {
  for (const definition of GATE_DEFINITIONS) {
    const gate = state.gates[definition.id];
    if (!gate || gate.state !== 'UNPROVEN') continue;
    if (!dependenciesPass(state, definition.id)) continue;
    if (activeTaskForGate(state, definition.id)) continue;

    if (definition.derived) {
      if (definition.authority !== state.candidate.claimBoundary) {
        gate.state = 'BLOCKED';
        gate.blockingReason = 'CLAIM_BOUNDARY_AUTHORITY_MISMATCH';
        appendAudit(state, { type: 'GATE_BLOCKED', gateId: gate.id, reason: gate.blockingReason });
        continue;
      }
      gate.state = 'PASS';
      gate.blockingReason = null;
      gate.latestReceiptId = 'derived:policy';
      gate.lastEvidenceDigest = digest([
        state.candidateToken,
        definition.id,
        ...definition.deps.map((dep) => state.gates[dep]?.lastEvidenceDigest ?? dep),
      ]);
      appendAudit(state, { type: 'DERIVED_AUTHORITY_PASS', gateId: gate.id, authority: definition.authority });
      continue;
    }

    const lane = selectLane(state, definition);
    if (!lane) {
      gate.state = 'BLOCKED';
      gate.blockingReason = 'NO_ADMITTED_HEALTHY_FAILURE_DOMAIN';
      appendAudit(state, { type: 'GATE_BLOCKED', gateId: gate.id, reason: gate.blockingReason });
      continue;
    }
    emittedTasks.push(createProofTask(state, definition.id, lane));
  }
}

export function checkNoIdleInvariant(state) {
  const openGates = Object.values(state.gates).filter((gate) => gate.state !== 'PASS');
  if (openGates.length === 0) return { ok: true, code: null };

  const activeTasks = Object.values(state.tasks).filter((task) => ACTIVE_TASK_STATES.has(task.status));
  if (activeTasks.length > 0) return { ok: true, code: null };

  const everyOpenGateExplicitlyBlocked = openGates.every((gate) => Boolean(gate.blockingReason));
  if (everyOpenGateExplicitlyBlocked) return { ok: true, code: null };

  return { ok: false, code: 'ORCHESTRATION_INVARIANT_BREACH' };
}

function enforceRetention(state) {
  const unfinished = Object.values(state.gates).filter((gate) => gate.id !== 'production_authority' && gate.state !== 'PASS');
  const activeTasks = Object.values(state.tasks).filter((task) => ACTIVE_TASK_STATES.has(task.status));
  if (state.retention.cleanupRequested && (unfinished.length > 0 || activeTasks.length > 0)) {
    const violation = {
      code: 'FROZEN_TARGET_RETENTION_VIOLATION',
      unfinishedGates: unfinished.map((gate) => gate.id),
      activeTaskCount: activeTasks.length,
      at: nowIso(),
    };
    state.retention.cleanupAllowed = false;
    state.retention.violations.push(violation);
    state.breaches.push(violation);
    appendAudit(state, { type: 'RETENTION_VIOLATION', ...violation });
    return;
  }
  if (state.retention.cleanupRequested) state.retention.cleanupAllowed = true;
}

export function applyControlEvent(inputState, event) {
  const state = clone(inputState);
  const emittedTasks = [];

  if (!event?.eventId || !event?.type) {
    throw new Error('Control event requires eventId and type');
  }
  if (event.candidateToken && event.candidateToken !== state.candidateToken) {
    appendAudit(state, { type: 'EVENT_REJECTED', eventId: event.eventId, reason: 'CANDIDATE_TOKEN_MISMATCH' });
    return { state, emittedTasks, rejected: true, reason: 'CANDIDATE_TOKEN_MISMATCH' };
  }
  if (state.seenEventIds.includes(event.eventId)) {
    appendAudit(state, { type: 'DUPLICATE_EVENT_IGNORED', eventId: event.eventId });
    return { state, emittedTasks, duplicate: true };
  }

  rememberEvent(state, event.eventId);
  state.lastEvent = { eventId: event.eventId, type: event.type, at: nowIso() };

  switch (event.type) {
    case 'CANDIDATE_STARTED':
      appendAudit(state, { type: 'CANDIDATE_STARTED', eventId: event.eventId });
      break;
    case 'PROOF_RECEIPT':
      processReceipt(state, event.receipt || {}, emittedTasks);
      break;
    case 'TASK_STARTED': {
      const task = state.tasks[event.idempotencyKey];
      if (task && task.status === 'QUEUED') {
        task.status = 'RUNNING';
        task.startedAt = nowIso();
        appendAudit(state, { type: 'TASK_STARTED', taskId: task.taskId, gateId: task.gateId });
      }
      break;
    }
    case 'PROVIDER_DEGRADED': {
      const provider = event.provider;
      state.providerHealth[provider] = { state: 'DEGRADED', at: nowIso(), reason: event.reason || 'PROVIDER_DEGRADED' };
      for (const task of Object.values(state.tasks)) {
        if (task.provider === provider && ACTIVE_TASK_STATES.has(task.status)) {
          task.status = 'PROVIDER_DEGRADED';
          task.completedAt = nowIso();
        }
      }
      appendAudit(state, { type: 'PROVIDER_DEGRADED', provider, reason: event.reason || null });
      break;
    }
    case 'PROVIDER_RECOVERED': {
      const provider = event.provider;
      state.providerHealth[provider] = { state: 'HEALTHY', at: nowIso() };
      for (const gate of Object.values(state.gates)) {
        if (gate.state === 'BLOCKED' && gate.blockingReason === 'NO_ADMITTED_HEALTHY_FAILURE_DOMAIN') {
          gate.state = 'UNPROVEN';
          gate.blockingReason = null;
        }
      }
      appendAudit(state, { type: 'PROVIDER_RECOVERED', provider });
      break;
    }
    case 'REOPEN_GATE': {
      const gate = state.gates[event.gateId];
      if (gate && ['FAIL', 'BLOCKED'].includes(gate.state)) {
        gate.state = 'UNPROVEN';
        gate.blockingReason = null;
        appendAudit(state, { type: 'GATE_REOPENED', gateId: gate.id, regressionCaseId: event.regressionCaseId || null });
      }
      break;
    }
    case 'CLEANUP_REQUEST':
      state.retention.cleanupRequested = true;
      appendAudit(state, { type: 'CLEANUP_REQUEST' });
      break;
    case 'PROVIDER_STATUS':
      appendAudit(state, {
        type: 'PROVIDER_STATUS_METADATA',
        provider: event.provider,
        status: event.status,
        note: 'Provider status is metadata only and cannot satisfy a gate.',
      });
      break;
    default:
      appendAudit(state, { type: 'EVENT_REJECTED', eventId: event.eventId, reason: 'UNKNOWN_EVENT_TYPE' });
      return { state, emittedTasks, rejected: true, reason: 'UNKNOWN_EVENT_TYPE' };
  }

  scheduleRunnable(state, emittedTasks);
  enforceRetention(state);

  const invariant = checkNoIdleInvariant(state);
  if (!invariant.ok) {
    const breach = { code: invariant.code, at: nowIso(), lastEvent: state.lastEvent };
    state.breaches.push(breach);
    appendAudit(state, { type: invariant.code });
  }

  state.updatedAt = nowIso();
  return { state, emittedTasks, invariant };
}
