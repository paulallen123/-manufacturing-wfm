import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { patchPayrollMoneySources } from '../scripts/patch-payroll-money.mjs';

// Exercise the existing sealed payroll implementation and current money patch.
// No server, customer database, provider, spreadsheet or network is started.
const archive = fileURLToPath(new URL('../artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz', import.meta.url));
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'),
  '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d');
const names = ['engine.js', 'cost-engine.js', 'work-rules.js', 'payroll-control.js'];
const sources = Object.fromEntries(names.map(name => [name,
  execFileSync('tar', ['-xOf', archive, 'public/' + name], { encoding: 'utf8', maxBuffer: 2_000_000 })]));
const fixed = patchPayrollMoneySources(sources['cost-engine.js'], sources['work-rules.js']);
sources['cost-engine.js'] = fixed.cost;
sources['work-rules.js'] = fixed.rules;

function loadPayroll(browser) {
  const context = vm.createContext({}), cache = {};
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

// Independent CSV decoder: deliberately does not call safeField or split on comma.
function records(csv) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (c === '\r' && csv[i + 1] === '\n' && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += c;
  }
  assert.equal(quoted, false);
  assert.equal(cell, '');
  assert.equal(row.length, 0);
  return rows;
}

for (const browser of [false, true]) {
  const mode = browser ? 'browser domain module' : 'server domain module';
  test(`${mode}: quoted Unicode and leading-zero IDs survive actual release and readback`, () => {
    const P = loadPayroll(browser), state = signedFixture(P);
    const released = P.release(state, payroll, request, 'synthetic-batch-1');
    const batch = P.batchById(state, payroll, released.id);
    const decoded = records(batch.csv), [header, ...rows] = decoded;
    assert.equal(batch.rowCount, 1);
    assert.equal(rows.length, batch.rowCount);
    assert.ok(decoded.every(row => row.length === 19));
    const row = Object.fromEntries(header.map((key, i) => [key, rows[0][i]]));
    assert.equal(row.employee_name, 'Zoë, "山田" 🛠');
    assert.equal(row.payroll_id, '0000123');
    assert.equal(row.minutes, '30');
    assert.equal(row.gross_amount_gbp, '10.01');
    assert.equal(row.source_record_ids, 'synthetic-row-0');
    assert.ok(batch.csv.endsWith('\r\n'));
    assert.ok(batch.csv.includes('"Zoë, ""山田"" 🛠"'));
    const bytes = Buffer.from(batch.csv, 'utf8');
    assert.equal(bytes.toString('utf8'), batch.csv);
    const restored = JSON.parse(JSON.stringify(state));
    assert.deepEqual(Buffer.from(P.batchById(restored, payroll, released.id).csv), bytes);
    const before = JSON.stringify(restored);
    const replay = P.release(restored, payroll, request, 'synthetic-ignored-retry-id');
    assert.equal(replay.id, released.id);
    assert.equal(replay.reused, true);
    assert.equal(JSON.stringify(restored), before);
    assert.equal(restored.payrollControl.audit.filter(x => x.type === 'payroll-batch-released').length, 1);
  });

  test(`${mode}: unsafe CSV fields reject before any batch or audit mutation`, () => {
    const P = loadPayroll(browser);
    for (const value of ['line\nbreak', 'line\rbreak', 'tab\tvalue', 'nul\0value', 'delete\x7f',
      '=1+1', '+1', '-1', '@SUM(A1)', '  =1', '＝1', '＋1', '－1', '＠SUM(A1)']) {
      for (const field of ['name', 'teamName', 'batchId']) {
        const state = signedFixture(P, field === 'name' ? value : undefined,
          field === 'teamName' ? value : undefined);
        const before = JSON.stringify(state);
        assert.throws(() => P.release(state, payroll, request,
          field === 'batchId' ? value : 'synthetic-rejected-batch'),
        error => error.status === 409 && /Unsafe control character or spreadsheet formula prefix/.test(error.message),
        `${mode}: ${field} ${JSON.stringify(value)} must reach serialization denial`);
        assert.equal(JSON.stringify(state), before, `${field} rejection must preserve the complete signed state`);
        assert.equal(state.payrollControl.periods[0].batches.length, 0);
        assert.equal(state.payrollControl.audit.some(x => x.type === 'payroll-batch-released'), false);
      }
    }
  });
}
