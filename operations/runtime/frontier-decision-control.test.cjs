'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSimulationPassport,
  createAssuranceEnvelope,
  assertExecutionAllowed,
  createCausalPromotionAssessment
} = require('./frontier-decision-control.cjs');

function episode() {
  return {
    contractVersion: 'VECTOR_DECISION_EPISODE_V1',
    episodeId: 'ep-1',
    tenant: 'tenant-a',
    contextRevision: 'twin-r17'
  };
}

function passport(overrides = {}) {
  return createSimulationPassport({
    sourceEpisodeId: 'ep-1',
    contextRevision: 'twin-r17',
    stateSnapshotRef: 'twin://site-a/shift-1',
    generatedAt: '2026-09-23T15:00:00Z',
    inputEvidenceRefs: ['ev:skills', 'ev:absence', 'ev:plan'],
    models: [
      { id: 'workforce-des', version: '17', type: 'DISCRETE_EVENT', calibrationEvidenceRefs: ['cal:1'], validityRef: 'validity:17' }
    ],
    candidates: [
      { optionId: 'do-nothing', expected: { planAttainmentPct: 81 }, constraintViolationProbability: 0, hardConstraintsPassed: true },
      { optionId: 'redeploy', expected: { planAttainmentPct: 97 }, constraintViolationProbability: 0.001, hardConstraintsPassed: true }
    ],
    validity: {
      insideEnvelope: true,
      stale: false,
      outOfDistribution: false,
      modelDisagreement: false,
      assessedAt: '2026-09-23T15:00:00Z',
      evidenceRefs: ['validity:17']
    },
    reproducibility: {
      seed: 'seed-17',
      codeDigest: 'code:abc',
      environmentDigest: 'env:def',
      solverVersions: ['vector-des@17']
    },
    ...overrides
  });
}

function envelope(overrides = {}) {
  return createAssuranceEnvelope({
    episode: episode(),
    simulationPassport: passport(),
    unknownsAssessment: { level: 'KNOWN', autonomyCeiling: 'FULL_BOUNDED', reasons: [] },
    actionContract: {
      actionType: 'workforce.redeploy',
      riskClass: 'LOW',
      reversibility: 'REVERSIBLE',
      maxBlastRadius: 1,
      preconditions: ['skill-valid', 'rest-compliant'],
      postconditions: ['assignment-visible', 'coverage-restored']
    },
    authority: {
      grantRef: 'grant:1',
      expiresAt: '2026-09-23T16:00:00Z',
      riskCeiling: 'LOW',
      blastRadiusCeiling: 1
    },
    verifier: {
      executorId: 'executor-a',
      verifierId: 'verifier-b',
      independentReadBack: true
    },
    causalPlan: {
      primaryOutcome: 'good-units-per-paid-hour',
      baselineMethod: 'SWITCHBACK',
      evidenceGrade: 'RANDOMIZED',
      outcomeWindow: 'PT8H',
      guardrails: ['quality', 'working-time']
    },
    ...overrides
  });
}

test('simulation passport is bound to models, evidence, candidates and validity', () => {
  const p = passport();
  assert.equal(p.contractVersion, 'VECTOR_SIMULATION_PASSPORT_V1');
  assert.equal(p.candidates.length, 2);
  assert.match(p.passportDigest, /^[a-f0-9]{64}$/);
});

test('low-risk reversible decision with independent verification can earn bounded autonomy', () => {
  const a = envelope();
  assert.equal(a.autonomy.ceiling, 'BOUNDED_AUTO');
  assert.equal(a.autonomy.boundedAutoEligible, true);
  assert.equal(assertExecutionAllowed(a, { requestedMode: 'BOUNDED_AUTO' }), true);
});

test('consequential or compensatable actions are capped at human approval', () => {
  const a = envelope({
    actionContract: {
      actionType: 'workforce.reassign',
      riskClass: 'MEDIUM',
      reversibility: 'COMPENSATABLE',
      maxBlastRadius: 1,
      preconditions: ['skill-valid'],
      postconditions: ['assignment-visible'],
      compensationRef: 'compensate:assignment'
    },
    authority: {
      grantRef: 'grant:2',
      expiresAt: '2026-09-23T16:00:00Z',
      riskCeiling: 'MEDIUM',
      blastRadiusCeiling: 1
    }
  });
  assert.equal(a.autonomy.ceiling, 'HUMAN_APPROVAL');
  assert.equal(assertExecutionAllowed(a, { requestedMode: 'HUMAN_APPROVAL' }), true);
  assert.throws(() => assertExecutionAllowed(a, { requestedMode: 'BOUNDED_AUTO' }), /earned bounded autonomy/i);
});

test('out-of-envelope simulation forces shadow-only behavior', () => {
  const p = passport({
    validity: {
      insideEnvelope: false,
      stale: false,
      outOfDistribution: true,
      modelDisagreement: false,
      assessedAt: '2026-09-23T15:00:00Z',
      evidenceRefs: ['validity:ood']
    }
  });
  const a = envelope({ simulationPassport: p });
  assert.equal(a.autonomy.ceiling, 'SHADOW');
  assert.throws(() => assertExecutionAllowed(a, { requestedMode: 'HUMAN_APPROVAL' }), /does not permit execution/i);
});

test('unknowns containment reduces the decision to replay-only', () => {
  const a = envelope({
    unknownsAssessment: {
      level: 'NOVEL_OR_COMPOUND',
      autonomyCeiling: 'CONTAINMENT_ONLY',
      reasons: ['telemetry-blind']
    }
  });
  assert.equal(a.autonomy.ceiling, 'REPLAY_ONLY');
});

test('executor and verifier separation is mandatory', () => {
  assert.throws(() => envelope({
    verifier: { executorId: 'same', verifierId: 'same', independentReadBack: true }
  }), /distinct identified principals/i);
});

test('causal learning cannot self-promote and requires strong replicated evidence', () => {
  const weak = createCausalPromotionAssessment({
    evidenceGrade: 'OBSERVATIONAL',
    effect: 0.04,
    confidenceInterval: { low: 0.01, high: 0.07 },
    replicated: true,
    guardrailsPassed: true,
    driftFree: true,
    independentlyReviewed: true
  });
  assert.equal(weak.promotionEligible, false);
  assert.equal(weak.maySelfPromote, false);

  const strong = createCausalPromotionAssessment({
    evidenceGrade: 'REPLICATED',
    effect: 0.04,
    confidenceInterval: { low: 0.015, high: 0.065 },
    replicated: true,
    guardrailsPassed: true,
    driftFree: true,
    independentlyReviewed: true
  });
  assert.equal(strong.promotionEligible, true);
  assert.equal(strong.maySelfGrantAuthority, false);
});
