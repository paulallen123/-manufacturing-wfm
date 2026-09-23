'use strict';

const { createHash } = require('node:crypto');

const AUTONOMY_LEVELS = Object.freeze([
  'REPLAY_ONLY',
  'SHADOW',
  'RECOMMEND',
  'HUMAN_APPROVAL',
  'BOUNDED_AUTO'
]);

const EVIDENCE_GRADES = Object.freeze([
  'SIMULATION_ONLY',
  'OBSERVATIONAL',
  'QUASI_EXPERIMENTAL',
  'RANDOMIZED',
  'REPLICATED'
]);

const REVERSIBILITY = Object.freeze([
  'REVERSIBLE',
  'COMPENSATABLE',
  'IRREVERSIBLE'
]);

const RISK_ORDER = Object.freeze({
  READ_ONLY: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function text(value, max = 240) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function iso(value, name) {
  const raw = text(value, 90);
  const ms = Date.parse(raw);
  if (!raw || !Number.isFinite(ms)) throw new Error(name + ' must be a valid ISO timestamp.');
  return new Date(ms).toISOString();
}

function list(value, max = 50, maxLen = 220) {
  return Array.isArray(value)
    ? [...new Set(value.map(v => text(v, maxLen)).filter(Boolean))].slice(0, max)
    : [];
}

function number(value, min, max, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(name + ' must be between ' + min + ' and ' + max + '.');
  }
  return n;
}

function modelRef(input = {}) {
  const id = text(input.id, 180);
  const version = text(input.version, 120);
  const type = text(input.type, 80).toUpperCase();
  if (!id || !version || !type) throw new Error('Simulation model refs require id, version and type.');
  return {
    id,
    version,
    type,
    calibrationEvidenceRefs: list(input.calibrationEvidenceRefs, 30, 220),
    validityRef: text(input.validityRef, 220) || null
  };
}

function candidateResult(input = {}) {
  const optionId = text(input.optionId, 120);
  if (!optionId) throw new Error('Simulation candidate result requires optionId.');
  const violationProbability = number(
    input.constraintViolationProbability ?? 1,
    0,
    1,
    'constraintViolationProbability'
  );
  const uncertainty = input.uncertainty && typeof input.uncertainty === 'object'
    ? clone(input.uncertainty)
    : {};
  return {
    optionId,
    expected: input.expected && typeof input.expected === 'object' ? clone(input.expected) : {},
    uncertainty,
    constraintViolationProbability: violationProbability,
    hardConstraintsPassed: input.hardConstraintsPassed === true
  };
}

function createSimulationPassport(input = {}) {
  const sourceEpisodeId = text(input.sourceEpisodeId, 180);
  const contextRevision = text(input.contextRevision, 180);
  const stateSnapshotRef = text(input.stateSnapshotRef, 260);
  const generatedAt = iso(input.generatedAt, 'generatedAt');
  const models = Array.isArray(input.models) ? input.models.map(modelRef) : [];
  const inputEvidenceRefs = list(input.inputEvidenceRefs, 100, 240);
  const candidates = Array.isArray(input.candidates) ? input.candidates.map(candidateResult) : [];
  if (!sourceEpisodeId || !contextRevision || !stateSnapshotRef) {
    throw new Error('Simulation passport requires sourceEpisodeId, contextRevision and stateSnapshotRef.');
  }
  if (!models.length) throw new Error('Simulation passport requires at least one versioned model.');
  if (!inputEvidenceRefs.length) throw new Error('Simulation passport requires evidence-bound inputs.');
  if (candidates.length < 2) throw new Error('Simulation passport requires at least two candidate results.');

  const validity = {
    insideEnvelope: input.validity?.insideEnvelope === true,
    stale: input.validity?.stale === true,
    outOfDistribution: input.validity?.outOfDistribution === true,
    modelDisagreement: input.validity?.modelDisagreement === true,
    assessedAt: iso(input.validity?.assessedAt || generatedAt, 'validity.assessedAt'),
    evidenceRefs: list(input.validity?.evidenceRefs, 50, 220)
  };

  const reproducibility = {
    seed: text(input.reproducibility?.seed, 120) || null,
    codeDigest: text(input.reproducibility?.codeDigest, 160) || null,
    environmentDigest: text(input.reproducibility?.environmentDigest, 160) || null,
    solverVersions: list(input.reproducibility?.solverVersions, 50, 180)
  };

  const core = {
    contractVersion: 'VECTOR_SIMULATION_PASSPORT_V1',
    sourceEpisodeId,
    contextRevision,
    stateSnapshotRef,
    generatedAt,
    inputEvidenceRefs,
    models,
    candidates: candidates.sort((a, b) => a.optionId.localeCompare(b.optionId)),
    validity,
    reproducibility
  };

  return Object.freeze({ ...core, passportDigest: digest(core) });
}

function autonomyIndex(level) {
  const idx = AUTONOMY_LEVELS.indexOf(level);
  if (idx < 0) throw new Error('Unsupported autonomy level.');
  return idx;
}

function minLevel(a, b) {
  return autonomyIndex(a) <= autonomyIndex(b) ? a : b;
}

function createAssuranceEnvelope(input = {}) {
  const episode = input.episode;
  const passport = input.simulationPassport;
  if (!episode?.episodeId || !episode?.contextRevision || !episode?.tenant) {
    throw new Error('A valid Decision Episode is required.');
  }
  if (!passport || passport.contractVersion !== 'VECTOR_SIMULATION_PASSPORT_V1') {
    throw new Error('A valid Simulation Passport is required.');
  }
  if (passport.sourceEpisodeId !== episode.episodeId || passport.contextRevision !== episode.contextRevision) {
    throw new Error('Simulation Passport is not bound to the Decision Episode context.');
  }

  const riskClass = text(input.actionContract?.riskClass, 40).toUpperCase();
  if (!(riskClass in RISK_ORDER)) throw new Error('Action contract requires a supported riskClass.');
  const reversibility = text(input.actionContract?.reversibility, 40).toUpperCase();
  if (!REVERSIBILITY.includes(reversibility)) throw new Error('Action contract requires a supported reversibility class.');

  const actionContract = {
    actionType: text(input.actionContract?.actionType, 180),
    riskClass,
    reversibility,
    maxBlastRadius: Number(input.actionContract?.maxBlastRadius ?? 0),
    preconditions: list(input.actionContract?.preconditions, 50, 180),
    postconditions: list(input.actionContract?.postconditions, 50, 180),
    compensationRef: text(input.actionContract?.compensationRef, 220) || null
  };
  if (!actionContract.actionType) throw new Error('Action contract requires actionType.');
  if (!Number.isSafeInteger(actionContract.maxBlastRadius) || actionContract.maxBlastRadius < 0) {
    throw new Error('maxBlastRadius must be a non-negative integer.');
  }
  if (!actionContract.preconditions.length || !actionContract.postconditions.length) {
    throw new Error('Action contract requires explicit preconditions and postconditions.');
  }
  if (reversibility === 'COMPENSATABLE' && !actionContract.compensationRef) {
    throw new Error('Compensatable actions require compensationRef.');
  }

  const verifier = {
    executorId: text(input.verifier?.executorId, 120),
    verifierId: text(input.verifier?.verifierId, 120),
    independentReadBack: input.verifier?.independentReadBack === true
  };
  if (!verifier.executorId || !verifier.verifierId || verifier.executorId === verifier.verifierId) {
    throw new Error('Executor and verifier must be distinct identified principals.');
  }

  const authority = {
    grantRef: text(input.authority?.grantRef, 220),
    expiresAt: iso(input.authority?.expiresAt, 'authority.expiresAt'),
    riskCeiling: text(input.authority?.riskCeiling, 40).toUpperCase(),
    blastRadiusCeiling: Number(input.authority?.blastRadiusCeiling ?? -1)
  };
  if (!authority.grantRef || !(authority.riskCeiling in RISK_ORDER)) {
    throw new Error('Authority requires grantRef and a supported riskCeiling.');
  }
  if (!Number.isSafeInteger(authority.blastRadiusCeiling) || authority.blastRadiusCeiling < 0) {
    throw new Error('Authority blastRadiusCeiling must be a non-negative integer.');
  }

  const causalPlan = {
    primaryOutcome: text(input.causalPlan?.primaryOutcome, 120),
    baselineMethod: text(input.causalPlan?.baselineMethod, 120).toUpperCase(),
    evidenceGrade: text(input.causalPlan?.evidenceGrade || 'SIMULATION_ONLY', 40).toUpperCase(),
    outcomeWindow: text(input.causalPlan?.outcomeWindow, 80),
    guardrails: list(input.causalPlan?.guardrails, 50, 140)
  };
  if (!causalPlan.primaryOutcome || !causalPlan.baselineMethod || !causalPlan.outcomeWindow) {
    throw new Error('Causal plan requires primaryOutcome, baselineMethod and outcomeWindow.');
  }
  if (!EVIDENCE_GRADES.includes(causalPlan.evidenceGrade)) throw new Error('Unsupported causal evidence grade.');

  const unknowns = {
    level: text(input.unknownsAssessment?.level || 'UNCERTAIN', 80).toUpperCase(),
    autonomyCeiling: text(input.unknownsAssessment?.autonomyCeiling || 'SHADOW_OR_LOW_RISK', 80).toUpperCase(),
    reasons: list(input.unknownsAssessment?.reasons, 50, 160)
  };

  let ceiling = 'BOUNDED_AUTO';
  const reasons = [];

  if (!passport.validity.insideEnvelope || passport.validity.stale || passport.validity.outOfDistribution) {
    ceiling = minLevel(ceiling, 'SHADOW');
    reasons.push('SIMULATION_OUTSIDE_VALIDITY');
  }
  if (passport.validity.modelDisagreement) {
    ceiling = minLevel(ceiling, 'RECOMMEND');
    reasons.push('MODEL_DISAGREEMENT');
  }
  if (unknowns.autonomyCeiling === 'CONTAINMENT_ONLY') {
    ceiling = minLevel(ceiling, 'REPLAY_ONLY');
    reasons.push('UNKNOWNS_CONTAINMENT_ONLY');
  } else if (unknowns.autonomyCeiling === 'SHADOW_OR_LOW_RISK') {
    ceiling = minLevel(ceiling, riskClass === 'READ_ONLY' || riskClass === 'LOW' ? 'HUMAN_APPROVAL' : 'SHADOW');
    reasons.push('UNKNOWNS_REDUCED_AUTONOMY');
  }

  if (RISK_ORDER[riskClass] > RISK_ORDER[authority.riskCeiling]) {
    ceiling = minLevel(ceiling, 'SHADOW');
    reasons.push('RISK_EXCEEDS_AUTHORITY');
  }
  if (actionContract.maxBlastRadius > authority.blastRadiusCeiling) {
    ceiling = minLevel(ceiling, 'SHADOW');
    reasons.push('BLAST_RADIUS_EXCEEDS_AUTHORITY');
  }
  if (Date.parse(authority.expiresAt) <= Date.parse(passport.generatedAt)) {
    ceiling = minLevel(ceiling, 'SHADOW');
    reasons.push('AUTHORITY_EXPIRED_AT_SIMULATION_TIME');
  }
  if (!verifier.independentReadBack) {
    ceiling = minLevel(ceiling, 'HUMAN_APPROVAL');
    reasons.push('NO_INDEPENDENT_READBACK');
  }
  if (riskClass === 'MEDIUM' || riskClass === 'HIGH' || riskClass === 'CRITICAL') {
    ceiling = minLevel(ceiling, 'HUMAN_APPROVAL');
    reasons.push('CONSEQUENTIAL_RISK_REQUIRES_HUMAN');
  }
  if (reversibility === 'COMPENSATABLE') {
    ceiling = minLevel(ceiling, 'HUMAN_APPROVAL');
    reasons.push('COMPENSATION_NOT_TRUE_ROLLBACK');
  }
  if (reversibility === 'IRREVERSIBLE') {
    ceiling = minLevel(ceiling, 'HUMAN_APPROVAL');
    reasons.push('IRREVERSIBLE_ACTION');
  }

  const core = {
    contractVersion: 'VECTOR_DECISION_ASSURANCE_V1',
    tenant: episode.tenant,
    sourceEpisodeId: episode.episodeId,
    contextRevision: episode.contextRevision,
    simulationPassportDigest: passport.passportDigest,
    inputEvidenceRefs: passport.inputEvidenceRefs,
    actionContract,
    verifier,
    authority,
    unknowns,
    causalPlan,
    autonomy: {
      ceiling,
      executionEligible: autonomyIndex(ceiling) >= autonomyIndex('HUMAN_APPROVAL'),
      requiresHumanApproval: ceiling === 'HUMAN_APPROVAL',
      boundedAutoEligible: ceiling === 'BOUNDED_AUTO',
      reasons: [...new Set(reasons)]
    }
  };

  return Object.freeze({ ...core, assuranceDigest: digest(core) });
}

function assertExecutionAllowed(envelope, input = {}) {
  if (!envelope || envelope.contractVersion !== 'VECTOR_DECISION_ASSURANCE_V1') {
    throw new Error('Valid frontier Decision Assurance Envelope required.');
  }
  const requestedMode = text(input.requestedMode, 40).toUpperCase();
  if (!['HUMAN_APPROVAL', 'BOUNDED_AUTO'].includes(requestedMode)) {
    throw new Error('Execution requestedMode must be HUMAN_APPROVAL or BOUNDED_AUTO.');
  }
  if (requestedMode === 'HUMAN_APPROVAL' && autonomyIndex(envelope.autonomy.ceiling) < autonomyIndex('HUMAN_APPROVAL')) {
    throw new Error('Decision assurance does not permit execution.');
  }
  if (requestedMode === 'BOUNDED_AUTO' && envelope.autonomy.ceiling !== 'BOUNDED_AUTO') {
    throw new Error('Decision assurance has not earned bounded autonomy.');
  }
  return true;
}

function createCausalPromotionAssessment(input = {}) {
  const evidenceGrade = text(input.evidenceGrade, 40).toUpperCase();
  if (!EVIDENCE_GRADES.includes(evidenceGrade)) throw new Error('Unsupported causal evidence grade.');
  const effect = Number(input.effect);
  if (!Number.isFinite(effect)) throw new Error('Causal effect estimate must be numeric.');
  const confidenceLow = Number(input.confidenceInterval?.low);
  const confidenceHigh = Number(input.confidenceInterval?.high);
  if (!Number.isFinite(confidenceLow) || !Number.isFinite(confidenceHigh) || confidenceLow > confidenceHigh) {
    throw new Error('Valid confidence interval required.');
  }
  const replicated = input.replicated === true;
  const guardrailsPassed = input.guardrailsPassed === true;
  const driftFree = input.driftFree === true;
  const independentlyReviewed = input.independentlyReviewed === true;
  const evidenceStrongEnough = evidenceGrade === 'RANDOMIZED' || evidenceGrade === 'REPLICATED';
  const promotionEligible =
    evidenceStrongEnough &&
    replicated &&
    guardrailsPassed &&
    driftFree &&
    independentlyReviewed &&
    confidenceLow > 0;

  const core = {
    contractVersion: 'VECTOR_CAUSAL_PROMOTION_V1',
    evidenceGrade,
    effect,
    confidenceInterval: { low: confidenceLow, high: confidenceHigh },
    replicated,
    guardrailsPassed,
    driftFree,
    independentlyReviewed,
    promotionEligible,
    maySelfGrantAuthority: false,
    maySelfPromote: false
  };
  return Object.freeze({ ...core, assessmentDigest: digest(core) });
}

module.exports = Object.freeze({
  AUTONOMY_LEVELS,
  EVIDENCE_GRADES,
  REVERSIBILITY,
  RISK_ORDER,
  stable,
  digest,
  createSimulationPassport,
  createAssuranceEnvelope,
  assertExecutionAllowed,
  createCausalPromotionAssessment
});
