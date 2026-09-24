'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDecisionEpisode
} = require('./decision-episode.cjs');
const {
  buildGoldenIndustrialLoop,
  validateGoldenIndustrialLoop,
  registerGoldenIndustrialLoop,
  issueGoldenIndustrialLoopPermit,
  executeGoldenIndustrialLoop,
  recordGoldenIndustrialLoopOutcome
} = require('./golden-industrial-loop.cjs');

function episode() {
  return createDecisionEpisode({
    tenant: 'tenant-a',
    site: 'site-1',
    decisionType: 'absence-recovery',
    triggerId: 'absence-17',
    triggeredAt: '2026-09-23T08:00:00Z',
    contextRevision: 'twin-r17',
    mode: 'SHADOW',
    sourceEvidence: ['ev:absence', 'ev:skills', 'ev:plan'],
    objective: {
      labourCost: 1,
      planAttainmentPct: 2,
      uncertaintyPenalty: 0.2
    },
    options: [
      {
        id: 'do-nothing',
        feasible: true,
        policyAllowed: true,
        hardConstraintsPassed: true,
        uncertainty: 0.15,
        prediction: { labourCost: 0, planAttainmentPct: 80 },
        evidenceRefs: ['sim:base']
      },
      {
        id: 'overtime',
        feasible: true,
        policyAllowed: true,
        hardConstraintsPassed: true,
        uncertainty: 0.1,
        prediction: { labourCost: 250, planAttainmentPct: 98 },
        evidenceRefs: ['sim:ot']
      }
    ]
  });
}

function input(overrides = {}) {
  return {
    episode: episode(),
    selectedOptionId: 'overtime',
    stateSnapshotRef: 'twin://site-1/r17',
    generatedAt: '2026-09-23T08:05:00Z',
    simulationEvidenceRefs: ['simrun:17'],
    models: [
      {
        id: 'absence-recovery-des',
        version: '17',
        type: 'DISCRETE_EVENT',
        calibrationEvidenceRefs: ['cal:17'],
        validityRef: 'validity:17'
      }
    ],
    simulationResults: [
      {
        optionId: 'do-nothing',
        expected: { labourCost: 0, planAttainmentPct: 80 },
        uncertainty: { aggregate: 0.15 },
        constraintViolationProbability: 0,
        hardConstraintsPassed: true
      },
      {
        optionId: 'overtime',
        expected: { labourCost: 250, planAttainmentPct: 98 },
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
      rollback: {
        eventKey: 'rb-17',
        reason: 'restore original workforce state'
      }
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
    },
    ...overrides
  };
}

test('golden loop binds one immutable root episode through simulation, assurance and execution plan', () => {
  const loop = buildGoldenIndustrialLoop(input());
  assert.equal(validateGoldenIndustrialLoop(loop), true);
  assert.equal(loop.rootEpisodeId, loop.simulationPassport.sourceEpisodeId);
  assert.equal(loop.rootEpisodeId, loop.assurance.sourceEpisodeId);
  assert.equal(loop.contextRevision, loop.assurance.contextRevision);
  assert.equal(loop.executionPlan.frontierAssuranceDigest, loop.assuranceDigest);
  assert.equal(loop.selectionBasis, 'RECOMMENDED');
  assert.equal(loop.autonomy.ceiling, 'BOUNDED_AUTO');
});

test('simulation results must agree with the Decision Episode predictions', () => {
  const bad = input();
  bad.simulationResults[1].expected.planAttainmentPct = 91;
  assert.throws(() => buildGoldenIndustrialLoop(bad), /does not match Decision Episode prediction/i);
});

test('human override of the recommended option requires explicit evidence', () => {
  const e = episode();
  assert.equal(e.recommendation.optionId, 'overtime');
  assert.throws(
    () => buildGoldenIndustrialLoop(input({
      episode: e,
      selectedOptionId: 'do-nothing'
    })),
    /requires a reason and evidence/i
  );

  const loop = buildGoldenIndustrialLoop(input({
    episode: e,
    selectedOptionId: 'do-nothing',
    overrideReason: 'Operator has verified an imminent upstream material shortage.',
    overrideEvidenceRefs: ['ev:material-shortage']
  }));
  assert.equal(loop.selectionBasis, 'EVIDENCED_HUMAN_OVERRIDE');
  assert.deepEqual(loop.override.evidenceRefs, ['ev:material-shortage']);
});

test('action contract cannot drift from the execution adapter action type', () => {
  assert.throws(
    () => buildGoldenIndustrialLoop(input({
      actionContract: {
        ...input().actionContract,
        actionType: 'workforce.agency_assignment'
      }
    })),
    /does not match the execution plan/i
  );
});

test('registration stores passport before assurance and is idempotency-aware', () => {
  const calls = [];
  const engine = {
    registerSimulationPassport(args) {
      calls.push(['passport', args]);
      return { passportDigest: args.passport.passportDigest, idempotent: false };
    },
    registerFrontierAssurance(args) {
      calls.push(['assurance', args]);
      return { assuranceDigest: args.envelope.assuranceDigest, idempotent: false };
    }
  };
  const loop = buildGoldenIndustrialLoop(input());
  const receipt = registerGoldenIndustrialLoop(engine, loop, { actorRef: 'system:test' });
  assert.deepEqual(calls.map(x => x[0]), ['passport', 'assurance']);
  assert.equal(receipt.rootEpisodeId, loop.rootEpisodeId);
  assert.equal(receipt.assuranceDigest, loop.assuranceDigest);
  assert.equal(receipt.idempotent, false);
});

test('permit and execution remain bound to the same root episode and context', async () => {
  const loop = buildGoldenIndustrialLoop(input());
  const engine = {
    issueHumanPermit(args) {
      assert.equal(args.episodeId, loop.rootEpisodeId);
      assert.equal(args.contextRevision, loop.contextRevision);
      assert.equal(args.plan.frontierAssuranceDigest, loop.assuranceDigest);
      return {
        permitId: 'permit-17',
        shadowEpisodeId: loop.rootEpisodeId
      };
    },
    async executePermit(args) {
      assert.equal(args.currentContextRevision, loop.contextRevision);
      return { executionId: 'exec-17', state: 'VERIFIED' };
    }
  };
  const permit = issueGoldenIndustrialLoopPermit(engine, loop, {
    actorRef: 'manager:17',
    now: Date.parse('2026-09-23T08:10:00Z')
  });
  const result = await executeGoldenIndustrialLoop(engine, loop, permit, {
    now: Date.parse('2026-09-23T08:11:00Z')
  });
  assert.equal(result.state, 'VERIFIED');
});


test('golden loop business outcome is recorded only after verified execution and preserves root binding', () => {
  const loop = buildGoldenIndustrialLoop(input());
  const execution = {
    executionId: 'exec-17',
    state: 'VERIFIED',
    detail: { outcomePending: true }
  };
  const engine = {
    recordVerifiedOutcome(args) {
      assert.equal(args.tenant, loop.tenant);
      assert.equal(args.executionId, execution.executionId);
      return {
        contractVersion: 'VECTOR_AUTOPILOT_OUTCOME_V1',
        rootEpisodeId: loop.rootEpisodeId,
        selectedEpisodeId: 'selected-17',
        outcomeDigest: 'outcome-17',
        episode: {
          contractVersion: 'VECTOR_DECISION_EPISODE_V1',
          episodeId: 'selected-17',
          outcome: { actual: args.actual }
        },
        idempotent: false
      };
    }
  };
  const result = recordGoldenIndustrialLoopOutcome(engine, loop, execution, {
    observedAt: '2026-09-23T18:00:00Z',
    evidenceRefs: ['measure:17'],
    actual: { planAttainmentPct: 99, labourCost: 245 },
    actorRef: 'system:measurement'
  });
  assert.equal(result.rootEpisodeId, loop.rootEpisodeId);
  assert.equal(result.executionId, execution.executionId);
  assert.equal(result.outcomeDigest, 'outcome-17');
});

test('golden loop refuses business outcome before independently verified execution', () => {
  const loop = buildGoldenIndustrialLoop(input());
  assert.throws(
    () => recordGoldenIndustrialLoopOutcome(
      { recordVerifiedOutcome() { throw new Error('should not be called'); } },
      loop,
      { executionId: 'exec-17', state: 'APPLIED' },
      {
        observedAt: '2026-09-23T18:00:00Z',
        evidenceRefs: ['measure:17'],
        actual: { planAttainmentPct: 99 }
      }
    ),
    /requires a VERIFIED execution/i
  );
});
