'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(__dirname, 'vector-workflows.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');

test('Vector keeps Time Review source-bound inside registered Attendance navigation', () => {
  assert.doesNotMatch(shellSource, /\['time-review','Time review'\]/);
  assert.match(shellSource, /'time-review':'attendance'/);
  assert.match(source, /ui\.page !== 'attendance'/);
  assert.match(source, /time: 'attendance'/);
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close(error => error ? reject(error) : resolve(port));
  });
});

test('Vector workflow controller uses real authentication, saved checks and restart recovery', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-workflow-'));
  const runtime = path.join(directory, 'runtime');
  execFileSync(process.execPath, [path.join(root, 'scripts/compose-vector-local-runtime.mjs'), runtime], { stdio: 'pipe' });
  const dbPath = path.join(directory, 'test.sqlite');
  const port = await reservePort(), origin = 'http://127.0.0.1:' + port;
  let child;
  async function start() {
    child = spawn(process.execPath, ['--require', path.join(runtime, 'local-paths.cjs'), path.join(runtime, 'security-runtime/bootstrap.cjs')], {
      env: { ...process.env, WFM_DB: dbPath, PORT: String(port), WFM_HOSTED_STAGING: 'false', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let diagnostics = '';
    child.stdout.on('data', data => { diagnostics += '[stdout] ' + data; });
    child.stderr.on('data', data => { diagnostics += '[stderr] ' + data; });
    const startupBudgetMs = Number(process.env.WFM_PROOF_STARTUP_BUDGET_MS || 30000);
    const deadline = Date.now() + startupBudgetMs;
    while (Date.now() <= deadline) {
      if (child.exitCode !== null) throw Error('Runtime exited before ready: ' + diagnostics);
      try { if ((await fetch(origin + '/api/health')).ok) return; } catch {}
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(100, remaining));
    }
    throw Error('Runtime did not become ready within condition budget ' + startupBudgetMs + 'ms: ' + diagnostics);
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
    let context;
    context = vm.createContext({
      console, URL, setTimeout, clearTimeout, document, OFFLINE: false,
      PR: require(path.join(runtime, 'public/payroll-control.js')),
      WFMCost: require(path.join(runtime, 'public/cost-engine.js')),
      F: { actor: bootstrap.actor, ready: true }, ui: { page: 'overview' }, data: bootstrap.state,
      payrollActor: () => bootstrap.actor,
      request,
      command: async (command, payload) => {
        const response = await request('/api/command', 'POST', { command, payload, version: bootstrap.state.version });
        bootstrap = await request('/api/bootstrap');
        return response;
      },
      reload: async () => {
        bootstrap = await request('/api/bootstrap');
        context.data = bootstrap.state;
        context.F.actor = bootstrap.actor;
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
  await t.test('leave request cannot show success when the saved balance was not reserved', async () => {
    const uncertain = await client('maya@northstar.example');
    await uncertain.workflow.leaveRefresh();
    const before = uncertain.workflow.leaveState();
    const date = before.personal.shifts[2].start.slice(0, 10);
    const original = uncertain.context.request;
    let accepted = false;
    uncertain.context.request = async (url, method, payload) => {
      if (url === '/api/personal/work') {
        accepted = true;
        return { ok: true, version: before.bootstrap.state.version + 1, result: { id: 'leave-unreserved', status: 'pending' } };
      }
      const response = await original(url, method, payload);
      if (accepted && url === '/api/bootstrap') response.state.requests.push({ id: 'leave-unreserved', employee: before.bootstrap.actor.personId, date, hours: 7.5, status: 'pending' });
      if (accepted && url === '/api/personal') response.leave = structuredClone(before.personal.leave);
      return response;
    };
    await assert.rejects(() => uncertain.workflow.leaveRequest({ date, hours: 7.5 }), /saved balance and request details were not confirmed/);
    assert.equal(uncertain.workflow.leaveState().receipt, null);
  });
  await t.test('missing or blank saved balances cannot be interpreted as a valid zero', async () => {
    for (const [suffix, malformed] of [['null', null], ['blank', '']]) {
      const uncertain = await client('maya@northstar.example');
      await uncertain.workflow.leaveRefresh();
      const state = uncertain.workflow.leaveState();
      const date = state.personal.shifts[2].start.slice(0, 10);
      state.personal.leave.availableMinutes = 450;
      state.personal.leave.pendingMinutes = 0;
      const baseline = structuredClone(state.personal.leave);
      const original = uncertain.context.request;
      let accepted = false;
      uncertain.context.request = async (url, method, payload) => {
        if (url === '/api/personal/work') {
          accepted = true;
          return { ok: true, version: state.bootstrap.state.version + 1, result: { id: 'leave-malformed-' + suffix, status: 'pending' } };
        }
        const response = await original(url, method, payload);
        if (accepted && url === '/api/bootstrap') response.state.requests.push({ id: 'leave-malformed-' + suffix, employee: state.bootstrap.actor.personId, date, hours: 7.5, status: 'pending' });
        if (accepted && url === '/api/personal') response.leave = { ...baseline, availableMinutes: malformed, pendingMinutes: 450 };
        return response;
      };
      await assert.rejects(() => uncertain.workflow.leaveRequest({ date, hours: 7.5 }), /saved balance and request details were not confirmed/);
      assert.equal(uncertain.workflow.leaveState().receipt, null);
    }
  });
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
    assert.equal(leaveEmployee.context.data.version, after.bootstrap.state.version, 'saved leave must refresh the shared Vector dashboard state');
    assert.match(leaveEmployee.workflow.leavePage(), /Saved and read back from the service/);
    assert.doesNotMatch(leaveEmployee.workflow.leavePage(), /workflow preview|demo does not certify/i);
  });
  await t.test('employee leave route surfaces authoritative overlap refusal without remounting the active modal', async () => {
    const originalReload = leaveEmployee.context.reload;
    let reloads = 0;
    leaveEmployee.context.reload = async (...args) => { reloads++; return originalReload(...args); };
    try {
      await assert.rejects(
        () => leaveEmployee.workflow.leaveRequest({ date: leaveDate, hours: 7.5 }),
        error => error.status === 409 && /overlap|already|request/i.test(String(error.message || ''))
      );
      assert.equal(reloads, 0, '409 conflict recovery must not remount the active modal before its error can render.');
      assert.equal(leaveEmployee.workflow.leaveState().receipt, null);
      assert.equal(leaveEmployee.workflow.leaveState().bootstrap.state.requests.filter(request => request.id === leaveRequestId).length, 1);
    } finally {
      leaveEmployee.context.reload = originalReload;
    }
  });
  await t.test('a rejected stale leave write refreshes the next action context without replaying it', async () => {
    const state = leaveEmployee.workflow.leaveState();
    const actualVersion = state.bootstrap.state.version;
    const date = state.personal.shifts.map(shift => shift.start.slice(0, 10)).find(value => value !== leaveDate);
    state.bootstrap.state.version = actualVersion - 1;
    await assert.rejects(() => leaveEmployee.workflow.leaveRequest({ date, hours: 7.5 }), error => error.status === 409);
    assert.equal(leaveEmployee.workflow.leaveState().bootstrap.state.version, actualVersion, '409 must refresh the saved action version');
    assert.equal(leaveEmployee.workflow.leaveState().receipt, null);
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
  await t.test('a synthetic saved result without its matching correction cannot produce a success receipt', async () => {
    const uncertain = await client('manager@northstar.example');
    await uncertain.workflow.refresh();
    const team = uncertain.context.RF.report.teams.find(item => item.id === 's1');
    const issue = team.issues.find(item => item.id === 'issue-5');
    uncertain.context.RF.team = team.id;
    const reason = issue.evidence;
    uncertain.context.command = async () => ({ ok: true, version: uncertain.bootstrap().state.version + 1, result: { id: issue.id, status: 'resolved', revision: team.revision + 1 } });
    const original = uncertain.context.request;
    uncertain.context.request = async (...args) => {
      const response = await original(...args);
      if (args[0].startsWith('/api/weekly-review')) {
        const savedTeam = response.teams.find(item => item.id === team.id);
        savedTeam.revision = team.revision + 1;
        const savedIssue = savedTeam.issues.find(item => item.id === issue.id);
        savedIssue.status = 'resolved';
        savedIssue.resolution = { by: 'm1', decision: 'accept', reason };
      }
      return response;
    };
    await assert.rejects(() => uncertain.workflow.mutate('review-resolve', {
      period: '2026-09-07', team: team.id, revision: team.revision, issue: issue.id,
      decision: 'accept', checked: true, reason
    }), /saved result is not yet confirmed/);
    assert.equal(uncertain.workflow.state().receipt, null);
  });
  await t.test('a stale attendance exception cannot leave the workflow permanently busy', async () => {
    const uncertain = await client('manager@northstar.example');
    await uncertain.workflow.refresh();
    const team = uncertain.context.RF.report.teams.find(item => item.id === 's1');
    uncertain.context.RF.team = team.id;
    await assert.rejects(() => uncertain.workflow.mutate('review-resolve', {
      period: '2026-09-07', team: team.id, revision: team.revision, issue: 'missing-issue',
      decision: 'accept', checked: true, reason: 'Evidence no longer exists.'
    }), /source exception changed/);
    assert.equal(uncertain.workflow.state().busy, false, 'a pre-submit evidence failure must release the action lock');
  });
  await t.test('a corrected punch with an unchanged worked total cannot produce a success receipt', async () => {
    const uncertain = await client('manager@northstar.example');
    await uncertain.workflow.refresh();
    const team = uncertain.context.RF.report.teams.find(item => item.id === 's1');
    const issue = team.issues.find(item => item.id === 'issue-5');
    uncertain.context.RF.team = team.id;
    const reason = issue.evidence;
    uncertain.context.command = async () => ({ ok: true, version: uncertain.bootstrap().state.version + 1, result: { id: issue.id, status: 'resolved', revision: team.revision + 1 } });
    const original = uncertain.context.request;
    uncertain.context.request = async (...args) => {
      const response = await original(...args);
      if (args[0].startsWith('/api/weekly-review')) {
        const savedTeam = response.teams.find(item => item.id === team.id);
        savedTeam.revision = team.revision + 1;
        const savedIssue = savedTeam.issues.find(item => item.id === issue.id);
        savedIssue.status = 'resolved';
        savedIssue.resolution = { by: 'm1', decision: 'accept', reason };
        const savedRow = savedTeam.records.find(item => item.id === issue.row);
        savedRow.effective = { ...savedRow.effective, ...issue.proposed };
        savedRow.correction = structuredClone(issue.proposed);
        savedRow.reviewedBy = 'm1';
        // Deliberately leave workedMinutes at its old 450-minute value.
      }
      return response;
    };
    await assert.rejects(() => uncertain.workflow.mutate('review-resolve', {
      period: '2026-09-07', team: team.id, revision: team.revision, issue: issue.id,
      decision: 'accept', checked: true, reason
    }), /saved result is not yet confirmed/);
    assert.equal(uncertain.workflow.state().receipt, null);
  });
  await t.test('the same attendance identifiers remain isolated to the signed-in tenant', async () => {
    const isolated = await client('other@isolation.example');
    await isolated.workflow.refresh();
    const isolatedTeam = isolated.context.RF.report.teams.find(item => item.issues.some(issue => issue.id === 'issue-5' && issue.status === 'open'));
    assert.ok(isolatedTeam, 'the isolated fixture must contain its own independently scoped issue-5');
    const isolatedIssue = isolatedTeam.issues.find(item => item.id === 'issue-5');
    isolated.context.RF.team = isolatedTeam.id;
    await isolated.workflow.mutate('review-resolve', {
      period: '2026-09-07', team: isolatedTeam.id, revision: isolatedTeam.revision, issue: isolatedIssue.id,
      decision: 'accept', checked: true, reason: isolatedIssue.evidence
    });
    const northstar = await client('manager@northstar.example');
    await northstar.workflow.refresh();
    assert.equal(northstar.context.RF.report.teams.find(item => item.id === 's1').issues.find(item => item.id === 'issue-5').status, 'open');
  });
  await t.test('manager attendance correction preserves raw punches and reads back the exact reviewed result', async () => {
    const attendanceManager = await client('manager@northstar.example');
    await attendanceManager.workflow.refresh();
    const team = attendanceManager.context.RF.report.teams.find(item => item.id === 's1');
    const issue = team.issues.find(item => item.id === 'issue-5');
    const before = team.records.find(item => item.id === issue.row);
    attendanceManager.context.RF.team = team.id;
    const correction = await attendanceManager.workflow.mutate('review-resolve', {
      period: '2026-09-07', team: team.id, revision: team.revision, issue: issue.id,
      decision: 'accept', checked: true, reason: issue.evidence
    });
    const savedTeam = attendanceManager.context.RF.report.teams.find(item => item.id === team.id);
    const savedIssue = savedTeam.issues.find(item => item.id === issue.id);
    const saved = savedTeam.records.find(item => item.id === issue.row);
    assert.equal(savedIssue.status, 'resolved');
    assert.equal(savedIssue.resolution.by, 'm1');
    assert.equal(savedIssue.resolution.decision, 'accept');
    assert.deepEqual(saved.raw, before.raw);
    assert.equal(saved.effective.clockOut, '2026-09-09T13:30:00.000Z');
    assert.equal(saved.workedMinutes, 480);
    assert.equal(saved.reviewedBy, 'm1');
    assert.equal(savedTeam.revision, team.revision + 1);
    assert.equal(attendanceManager.workflow.state().receipt.action, 'review-resolve');
    const db = new DatabaseSync(dbPath);
    try {
      const audit = db.prepare("SELECT detail FROM audit_events WHERE tenant='northstar-demo' AND actor='m1' AND action='review-resolve' ORDER BY id DESC LIMIT 1").get();
      assert.ok(audit, 'the exact correction must have an append-only server audit row');
      assert.deepEqual(JSON.parse(audit.detail), { version: correction.version, resultId: issue.id });
    } finally { db.close(); }
  });
  await t.test('failed manager decision clears an earlier success message', async () => {
    const original = manager.context.request;
    manager.context.request = async (url, method, payload) => {
      if (url === '/api/command' && payload?.command === 'leave-decision') {
        const error = Error('The saved request changed before this decision.');
        error.status = 409;
        throw error;
      }
      return original(url, method, payload);
    };
    await assert.rejects(() => manager.workflow.leaveDecision({ id: leaveRequestId, decision: 'declined', reviewed: true }), /saved request changed/);
    assert.equal(manager.workflow.leaveState().receipt, null);
    manager.context.request = original;
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
    assert.equal(recovered.categories.find(item => item.id === category.id).confirmed, false, 'the saved correction resets the affected prior confirmation');
    const recoveredIssue = recovered.issues.find(item => item.id === 'issue-5');
    const recoveredRow = recovered.records.find(item => item.id === 'wr-e2-2026-09-09');
    assert.equal(recoveredIssue.status, 'resolved');
    assert.equal(recoveredIssue.resolution.by, 'm1');
    assert.equal(recoveredRow.raw.clockOut, '2026-09-09T13:00:00.000Z');
    assert.equal(recoveredRow.effective.clockOut, '2026-09-09T13:30:00.000Z');
    assert.equal(recoveredRow.workedMinutes, 480);
    assert.equal(recoveredRow.reviewedBy, 'm1');
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
  await t.test('unsaved Attendance review is protected when entering weekly sign-off', async () => {
    manager.context.ui.page = 'attendance';
    manager.context.triClean = () => false;
    await manager.workflow.action('weekly');
    assert.equal(manager.context.ui.page, 'attendance');
    manager.context.triClean = () => true;
    await manager.workflow.action('weekly');
    assert.equal(manager.context.ui.page, 'vector-weekly-signoff');
  });
});
