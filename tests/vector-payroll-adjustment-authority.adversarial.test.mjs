import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const operatingContext = require('../candidate/ux-overlay/vector-operating-context.js');
const workflowSource = fs.readFileSync(
  new URL('../candidate/ux-overlay/vector-workflows.js', import.meta.url),
  'utf8'
);

function loadPayroll({ locale = 'en-GB', currency, authoritative, currencySource, adjustment }) {
  let capturedModal;
  const actor = {
    tenant: 'tenant-a',
    email: 'payroll@example.test',
    personId: 'payroll-1',
    role: 'payroll_admin',
    permissions: ['payroll.view', 'payroll.export', 'payroll.reopen']
  };
  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; }
    },
    OFFLINE: false,
    PR: { has: (subject, permission) => subject.permissions.includes(permission) },
    WFMCost: {},
    VectorOperatingContext: operatingContext,
    VectorDisplayContext: () => ({ locale, currency, authoritative, currencySource }),
    F: { ready: true },
    ui: { page: 'payroll-run' },
    data: {},
    payrollActor: () => actor,
    request: async () => { throw Error('No request is expected while rendering saved payroll evidence.'); },
    command: async () => { throw Error('No command is expected while opening saved payroll evidence.'); },
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
  context.RF.company = {
    periods: [{ id: '2026-09-07', start: '2026-09-07', end: '2026-09-13' }],
    teams: [],
    totals: { employees: 0, workedMinutes: 0 },
    blockers: [],
    discrepancies: [],
    schema: 'synthetic-payroll-v1',
    reconciliation: {},
    lines: [],
    batches: [],
    adjustmentCandidates: [],
    adjustments: [adjustment],
    adjustmentBatches: [],
    audit: [],
    exportNote: 'Synthetic evidence only.',
    canRelease: false
  };
  return {
    page: () => context.VectorWorkflow.payrollPage(),
    review: async () => context.VectorWorkflow.action('adjust-review', adjustment.id),
    modal: () => capturedModal
  };
}

test('authoritative matching minor-unit evidence remains visible in list and review', async () => {
  const harness = loadPayroll({
    locale: 'de-DE',
    currency: 'EUR',
    authoritative: true,
    currencySource: 'cost_evidence',
    adjustment: {
      id: 'adj-eur',
      employee: 'employee-1',
      status: 'pending_approval',
      minutesDelta: 60,
      grossMinorDelta: 12345,
      minorUnitExponent: 2,
      currency: 'EUR',
      revision: 1,
      proposed: {}
    }
  });

  assert.match(harness.page(), /123,45\s*€/);
  await harness.review();
  assert.match(harness.modal().html, /123,45\s*€/);
});

test('a non-authoritative display context cannot make a payroll amount look authoritative', async () => {
  const harness = loadPayroll({
    currency: 'GBP',
    authoritative: false,
    currencySource: 'operating_context',
    adjustment: {
      id: 'adj-untrusted-context',
      employee: 'employee-1',
      status: 'pending_approval',
      minutesDelta: 60,
      grossMinorDelta: 12345,
      minorUnitExponent: 2,
      currency: 'GBP',
      revision: 1,
      proposed: {}
    }
  });

  assert.match(harness.page(), /adj-untrusted-context[^<]*·[^<]*·[^<]*·[^<]*· —/);
  assert.doesNotMatch(harness.page(), /£123\.45/);
  await harness.review();
  assert.match(harness.modal().html, /adj-untrusted-context[^<]*·[^<]*· —/);
  assert.doesNotMatch(harness.modal().html, /£123\.45/);
});

test('an unsafe minor-unit integer is refused instead of rounded into a plausible amount', async () => {
  const harness = loadPayroll({
    currency: 'GBP',
    authoritative: true,
    currencySource: 'cost_evidence',
    adjustment: {
      id: 'adj-unsafe-integer',
      employee: 'employee-1',
      status: 'pending_approval',
      minutesDelta: 60,
      grossMinorDelta: Number.MAX_SAFE_INTEGER + 1,
      minorUnitExponent: 2,
      currency: 'GBP',
      revision: 1,
      proposed: {}
    }
  });

  assert.match(harness.page(), /adj-unsafe-integer[^<]*·[^<]*·[^<]*·[^<]*· —/);
  await harness.review();
  assert.match(harness.modal().html, /adj-unsafe-integer[^<]*·[^<]*· —/);
});
