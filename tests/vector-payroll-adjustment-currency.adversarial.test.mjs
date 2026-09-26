import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const operatingContext = require('../ux-overlay/vector-operating-context.js');
const workflowSource = fs.readFileSync(new URL('../ux-overlay/vector-workflows.js', import.meta.url), 'utf8');

function loadPayroll({ locale, currency, adjustment }) {
  let capturedModal;
  const actor = {
    tenant: 'tenant-a', email: 'payroll@example.test', personId: 'payroll-1',
    role: 'payroll_admin', permissions: ['payroll.view', 'payroll.export', 'payroll.reopen']
  };
  const context = {
    console, URL, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    OFFLINE: false,
    PR: { has: (subject, permission) => subject.permissions.includes(permission) },
    WFMCost: {}, VectorOperatingContext: operatingContext,
    VectorDisplayContext: () => ({ locale, currency, authoritative: true, currencySource: currency ? 'cost_evidence' : 'unknown' }),
    F: { ready: true }, ui: { page: 'payroll-run' }, data: {}, payrollActor: () => actor,
    request: async () => { throw Error('No request is expected while rendering saved payroll evidence.'); },
    command: async () => { throw Error('No command is expected while opening adjustment evidence.'); },
    toast() {},
    modal: (title, html, submit) => { capturedModal = { title, html, submit }; },
    modalActions: label => `<button type="submit">${label}</button>`,
    shell: value => value, reload: async () => {}, showLogin() {}, render: async () => {}, triClean: () => true
  };
  context.globalThis = context;
  vm.runInNewContext(workflowSource, context, { filename: 'vector-workflows.js' });
  context.RF.company = {
    periods: [{ id: '2026-09-07', start: '2026-09-07', end: '2026-09-13' }],
    teams: [], totals: { employees: 0, workedMinutes: 0 }, blockers: [], discrepancies: [],
    schema: 'synthetic-payroll-v1', reconciliation: {}, lines: [], batches: [],
    adjustmentCandidates: [], adjustments: [adjustment], adjustmentBatches: [],
    audit: [], exportNote: 'Synthetic evidence only.', canRelease: false
  };
  return {
    workflow: context.VectorWorkflow,
    modal: () => capturedModal
  };
}

test('payroll adjustments render only a source-bound currency and minor-unit definition', async () => {
  const eur = loadPayroll({
    locale: 'de-DE', currency: 'EUR',
    adjustment: {
      id: 'adj-eur', employee: 'employee-1', status: 'pending_approval', minutesDelta: 60,
      grossMinorDelta: 12345, minorUnitExponent: 2, currency: 'EUR', revision: 1, proposed: {}
    }
  });
  assert.match(eur.workflow.payrollPage(), /123,45\s*€/);
  assert.doesNotMatch(eur.workflow.payrollPage(), /£/);

  const mismatch = loadPayroll({
    locale: 'en-GB', currency: 'GBP',
    adjustment: {
      id: 'adj-usd', employee: 'employee-1', status: 'pending_approval', minutesDelta: 60,
      grossMinorDelta: 12345, minorUnitExponent: 2, currency: 'USD', revision: 1, proposed: {}
    }
  });
  assert.match(mismatch.workflow.payrollPage(), /adj-usd[^<]*·[^<]*·[^<]*·[^<]*· —/);
  assert.doesNotMatch(mismatch.workflow.payrollPage(), /£123\.45|\$123\.45/);
});

test('legacy pence is shown only under authoritative GBP context and the review modal uses the same amount', async () => {
  const gbp = loadPayroll({
    locale: 'en-GB', currency: 'GBP',
    adjustment: {
      id: 'adj-gbp', employee: 'employee-1', status: 'pending_approval', minutesDelta: 60,
      grossPenceDelta: 12345, revision: 1, proposed: {}
    }
  });
  assert.match(gbp.workflow.payrollPage(), /£123\.45/);
  await gbp.workflow.action('adjust-review', 'adj-gbp');
  assert.match(gbp.modal().html, /£123\.45/);

  const unknown = loadPayroll({
    locale: 'en-GB', currency: null,
    adjustment: {
      id: 'adj-unknown', employee: 'employee-1', status: 'pending_approval', minutesDelta: 60,
      grossPenceDelta: 12345, revision: 1, proposed: {}
    }
  });
  assert.match(unknown.workflow.payrollPage(), /adj-unknown[^<]*·[^<]*·[^<]*·[^<]*· —/);
  assert.doesNotMatch(unknown.workflow.payrollPage(), /£123\.45/);
});

test('an adjustment without authoritative money cannot enter approval', async () => {
  const pending = loadPayroll({
    locale: 'en-GB', currency: null,
    adjustment: {
      id: 'adj-pending-unknown', employee: 'employee-1', status: 'pending_approval', minutesDelta: 60,
      grossPenceDelta: 12345, revision: 1, proposed: {}
    }
  });
  assert.match(pending.workflow.payrollPage(), /data-vector-workflow="adjust-review"[^>]* disabled/);
  await assert.rejects(
    () => pending.workflow.action('adjust-review', 'adj-pending-unknown'),
    /authoritative payroll adjustment amount/i
  );
  assert.equal(pending.modal(), undefined, 'a blocked review must not open a decision modal');
});

test('an approved adjustment without authoritative money cannot enter release', async () => {
  const approved = loadPayroll({
    locale: 'en-GB', currency: null,
    adjustment: {
      id: 'adj-approved-unknown', employee: 'employee-1', status: 'approved', minutesDelta: 60,
      grossPenceDelta: 12345, revision: 2, proposed: {}
    }
  });
  assert.match(approved.workflow.payrollPage(), /data-vector-workflow="adjust-release"[^>]* disabled/);
  await assert.rejects(
    () => approved.workflow.action('adjust-release'),
    /authoritative payroll adjustment amount/i
  );
  assert.equal(approved.modal(), undefined, 'a blocked release must not open a release modal');
});
