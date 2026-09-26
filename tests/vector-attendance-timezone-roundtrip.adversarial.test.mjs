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

function loadWorkflow({ timeZone, locale = 'en-US', authoritative = true, row }) {
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
      timeZoneSource: 'operating_context',
      authoritative
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

test('Europe/London fall-back preserves the selected source instant and explains its UTC offset', async () => {
  const cases = [
    ['2026-10-25T00:30:00.000Z', 'UTC+01:00'],
    ['2026-10-25T01:30:00.000Z', 'UTC+00:00']
  ];

  for (const [originalClockIn, offsetLabel] of cases) {
    const harness = loadWorkflow({
      timeZone: 'Europe/London',
      row: {
        id: 'row-fold',
        employee: 'employee-1',
        raw: { kind: 'worked', clockIn: originalClockIn, clockOut: '2026-10-25T03:30:00.000Z', breaks: [] },
        effective: { kind: 'worked', clockIn: originalClockIn, clockOut: '2026-10-25T03:30:00.000Z', breaks: [] }
      }
    });

    harness.open();
    const opened = harness.modal();
    assert.match(opened.html, new RegExp(offsetLabel.replace('+', '\\+')));
    await assert.rejects(opened.submit(form({
      clockIn: '2026-10-25T01:30',
      clockOut: '2026-10-25T03:30',
      breaksConfirmed: true,
      reason: 'Verified against source evidence.'
    })));
    assert.equal(harness.command().input.clockIn, originalClockIn);
  }
});

test('an edited fall-back wall time is rejected when it identifies two possible instants', async () => {
  const harness = loadWorkflow({
    timeZone: 'Europe/London',
    row: {
      id: 'row-ambiguous',
      employee: 'employee-1',
      raw: { kind: 'worked', clockIn: '2026-10-25T02:30:00.000Z', clockOut: '2026-10-25T04:30:00.000Z', breaks: [] },
      effective: { kind: 'worked', clockIn: '2026-10-25T02:30:00.000Z', clockOut: '2026-10-25T04:30:00.000Z', breaks: [] }
    }
  });

  harness.open();
  await assert.rejects(harness.modal().submit(form({
    clockIn: '2026-10-25T01:30',
    clockOut: '2026-10-25T04:30',
    breaksConfirmed: true,
    reason: 'Verified against source evidence.'
  })), /occurs twice|ambiguous/i);
  assert.equal(harness.command(), undefined);
});

test('a non-authoritative operating context cannot open the consequential attendance editor', () => {
  const harness = loadWorkflow({
    timeZone: 'Asia/Tokyo',
    authoritative: false,
    row: {
      id: 'row-unauthorised',
      employee: 'employee-1',
      raw: { kind: 'worked', clockIn: '2026-12-31T23:30:00.000Z', clockOut: '2027-01-01T07:30:00.000Z', breaks: [] },
      effective: { kind: 'worked', clockIn: '2026-12-31T23:30:00.000Z', clockOut: '2027-01-01T07:30:00.000Z', breaks: [] }
    }
  });

  assert.throws(
    () => harness.open(),
    /authoritative.*time.?zone|time.?zone.*authoritative/i,
    'a display-only context must not acquire authority merely by naming its source operating_context'
  );
  assert.equal(harness.modal(), undefined, 'the edit modal must remain closed');
});

test('a spring-forward wall time that does not exist is rejected before mutation', async () => {
  const harness = loadWorkflow({
    timeZone: 'Europe/London',
    row: {
      id: 'row-gap',
      employee: 'employee-1',
      raw: { kind: 'worked', clockIn: '2026-03-29T00:30:00.000Z', clockOut: '2026-03-29T03:30:00.000Z', breaks: [] },
      effective: { kind: 'worked', clockIn: '2026-03-29T00:30:00.000Z', clockOut: '2026-03-29T03:30:00.000Z', breaks: [] }
    }
  });

  harness.open();
  await assert.rejects(harness.modal().submit(form({
    clockIn: '2026-03-29T01:30',
    clockOut: '2026-03-29T04:30',
    breaksConfirmed: true,
    reason: 'Verified against source evidence.'
  })), /does not exist|daylight-saving/i);
  assert.equal(harness.command(), undefined);
});
