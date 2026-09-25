'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  CONTRACT_VERSION,
  parseDate,
  parseHours,
  deterministicInterpret,
  normaliseLocale,
  createVectorOperationsBot
} = require('./vector-operations-bot.cjs');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-operations-bot-'));
  const dbPath = path.join(dir, 'wfm.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);'
  );
  const user = db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)');
  const session = db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)');
  const accounts = [
    ['worker@alpha.example', 'alpha', 'employee', 'worker-token'],
    ['manager@alpha.example', 'alpha', 'manager', 'manager-token'],
    ['worker@beta.example', 'beta', 'employee', 'beta-token']
  ];
  for (const [email, tenant, role, token] of accounts) {
    user.run(email, tenant, role);
    session.run(sha256(token), email, Date.now() + 60 * 60 * 1000);
  }
  db.close();
  return {
    dir,
    dbPath,
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

async function startBot(dbPath, options = {}) {
  const bot = createVectorOperationsBot({ dbPath, ...options });
  const server = http.createServer(async (req, res) => {
    if (!(await bot.handleRequest(req, res))) {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    base: 'http://127.0.0.1:' + address.port,
    bot,
    async close() {
      bot.close();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

async function api(base, token, route, method = 'GET', body) {
  const response = await fetch(base + '/api/workforce/lifecycle/operations-bot' + route, {
    method,
    headers: {
      cookie: 'wfm_session=' + token,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const value = await response.json();
  return { status: response.status, value };
}

test('date, hour and locale parsing is strict and language-neutral', () => {
  assert.equal(parseDate('2026-10-02'), '2026-10-02');
  assert.equal(parseDate('02/10/2026'), '2026-10-02');
  assert.equal(parseDate('99/99/2026'), null);
  assert.equal(parseHours('7.5 hours'), 7.5);
  assert.equal(parseHours('7,5 heures'), 7.5);
  assert.equal(parseHours('20 hours'), null);
  assert.equal(normaliseLocale('fr_FR'), 'fr-FR');
  assert.equal(normaliseLocale('../bad'), 'en-GB');
});

test('deterministic fallback recognises multilingual leave requests without inventing missing data', () => {
  const french = deterministicInterpret('Je veux demander congé le 02/10/2026 pour 7,5 heures', 'fr-FR', 'employee');
  assert.equal(french.kind, 'action');
  assert.equal(french.capability, 'leave.request');
  assert.deepEqual({ ...french.args }, { date: '2026-10-02', hours: 7.5 });

  const german = deterministicInterpret('Urlaub beantragen am 2026-10-03', 'de-DE', 'employee');
  assert.equal(german.kind, 'needs_parameters');
  assert.deepEqual(Array.from(german.missing), ['hours']);

  const manager = deterministicInterpret('Book holiday 2026-10-02 for 7.5 hours', 'en-GB', 'manager');
  assert.equal(manager.kind, 'unsupported');
});

test('employee gets only employee-safe executable capabilities', async t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const runtime = await startBot(f.dbPath);
  t.after(() => runtime.close());

  const result = await api(runtime.base, 'worker-token', '/capabilities');
  assert.equal(result.status, 200);
  assert.equal(result.value.contractVersion, CONTRACT_VERSION);
  assert.deepEqual(result.value.capabilities.map(item => item.key), ['leave.request']);
});

test('manager receives non-mutating operational navigation capabilities but not employee leave mutation', async t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const runtime = await startBot(f.dbPath);
  t.after(() => runtime.close());

  const result = await api(runtime.base, 'manager-token', '/capabilities');
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.value.capabilities.map(item => item.key).sort(),
    ['agency.open', 'factory.open', 'time_review.open']
  );
});

test('leave request follows plan -> explicit confirmation -> typed execution -> verified completion', async t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const runtime = await startBot(f.dbPath);
  t.after(() => runtime.close());

  const planned = await api(runtime.base, 'worker-token', '/plan', 'POST', {
    message: 'Please book annual leave 2026-10-02 for 7.5 hours',
    locale: 'en-GB'
  });
  assert.equal(planned.status, 200);
  assert.equal(planned.value.supported, true);
  assert.equal(planned.value.offerToAct, true);
  assert.match(planned.value.confirmation, /like me to do/i);
  assert.equal(planned.value.plan.capability, 'leave.request');
  assert.deepEqual(planned.value.plan.args, { date: '2026-10-02', hours: 7.5 });

  const refused = await api(runtime.base, 'worker-token', '/execute', 'POST', {
    planId: planned.value.plan.id,
    confirm: false
  });
  assert.equal(refused.status, 400);

  const authorised = await api(runtime.base, 'worker-token', '/execute', 'POST', {
    planId: planned.value.plan.id,
    confirm: true
  });
  assert.equal(authorised.status, 200);
  assert.equal(authorised.value.execution.type, 'vector_workflow');
  assert.equal(authorised.value.execution.operation, 'leaveRequest');
  assert.deepEqual(authorised.value.execution.args, { date: '2026-10-02', hours: 7.5 });
  assert.equal(authorised.value.verifyAfterExecution, true);

  const completed = await api(runtime.base, 'worker-token', '/complete', 'POST', {
    planId: planned.value.plan.id,
    ok: true,
    receipt: { id: 'leave-123', status: 'pending', version: '42' }
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.value.ok, true);
  assert.equal(completed.value.receipt.id, 'leave-123');

  const replay = await api(runtime.base, 'worker-token', '/execute', 'POST', {
    planId: planned.value.plan.id,
    confirm: true
  });
  assert.equal(replay.status, 409);
});

test('plan ownership and tenant scope are rechecked at execution', async t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const runtime = await startBot(f.dbPath);
  t.after(() => runtime.close());

  const planned = await api(runtime.base, 'worker-token', '/plan', 'POST', {
    message: 'Book holiday 2026-10-02 for 8 hours',
    locale: 'en-GB'
  });
  const otherTenant = await api(runtime.base, 'beta-token', '/execute', 'POST', {
    planId: planned.value.plan.id,
    confirm: true
  });
  assert.equal(otherTenant.status, 404);

  const manager = await api(runtime.base, 'manager-token', '/execute', 'POST', {
    planId: planned.value.plan.id,
    confirm: true
  });
  assert.equal(manager.status, 404);
});

test('unknown requests and capability questions never manufacture an executable plan', async t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const runtime = await startBot(f.dbPath);
  t.after(() => runtime.close());

  const unknown = await api(runtime.base, 'worker-token', '/plan', 'POST', {
    message: 'Move 50 people between factories and release payroll',
    locale: 'en-GB'
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.value.supported, false);
  assert.equal(unknown.value.offerToAct, false);
  assert.equal(unknown.value.plan, undefined);

  const question = await api(runtime.base, 'worker-token', '/plan', 'POST', {
    message: 'What can you do?',
    locale: 'en-GB'
  });
  assert.equal(question.status, 200);
  assert.equal(question.value.offerToAct, false);
  assert.equal(question.value.plan, undefined);
});

test('French voice/text locale receives a French confirmation while execution remains language-neutral', async t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const runtime = await startBot(f.dbPath);
  t.after(() => runtime.close());

  const planned = await api(runtime.base, 'worker-token', '/plan', 'POST', {
    message: 'Je veux demander congé le 02/10/2026 pour 7,5 heures',
    locale: 'fr-FR'
  });
  assert.equal(planned.status, 200);
  assert.match(planned.value.confirmation, /Voulez-vous/);
  assert.deepEqual(planned.value.plan.args, { date: '2026-10-02', hours: 7.5 });
});

test('an injected language interpreter may classify any language but cannot create an unregistered capability', async t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const intentProvider = async ({ message }) => {
    if (message.includes('ጥያቄ')) {
      return { kind: 'action', capability: 'leave.request', args: { date: '2026-10-05', hours: 8 } };
    }
    return { kind: 'action', capability: 'dangerous.unregistered', args: {} };
  };
  const runtime = await startBot(f.dbPath, { intentProvider });
  t.after(() => runtime.close());

  const allowed = await api(runtime.base, 'worker-token', '/plan', 'POST', {
    message: 'ጥያቄ',
    locale: 'am-ET'
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.value.plan.capability, 'leave.request');

  const refused = await api(runtime.base, 'worker-token', '/plan', 'POST', {
    message: 'anything else',
    locale: 'am-ET'
  });
  assert.equal(refused.status, 200);
  assert.equal(refused.value.offerToAct, false);
  assert.equal(refused.value.plan, undefined);
});

test('audit rows are append-only and record the execution lifecycle', async t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const runtime = await startBot(f.dbPath);

  const planned = await api(runtime.base, 'worker-token', '/plan', 'POST', {
    message: 'Book leave 2026-10-02 8 hours',
    locale: 'en-GB'
  });
  await api(runtime.base, 'worker-token', '/execute', 'POST', {
    planId: planned.value.plan.id,
    confirm: true
  });
  await api(runtime.base, 'worker-token', '/complete', 'POST', {
    planId: planned.value.plan.id,
    ok: true,
    receipt: { id: 'leave-audit', status: 'pending' }
  });

  await runtime.close();

  const db = new DatabaseSync(f.dbPath);
  const events = db.prepare(
    'SELECT event FROM vector_operations_bot_audit WHERE plan_id=? ORDER BY created_at,id'
  ).all(planned.value.plan.id).map(row => row.event);
  assert.deepEqual(events.sort(), ['EXECUTION_AUTHORIZED', 'EXECUTION_VERIFIED_BY_WORKFLOW', 'PLAN_CREATED'].sort());
  assert.throws(() => {
    db.prepare('UPDATE vector_operations_bot_audit SET event=? WHERE plan_id=?')
      .run('TAMPERED', planned.value.plan.id);
  }, /append only/i);
  db.close();
});
