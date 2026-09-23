'use strict';

const {
  createDecisionOutcomeProof
} = require('./decision-outcome-proof.cjs');
const {
  createCausalPromotionAssessment,
  digest
} = require('./frontier-decision-control.cjs');
const {
  validateGoldenIndustrialLoop
} = require('./golden-industrial-loop.cjs');

const ALLOWED_OUTCOME_CLASSES = Object.freeze(['VERIFIED_OPERATIONAL', 'REALISED_FINANCIAL']);

function text(value, max = 240) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function list(value, max = 50, maxLen = 220) {
  return Array.isArray(value)
    ? [...new Set(value.map(v => text(v, maxLen)).filter(Boolean))].slice(0, max)
    : [];
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createGoldenOutcomeProof(input = {}) {
  const loop = input.loop;
  validateGoldenIndustrialLoop(loop);

  const receipt = input.outcomeReceipt;
  if (!receipt || receipt.contractVersion !== 'VECTOR_GOLDEN_LOOP_OUTCOME_V1') {
    throw new Error('Golden outcome proof requires a Golden Loop outcome receipt.');
  }
  if (receipt.rootEpisodeId !== loop.rootEpisodeId || receipt.loopDigest !== loop.loopDigest) {
    throw new Error('Golden outcome receipt is not bound to the exact Golden Loop.');
  }
  if (!receipt.executionId || !receipt.outcomeDigest || !receipt.episode?.selection || !receipt.episode?.outcome) {
    throw new Error('Golden outcome receipt is incomplete.');
  }

  const classification = text(input.classification, 40).toUpperCase();
  if (!ALLOWED_OUTCOME_CLASSES.includes(classification)) {
    throw new Error('Frontier outcome proof requires VERIFIED_OPERATIONAL or REALISED_FINANCIAL evidence.');
  }

  const proof = createDecisionOutcomeProof({
    episode: receipt.episode,
    metric: input.metric,
    direction: input.direction,
    classification,
    baselineActual: input.baselineActual,
    baselineEvidenceRefs: input.baselineEvidenceRefs,
    financeEvidenceRefs: input.financeEvidenceRefs,
    currency: input.currency,
    measurementWindow: input.measurementWindow
  });

  if (!proof.verifiedOperationalOutcome || !proof.learningEligible) {
    throw new Error('Golden outcome proof must contain a verified operational result.');
  }

  const core = {
    contractVersion: 'VECTOR_GOLDEN_OUTCOME_PROOF_V1',
    rootEpisodeId: loop.rootEpisodeId,
    loopDigest: loop.loopDigest,
    executionId: receipt.executionId,
    outcomeDigest: receipt.outcomeDigest,
    decisionOutcomeProofDigest: proof.proofDigest,
    classification: proof.classification,
    metric: proof.metric,
    direction: proof.direction,
    observed: clone(proof.observed),
    evidence: clone(proof.evidence),
    claimBoundary: proof.claimBoundary,
    adaptiveLearningEligible: proof.learningEligible === true,
    causalPromotionEligible: false,
    maySelfPromotePolicy: false,
    maySelfGrantAuthority: false
  };

  return Object.freeze({
    ...core,
    bundleDigest: digest(core),
    decisionOutcomeProof: proof
  });
}

function validateGoldenOutcomeProof(bundle) {
  if (!bundle || bundle.contractVersion !== 'VECTOR_GOLDEN_OUTCOME_PROOF_V1') {
    throw new Error('Valid Golden outcome proof bundle required.');
  }
  if (!bundle.rootEpisodeId || !bundle.loopDigest || !bundle.executionId || !bundle.outcomeDigest) {
    throw new Error('Golden outcome proof binding is incomplete.');
  }
  if (!bundle.decisionOutcomeProof || bundle.decisionOutcomeProof.proofDigest !== bundle.decisionOutcomeProofDigest) {
    throw new Error('Golden outcome proof nested proof binding mismatch.');
  }
  if (!bundle.decisionOutcomeProof.verifiedOperationalOutcome) {
    throw new Error('Golden outcome proof is not operationally verified.');
  }
  const { decisionOutcomeProof, bundleDigest, ...core } = clone(bundle);
  if (digest(core) !== bundleDigest) throw new Error('Golden outcome proof integrity check failed.');
  return true;
}

function assessGoldenCausalPromotion(input = {}) {
  const bundle = input.outcomeProof;
  validateGoldenOutcomeProof(bundle);

  const causalEvidenceRefs = list(input.causalEvidenceRefs, 50, 220);
  if (!causalEvidenceRefs.length) {
    throw new Error('Causal promotion assessment requires explicit causal evidence references.');
  }

  const assessment = createCausalPromotionAssessment({
    evidenceGrade: input.evidenceGrade,
    effect: input.effect,
    confidenceInterval: input.confidenceInterval,
    replicated: input.replicated,
    guardrailsPassed: input.guardrailsPassed,
    driftFree: input.driftFree,
    independentlyReviewed: input.independentlyReviewed
  });

  const core = {
    contractVersion: 'VECTOR_GOLDEN_CAUSAL_ASSESSMENT_V1',
    rootEpisodeId: bundle.rootEpisodeId,
    loopDigest: bundle.loopDigest,
    executionId: bundle.executionId,
    outcomeProofDigest: bundle.bundleDigest,
    causalEvidenceRefs,
    causalAssessmentDigest: assessment.assessmentDigest,
    evidenceGrade: assessment.evidenceGrade,
    effect: assessment.effect,
    confidenceInterval: clone(assessment.confidenceInterval),
    promotionEligible: assessment.promotionEligible === true,
    promotionMode: 'PROPOSAL_ONLY',
    maySelfPromotePolicy: false,
    maySelfGrantAuthority: false,
    requiresIndependentPromotionDecision: true
  };

  return Object.freeze({
    ...core,
    assessmentDigest: digest(core),
    causalAssessment: assessment
  });
}

function validateGoldenCausalAssessment(assessment) {
  if (!assessment || assessment.contractVersion !== 'VECTOR_GOLDEN_CAUSAL_ASSESSMENT_V1') {
    throw new Error('Valid Golden causal assessment required.');
  }
  if (!assessment.rootEpisodeId || !assessment.outcomeProofDigest || !assessment.causalAssessment?.assessmentDigest) {
    throw new Error('Golden causal assessment binding is incomplete.');
  }
  if (assessment.causalAssessment.assessmentDigest !== assessment.causalAssessmentDigest) {
    throw new Error('Golden causal assessment nested digest mismatch.');
  }
  if (
    assessment.promotionEligible !== assessment.causalAssessment.promotionEligible ||
    assessment.maySelfPromotePolicy !== false ||
    assessment.maySelfGrantAuthority !== false ||
    assessment.requiresIndependentPromotionDecision !== true
  ) {
    throw new Error('Golden causal promotion safety contract mismatch.');
  }

  const { causalAssessment, assessmentDigest, ...core } = clone(assessment);
  if (digest(core) !== assessmentDigest) throw new Error('Golden causal assessment integrity check failed.');
  return true;
}

function createCausalLearningProposal(input = {}) {
  const outcomeProof = input.outcomeProof;
  const assessment = input.causalAssessment;
  validateGoldenOutcomeProof(outcomeProof);
  validateGoldenCausalAssessment(assessment);

  if (
    assessment.rootEpisodeId !== outcomeProof.rootEpisodeId ||
    assessment.loopDigest !== outcomeProof.loopDigest ||
    assessment.executionId !== outcomeProof.executionId ||
    assessment.outcomeProofDigest !== outcomeProof.bundleDigest
  ) {
    throw new Error('Causal learning proposal inputs are not bound to the same decision/outcome chain.');
  }
  if (assessment.promotionEligible !== true) {
    throw new Error('Causal evidence has not passed the promotion gate.');
  }

  const target = text(input.target, 180);
  if (!target) throw new Error('Causal learning proposal requires a target policy/model reference.');

  const proposalEvidenceRefs = list(input.proposalEvidenceRefs, 50, 220);
  if (!proposalEvidenceRefs.length) {
    throw new Error('Causal learning proposal requires proposal evidence references.');
  }

  const core = {
    contractVersion: 'VECTOR_CAUSAL_LEARNING_PROPOSAL_V1',
    rootEpisodeId: outcomeProof.rootEpisodeId,
    loopDigest: outcomeProof.loopDigest,
    executionId: outcomeProof.executionId,
    outcomeProofDigest: outcomeProof.bundleDigest,
    causalAssessmentDigest: assessment.assessmentDigest,
    target,
    proposedEffect: assessment.effect,
    evidenceGrade: assessment.evidenceGrade,
    evidenceRefs: proposalEvidenceRefs,
    status: 'PROPOSAL_ONLY',
    mayApplyAutomatically: false,
    mayExpandAuthority: false,
    maySelfApprove: false,
    requiresIndependentPromotionDecision: true
  };

  return Object.freeze({ ...core, proposalDigest: digest(core) });
}

module.exports = Object.freeze({
  ALLOWED_OUTCOME_CLASSES,
  createGoldenOutcomeProof,
  validateGoldenOutcomeProof,
  assessGoldenCausalPromotion,
  validateGoldenCausalAssessment,
  createCausalLearningProposal
});
