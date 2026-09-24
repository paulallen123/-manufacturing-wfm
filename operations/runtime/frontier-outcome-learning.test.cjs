'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDecisionEpisode,
  selectDecisionOption,
  recordDecisionOutcome
} = require('./decision-episode.cjs');
const {
  buildGoldenIndustrialLoop
} = require('./golden-industrial-loop.cjs');
const {
  createGoldenOutcomeProof,
  validateGoldenOutcomeProof,
  assessGoldenCausalPromotion,
  validateGoldenCausalAssessment,
  createCausalLearningProposal
} = require('./frontier-outcome-learning.cjs');

function shadowEpisode() {
  return createDecisionEpisode({
    tenant: 'tenant-a',
    site: 'site-1',
    decisionType: 'absence-recovery',
    triggerId: 'absence-17',
    triggeredAt: '2026-09-23T08:00:00Z',
    contextRevision: 'twin-r17',
    mode: 'SHADOW',
    sourceEvidence: ['ev:absence', 'ev:skills', 'ev:plan'],
    objective: { labourCost: 1, planAttainmentPct: 2, uncertaintyPenalty: 0.2 },
    options: [
      {
        id: 'do-nothing',
        feasible: true,
        policyAllowed: true,
        hardConstraintsPassed: true,
        uncertainty: 0.15,
        prediction: { labourCost: 500, planAttainmentPct: 80 },
        evidenceRefs: ['sim:base']
      },
      {
        id: 'overtime',
        feasible: true,
        policyAllowed: true,
        hardConstraintsPassed: true,
        uncertainty: 0.1,
        prediction: { labourCost: 300, planAttainmentPct: 98 },
        evidenceRefs: ['sim:ot']
      }
    ]
  });
}

function loop() {
  const episode = shadowEpisode();
  return buildGoldenIndustrialLoop({
    episode,
    selectedOptionId: 'overtime',
    stateSnapshotRef: 'twin://site-1/r17',
    generatedAt: '2026-09-23T08:05:00Z',
    simulationEvidenceRefs: ['simrun:17'],
    models: [{
      id: 'absence-recovery-des',
      version: '17',
      type: 'DISCRETE_EVENT',
      calibrationEvidenceRefs: ['cal:17'],
      validityRef: 'validity:17'
    }],
    simulationResults: [
      {
        optionId: 'do-nothing',
        expected: { labourCost: 500, planAttainmentPct: 80 },
        uncertainty: { aggregate: 0.15 },
        constraintViolationProbability: 0,
        hardConstraintsPassed: true
      },
      {
        optionId: 'overtime',
        expected: { labourCost: 300, planAttainmentPct: 98 },
        uncertainty: { aggregate: 0.1 },
        constraintViolationProbability: 0.001,
        hardConstraintsPassed: true
      }
    ],
    validity: {
      insideEnvelope: true,
      stale: false,
      outOfDistribution: false,
      modelDisagreement: false,
      assessedAt: '2026-09-23T08:05:00Z',
      evidenceRefs: ['validity:17']
    },
    reproducibility: {
      seed: 'seed-17',
      codeDigest: 'code:17',
      environmentDigest: 'env:17',
      solverVersions: ['vector-des@17']
    },
    executionPlan: {
      adapter: 'workforce-lifecycle',
      reversible: true,
      action: {
        eventKey: 'ot-17',
        kind: 'OVERTIME_OVERRIDE',
        employeeId: 'E17',
        effectiveAt: '2026-09-23T09:00:00Z',
        payload: { minutes: 60 }
      },
      rollback: { eventKey: 'rb-17', reason: 'restore original workforce state' }
    },
    actionContract: {
      actionType: 'workforce.overtime_override',
      riskClass: 'LOW',
      reversibility: 'REVERSIBLE',
      maxBlastRadius: 1,
      preconditions: ['employee-active', 'rest-compliant'],
      postconditions: ['overtime-visible', 'coverage-restored']
    },
    authority: {
      grantRef: 'grant:17',
      expiresAt: '2026-09-23T09:30:00Z',
      riskCeiling: 'LOW',
      blastRadiusCeiling: 1
    },
    verifier: {
      executorId: 'workforce-lifecycle-executor',
      verifierId: 'workforce-lifecycle-verifier',
      independentReadBack: true
    },
    unknownsAssessment: {
      level: 'KNOWN',
      autonomyCeiling: 'FULL_BOUNDED',
      reasons: []
    },
    causalPlan: {
      primaryOutcome: 'planAttainmentPct',
      baselineMethod: 'SWITCHBACK',
      evidenceGrade: 'RANDOMIZED',
      outcomeWindow: 'PT8H',
      guardrails: ['quality', 'working-time']
    }
  });
}

function outcomeReceipt(goldenLoop = loop()) {
  const promoted = createDecisionEpisode({
    tenant: goldenLoop.tenant,
    site: goldenLoop.site,
    decisionType: goldenLoop.decisionType,
    triggerId: 'absence-17',
    triggeredAt: '2026-09-23T08:00:00Z',
    contextRevision: goldenLoop.contextRevision,
    mode: 'HUMAN_APPROVAL',
    sourceEvidence: goldenLoop.evidenceRefs,
    objective: { labourCost: 1, planAttainmentPct: 2, uncertaintyPenalty: 0.2 },
    options: goldenLoop.simulationPassport.candidates.map(candidate => ({
      id: candidate.optionId,
      feasible: true,
      policyAllowed: true,
      hardConstraintsPassed: candidate.hardConstraintsPassed,
      uncertainty: Number(candidate.uncertainty?.aggregate || 0),
      prediction: candidate.expected,
      evidenceRefs: goldenLoop.evidenceRefs
    }))
  });
  const selected = selectDecisionOption(promoted, {
    optionId: goldenLoop.selectedOptionId,
    selectedAt: '2026-09-23T08:10:00Z',
    actorRef: 'manager:17',
    authorityDecision: 'HUMAN_APPROVED'
  });
  const completed = recordDecisionOutcome(selected, {
    observedAt: '2026-09-23T18:00:00Z',
    evidenceRefs: ['mes:shift-17', 'payroll:shift-17'],
    actual: { labourCost: 320, planAttainmentPct: 97 }
  });
  return {
    contractVersion: 'VECTOR_GOLDEN_LOOP_OUTCOME_V1',
    rootEpisodeId: goldenLoop.rootEpisodeId,
    loopDigest: goldenLoop.loopDigest,
    executionId: 'exec-17',
    outcomeDigest: completed.outcomeDigest,
    episode: completed,
    idempotent: false
  };
}

test('verified outcome proof is evidence-bound but is never automatically causal-promotion eligible', () => {
  const goldenLoop = loop();
  const bundle = createGoldenOutcomeProof({
    loop: goldenLoop,
    outcomeReceipt: outcomeReceipt(goldenLoop),
    metric: 'planAttainmentPct',
    direction: 'MAXIMIZE',
    classification: 'VERIFIED_OPERATIONAL',
    baselineActual: 82,
    baselineEvidenceRefs: ['mes:comparable-baseline']
  });
  assert.equal(validateGoldenOutcomeProof(bundle), true);
  assert.equal(bundle.adaptiveLearningEligible, true);
  assert.equal(bundle.causalPromotionEligible, false);
  assert.equal(bundle.maySelfPromotePolicy, false);
  assert.equal(bundle.maySelfGrantAuthority, false);
});

test('frontier outcome proof refuses simulation-only classification after a real execution', () => {
  const goldenLoop = loop();
  assert.throws(
    () => createGoldenOutcomeProof({
      loop: goldenLoop,
      outcomeReceipt: outcomeReceipt(goldenLoop),
      metric: 'planAttainmentPct',
      direction: 'MAXIMIZE',
      classification: 'SIMULATED',
      baselineActual: 82,
      baselineEvidenceRefs: ['mes:baseline']
    }),
    /VERIFIED_OPERATIONAL or REALISED_FINANCIAL/i
  );
});

test('observational or unreviewed causal evidence cannot promote a policy', () => {
  const goldenLoop = loop();
  const bundle = createGoldenOutcomeProof({
    loop: goldenLoop,
    outcomeReceipt: outcomeReceipt(goldenLoop),
    metric: 'planAttainmentPct',
    direction: 'MAXIMIZE',
    classification: 'VERIFIED_OPERATIONAL',
    baselineActual: 82,
    baselineEvidenceRefs: ['mes:comparable-baseline']
  });
  const assessment = assessGoldenCausalPromotion({
    outcomeProof: bundle,
    causalEvidenceRefs: ['experiment:analysis-17'],
    evidenceGrade: 'OBSERVATIONAL',
    effect: 0.039,
    confidenceInterval: { low: 0.012, high: 0.066 },
    replicated: true,
    guardrailsPassed: true,
    driftFree: true,
    independentlyReviewed: true
  });
  assert.equal(validateGoldenCausalAssessment(assessment), true);
  assert.equal(assessment.promotionEligible, false);
  assert.equal(assessment.maySelfPromotePolicy, false);
  assert.throws(
    () => createCausalLearningProposal({
      outcomeProof: bundle,
      causalAssessment: assessment,
      target: 'policy://absence-recovery/v18',
      proposalEvidenceRefs: ['experiment:analysis-17']
    }),
    /has not passed the promotion gate/i
  );
});

test('replicated causal evidence can create a proposal but can never self-apply or expand authority', () => {
  const goldenLoop = loop();
  const bundle = createGoldenOutcomeProof({
    loop: goldenLoop,
    outcomeReceipt: outcomeReceipt(goldenLoop),
    metric: 'planAttainmentPct',
    direction: 'MAXIMIZE',
    classification: 'VERIFIED_OPERATIONAL',
    baselineActual: 82,
    baselineEvidenceRefs: ['mes:comparable-baseline']
  });
  const assessment = assessGoldenCausalPromotion({
    outcomeProof: bundle,
    causalEvidenceRefs: ['experiment:switchback-17', 'review:causal-17'],
    evidenceGrade: 'REPLICATED',
    effect: 0.039,
    confidenceInterval: { low: 0.012, high: 0.066 },
    replicated: true,
    guardrailsPassed: true,
    driftFree: true,
    independentlyReviewed: true
  });
  assert.equal(assessment.promotionEligible, true);
  const proposal = createCausalLearningProposal({
    outcomeProof: bundle,
    causalAssessment: assessment,
    target: 'policy://absence-recovery/v18',
    proposalEvidenceRefs: ['experiment:switchback-17', 'review:causal-17']
  });
  assert.equal(proposal.status, 'PROPOSAL_ONLY');
  assert.equal(proposal.mayApplyAutomatically, false);
  assert.equal(proposal.mayExpandAuthority, false);
  assert.equal(proposal.maySelfApprove, false);
  assert.equal(proposal.requiresIndependentPromotionDecision, true);
});

test('causal assessment cannot be rebound to a different root decision', () => {
  const goldenLoop = loop();
  const bundle = createGoldenOutcomeProof({
    loop: goldenLoop,
    outcomeReceipt: outcomeReceipt(goldenLoop),
    metric: 'labourCost',
    direction: 'MINIMIZE',
    classification: 'VERIFIED_OPERATIONAL',
    baselineActual: 500,
    baselineEvidenceRefs: ['payroll:baseline']
  });
  const assessment = assessGoldenCausalPromotion({
    outcomeProof: bundle,
    causalEvidenceRefs: ['experiment:cost-17'],
    evidenceGrade: 'REPLICATED',
    effect: 180,
    confidenceInterval: { low: 120, high: 230 },
    replicated: true,
    guardrailsPassed: true,
    driftFree: true,
    independentlyReviewed: true
  });
  const tampered = { ...assessment, rootEpisodeId: 'other-root' };
  assert.throws(
    () => createCausalLearningProposal({
      outcomeProof: bundle,
      causalAssessment: tampered,
      target: 'policy://cost/v2',
      proposalEvidenceRefs: ['experiment:cost-17']
    }),
    /integrity check failed|not bound to the same decision/i
  );
});
