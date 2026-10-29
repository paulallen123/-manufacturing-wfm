'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { fork } = require('node:child_process');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = '/api/integrations/autonomous';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://vector.example.test';
const TOKENS = { manager: 'a'.repeat(64), second: 's'.repeat(64), other: 'b'.repeat(64) };

function seed(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);' +
      'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
    for (const [name, tenant, role] of [
      ['manager', 'alpha', 'manager'], ['second', 'alpha', 'manager'], ['other', 'bravo', 'admin']
    ]) {
      db.prepare('INSERT INTO users VALUES(?,?,?)').run(name, tenant, role);
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
        createHash('sha256').update(TOKENS[name]).digest('hex'), name, Date.now() + 600_000);
    }
  } finally { db.close(); }
}

function start(dbPath) {
  const child = fork(join(__dirname, 'fixtures/gusto-http-child.cjs'), [dbPath],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('HTTP child startup timed out: ' + errors)), 10_000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`HTTP child exited ${code}: ${errors}`)); });
    child.on('message', message => {
      if (message?.type === 'ready') { clearTimeout(timeout); resolve(message.port); }
    });
  });
  return { child, ready };
}

async function crash(worker) {
  if (worker.child.exitCode !== null || worker.child.signalCode !== null) return;
  const exited = new Promise(resolve => worker.child.once('exit', resolve));
  worker.child.kill('SIGKILL');
  await exited;
}

async function setDenial(worker, value) {
  const acknowledged = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { worker.child.off('message', onMessage); reject(new Error('Denial control timed out')); }, 5_000);
    function onMessage(message) {
      if (message?.type === 'denial-set') {
        clearTimeout(timeout);
        worker.child.off('message', onMessage);
        resolve();
      }
    }
    worker.child.on('message', onMessage);
  });
  worker.child.send({ type: 'denial', value });
  await acknowledged;
}

async function call(port, token, method, suffix, body, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${PREFIX}${suffix}`, {
    method,
    signal: AbortSignal.timeout(10_000),
    headers: { ...(token ? { cookie: 'wfm_session=' + TOKENS[token] } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text();
  return { status: response.status, body: raw ? JSON.parse(raw) : null };
}

for (const denial of ['forbidden', 'wrong-company', 'missing-scope']) {
  test(`Gusto ${denial} denial survives real HTTP and a separate-process reopen`, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'vector-gusto-http-'));
    const dbPath = join(directory, 'hub.sqlite');
    seed(dbPath);
    let worker = start(dbPath);
    t.after(async () => {
      if (worker) await crash(worker);
      rmSync(directory, { recursive: true, force: true });
    });
    let port = await worker.ready;
    const discovered = await call(port, 'manager', 'POST', '/discover', {
      source: 'USER', apps: [{ productKey: 'gusto', name: 'Gusto' }]
    });
    assert.equal(discovered.status, 200);
    const candidateId = discovered.body.candidates[0].id;
    assert.equal((await call(port, 'manager', 'POST', '/confirm', {
      candidateId, authoritativeFor: ['people', 'payroll']
    })).status, 200);
    const connected = await call(port, 'manager', 'POST', '/connect', { candidateId, authMethod: 'oauth2' });
    assert.equal(connected.status, 200);
    const connectionId = connected.body.connection.id;
    const authorization = await call(port, 'manager', 'POST', '/gusto/authorize',
      { connectionId, expectedCompanyUuid: COMPANY }, { origin: ORIGIN });
    assert.equal(authorization.status, 200);
    const state = new URL(authorization.body.authorizationUrl).searchParams.get('state');
    assert.equal((await call(port, 'manager', 'POST', '/gusto/complete',
      { state, code: 'fixture-code' }, { origin: ORIGIN })).status, 200);
    assert.equal((await call(port, 'manager', 'POST', '/mapping-activate', {
      connectionId, mappings: [{ sourceField: 'employee_id', canonicalField: 'employeeId', confidence: 1 }]
    })).status, 200);
    assert.equal((await call(port, null, 'POST', '/sync-validate', {
      tenant: 'alpha', connectionId, records: [{ employee_id: 'synthetic-person' }]
    }, { 'x-wfm-integration-internal': 'fixture-worker' })).status, 200);
    assert.equal((await call(port, 'manager', 'GET', '/status')).body.readiness.readyForPeopleSync, true);

    await setDenial(worker, denial);
    const rejected = await call(port, 'manager', 'POST', '/gusto/verify', { connectionId }, { origin: ORIGIN });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.code, {
      forbidden: 'GUSTO_FORBIDDEN', 'wrong-company': 'GUSTO_COMPANY_MISMATCH',
      'missing-scope': 'GUSTO_SCOPE_REQUIRED'
    }[denial]);
    assert.doesNotMatch(JSON.stringify(rejected), /private-provider-detail|fixture-access-token|fixture-refresh-token/);
    await crash(worker);
    worker = start(dbPath);
    port = await worker.ready;
    const readback = await call(port, 'second', 'GET', '/status');
    assert.equal(readback.status, 200);
    assert.equal(readback.body.connections[0].state, 'REAUTH_REQUIRED');
    assert.equal(readback.body.readiness.readyForPeopleSync, false);
    assert.deepEqual((await call(port, 'other', 'GET', '/status')).body.connections, []);
    assert.equal((await call(port, null, 'POST', '/health-report',
      { connectionId, health: 'healthy' }, { 'x-wfm-integration-internal': 'fixture-worker' })).status, 409);
    const recovery = await call(port, 'manager', 'POST', '/gusto/verify', { connectionId }, { origin: ORIGIN });
    assert.equal(recovery.status, 200);
    assert.equal(recovery.body.connection.state, 'VALIDATING');
    assert.equal(recovery.body.dataSynced, false);
    assert.equal(recovery.body.payrollProof, false);
    await crash(worker);
    worker = start(dbPath);
    port = await worker.ready;
    const recoveredReadback = await call(port, 'second', 'GET', '/status');
    assert.equal(recoveredReadback.body.connections[0].state, 'VALIDATING');
    assert.equal(recoveredReadback.body.readiness.readyForPeopleSync, false);
  });
}
