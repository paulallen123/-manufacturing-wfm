import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const workflowSource = fs.readFileSync(new URL('../ux-overlay/vector-workflows.js', import.meta.url), 'utf8');

async function loadEmployeeLeave(balance) {
  const actor = {
    tenant: 'tenant-a',
    email: 'worker@example.test',
    personId: 'employee-1',
    role: 'employee'
  };
  const bootstrap = { actor, state: { version: 7, requests: [] } };
  const personal = {
    leave: balance,
    shifts: [{ start: '2026-10-05T06:00:00.000Z' }]
  };
  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    OFFLINE: false,
    PR: { has: () => false },
    WFMCost: {},
    VectorOperatingContext: {},
    VectorDisplayContext: () => ({ locale: 'en-GB', timeZone: 'Europe/London', authoritative: true }),
    F: { ready: true },
    ui: { page: 'vector-leave' },
    data: {},
    payrollActor: () => actor,
    request: async url => {
      if (url === '/api/bootstrap') return structuredClone(bootstrap);
      if (url === '/api/personal') return structuredClone(personal);
      throw Error('Unexpected request: ' + url);
    },
    command: async () => { throw Error('No command is expected while rendering leave evidence.'); },
    toast() {}, modal() {}, modalActions: label => `<button type="submit">${label}</button>`,
    shell: value => value, reload: async () => {}, showLogin() {}, render: async () => {}, triClean: () => true
  };
  context.globalThis = context;
  vm.runInNewContext(workflowSource, context, { filename: 'vector-workflows.js' });
  await context.VectorWorkflow.leaveRefresh();
  return context.VectorWorkflow;
}

test('missing leave balance evidence is shown as unknown and blocks a request', async () => {
  for (const [balance, available, pending] of [
    [{ availableMinutes: null, pendingMinutes: 0 }, '—', '0.0 hours'],
    [{ availableMinutes: 450, pendingMinutes: '' }, '7.5 hours', '—'],
    [null, '—', '—']
  ]) {
    const workflow = await loadEmployeeLeave(balance);
    const page = workflow.leavePage();
    assert.match(page, new RegExp(`<b>${available}</b><small>Available after pending requests</small>`));
    assert.match(page, new RegExp(`<b>${pending}</b><small>Awaiting a manager decision</small>`));
    assert.match(page, /Balance evidence unavailable/);
    assert.match(page, /data-vector-workflow="leave-request"[^>]* disabled/);
  }
});

test('an authoritative zero leave balance remains visible without being treated as missing', async () => {
  const workflow = await loadEmployeeLeave({ availableMinutes: 0, pendingMinutes: 0 });
  const page = workflow.leavePage();
  assert.match(page, /<b>0\.0 hours<\/b>/);
  assert.doesNotMatch(page, /Balance evidence unavailable/);
  assert.doesNotMatch(page, /data-vector-workflow="leave-request"[^>]* disabled/);
});
