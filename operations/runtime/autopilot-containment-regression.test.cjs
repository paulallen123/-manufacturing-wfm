'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createDecisionEpisode } = require('./decision-episode.cjs');
const { createAutopilotExecutionEngine } = require('./autopilot-execution-engine.cjs');

function setup(adapter) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-ap-containment-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE vector_decision_episodes(tenant TEXT,episode_id TEXT,decision_type TEXT,episode_json TEXT,created_at TEXT,PRIMARY KEY(tenant,episode_id));'+
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);'+
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
  const episode = createDecisionEpisode({ tenant: 'synthetic-tenant', site: 'synthetic-site',
    decisionType: 'absence-recovery', triggerId: 'synthetic-trigger',
    triggeredAt: '2026-10-13T10:00:00Z', contextRevision: 'r1', mode: 'SHADOW',
    sourceEvidence: ['synthetic-evidence'], objective: { labourCost: 1 },
    options: [{ id: 'do-nothing', feasible: true, policyAllowed: true, hardConstraintsPassed: true,
      uncertainty: 0, prediction: { labourCost: 2 } },
    { id: 'overtime', feasible: true, policyAllowed: true, hardConstraintsPassed: true,
      uncertainty: 0, prediction: { labourCost: 1 } }] });
  db.prepare('INSERT INTO vector_decision_episodes VALUES(?,?,?,?,?)').run(
    episode.tenant, episode.episodeId, episode.decisionType, JSON.stringify(episode), new Date().toISOString());
  db.close();
  const engine = createAutopilotExecutionEngine({ dbPath, lifecycleAdapter: adapter });
  const permit = engine.issueHumanPermit({ tenant: episode.tenant, episodeId: episode.episodeId,
    optionId: 'overtime', actorRef: 'synthetic-manager', contextRevision: 'r1',
    plan: { adapter: 'workforce-lifecycle', reversible: true,
      action: { eventKey: 'synthetic-action', kind: 'OVERTIME_OVERRIDE', employeeId: 'synthetic-worker',
        effectiveAt: '2026-10-13T12:00:00Z', payload: { minutes: 30 } },
      rollback: { eventKey: 'synthetic-rollback', reason: 'synthetic compensation' } } });
  return { dir, engine, permit, tenant: episode.tenant,
    close() { engine.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('unconfirmed apply is contained without attempting compensation and stays idempotent', async () => {
  const calls = [];
  const sample = setup({ applyTrustedEvent({ eventKey }) { calls.push(eventKey); throw new Error('synthetic adapter outage'); },
    getTrustedEvent() { throw new Error('must not read back after failed apply'); } });
  try {
    const args = { tenant: sample.tenant, permitId: sample.permit.permitId, currentContextRevision: 'r1' };
    const first = await sample.engine.executePermit(args);
    const retry = await sample.engine.executePermit(args);
    assert.equal(first.state, 'CONTAINED');
    assert.equal(first.detail.reason, 'NO_CONFIRMED_APPLY');
    assert.equal(retry.idempotent, true);
    assert.equal(retry.state, 'CONTAINED');
    assert.deepEqual(calls, ['synthetic-action']);
    assert.deepEqual(sample.engine.statusForTenant(sample.tenant).map(x => x.state),
      ['CONTAINED', 'VERIFY_FAILED', 'PREPARED']);
  } finally { sample.close(); }
});

test('failed compensating rollback is contained and never labeled verified', async () => {
  const calls = [];
  const sample = setup({ applyTrustedEvent({ eventKey }) {
    calls.push(eventKey);
    if (eventKey === 'synthetic-rollback') throw new Error('synthetic rollback outage');
    return { event: { id: 'wf-action' }, decision: { status: 'ACCEPTED' } };
  }, getTrustedEvent({ eventKey }) { calls.push(`read:${eventKey}`); return null; } });
  try {
    const args = { tenant: sample.tenant, permitId: sample.permit.permitId, currentContextRevision: 'r1' };
    const first = await sample.engine.executePermit(args);
    const retry = await sample.engine.executePermit(args);
    assert.equal(first.state, 'CONTAINED');
    assert.equal(first.detail.reason, 'ROLLBACK_UNCONFIRMED');
    assert.equal(retry.idempotent, true);
    assert.equal(retry.state, 'CONTAINED');
    assert.deepEqual(calls, ['synthetic-action', 'read:synthetic-action', 'synthetic-rollback']);
    assert.deepEqual(sample.engine.statusForTenant(sample.tenant).map(x => x.state),
      ['CONTAINED', 'VERIFY_FAILED', 'APPLIED', 'PREPARED']);
  } finally { sample.close(); }
});

test('characterizes unresolved post-write throw: accepted action has no compensation', async () => {
  const persisted = new Map();
  const calls = [];
  const sample = setup({ applyTrustedEvent({ eventKey }) {
    calls.push(eventKey);
    persisted.set(eventKey, { id: 'wf-action', status: 'ACCEPTED' });
    throw new Error('synthetic response lost after lifecycle insert');
  }, getTrustedEvent({ eventKey }) { calls.push(`read:${eventKey}`); return persisted.get(eventKey); } });
  try {
    const result = await sample.engine.executePermit({ tenant: sample.tenant,
      permitId: sample.permit.permitId, currentContextRevision: 'r1' });
    assert.equal(result.state, 'CONTAINED');
    assert.equal(result.detail.reason, 'NO_CONFIRMED_APPLY');
    assert.equal(persisted.get('synthetic-action').status, 'ACCEPTED');
    assert.deepEqual(calls, ['synthetic-action']);
    assert.equal(persisted.has('synthetic-rollback'), false);
  } finally { sample.close(); }
});
