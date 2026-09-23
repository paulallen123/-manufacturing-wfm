'use strict';

const {
  stable,
  digest,
  createSimulationPassport,
  createAssuranceEnvelope,
  validateSimulationPassport,
  validateAssuranceEnvelope
} = require('./frontier-decision-control.cjs');
const {
  ACTION_KIND_TO_TYPE,
  safePlan
} = require('./autopilot-execution-engine.cjs');

const CONTRACT_VERSION = 'VECTOR_GOLDEN_INDUSTRIAL_LOOP_V1';

function text(value, max = 240) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value, max = 50, maxLen = 220) {
  return Array.isArray(value)
    ? [...new Set(value.map(v => text(v, maxLen)).filter(Boolean))].slice(0, max)
    : [];
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function eligible(option) {
  return Boolean(option?.feasible && option?.policyAllowed && option?.hardConstraintsPassed);
}

function predictionsMatch(option, result) {
  const expected = result?.expected && typeof result.expected === 'object' ? result.expected : {};
  for (const [key, value] of Object.entries(option?.prediction || {})) {
    if (value == null) continue;
    if (Number(expected[key]) !== Number(value)) return false;
  }
  return true;
}

function normaliseSimulationResults(episode, results) {
  if (!Array.isArray(results)) throw new Error('Golden loop requires explicit simulation results.');
  const byId = new Map(results.map(r => [text(r?.optionId, 120), r]));
  if (byId.size !== results.length) throw new Error('Simulation result option ids must be unique.');

  return (episode.options || []).map(option => {
    const result = byId.get(option.id);
    if (!result) throw new Error('Simulation result missing for option ' + option.id + '.');
    if (!predictionsMatch(option, result)) {
      throw new Error('Simulation result does not match Decision Episode prediction for option ' + option.id + '.');
    }
    if (result.hardConstraintsPassed !== option.hardConstraintsPassed) {
      throw new Error('Simulation hard-constraint result disagrees with Decision Episode for option ' + option.id + '.');
    }
    return {
      optionId: option.id,
      expected: clone(result.expected),
      uncertainty: result.uncertainty && typeof result.uncertainty === 'object'
        ? clone(result.uncertainty)
        : { aggregate: Number(option.uncertainty) },
      constraintViolationProbability: result.constraintViolationProbability,
      hardConstraintsPassed: result.hardConstraintsPassed
    };
  });
}

function buildGoldenIndustrialLoop(input = {}) {
  const episode = input.episode;
  if (!episode?.episodeId || episode.contractVersion !== 'VECTOR_DECISION_EPISODE_V1') {
    throw new Error('Golden loop requires a valid Decision Episode.');
  }
  if (episode.mode !== 'SHADOW') throw new Error('Golden loop must start from a Shadow Decision Episode.');

  const selectedOptionId = text(input.selectedOptionId || episode.recommendation?.optionId, 120);
  const selectedOption = (episode.options || []).find(o => o.id === selectedOptionId);
  if (!selectedOption) throw new Error('Golden loop selected option is not part of the Decision Episode.');
  if (!eligible(selectedOption)) throw new Error('Golden loop selected option is not eligible.');

  const recommendedOptionId = text(episode.recommendation?.optionId, 120) || null;
  const override = Boolean(recommendedOptionId && selectedOptionId !== recommendedOptionId);
  const overrideReason = text(input.overrideReason, 500);
  const overrideEvidenceRefs = list(input.overrideEvidenceRefs, 30, 220);
  if (override && (!overrideReason || !overrideEvidenceRefs.length)) {
    throw new Error('Overriding the recommended option requires a reason and evidence.');
  }

  const simulationEvidenceRefs = list(input.simulationEvidenceRefs, 50, 220);
  if (!simulationEvidenceRefs.length) throw new Error('Golden loop requires simulation evidence references.');
  const inputEvidenceRefs = [...new Set([...(episode.sourceEvidence || []), ...simulationEvidenceRefs])];

  const candidates = normaliseSimulationResults(episode, input.simulationResults);
  const passport = createSimulationPassport({
    sourceEpisodeId: episode.episodeId,
    contextRevision: episode.contextRevision,
    stateSnapshotRef: input.stateSnapshotRef,
    generatedAt: input.generatedAt,
    inputEvidenceRefs,
    models: input.models,
    candidates,
    validity: input.validity,
    reproducibility: input.reproducibility
  });
  validateSimulationPassport(passport);

  const rawPlan = safePlan(input.executionPlan || {});
  const actionType = ACTION_KIND_TO_TYPE[rawPlan.action.kind];
  const actionContract = {
    ...(input.actionContract || {}),
    actionType: text(input.actionContract?.actionType, 180) || actionType
  };
  if (actionContract.actionType !== actionType) {
    throw new Error('Action contract type does not match the execution plan.');
  }

  const assurance = createAssuranceEnvelope({
    episode,
    simulationPassport: passport,
    unknownsAssessment: input.unknownsAssessment,
    actionContract,
    authority: input.authority,
    verifier: input.verifier,
    causalPlan: input.causalPlan
  });
  validateAssuranceEnvelope(assurance);

  const executionPlan = Object.freeze({
    ...rawPlan,
    frontierAssuranceDigest: assurance.assuranceDigest
  });

  const core = {
    contractVersion: CONTRACT_VERSION,
    rootEpisodeId: episode.episodeId,
    tenant: episode.tenant,
    site: episode.site,
    decisionType: episode.decisionType,
    contextRevision: episode.contextRevision,
    recommendedOptionId,
    selectedOptionId,
    selectionBasis: override ? 'EVIDENCED_HUMAN_OVERRIDE' : 'RECOMMENDED',
    override: override
      ? { reason: overrideReason, evidenceRefs: overrideEvidenceRefs }
      : null,
    simulationPassportDigest: passport.passportDigest,
    assuranceDigest: assurance.assuranceDigest,
    autonomy: clone(assurance.autonomy),
    executionPlanDigest: digest(executionPlan),
    evidenceRefs: inputEvidenceRefs
  };

  const loop = Object.freeze({
    ...core,
    loopDigest: digest(core),
    simulationPassport: passport,
    assurance,
    executionPlan
  });

  return loop;
}

function validateGoldenIndustrialLoop(loop) {
  if (!loop || loop.contractVersion !== CONTRACT_VERSION) throw new Error('Valid Golden Industrial Loop required.');
  validateSimulationPassport(loop.simulationPassport);
  validateAssuranceEnvelope(loop.assurance);
  if (loop.rootEpisodeId !== loop.simulationPassport.sourceEpisodeId) throw new Error('Golden loop root/passport binding mismatch.');
  if (loop.rootEpisodeId !== loop.assurance.sourceEpisodeId) throw new Error('Golden loop root/assurance binding mismatch.');
  if (loop.contextRevision !== loop.simulationPassport.contextRevision || loop.contextRevision !== loop.assurance.contextRevision) {
    throw new Error('Golden loop context binding mismatch.');
  }
  if (loop.simulationPassportDigest !== loop.simulationPassport.passportDigest) throw new Error('Golden loop passport digest mismatch.');
  if (loop.assuranceDigest !== loop.assurance.assuranceDigest) throw new Error('Golden loop assurance digest mismatch.');
  if (loop.executionPlan?.frontierAssuranceDigest !== loop.assuranceDigest) throw new Error('Golden loop execution plan is not assurance-bound.');

  const { simulationPassport, assurance, executionPlan, loopDigest, ...core } = clone(loop);
  if (digest(core) !== loopDigest) throw new Error('Golden loop integrity check failed.');
  if (digest(executionPlan) !== loop.executionPlanDigest) throw new Error('Golden loop execution plan integrity check failed.');
  return true;
}

function registerGoldenIndustrialLoop(engine, loop, input = {}) {
  validateGoldenIndustrialLoop(loop);
  if (!engine || typeof engine.registerSimulationPassport !== 'function' || typeof engine.registerFrontierAssurance !== 'function') {
    throw new Error('Golden loop requires a frontier-capable Autopilot engine.');
  }
  const actorRef = text(input.actorRef, 180) || 'system:golden-loop';
  const passport = engine.registerSimulationPassport({
    tenant: loop.tenant,
    episodeId: loop.rootEpisodeId,
    passport: loop.simulationPassport,
    actorRef
  });
  const assurance = engine.registerFrontierAssurance({
    tenant: loop.tenant,
    episodeId: loop.rootEpisodeId,
    envelope: loop.assurance,
    actorRef
  });
  return Object.freeze({
    contractVersion: 'VECTOR_GOLDEN_LOOP_REGISTRATION_V1',
    rootEpisodeId: loop.rootEpisodeId,
    loopDigest: loop.loopDigest,
    passportDigest: passport.passportDigest,
    assuranceDigest: assurance.assuranceDigest,
    idempotent: passport.idempotent === true && assurance.idempotent === true
  });
}

function issueGoldenIndustrialLoopPermit(engine, loop, input = {}) {
  validateGoldenIndustrialLoop(loop);
  if (!engine || typeof engine.issueHumanPermit !== 'function') {
    throw new Error('Golden loop requires a frontier-capable Autopilot engine.');
  }
  return engine.issueHumanPermit({
    tenant: loop.tenant,
    episodeId: loop.rootEpisodeId,
    optionId: loop.selectedOptionId,
    actorRef: text(input.actorRef, 180),
    contextRevision: loop.contextRevision,
    plan: loop.executionPlan,
    now: input.now
  });
}

async function executeGoldenIndustrialLoop(engine, loop, permit, input = {}) {
  validateGoldenIndustrialLoop(loop);
  if (!permit?.permitId || permit.shadowEpisodeId !== loop.rootEpisodeId) {
    throw new Error('Golden loop permit is not bound to the root Decision Episode.');
  }
  if (!engine || typeof engine.executePermit !== 'function') {
    throw new Error('Golden loop requires a frontier-capable Autopilot engine.');
  }
  return await engine.executePermit({
    tenant: loop.tenant,
    permitId: permit.permitId,
    currentContextRevision: loop.contextRevision,
    now: input.now
  });
}

module.exports = Object.freeze({
  CONTRACT_VERSION,
  buildGoldenIndustrialLoop,
  validateGoldenIndustrialLoop,
  registerGoldenIndustrialLoop,
  issueGoldenIndustrialLoopPermit,
  executeGoldenIndustrialLoop,
  stable,
  digest
});
