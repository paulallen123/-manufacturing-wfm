import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OneDriveSyncGuardian, ConflictError, classifyOneDriveError } from './onedrive-sync-guardian.mjs';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function httpError(status, code = '') { const e = new Error(`HTTP ${status}`); e.status = status; e.code = code; return e; }

async function guardianFor(adapter, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'wfm-od-guardian-'));
  return new OneDriveSyncGuardian({
    adapter,
    target: { driveId: 'drive-1', itemId: 'master-1' },
    config: {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 2,
      jitterRatio: 0,
      circuitFailureThreshold: 2,
      circuitResetMs: 100,
      snapshotPath: join(dir, 'snapshot.json'),
      queueDir: join(dir, 'queue'),
      ...overrides,
    },
    sleep: async () => {},
    logger: { warn() {} },
  });
}

test('classifies auth, throttle and service failures', async () => {
  assert.equal(classifyOneDriveError(httpError(401)).kind, 'auth');
  assert.equal(classifyOneDriveError(httpError(429)).retryable, true);
  assert.equal(classifyOneDriveError(httpError(502)).kind, 'service');
});

test('retries transient direct failures and succeeds without fallback', async () => {
  let calls = 0;
  const g = await guardianFor({
    async fetchExact() { calls += 1; if (calls < 3) throw httpError(502); return { id: 'master-1', eTag: 'v1', content: 'A' }; },
  });
  const result = await g.readMaster();
  assert.equal(result.source, 'direct');
  assert.equal(calls, 3);
  assert.equal(result.remote.content, 'A');
});

test('uses fallback after direct retries are exhausted', async () => {
  let fallback = 0;
  const g = await guardianFor({
    async fetchExact() { throw httpError(502); },
    async recoverExact() { fallback += 1; return { id: 'master-1', eTag: 'v7', content: 'Recovered' }; },
  });
  const result = await g.readMaster();
  assert.equal(result.source, 'fallback');
  assert.equal(fallback, 1);
  assert.equal(result.remote.version, 'v7');
});

test('does not hide authentication failures behind fallback', async () => {
  let fallback = 0;
  const g = await guardianFor({
    async fetchExact() { throw httpError(401); },
    async recoverExact() { fallback += 1; return { id: 'master-1', content: 'wrong' }; },
  });
  await assert.rejects(g.readMaster(), (error) => error.status === 401);
  assert.equal(fallback, 0);
});

test('falls back to last-known-good snapshot when Microsoft stays unavailable', async () => {
  let online = true;
  const adapter = {
    async fetchExact() { if (!online) throw httpError(503); return { id: 'master-1', eTag: 'v1', content: 'Stable' }; },
    async recoverExact() { throw httpError(503); },
  };
  const g = await guardianFor(adapter, { circuitFailureThreshold: 99 });
  await g.readMaster();
  online = false;
  const result = await g.readMaster();
  assert.equal(result.source, 'snapshot');
  assert.equal(result.stale, true);
  assert.equal(result.remote.content, 'Stable');
});

test('refuses a stale base version before writing', async () => {
  const g = await guardianFor({
    async fetchExact() { return { id: 'master-1', eTag: 'v2', content: 'Current' }; },
    async writeExact() { throw new Error('must not write'); },
  });
  await assert.rejects(
    g.applyChange({ baseVersion: 'v1', delta: 'X', merge: (content, delta) => content + delta }),
    ConflictError,
  );
});

test('passes expectedVersion to an exact write and persists a refreshed snapshot', async () => {
  let expected;
  const g = await guardianFor({
    async fetchExact() { return { id: 'master-1', eTag: 'v3', content: 'Base' }; },
    async writeExact(_target, content, opts) { expected = opts.expectedVersion; return { id: 'master-1', eTag: 'v4', content }; },
  });
  const result = await g.applyChange({ delta: '+delta', merge: (content, delta) => content + delta });
  assert.equal(result.status, 'written');
  assert.equal(expected, 'v3');
  assert.equal(result.remote.content, 'Base+delta');
});

test('queues a delta instead of losing it when a write has a transient failure', async () => {
  const g = await guardianFor({
    async fetchExact() { return { id: 'master-1', eTag: 'v1', content: 'Base' }; },
    async writeExact() { throw httpError(503); },
  }, { circuitFailureThreshold: 99 });
  const result = await g.applyChange({ description: 'append log', delta: { text: 'X' }, merge: (content, delta) => `${content}${delta.text}` });
  assert.equal(result.status, 'queued');
  const queued = JSON.parse(await readFile(result.queued.path, 'utf8'));
  assert.equal(queued.delta.text, 'X');
  assert.equal(queued.baseVersion, 'v1');
});

test('flushes a queued delta once connectivity returns', async () => {
  let failWrite = true;
  let version = 1;
  let content = 'Base';
  const adapter = {
    async fetchExact() { return { id: 'master-1', eTag: `v${version}`, content }; },
    async writeExact(_target, next, opts) {
      if (failWrite) throw httpError(503);
      assert.equal(opts.expectedVersion, `v${version}`);
      content = next; version += 1;
      return { id: 'master-1', eTag: `v${version}`, content };
    },
  };
  const g = await guardianFor(adapter, { circuitFailureThreshold: 99 });
  const queued = await g.applyChange({ delta: { text: '+Q' }, merge: (c, d) => c + d.text });
  assert.equal(queued.status, 'queued');
  failWrite = false;
  const flushed = await g.flushQueue({ merge: (c, d) => c + d.text });
  assert.equal(flushed[0].status, 'written');
  assert.equal(content, 'Base+Q');
});

test('opens the circuit after repeated complete read failures', async () => {
  let now = 1000;
  const dir = await mkdtemp(join(tmpdir(), 'wfm-od-circuit-'));
  const g = new OneDriveSyncGuardian({
    adapter: { async fetchExact() { throw httpError(503); }, async recoverExact() { throw httpError(503); } },
    target: { itemId: 'master-1' },
    config: { maxAttempts: 1, circuitFailureThreshold: 2, circuitResetMs: 100, snapshotPath: join(dir, 's.json'), queueDir: join(dir, 'q') },
    clock: () => now,
    sleep: async () => {}, logger: { warn() {} },
  });
  await assert.rejects(g.readMaster());
  await assert.rejects(g.readMaster());
  assert.equal(g.circuitState().state, 'open');
  await assert.rejects(g.readMaster(), (error) => error.code === 'CIRCUIT_OPEN');
  now += 101;
  assert.equal(g.circuitState().state, 'half-open');
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
    break;
  }
}
console.log(`${passed}/${tests.length} OneDrive guardian checks passed`);
