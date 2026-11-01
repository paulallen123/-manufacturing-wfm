import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

// Run only against a locally composed fixture runtime and a disposable database.
const runtime = process.env.WFM_RUNTIME;
const fixturePassword = process.env.VECTOR_FIXTURE_PASSWORD;
assert.ok(runtime, 'WFM_RUNTIME must point to the isolated composed fixture runtime');
assert.ok(fixturePassword, 'VECTOR_FIXTURE_PASSWORD must contain the synthetic fixture password');

async function makeObservedHarness(dir, database) {
  let source = fs.readFileSync(new URL('./attendance-runtime-harness.mjs', import.meta.url), 'utf8');
  const original = "return {start,stop,get origin(){return current?.origin||'';},get pid(){return current?.process.pid;}};";
  const observed = "return {start,stop,get origin(){return current?.origin||'';},get pid(){return current?.process.pid;},get diagnostics(){return current?.diagnostics||'';}};";
  const inherited = "env:{...process.env,PORT:'0',WFM_DB:database,WFM_HOSTED_STAGING:'false',NODE_ENV:'test'},";
  const isolated = "env:{PATH:process.env.PATH||'/usr/bin:/bin',PORT:'0',WFM_DB:database,WFM_HOSTED_STAGING:'false',NODE_ENV:'test'},";
  assert.ok(source.includes(original), 'test-only harness diagnostics hook must match the current harness');
  const verboseStartup = "throw Error(error.message+'\\n'+child.diagnostics);";
  const safeStartup = "throw Error('Synthetic attendance runtime failed to start');";
  assert.ok(source.includes(inherited), 'test-only harness environment hook must match the current harness');
  assert.ok(source.includes(verboseStartup), 'test-only harness startup hook must match the current harness');
  source = source.replace(inherited, isolated).replace(verboseStartup, safeStartup);
  const copy = path.join(dir, 'attendance-runtime-observed.mjs');
  fs.writeFileSync(copy, source.replace(original, observed));
  const { createAttendanceRuntime } = await import(pathToFileURL(copy).href);
  return createAttendanceRuntime({ runtime, database });
}

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-kiosk-recovery-'));
  const database = path.join(dir, 'fixture.sqlite');
  let harness;
  let origin;
  try {
    harness = await makeObservedHarness(dir, database);
    origin = await harness.start();
    async function post(route, body, headers = {}) {
      const response = await fetch(origin + route, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      };
    }
    const login = await post('/api/login', {
      email: 'superuser@northstar.example', password: fixturePassword,
    });
    assert.equal(login.status, 200);
    const device = await post('/api/kiosk/devices/register', {
      site: 'Tamworth', name: 'Synthetic recovery kiosk',
    }, { cookie: login.cookie });
    assert.equal(device.status, 200);
    const headers = {
      'x-device-id': device.body.id,
      authorization: 'Device ' + device.body.secret,
    };
    const now = Date.now();
    const events = [
      { eventId: 'synthetic-in-0001', sequence: 1, employee: 'e0', type: 'in', capturedAt: new Date(now - 60000).toISOString() },
      { eventId: 'synthetic-out-0002', sequence: 2, employee: 'e0', type: 'out', capturedAt: new Date(now - 1000).toISOString() },
    ];
    return {
      database, events, headers, post, harness,
      async restart() { await harness.stop(); origin = await harness.start(); },
      async stop() { await harness.stop(); },
      async close() { await harness.stop(); fs.rmSync(dir, { recursive: true, force: true }); },
    };
  } catch (error) {
    if (harness) await harness.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function state(fixture) {
  const db = new DatabaseSync(fixture.database, { readOnly: true });
  try {
    return {
      kioskEvents: db.prepare('SELECT COUNT(*) AS n FROM kiosk_events').get().n,
      lastSequence: db.prepare('SELECT last_sequence AS n FROM kiosk_devices').get().n,
      personalEvents: db.prepare('SELECT COUNT(*) AS n FROM personal_event').get().n,
      audits: db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='personal-clock'").get().n,
    };
  } finally { db.close(); }
}

function inject(database, sql) {
  const db = new DatabaseSync(database);
  try { db.exec(sql); } finally { db.close(); }
}

async function assertFaultReached(response, harness, marker) {
  if (response.status === 200) {
    assert.equal(response.body.results?.[0]?.status, 'held');
    assert.match(response.body.results?.[0]?.error || '', new RegExp(marker));
    return;
  }
  assert.ok(response.status >= 500, 'the failed write must not be acknowledged as accepted');
  const deadline = Date.now() + 2000;
  while (!harness.diagnostics.includes(marker) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(harness.diagnostics.includes(marker), 'server diagnostics must identify the injected fault');
}

test('normal kiosk in and out persist exactly once with audit', async () => {
  const fixture = await setup();
  try {
    const result = await fixture.post('/api/kiosk/sync', { events: fixture.events }, fixture.headers);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.results.map(row => row.status), ['accepted', 'accepted']);
    assert.deepEqual(state(fixture), { kioskEvents: 2, lastSequence: 2, personalEvents: 2, audits: 2 });
  } finally { await fixture.close(); }
});

test('sequence update failure permits ordered replay after restart', async t => {
  const fixture = await setup();
  try {
    inject(fixture.database, "CREATE TRIGGER v041_sequence_fault BEFORE UPDATE OF last_sequence ON kiosk_devices BEGIN SELECT RAISE(ABORT,'synthetic sequence fault'); END;");
    const failed = await fixture.post('/api/kiosk/sync', { events: [fixture.events[0]] }, fixture.headers);
    await assertFaultReached(failed, fixture.harness, 'synthetic sequence fault');
    t.diagnostic('after injected sequence failure: ' + JSON.stringify(state(fixture)));
    await fixture.stop();
    inject(fixture.database, 'DROP TRIGGER v041_sequence_fault');
    await fixture.restart();
    const replay = await fixture.post('/api/kiosk/sync', { events: fixture.events }, fixture.headers);
    t.diagnostic('replay statuses: ' + JSON.stringify(replay.body.results?.map(row => row.status)));
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body.results.map(row => row.status), ['accepted', 'accepted']);
    assert.deepEqual(state(fixture), { kioskEvents: 2, lastSequence: 2, personalEvents: 2, audits: 2 });
  } finally { await fixture.close(); }
});

test('kiosk event insert failure permits exact replay after restart', async t => {
  const fixture = await setup();
  try {
    inject(fixture.database, "CREATE TRIGGER v041_event_fault BEFORE INSERT ON kiosk_events BEGIN SELECT RAISE(ABORT,'synthetic event insert fault'); END;");
    const failed = await fixture.post('/api/kiosk/sync', { events: [fixture.events[0]] }, fixture.headers);
    await assertFaultReached(failed, fixture.harness, 'synthetic event insert fault');
    t.diagnostic('after injected event failure: ' + JSON.stringify(state(fixture)));
    await fixture.stop();
    inject(fixture.database, 'DROP TRIGGER v041_event_fault');
    await fixture.restart();
    const replay = await fixture.post('/api/kiosk/sync', { events: [fixture.events[0]] }, fixture.headers);
    t.diagnostic('replay status: ' + JSON.stringify(replay.body.results?.[0]?.status));
    assert.equal(replay.status, 200);
    assert.equal(replay.body.results[0].status, 'accepted');
    assert.deepEqual(state(fixture), { kioskEvents: 1, lastSequence: 1, personalEvents: 1, audits: 1 });
  } finally { await fixture.close(); }
});
