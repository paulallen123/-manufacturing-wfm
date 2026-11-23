import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { patchPayrollMoneySources } from '../../../scripts/patch-payroll-money.mjs';

// Exercise the existing sealed payroll implementation and current money patch.
// No server, customer database, provider, spreadsheet or network is started.
const archive = fileURLToPath(new URL('../../../artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz', import.meta.url));
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'),
  '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d');
const names = ['engine.js', 'cost-engine.js', 'work-rules.js', 'payroll-control.js'];
const sources = Object.fromEntries(names.map(name => [name,
  execFileSync('tar', ['-xOf', archive, 'public/' + name], { encoding: 'utf8', maxBuffer: 2_000_000 })]));
const fixed = patchPayrollMoneySources(sources['cost-engine.js'], sources['work-rules.js']);
sources['cost-engine.js'] = fixed.cost;
sources['work-rules.js'] = fixed.rules;

function loadPayroll(browser) {
  const context = vm.createContext({Date: class extends Date { constructor(...a) { super(...(a.length ? a : ['2026-09-14T12:00:00.000Z'])); } static now() { return Date.parse('2026-09-14T12:00:00.000Z'); } }}), cache = {};
  function load(name) {
    name = name.replace(/^\.\//, '');
    if (cache[name]) return cache[name];
    assert.ok(Object.hasOwn(sources, name), `Unexpected dependency ${name}`);
    const module = { exports: {} };
    vm.runInContext('(function(module,exports,require){' + sources[name] + '\n})',
      context, { filename: name })(module, module.exports, load);
    return cache[name] = module.exports;
  }
  if (!browser) return load('payroll-control.js');
  for (const name of names) vm.runInContext(sources[name], context, { filename: name });
  return context.WFMPayroll;
}

const manager = { personId: 'synthetic-manager', role: 'manager' };
const payroll = { personId: 'synthetic-payroll', permissions: ['payroll.view', 'payroll.export'] };
const request = { period: '2026-09-07', checked: true, schemaReviewed: true };
function signedFixture(P, name = 'Zoë, "山田" 🛠', teamName = 'Synthetic team') {
  const state = {
    org: [{ id: manager.personId, name: 'Synthetic manager', parent: null },
      { id: 'synthetic-team', parent: manager.personId }],
    staff: [{ id: 'synthetic-employee', name, payrollId: '0000123', manager: 'synthetic-team', site: 'Synthetic' }],
    costing: {
      employeePolicies: {},
      rates: { 'synthetic-employee': [{ effectiveFrom: '2026-09-01', hourlyRate: 20.01, currency: 'GBP', basis: 'hourly', oncostPercent: 0, oncostHourly: 0 }] },
      policies: { Synthetic: [{ version: 'synthetic', effectiveFrom: '2026-09-01', weeklyTiers: [], dailyTiers: [],
        bankHolidayMultiplier: 1, weekendMultiplier: 1, nightMultiplier: 1, stacking: 'highest', region: 'england-and-wales', warningPercent: 90 }] }
    },
    payrollControl: { periods: [{
      id: request.period, start: request.period, end: '2026-09-13',
      expectedRoster: ['synthetic-employee'],
      teams: [{ id: 'synthetic-team', name: teamName, employees: ['synthetic-employee'], feedComplete: true }],
      reviews: { 'synthetic-team': { revision: 1, status: 'draft', acknowledgements: {}, employeeChecks: {} } },
      issues: [], batches: [], reminders: [],
      records: Array.from({ length: 7 }, (_, day) => {
        const date = '2026-09-' + String(7 + day).padStart(2, '0');
        return { id: 'synthetic-row-' + day, employee: 'synthetic-employee', team: 'synthetic-team', date,
          raw: day === 0
            ? { kind: 'worked', clockIn: date + 'T09:00:00Z', clockOut: date + 'T09:30:00Z',
              breaks: [], breaksConfirmed: true, pendingSync: false }
            : { kind: 'off_rota', clockIn: null, clockOut: null, breaks: [], pendingSync: false } };
      })
    }], audit: [], adjustments: [], adjustmentBatches: [] }
  };
  assert.equal(P.blockers(state, state.payrollControl.periods[0], state.payrollControl.periods[0].teams[0]).length, 0,
    JSON.stringify(P.blockers(state, state.payrollControl.periods[0], state.payrollControl.periods[0].teams[0])));
  const review = { period: request.period, team: 'synthetic-team', revision: 1, checked: true };
  for (const category of P.CATEGORIES) P.acknowledge(state, manager, { ...review, category: category.id });
  P.acknowledge(state, manager, { ...review, employee: 'synthetic-employee' });
  P.sign(state, manager, { ...review, attestation: 'confirmed' });
  assert.equal(P.companyBlockers(state, payroll, state.payrollControl.periods[0]).length, 0);
  return state;
}

const expectedHeader = '"batch_id","schema_version","period_start","period_end","employee_id","payroll_id","employee_name","team","work_date","pay_code","minutes","hours","basic_hourly_rate_gbp","pay_multiplier","hourly_allowance_gbp","gross_amount_gbp","manager_approved_by","manager_approved_at","source_record_ids"';
const expectedRow = '"synthetic-batch-1","reviewed-pay-v3-reconciled","2026-09-07","2026-09-13","synthetic-employee","0000123","Zoë, ""山田"" 🛠","Synthetic team","2026-09-07","WORKED_BASIC","30","0.5000","20.01","1","0.00","10.01","synthetic-manager","2026-09-14T12:00:00.000Z","synthetic-row-0"';
const expected = Buffer.from(expectedHeader + '\r\n' + expectedRow + '\r\n', 'utf8');
for (const browser of [false, true]) {
  test(`${browser ? 'browser-global' : 'CommonJS'} dispatch and reload preserve all 19 UTF-8 columns`, () => {
    const P = loadPayroll(browser), state = signedFixture(P);
    const released = P.dispatch(state, payroll, 'payroll-release', request, 'synthetic-batch-1');
    const batch = P.batchById(state, payroll, released.id);
    assert.deepEqual(Buffer.from(batch.csv, 'utf8'), expected);
    assert.equal(batch.grossPence, 1001);
    assert.equal(batch.rowCount, 1);
    assert.equal(batch.reconciliation.ok, true);
    const restored = JSON.parse(JSON.stringify(state));
    const before = JSON.stringify(restored);
    assert.deepEqual(Buffer.from(P.batchById(restored, payroll, released.id).csv, 'utf8'), expected);
    const replay = P.dispatch(restored, payroll, 'payroll-release', request, 'synthetic-retry');
    assert.equal(replay.id, released.id);
    assert.equal(replay.reused, true);
    assert.equal(JSON.stringify(restored), before);
    assert.equal(restored.payrollControl.audit.filter(x => x.type === 'payroll-batch-released').length, 1);
  });
}
console.log('Expected UTF-8 SHA256:', createHash('sha256').update(expected).digest('hex'));
