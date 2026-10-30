import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const modulePath = fileURLToPath(new URL('./durable-outcome-ledger.mjs', import.meta.url));
const { DurableOutcomeLedger } = await import(pathToFileURL(modulePath).href);
const fixture = (evidenceRef, overrides = {}) => ({
  tenantScope: 'tenant-a', source: 'signed-evaluation', category: 'shift-quality',
  fingerprint: 'late-handoff', baseline: 7, result: 9,
  verified: true, evidenceRef, createdAt: '2026-10-30T00:00:00.000Z', ...overrides,
});
function tempDb(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vector-v123-heldout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'outcomes.sqlite');
}

test('a child process commits a win and a distinct process replays it after restart', t => {
  const db = tempDb(t);
  const script = `import { DurableOutcomeLedger } from ${JSON.stringify(pathToFileURL(modulePath).href)};
    const ledger = new DurableOutcomeLedger({path:process.env.V123_DB,minRepeatedWins:2});
    ledger.ingestOutcome(${JSON.stringify(fixture('proof-1'))}); ledger.close();`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, V123_DB: db }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(child.status, 0, child.stderr);
  const reopened = new DurableOutcomeLedger({ path: db, minRepeatedWins: 2 });
  t.after(() => reopened.close());
  assert.equal(reopened.snapshot().outcomes.length, 1);
  reopened.ingestOutcome(fixture('proof-2', { createdAt: '2026-10-30T00:00:01.000Z' }));
  assert.equal(reopened.snapshot().skills.length, 1);
  assert.equal(reopened.snapshot().skills[0].verifiedWinCount, 2);
});

test('duplicate evidence is idempotent across handles and conflicting replay rolls back', t => {
  const db = tempDb(t);
  const first = new DurableOutcomeLedger({ path: db, minRepeatedWins: 2 });
  const second = new DurableOutcomeLedger({ path: db, minRepeatedWins: 2 });
  t.after(() => { first.close(); second.close(); });
  const original = first.ingestOutcome(fixture('proof-1'));
  assert.deepEqual(second.ingestOutcome(fixture('proof-1', { createdAt: undefined })), original);
  assert.throws(() => second.ingestOutcome(fixture('proof-1', { result: 99 })), /REPLAY_CONFLICT/);
  assert.equal(first.snapshot().outcomes.length, 1);
  first.ingestOutcome(fixture('proof-1', { tenantScope: 'tenant-b' }));
  assert.equal(second.snapshot().outcomes.length, 2);
  assert.equal(second.snapshot().skills.length, 0);
});

test('inert validation rejects accessors without invoking them or inserting rows', t => {
  const db = tempDb(t);
  const ledger = new DurableOutcomeLedger({ path: db });
  t.after(() => ledger.close());
  let getterCalled = false;
  const malicious = fixture('proof-1');
  Object.defineProperty(malicious, 'source', { enumerable: true, get() { getterCalled = true; throw new Error('SIDE_EFFECT'); } });
  assert.throws(() => ledger.ingestOutcome(malicious), /INERT_RECORD_REQUIRED/);
  assert.equal(getterCalled, false);
  assert.throws(() => ledger.ingestOutcome(fixture('proof-2', { containsSecret: true })), /FORBIDDEN/);
  assert.throws(() => ledger.ingestOutcome(fixture('proof-3', { baseline: NaN })), /FINITE_VALUES_REQUIRED/);
  assert.equal(ledger.snapshot().outcomes.length, 0);
});

test('corrupt stored row fails closed on reopen', t => {
  const db = tempDb(t);
  const ledger = new DurableOutcomeLedger({ path: db });
  ledger.ingestOutcome(fixture('proof-1'));
  ledger.close();
  const sql = new DatabaseSync(db);
  sql.prepare('UPDATE outcome_replay SET evidence=? WHERE evidence=?').run('altered-proof', 'proof-1');
  sql.close();
  assert.throws(() => new DurableOutcomeLedger({ path: db }), /OUTCOME_REPLAY_ROW_INVALID/);
});

test('uncommitted SQLite append is absent after writer process is killed', t => {
  const db = tempDb(t);
  const original = new DurableOutcomeLedger({ path: db });
  original.ingestOutcome(fixture('committed'));
  original.close();
  const pending = JSON.stringify(fixture('uncommitted'));
  const script = `import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.env.V123_DB);
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO outcome_replay (tenant,source,evidence,input_json) VALUES (?,?,?,?)')
      .run('tenant-a','signed-evaluation','uncommitted', ${JSON.stringify(pending)});
    process.kill(process.pid, 'SIGKILL');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, V123_DB: db }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  const reopened = new DurableOutcomeLedger({ path: db });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.snapshot().outcomes.map(x => x.evidenceRef), ['committed']);
});

test('replay preserves the decision threshold across process configuration changes', t => {
  const db = tempDb(t);
  const original = new DurableOutcomeLedger({ path: db, minRepeatedWins: 2 });
  original.ingestOutcome(fixture('proof-1'));
  original.ingestOutcome(fixture('proof-2', { createdAt: '2026-10-30T00:00:01.000Z' }));
  assert.equal(original.snapshot().skills.length, 1);
  original.close();
  // Reusing a ledger with a different threshold silently changes prior learned decisions.
  assert.throws(() => new DurableOutcomeLedger({ path: db, minRepeatedWins: 3 }), /LEARNING_THRESHOLD_REPLAY_MISMATCH/);
});

test('derived evaluation and candidate timestamps replay identically across reopen', t => {
  const db = tempDb(t);
  const first = new DurableOutcomeLedger({ path: db, minRepeatedWins: 2 });
  first.ingestOutcome(fixture('win-1'));
  first.ingestOutcome(fixture('win-2', { createdAt: '2026-10-30T00:00:01.000Z' }));
  first.ingestOutcome(fixture('regression', {
    fingerprint: 'safety-rollback', baseline: 10, result: 3,
    createdAt: '2026-10-30T00:00:02.000Z',
  }));
  const snapshot = first.snapshot();
  assert.equal(snapshot.skills.length, 1);
  assert.equal(snapshot.evals.length, 1);
  first.close();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  const reopened = new DurableOutcomeLedger({ path: db, minRepeatedWins: 2 });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.snapshot(), snapshot);
});
