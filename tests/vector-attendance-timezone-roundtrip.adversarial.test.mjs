import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const candidateRoot = fs.existsSync(new URL('../candidate/ux-overlay/vector-operating-context.js', import.meta.url))
  ? '../candidate/ux-overlay/'
  : '../ux-overlay/';
const operatingContext = require(candidateRoot + 'vector-operating-context.js');
const workflowSource = fs.readFileSync(new URL(candidateRoot + 'vector-workflows.js', import.meta.url), 'utf8');

function loadWorkflow({ timeZone, locale = 'en-US', row }) {
  let capturedModal;
  let capturedCommand;
  const document = {
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; }
  };
  const actor = {
    tenant: 'tenant-a',
    email: 'manager@example.test',
    personId: 'manager-1',
    role: 'manager'
  };
  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    document,
    OFFLINE: false,
    PR: { has: () => true },
    WFMCost: {},
    VectorOperatingContext: operatingContext,
    VectorDisplayContext: () => ({
      locale,
      timeZone,
      timeZoneSource: 'operating_context'
    }),
    F: { ready: true },
    ui: { page: 'attendance' },
    data: {},
    payrollActor: () => actor,
    request: async () => ({ teams: [], periods: [], totals: {}, blockers: [], discrepancies: [], lines: [], batches: [], audit: [], schema: '' }),
    command: async (name, input) => {
      capturedCommand = { name, input: structuredClone(input) };
      return { ok: true, version: 2, result: { id: 'issue-new', status: 'open' } };
    },
    toast() {},
    modal: (title, html, submit) => { capturedModal = { title, html, submit }; },
    modalActions: label => `<button type="submit">${label}</button>`,
    shell: value => value,
    reload: async () => {},
    showLogin() {},
    render: async () => {},
    triClean: () => true
  };
  context.globalThis = context;
  vm.runInNewContext(workflowSource, context, { filename: 'vector-workflows.js' });
  context.RF.report = {
    teams: [{
      id: 'site-a',
      revision: 1,
      records: [row],
      issues: [],
      categories: [],
      employees: []
    }]
  };
  context.RF.team = 'site-a';
  return {
    open: () => context.amendDialog(row.id),
    modal: () => capturedModal,
    command: () => capturedCommand
  };
}

function form(values) {
  return {
    get: key => values[key] ?? '',
    has: key => Boolean(values[key])
  };
}

test('unchanged Tokyo attendance values retain the original instant at the command boundary', async () => {
  const originalClockIn = '2026-12-31T23:30:00.000Z';
  const originalClockOut = '2027-01-01T07:30:00.000Z';
  const harness = loadWorkflow({
    timeZone: 'Asia/Tokyo',
    row: {
      id: 'row-1',
      employee: 'employee-1',
      raw: { kind: 'worked', clockIn: originalClockIn, clockOut: originalClockOut, breaks: [] },
      effective: { kind: 'worked', clockIn: originalClockIn, clockOut: originalClockOut, breaks: [] }
    }
  });

  harness.open();
  const opened = harness.modal();
  assert.match(opened.html, /value="2027-01-01T08:30"/);

  await assert.rejects(
    opened.submit(form({
      clockIn: '2027-01-01T08:30',
      clockOut: '2027-01-01T16:30',
      breaksConfirmed: true,
      reason: 'Verified against source evidence.'
    }))
  );

  const submitted = harness.command().input;
  assert.equal(
    submitted.clockIn,
    originalClockIn,
    'an unchanged site-local value must round-trip to the original instant, not a zone-free wall time'
  );
  assert.equal(
    submitted.clockOut,
    originalClockOut,
    'an unchanged site-local value must preserve its original UTC instant'
  );
});

test('Europe/London fall-back instants remain distinguishable in attendance input', () => {
  const firstOccurrence = operatingContext.localDateTimeInput(
    '2026-10-25T00:30:00.000Z',
    { timeZone: 'Europe/London' }
  );
  const secondOccurrence = operatingContext.localDateTimeInput(
    '2026-10-25T01:30:00.000Z',
    { timeZone: 'Europe/London' }
  );

  assert.notEqual(
    firstOccurrence,
    secondOccurrence,
    'two distinct source instants must not collapse to the same editable value during the DST fall-back overlap'
  );
});
