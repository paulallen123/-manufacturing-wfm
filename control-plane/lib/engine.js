import crypto from 'node:crypto';
import {
  ACTIVE_TASK_STATES,
  ALLOWED_RECEIPT_RESULTS,
  GATE_DEFINITIONS,
  LANE_DEFINITIONS,
  getGateDefinition,
} from './policy.js';
import { validateCandidateIdentity } from './candidate-binding.js';

const CANDIDATE_IDENTITY_FIELDS = [
  'repository',
  'ref',
  'commitSha',
  'projectId',
  'serviceId',
  'deploymentId',
  'runtimeSha',
  'releaseId',
  'publicOrigin',
  'environment',
  'provider',
  'failureDomainId',
];

function clone(value) {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

function digest(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

export function candidateToken(identity) {
  return digest(CANDIDATE_IDENTITY_FIELDS.map((field) => String(identity[field] ?? ''))).slice(0, 40);
}

export function identitiesMatch(expected, observed) {
  return CANDIDATE_IDENTITY_FIELDS.every((field) => String(expected[field] ?? '') === String(observed[field] ?? ''));
}

export function createInitialState(candidate) {
  const validation = validateCandidateIdentity(candidate);
  if (!validation.ok) throw new Error(`INVALID_CANDIDATE_IDENTITY:${validation.errors.join(',')}`);
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
    schemaVersion: 1,
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

function selectLane(state, definition) {
  for (const laneId of definition.lanes) {
    const lane = LANE_DEFINITIONS[laneId];
    if (!lane?.enabled) continue;
    const providerState = state.providerHealth[lane.provider]?.state;
    if (providerState === 'DEGRADED') continue;
    return { laneId, ...lane };
  }
  return null;
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

function closeActiveTasksForGate(state, gateId, terminalState, proofLane = null) {
  for (const task of Object.values(state.tasks)) {
    if (task.gateId !== gateId || !ACTIVE_TASK_STATES.has(task.status)) continue;
    if (proofLane && task.laneId !== proofLane) continue;
    task.status = terminalState;
    task.completedAt = nowIso();
  }
}

function validateProofLane(state, gate, receipt) {
  const definition = getGateDefinition(gate.id);
  const laneId = receipt.proofLane?.laneId;
  const lane = laneId ? LANE_DEFINITIONS[laneId] : null;
  if (!laneId) return { ok: false, reason: 'MISSING_PROOF_LANE' };
  if (!definition?.lanes.includes(laneId) || !lane?.enabled) return { ok: false, reason: 'UNADMITTED_PROOF_LANE' };
  if (receipt.proofLane.provider && receipt.proofLane.provider !== lane.provider) {
    return { ok: false, reason: 'PROOF_LANE_PROVIDER_MISMATCH' };
  }
  if (receipt.proofLane.failureDomainId && receipt.proofLane.failureDomainId !== lane.failureDomainId) {
    return { ok: false, reason: 'PROOF_LANE_FAILURE_DOMAIN_MISMATCH' };
  }
  const activeTask = Object.values(state.tasks).find(
    (task) => task.gateId === gate.id && task.laneId === laneId && ACTIVE_TASK_STATES.has(task.status),
  );
  if (!activeTask) return { ok: false, reason: 'NO_ACTIVE_PROOF_TASK' };
  return { ok: true, lane, activeTask };
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

  const laneValidation = validateProofLane(state, gate, receipt);
  if (!laneValidation.ok) {
    rejectReceipt(state, gate, receipt, laneValidation.reason);
    return;
  }
  if (receipt.result === 'PASS' && !dependenciesPass(state, gate.id)) {
    rejectReceipt(state, gate, receipt, 'DEPENDENCIES_NOT_PROVEN');
    return;
  }
  if (gate.id === 'production_authority' && state.mode !== 'AUTHORITATIVE') {
    rejectReceipt(state, gate, receipt, 'RELEASE_AUTHORITY_DISABLED_IN_SHADOW');
    return;
  }

  gate.latestReceiptSequence = sequence;
  gate.latestReceiptId = receipt.receiptId;
  gate.lastEvidenceDigest = receipt.evidenceDigest;

  if (receipt.result === 'PASS' && receipt.applicationState !== 'PASS') {
    closeActiveTasksForGate(state, gate.id, 'REJECTED', receipt.proofLane?.laneId ?? null);
    gate.state = 'UNPROVEN';
    gate.blockingReason = 'NO_TERMINAL_APPLICATION_PASS';
    rejectReceipt(state, gate, receipt, 'FALSE_GREEN_PROVIDER_STATUS');
    return;
  }

  if (receipt.result === 'PASS') {
    closeActiveTasksForGate(state, gate.id, 'PASS', receipt.proofLane?.laneId ?? null);
    gate.state = 'PASS';
    gate.blockingReason = null;
    appendAudit(state, { type: 'GATE_PASS', gateId: gate.id, receiptId: receipt.receiptId });
    return;
  }

  if (receipt.result === 'FAIL') {
    closeActiveTasksForGate(state, gate.id, 'FAIL', receipt.proofLane?.laneId ?? null);
    gate.state = 'FAIL';
    gate.blockingReason = 'PRODUCT_ASSERTION_FAILED_AWAITING_REPAIR_REGRESSION';
    appendAudit(state, { type: 'GATE_FAIL', gateId: gate.id, receiptId: receipt.receiptId });
    const repairLane = selectLane(state, { lanes: ['github-actions', 'railway-proof-workers'] });
    if (repairLane) emittedTasks.push(createProofTask(state, gate.id, repairLane, 'repair_regression'));
    return;
  }

  if (receipt.result === 'BLOCKED') {
    closeActiveTasksForGate(state, gate.id, 'BLOCKED', receipt.proofLane?.laneId ?? null);
    gate.state = 'BLOCKED';
    gate.blockingReason = receipt.blockingReason || 'EXPLICIT_SAFETY_OR_EVIDENCE_BLOCK';
    appendAudit(state, { type: 'GATE_BLOCKED', gateId: gate.id, reason: gate.blockingReason });
    return;
  }

  if (receipt.result === 'PROVIDER_DEGRADED') {
    closeActiveTasksForGate(state, gate.id, 'PROVIDER_DEGRADED', receipt.proofLane?.laneId ?? null);
    const provider = receipt.proofLane?.provider || receipt.provider;
    if (provider) {
      state.providerHealth[provider] = { state: 'DEGRADED', at: nowIso(), reason: receipt.blockingReason || 'PROOF_LANE_PREEXECUTION_FAILURE' };
    }
    gate.state = 'UNPROVEN';
    gate.blockingReason = null;
    appendAudit(state, { type: 'PROVIDER_DEGRADED', provider, gateId: gate.id });
  }
}

function reconcileDependencyBlocks(state) {
  for (const definition of GATE_DEFINITIONS) {
    const gate = state.gates[definition.id];
    if (!gate || gate.state === 'PASS' || activeTaskForGate(state, definition.id)) continue;

    const blockingDependency = definition.deps.find((dep) => ['FAIL', 'BLOCKED'].includes(state.gates[dep]?.state));
    if (blockingDependency) {
      if (gate.state === 'UNPROVEN' || String(gate.blockingReason || '').startsWith('DEPENDENCY_BLOCKED:')) {
        gate.state = 'BLOCKED';
        gate.blockingReason = `DEPENDENCY_BLOCKED:${blockingDependency}`;
      }
      continue;
    }

    if (gate.state === 'BLOCKED' && String(gate.blockingReason || '').startsWith('DEPENDENCY_BLOCKED:') && dependenciesPass(state, definition.id)) {
      gate.state = 'UNPROVEN';
      gate.blockingReason = null;
    }
  }
}

function scheduleRunnable(state, emittedTasks) {
  for (const definition of GATE_DEFINITIONS) {
    const gate = state.gates[definition.id];
    if (!gate || gate.state !== 'UNPROVEN') continue;
    if (!dependenciesPass(state, definition.id)) continue;
    if (activeTaskForGate(state, definition.id)) continue;

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

function acceptProviderEvent(state, event, nextState) {
  const provider = event.provider;
  const sequence = Number(event.sequence);
  if (!provider || !Number.isInteger(sequence) || sequence < 0) {
    appendAudit(state, {
      type: 'EVENT_REJECTED',
      eventId: event.eventId,
      provider: provider || null,
      reason: 'INVALID_PROVIDER_EVENT_SEQUENCE',
    });
    return false;
  }
  const previousSequence = Number(state.providerHealth[provider]?.sequence ?? -1);
  if (sequence <= previousSequence) {
    appendAudit(state, {
      type: 'STALE_PROVIDER_EVENT_REJECTED',
      eventId: event.eventId,
      provider,
      sequence,
      previousSequence,
    });
    return false;
  }
  state.providerHealth[provider] = {
    ...nextState,
    sequence,
    at: nowIso(),
  };
  return true;
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
      if (!acceptProviderEvent(state, event, { state: 'DEGRADED', reason: event.reason || 'PROVIDER_DEGRADED' })) break;
      for (const task of Object.values(state.tasks)) {
        if (task.provider === provider && ACTIVE_TASK_STATES.has(task.status)) {
          task.status = 'PROVIDER_DEGRADED';
          task.completedAt = nowIso();
        }
      }
      appendAudit(state, { type: 'PROVIDER_DEGRADED', provider, sequence: event.sequence, reason: event.reason || null });
      break;
    }
    case 'PROVIDER_RECOVERED': {
      const provider = event.provider;
      if (!acceptProviderEvent(state, event, { state: 'HEALTHY' })) break;
      for (const gate of Object.values(state.gates)) {
        if (gate.state === 'BLOCKED' && gate.blockingReason === 'NO_ADMITTED_HEALTHY_FAILURE_DOMAIN') {
          gate.state = 'UNPROVEN';
          gate.blockingReason = null;
        }
      }
      appendAudit(state, { type: 'PROVIDER_RECOVERED', provider, sequence: event.sequence });
      break;
    }
    case 'REOPEN_GATE': {
      const gate = state.gates[event.gateId];
      const repairTask = event.idempotencyKey ? state.tasks[event.idempotencyKey] : null;
      const validRepair = Boolean(
        gate
        && gate.state === 'FAIL'
        && event.regressionCaseId
        && repairTask
        && repairTask.gateId === gate.id
        && repairTask.taskKind === 'repair_regression'
        && ACTIVE_TASK_STATES.has(repairTask.status)
      );
      if (!validRepair) {
        appendAudit(state, {
          type: 'EVENT_REJECTED',
          eventId: event.eventId,
          gateId: event.gateId || null,
          reason: 'INVALID_REOPEN_EVIDENCE',
        });
        break;
      }
      repairTask.status = 'PASS';
      repairTask.completedAt = nowIso();
      repairTask.regressionCaseId = event.regressionCaseId;
      gate.state = 'UNPROVEN';
      gate.blockingReason = null;
      appendAudit(state, { type: 'GATE_REOPENED', gateId: gate.id, regressionCaseId: event.regressionCaseId });
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

  reconcileDependencyBlocks(state);
  scheduleRunnable(state, emittedTasks);
  reconcileDependencyBlocks(state);
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
