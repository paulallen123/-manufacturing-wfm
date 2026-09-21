'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(__dirname, 'vector-workflows.js'), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('Vector workflow controller uses real authentication, saved checks and restart recovery', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-workflow-'));
  const runtime = path.join(directory, 'runtime');
  execFileSync(process.execPath, [path.join(root, 'scripts/compose-vector-local-runtime.mjs'), runtime], { stdio: 'pipe' });
  const dbPath = path.join(directory, 'test.sqlite');
  const port = 43217, origin = 'http://127.0.0.1:' + port;
  let child;
  async function start() {
    child = spawn(process.execPath, ['--require', path.join(runtime, 'local-paths.cjs'), path.join(runtime, 'security-runtime/bootstrap.cjs')], {
      env: { ...process.env, WFM_DB: dbPath, PORT: String(port), WFM_HOSTED_STAGING: 'false', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let diagnostics = ''; child.stderr.on('data', data => { diagnostics += data; });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) throw Error('Runtime exited: ' + diagnostics);
      try { if ((await fetch(origin + '/api/health')).ok) return; } catch {}
      await delay(50);
    }
    throw Error('Runtime did not start: ' + diagnostics);
  }
  async function stop() { if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } }
  t.after(async () => { await stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await start();
  await t.test('real HTTP serves the workflow controller before its payroll consumer', async () => {
    const page = await fetch(origin + '/');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.indexOf('src="/vector-workflows.js"') >= 0);
    assert.ok(html.indexOf('src="/vector-workflows.js"') < html.indexOf('src="payroll-intelligence-ui.js"'));
    const asset = await fetch(origin + '/vector-workflows.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
    assert.match(asset.headers.get('cache-control'), /no-store/);
    assert.equal(await asset.text(), source);
    assert.doesNotMatch(html, /src="review-ui\.js"/);
  });
  async function client(email) {
    let cookie = '';
    const request = async (url, method = 'GET', payload) => {
      const response = await fetch(origin + url, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const result = await response.json();
      if (!response.ok) { const error = Error(result.error); error.status = response.status; throw error; }
      return result;
    };
    await request('/api/login', 'POST', { email, password: 'Factory-local-demo-2026!' });
    let bootstrap = await request('/api/bootstrap'), dialog;
    const document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return { innerHTML: '' }; } };
    const context = vm.createContext({
      console, URL, setTimeout, clearTimeout, document, OFFLINE: false,
      PR: require(path.join(runtime, 'public/payroll-control.js')),
      WFMCost: require(path.join(runtime, 'public/cost-engine.js')),
      F: { actor: bootstrap.actor, ready: true }, ui: { page: 'overview' },
      payrollActor: () => bootstrap.actor,
      request,
      command: async (command, payload) => {
        const response = await request('/api/command', 'POST', { command, payload, version: bootstrap.state.version });
        bootstrap = await request('/api/bootstrap');
        return response;
      },
      modal: (title, html, submit) => { dialog = { title, html, submit }; },
      modalActions: label => '<button type="submit">' + label + '</button>',
      toast() {}, shell: html => html, render: async () => {}, showLogin() {}, fmt: value => new Date(value).toISOString().slice(11, 16),
      fetch: (url, options) => fetch(origin + url, { ...options, headers: { ...options?.headers, Cookie: cookie } })
    });
    vm.runInContext(source, context, { filename: 'vector-workflows.js' });
    return { context, request, workflow: context.VectorWorkflow, dialog: () => dialog, bootstrap: () => bootstrap };
  }

  await t.test('baseline surviving Time Review action fails without its removed owner', () => {
    const legacyConsumers = fs.readFileSync(path.join(runtime, 'public/time-review-ui.js'), 'utf8');
    assert.match(legacyConsumers, /RF\.period=TRI\.period/);
    assert.throws(() => vm.runInNewContext('RF.period = TRI.period', { TRI: { period: '2026-09-07' } }), /RF is not defined/);
  });
  const manager = await client('manager@northstar.example');
  await manager.workflow.refresh();
  const team = manager.context.RF.report.teams.find(team => team.categories.some(category => category.open === 0));
  assert.ok(team, 'fixture contains a source-verifiable category');
  manager.context.RF.team = team.id;
  const category = team.categories.find(category => category.open === 0);
  await t.test('new workflow reads real team and evidence before individual confirmation', async () => {
    assert.match(manager.workflow.weeklyPage(), new RegExp(team.name));
    await manager.workflow.action('category', category.id);
    assert.match(manager.dialog().title, /Verify/);
    assert.match(manager.dialog().html, /I verified every relevant record/);
    const form = new Map([['checked', 'on']]);
    await manager.dialog().submit(form);
    const saved = manager.context.RF.report.teams.find(item => item.id === team.id);
    assert.equal(saved.categories.find(item => item.id === category.id).confirmed, true);
    assert.equal(manager.workflow.state().receipt.action, 'review-check');
    const db = new DatabaseSync(dbPath);
    try { assert.ok(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='review-check'").get().count > 0); } finally { db.close(); }
  });
  await t.test('concurrent duplicate submission is bounded in the UI controller', async () => {
    const current = manager.context.RF.report.teams.find(item => item.id === team.id);
    const input = { period: '2026-09-07', team: team.id, revision: current.revision, category: category.id, checked: true };
    const results = await Promise.allSettled([manager.workflow.mutate('review-check', input), manager.workflow.mutate('review-check', input)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /already being saved/);
  });
  await t.test('unfinished weekly sign-off and unprivileged payroll are rejected', async () => {
    await assert.rejects(() => manager.workflow.action('sign'), /Complete every source review/);
    await assert.rejects(() => manager.request('/api/command', 'POST', { command: 'payroll-release', version: manager.bootstrap().state.version, payload: { period: '2026-09-07', checked: true, schemaReviewed: true } }), error => error.status === 403);
  });
  await t.test('employee cannot acquire manager review or mutate a team check', async () => {
    const employee = await client('maya@northstar.example');
    await employee.workflow.refresh();
    assert.equal(employee.context.RF.report, null);
    await assert.rejects(() => employee.workflow.mutate('review-check', { period: '2026-09-07', team: team.id, revision: team.revision, category: category.id, checked: true }), error => error.status === 403);
    assert.equal(employee.workflow.state().receipt, null);
  });
  const leaveEmployee = await client('maya@northstar.example');
  let leaveRequestId, leaveDate, leaveAvailableBefore;
  await t.test('employee leave route saves a real request and reads back reserved balance', async () => {
    await leaveEmployee.workflow.leaveRefresh();
    const before = leaveEmployee.workflow.leaveState();
    leaveDate = before.personal.shifts[1].start.slice(0, 10);
    leaveAvailableBefore = before.personal.leave.availableMinutes;
    const result = await leaveEmployee.workflow.leaveRequest({ date: leaveDate, hours: 7.5 });
    leaveRequestId = result.id;
    const after = leaveEmployee.workflow.leaveState();
    assert.equal(after.bootstrap.state.requests.find(request => request.id === leaveRequestId).status, 'pending');
    assert.equal(after.personal.leave.pendingMinutes, 450);
    assert.equal(after.personal.leave.availableMinutes, leaveAvailableBefore - 450);
    assert.match(leaveEmployee.workflow.leavePage(), /Saved and read back from the service/);
    assert.doesNotMatch(leaveEmployee.workflow.leavePage(), /workflow preview|demo does not certify/i);
  });
  await t.test('employee leave route surfaces authoritative overlap refusal without a false receipt', async () => {
    const priorReceipt = leaveEmployee.workflow.leaveState().receipt;
    await assert.rejects(() => leaveEmployee.workflow.leaveRequest({ date: leaveDate, hours: 7.5 }), error => error.status === 409);
    assert.deepEqual(leaveEmployee.workflow.leaveState().receipt, priorReceipt);
    assert.equal(leaveEmployee.workflow.leaveState().bootstrap.state.requests.filter(request => request.id === leaveRequestId).length, 1);
  });
  await t.test('manager leave route renders source request and saves an authorised decision', async () => {
    await manager.workflow.leaveRefresh();
    assert.match(manager.workflow.leavePage(), new RegExp(leaveRequestId));
    assert.match(manager.workflow.leavePage(), /Approve/);
    await manager.workflow.leaveDecision({ id: leaveRequestId, decision: 'approved', reviewed: true });
    const saved = manager.workflow.leaveState().bootstrap.state.requests.find(request => request.id === leaveRequestId);
    assert.equal(saved.status, 'approved');
    assert.equal(manager.workflow.leaveState().receipt.action, 'leave-decision');
  });
  await t.test('fresh employee login sees the manager decision and durable audit', async () => {
    const freshEmployee = await client('maya@northstar.example');
    await freshEmployee.workflow.leaveRefresh();
    assert.equal(freshEmployee.workflow.leaveState().bootstrap.state.requests.find(request => request.id === leaveRequestId).status, 'approved');
    const db = new DatabaseSync(dbPath);
    try {
      const actions = db.prepare("SELECT action FROM audit_events WHERE tenant='northstar-demo' AND action IN ('leave-request','leave-decision') ORDER BY id").all().map(row => row.action);
      assert.deepEqual(actions.slice(-2), ['leave-request', 'leave-decision']);
    } finally { db.close(); }
  });
  await t.test('saved verification survives controlled restart and a fresh login', async () => {
    await stop(); await start();
    const fresh = await client('manager@northstar.example');
    await fresh.workflow.refresh();
    const recovered = fresh.context.RF.report.teams.find(item => item.id === team.id);
    assert.equal(recovered.categories.find(item => item.id === category.id).confirmed, true);
    assert.equal(fresh.workflow.state().receipt, null, 'a new login does not fabricate a prior UI receipt');
  });
  await t.test('payroll source is readable by explicit payroll authority', async () => {
    const payroll = await client('payroll@northstar.example');
    await payroll.workflow.refresh();
    assert.ok(payroll.context.RF.company.teams.length);
    assert.match(payroll.workflow.payrollPage(), /Payroll preparation/);
    assert.match(payroll.workflow.payrollPage(), /disabled[^>]*>Review and release CSV|Review and release CSV/);
    assert.ok(payroll.context.RF.company.blockers.length, 'release remains blocked, not bypassed');
  });
  await t.test('accepted command without observed saved result cannot produce success receipt', async () => {
    const uncertain = await client('manager@northstar.example');
    await uncertain.workflow.refresh();
    uncertain.context.RF.team = team.id;
    const original = uncertain.context.request;
    uncertain.context.request = async (...args) => {
      const response = await original(...args);
      if (args[0].startsWith('/api/weekly-review')) for (const item of response.teams) for (const entry of item.categories) entry.confirmed = false;
      return response;
    };
    const current = uncertain.context.RF.report.teams.find(item => item.id === team.id);
    await assert.rejects(() => uncertain.workflow.mutate('review-check', { period: '2026-09-07', team: team.id, revision: current.revision, category: category.id, checked: true }), /saved result is not yet confirmed/);
    assert.equal(uncertain.workflow.state().receipt, null);
  });
  await t.test('account change during a command suppresses old-account readback and receipt', async () => {
    const changed = await client('manager@northstar.example');
    await changed.workflow.refresh();
    changed.context.command = async () => {
      changed.context.payrollActor = () => ({ tenant: 'other', email: 'other@example.test', personId: 'm1', role: 'manager' });
      return { ok: true, version: 99, result: { id: team.id } };
    };
    await assert.rejects(() => changed.workflow.mutate('review-check', { period: '2026-09-07', team: team.id, revision: team.revision, category: category.id, checked: true }), /account or review period changed/);
    assert.equal(changed.workflow.state().receipt, null);
  });
  await t.test('unsaved Time Review is protected when entering weekly sign-off', async () => {
    manager.context.ui.page = 'time-review';
    manager.context.triClean = () => false;
    await manager.workflow.action('weekly');
    assert.equal(manager.context.ui.page, 'time-review');
  });
});
