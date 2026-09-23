'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createDecisionEpisode } = require('./decision-episode.cjs');
const {
  createSimulationPassport,
  createAssuranceEnvelope
} = require('./frontier-decision-control.cjs');
const {
  createAutopilotExecutionEngine,
  safePlan
} = require('./autopilot-execution-engine.cjs');

function ep() {
  return createDecisionEpisode({
    tenant: 'A',
    site: 'S1',
    decisionType: 'absence-recovery',
    triggerId: 'a1',
    triggeredAt: '2026-09-22T09:00:00Z',
    contextRevision: 'r7',
    mode: 'SHADOW',
    sourceEvidence: ['a', 'b'],
    objective: {
      labourCost: 1,
      planAttainmentPct: 1,
      uncertaintyPenalty: 0.1
    },
    options: [
      {
        id: 'do-nothing',
        feasible: true,
        policyAllowed: true,
        hardConstraintsPassed: true,
        uncertainty: 0.1,
        prediction: { labourCost: 500, planAttainmentPct: 80 }
      },
      {
        id: 'overtime',
        feasible: true,
        policyAllowed: true,
        hardConstraintsPassed: true,
        uncertainty: 0.1,
        prediction: { labourCost: 300, planAttainmentPct: 95 }
      }
    ]
  });
}

function setup(lifecycleAdapter, verifierAdapter = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-'));
  const dbPath = path.join(dir, 'x.db');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE vector_decision_episodes(' +
      'tenant TEXT,episode_id TEXT,decision_type TEXT,episode_json TEXT,created_at TEXT,' +
      'PRIMARY KEY(tenant,episode_id));' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);'
  );
  const e = ep();
  db.prepare('INSERT INTO vector_decision_episodes VALUES(?,?,?,?,?)')
    .run('A', e.episodeId, e.decisionType, JSON.stringify(e), new Date().toISOString());
  db.close();

  return {
    dir,
    e,
    engine: createAutopilotExecutionEngine({
      dbPath,
      lifecycleAdapter,
      verifierAdapter,
      executorId: 'workforce-lifecycle-executor',
      verifierId: 'workforce-lifecycle-verifier'
    })
  };
}

function plan(extra = {}) {
  return {
    adapter: 'workforce-lifecycle',
    reversible: true,
    action: {
      eventKey: 'ot',
      kind: 'OVERTIME_OVERRIDE',
      employeeId: 'E1',
      effectiveAt: '2026-09-22T12:00:00Z',
      payload: { minutes: 60 }
    },
    rollback: { eventKey: 'rb', reason: 'restore' },
    ...extra
  };
}

function frontierEvidence(e, authorityExpiresAt = '2026-09-22T10:00:00Z') {
  const passport = createSimulationPassport({
    sourceEpisodeId: e.episodeId,
    contextRevision: e.contextRevision,
    stateSnapshotRef: 'twin://S1/r7',
    generatedAt: '2026-09-22T09:00:00Z',
    inputEvidenceRefs: ['absence:a1', 'skills:S1', 'plan:S1'],
    models: [
      {
        id: 'absence-recovery-des',
        version: '1',
        type: 'DISCRETE_EVENT',
        calibrationEvidenceRefs: ['cal:1'],
        validityRef: 'validity:1'
      }
    ],
    candidates: [
      {
        optionId: 'do-nothing',
        expected: { planAttainmentPct: 80 },
        uncertainty: { planAttainmentPct: 2 },
        constraintViolationProbability: 0,
        hardConstraintsPassed: true
      },
      {
        optionId: 'overtime',
        expected: { planAttainmentPct: 95 },
        uncertainty: { planAttainmentPct: 2 },
        constraintViolationProbability: 0.001,
        hardConstraintsPassed: true
      }
    ],
    validity: {
      insideEnvelope: true,
      stale: false,
      outOfDistribution: false,
      modelDisagreement: false,
      assessedAt: '2026-09-22T09:00:00Z',
      evidenceRefs: ['validity:1']
    },
    reproducibility: {
      seed: 'seed-1',
      codeDigest: 'code:1',
      environmentDigest: 'env:1',
      solverVersions: ['vector-des@1']
    }
  });

  const assurance = createAssuranceEnvelope({
    episode: e,
    simulationPassport: passport,
    unknownsAssessment: {
      level: 'KNOWN',
      autonomyCeiling: 'FULL_BOUNDED',
      reasons: []
    },
    actionContract: {
      actionType: 'workforce.overtime_override',
      riskClass: 'LOW',
      reversibility: 'REVERSIBLE',
      maxBlastRadius: 1,
      preconditions: ['rest-compliant', 'employee-active'],
      postconditions: ['overtime-visible', 'coverage-restored']
    },
    authority: {
      grantRef: 'authority:1',
      expiresAt: authorityExpiresAt,
      riskCeiling: 'LOW',
      blastRadiusCeiling: 1
    },
    verifier: {
      executorId: 'workforce-lifecycle-executor',
      verifierId: 'workforce-lifecycle-verifier',
      independentReadBack: true
    },
    causalPlan: {
      primaryOutcome: 'planAttainmentPct',
      baselineMethod: 'SWITCHBACK',
      evidenceGrade: 'RANDOMIZED',
      outcomeWindow: 'PT8H',
      guardrails: ['quality', 'working-time']
    }
  });

  return { passport, assurance };
}

function cleanup(s) {
  s.engine.close();
  fs.rmSync(s.dir, { recursive: true, force: true });
}

test('requires current context and reversible plan', () => {
  const s = setup({});
  assert.throws(
    () => s.engine.issueHumanPermit({
      tenant: 'A',
      episodeId: s.e.episodeId,
      optionId: 'overtime',
      actorRef: 'm',
      contextRevision: 'old',
      plan: plan()
    }),
    /context changed/i
  );
  assert.throws(
    () => s.engine.issueHumanPermit({
      tenant: 'A',
      episodeId: s.e.episodeId,
      optionId: 'overtime',
      actorRef: 'm',
      contextRevision: 'r7',
      plan: { ...plan(), reversible: false }
    }),
    /reversible/i
  );
  cleanup(s);
});

test('legacy human-approved route still executes, verifies and is idempotent', async () => {
  const events = new Map();
  const lifecycle = {
    applyTrustedEvent({ eventKey }) {
      const x = {
        event: { id: 'wf-' + eventKey, eventKey, status: 'ACCEPTED' },
        decision: { status: 'ACCEPTED', reasonCode: 'OK' }
      };
      events.set(eventKey, x.event);
      return x;
    },
    getTrustedEvent({ eventKey }) {
      return events.get(eventKey) || null;
    }
  };
  const s = setup(lifecycle);
  const permit = s.engine.issueHumanPermit({
    tenant: 'A',
    episodeId: s.e.episodeId,
    optionId: 'overtime',
    actorRef: 'm',
    contextRevision: 'r7',
    plan: plan()
  });
  const r = await s.engine.executePermit({
    tenant: 'A',
    permitId: permit.permitId,
    currentContextRevision: 'r7'
  });
  const r2 = await s.engine.executePermit({
    tenant: 'A',
    permitId: permit.permitId,
    currentContextRevision: 'r7'
  });
  assert.equal(r.state, 'VERIFIED');
  assert.equal(r2.idempotent, true);
  cleanup(s);
});

test('failed legacy verification rolls back or contains', async () => {
  const events = new Map();
  let fail = true;
  const lifecycle = {
    applyTrustedEvent({ eventKey }) {
      const x = {
        event: { id: 'wf-' + eventKey, eventKey, status: 'ACCEPTED' },
        decision: { status: 'ACCEPTED', reasonCode: 'OK' }
      };
      events.set(eventKey, x.event);
      return x;
    },
    getTrustedEvent({ eventKey }) {
      if (eventKey === 'ot' && fail) {
        fail = false;
        return null;
      }
      return events.get(eventKey) || null;
    }
  };
  const s = setup(lifecycle);
  const permit = s.engine.issueHumanPermit({
    tenant: 'A',
    episodeId: s.e.episodeId,
    optionId: 'overtime',
    actorRef: 'm',
    contextRevision: 'r7',
    plan: plan()
  });
  const r = await s.engine.executePermit({
    tenant: 'A',
    permitId: permit.permitId,
    currentContextRevision: 'r7'
  });
  assert.equal(r.state, 'ROLLED_BACK');
  cleanup(s);
});

test('inline frontier assurance is rejected and an unregistered digest cannot mint a permit', () => {
  assert.throws(
    () => safePlan({ ...plan(), frontierAssurance: { contractVersion: 'VECTOR_DECISION_ASSURANCE_V1' } }),
    /inline frontier assurance is not trusted/i
  );

  const s = setup({});
  assert.throws(
    () => s.engine.issueHumanPermit({
      tenant: 'A',
      episodeId: s.e.episodeId,
      optionId: 'overtime',
      actorRef: 'm',
      contextRevision: 'r7',
      now: Date.parse('2026-09-22T09:05:00Z'),
      plan: plan({ frontierAssuranceDigest: 'a'.repeat(64) })
    }),
    /registered decision assurance was not found/i
  );
  cleanup(s);
});

test('frontier route requires registered simulation, registered assurance and independent verifier', async () => {
  const events = new Map();
  const lifecycle = {
    applyTrustedEvent({ eventKey }) {
      const x = {
        event: { id: 'wf-' + eventKey, eventKey, status: 'ACCEPTED' },
        decision: { status: 'ACCEPTED', reasonCode: 'OK' }
      };
      events.set(eventKey, x.event);
      return x;
    },
    getTrustedEvent({ eventKey }) {
      return events.get(eventKey) || null;
    }
  };
  const verifier = {
    getTrustedEvent({ eventKey }) {
      return events.get(eventKey) || null;
    }
  };

  const s = setup(lifecycle, verifier);
  const { passport, assurance } = frontierEvidence(s.e);
  const p = s.engine.registerSimulationPassport({
    tenant: 'A',
    episodeId: s.e.episodeId,
    passport,
    actorRef: 'system:simulation'
  });
  assert.equal(p.passportDigest, passport.passportDigest);

  const a = s.engine.registerFrontierAssurance({
    tenant: 'A',
    episodeId: s.e.episodeId,
    envelope: assurance,
    actorRef: 'system:assurance'
  });
  assert.equal(a.assuranceDigest, assurance.assuranceDigest);

  const permit = s.engine.issueHumanPermit({
    tenant: 'A',
    episodeId: s.e.episodeId,
    optionId: 'overtime',
    actorRef: 'manager:1',
    contextRevision: 'r7',
    now: Date.parse('2026-09-22T09:05:00Z'),
    plan: plan({ frontierAssuranceDigest: assurance.assuranceDigest })
  });
  assert.equal(permit.assuranceDigest, assurance.assuranceDigest);

  const result = await s.engine.executePermit({
    tenant: 'A',
    permitId: permit.permitId,
    currentContextRevision: 'r7',
    now: Date.parse('2026-09-22T09:06:00Z')
  });
  assert.equal(result.state, 'VERIFIED');
  assert.equal(result.detail.assuranceDigest, assurance.assuranceDigest);
  assert.equal(result.detail.outcomePending, true);
  cleanup(s);
});

test('frontier assurance registration fails without a distinct verifier adapter', () => {
  const lifecycle = {
    applyTrustedEvent() {},
    getTrustedEvent() { return null; }
  };
  const s = setup(lifecycle, lifecycle);
  const { passport, assurance } = frontierEvidence(s.e);
  s.engine.registerSimulationPassport({
    tenant: 'A',
    episodeId: s.e.episodeId,
    passport
  });
  assert.throws(
    () => s.engine.registerFrontierAssurance({
      tenant: 'A',
      episodeId: s.e.episodeId,
      envelope: assurance
    }),
    /distinct independent read-back verifier/i
  );
  cleanup(s);
});

test('expired authority cannot mint a frontier permit even when the envelope was valid at simulation time', () => {
  const events = new Map();
  const lifecycle = {
    applyTrustedEvent() {},
    getTrustedEvent({ eventKey }) { return events.get(eventKey) || null; }
  };
  const verifier = {
    getTrustedEvent({ eventKey }) { return events.get(eventKey) || null; }
  };
  const s = setup(lifecycle, verifier);
  const { passport, assurance } = frontierEvidence(s.e, '2026-09-22T09:04:00Z');
  s.engine.registerSimulationPassport({ tenant: 'A', episodeId: s.e.episodeId, passport });
  s.engine.registerFrontierAssurance({ tenant: 'A', episodeId: s.e.episodeId, envelope: assurance });
  assert.throws(
    () => s.engine.issueHumanPermit({
      tenant: 'A',
      episodeId: s.e.episodeId,
      optionId: 'overtime',
      actorRef: 'manager:1',
      contextRevision: 'r7',
      now: Date.parse('2026-09-22T09:05:00Z'),
      plan: plan({ frontierAssuranceDigest: assurance.assuranceDigest })
    }),
    /authority grant is expired/i
  );
  cleanup(s);
});

test('tampered assurance cannot enter the trusted registry', () => {
  const lifecycle = { applyTrustedEvent() {}, getTrustedEvent() { return null; } };
  const verifier = { getTrustedEvent() { return null; } };
  const s = setup(lifecycle, verifier);
  const { passport, assurance } = frontierEvidence(s.e);
  s.engine.registerSimulationPassport({ tenant: 'A', episodeId: s.e.episodeId, passport });
  const tampered = JSON.parse(JSON.stringify(assurance));
  tampered.autonomy.ceiling = 'REPLAY_ONLY';
  assert.throws(
    () => s.engine.registerFrontierAssurance({
      tenant: 'A',
      episodeId: s.e.episodeId,
      envelope: tampered
    }),
    /integrity check failed/i
  );
  cleanup(s);
});


test('frontier outcome is recorded only after independently verified execution and is append-only', async () => {
  const events = new Map();
  const lifecycle = {
    applyTrustedEvent({ eventKey }) {
      const x = {
        event: { id: 'wf-' + eventKey, eventKey, status: 'ACCEPTED' },
        decision: { status: 'ACCEPTED', reasonCode: 'OK' }
      };
      events.set(eventKey, x.event);
      return x;
    },
    getTrustedEvent({ eventKey }) {
      return events.get(eventKey) || null;
    }
  };
  const verifier = {
    getTrustedEvent({ eventKey }) {
      return events.get(eventKey) || null;
    }
  };

  const s = setup(lifecycle, verifier);
  const { passport, assurance } = frontierEvidence(s.e);
  s.engine.registerSimulationPassport({ tenant: 'A', episodeId: s.e.episodeId, passport });
  s.engine.registerFrontierAssurance({ tenant: 'A', episodeId: s.e.episodeId, envelope: assurance });

  const permit = s.engine.issueHumanPermit({
    tenant: 'A',
    episodeId: s.e.episodeId,
    optionId: 'overtime',
    actorRef: 'manager:1',
    contextRevision: 'r7',
    now: Date.parse('2026-09-22T09:05:00Z'),
    plan: plan({ frontierAssuranceDigest: assurance.assuranceDigest })
  });
  const execution = await s.engine.executePermit({
    tenant: 'A',
    permitId: permit.permitId,
    currentContextRevision: 'r7',
    now: Date.parse('2026-09-22T09:06:00Z')
  });
  assert.equal(execution.state, 'VERIFIED');
  assert.equal(execution.detail.outcomePending, true);

  const measured = {
    tenant: 'A',
    executionId: execution.executionId,
    observedAt: '2099-01-01T00:00:00Z',
    evidenceRefs: ['measure:throughput:17', 'measure:labour:17'],
    actual: { planAttainmentPct: 97, labourCost: 310 },
    actorRef: 'system:measurement-worker'
  };
  const outcome = s.engine.recordVerifiedOutcome(measured);
  assert.equal(outcome.rootEpisodeId, s.e.episodeId);
  assert.equal(outcome.episode.outcome.actual.planAttainmentPct, 97);
  assert.equal(outcome.episode.outcome.actual.labourCost, 310);
  assert.equal(outcome.idempotent, false);

  const replay = s.engine.recordVerifiedOutcome(measured);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.outcomeDigest, outcome.outcomeDigest);

  const stored = s.engine.outcomeForExecution('A', execution.executionId);
  assert.equal(stored.outcomeDigest, outcome.outcomeDigest);
  assert.equal(stored.rootEpisodeId, s.e.episodeId);

  assert.throws(
    () => s.engine.recordVerifiedOutcome({
      ...measured,
      actual: { planAttainmentPct: 91, labourCost: 360 }
    }),
    /conflicting business outcome/i
  );
  cleanup(s);
});

test('outcome measurement cannot predate verification or attach to a rolled-back execution', async () => {
  const events = new Map();
  const healthy = {
    applyTrustedEvent({ eventKey }) {
      const x = {
        event: { id: 'wf-' + eventKey, eventKey, status: 'ACCEPTED' },
        decision: { status: 'ACCEPTED', reasonCode: 'OK' }
      };
      events.set(eventKey, x.event);
      return x;
    },
    getTrustedEvent({ eventKey }) {
      return events.get(eventKey) || null;
    }
  };
  const s1 = setup(healthy);
  const permit1 = s1.engine.issueHumanPermit({
    tenant: 'A',
    episodeId: s1.e.episodeId,
    optionId: 'overtime',
    actorRef: 'm',
    contextRevision: 'r7',
    plan: plan()
  });
  const verified = await s1.engine.executePermit({
    tenant: 'A',
    permitId: permit1.permitId,
    currentContextRevision: 'r7'
  });
  assert.throws(
    () => s1.engine.recordVerifiedOutcome({
      tenant: 'A',
      executionId: verified.executionId,
      observedAt: '2000-01-01T00:00:00Z',
      evidenceRefs: ['measure:old'],
      actual: { planAttainmentPct: 90 }
    }),
    /cannot predate execution verification/i
  );
  cleanup(s1);

  const rollbackEvents = new Map();
  let failReadback = true;
  const rollbackLifecycle = {
    applyTrustedEvent({ eventKey }) {
      const x = {
        event: { id: 'wf-' + eventKey, eventKey, status: 'ACCEPTED' },
        decision: { status: 'ACCEPTED', reasonCode: 'OK' }
      };
      rollbackEvents.set(eventKey, x.event);
      return x;
    },
    getTrustedEvent({ eventKey }) {
      if (eventKey === 'ot' && failReadback) {
        failReadback = false;
        return null;
      }
      return rollbackEvents.get(eventKey) || null;
    }
  };
  const s2 = setup(rollbackLifecycle);
  const permit2 = s2.engine.issueHumanPermit({
    tenant: 'A',
    episodeId: s2.e.episodeId,
    optionId: 'overtime',
    actorRef: 'm',
    contextRevision: 'r7',
    plan: plan()
  });
  const rolledBack = await s2.engine.executePermit({
    tenant: 'A',
    permitId: permit2.permitId,
    currentContextRevision: 'r7'
  });
  assert.equal(rolledBack.state, 'ROLLED_BACK');
  assert.throws(
    () => s2.engine.recordVerifiedOutcome({
      tenant: 'A',
      executionId: rolledBack.executionId,
      observedAt: '2099-01-01T00:00:00Z',
      evidenceRefs: ['measure:invalid'],
      actual: { planAttainmentPct: 90 }
    }),
    /until execution is independently VERIFIED/i
  );
  cleanup(s2);
});
