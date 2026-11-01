'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

// This check composes the selected source and exercises its real shared engines.
// V042_LEAVE_SOURCE_ROOT permits a fail-first run against the unchanged parent.
const root = path.resolve(process.env.V042_LEAVE_SOURCE_ROOT || path.join(__dirname, '..'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-dated-leave-'));
const runtime = path.join(directory, 'runtime');
process.env.NODE_ENV = 'test';
process.env.WFM_TENANT_TIMEZONE = 'Europe/London';
process.env.WFM_TENANT_CLOCK_ISO = '2026-10-29T12:00:00Z';
execFileSync(process.execPath, [path.join(root, 'scripts/compose-vector-local-runtime.mjs'), runtime], { stdio: 'pipe' });
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

const employee = { role: 'employee', personId: 'worker1', permissions: [] };
const manager = { role: 'manager', personId: 'mgr', permissions: [] };
function state(start = '2026-11-02T08:00:00.000Z', end = '2026-11-02T16:00:00.000Z') {
  return { version: 1, audit: [], staff: [{ id: 'worker1', name: 'Synthetic Worker', manager: 'mgr', site: 'site1', team: 'mgr', workerType: 'employee' }],
    org: [{ id: 'mgr', parent: null }], requests: [],
    operations: { leaveOpenings: { worker1: { yearStart: '2026-01-01', yearEnd: '2026-12-31', asOf: '2026-10-29', remainingMinutes: 600, usedBeforeMinutes: 600, annualMinutes: 1200, source: 'Synthetic reviewed opening', revision: 1 } } },
    workRules: { revision: 1, leaveBalances: { worker1: { hours: 10 } }, absences: [],
      leaveRules: [{ id: 'rule1', team: 'mgr', denominator: 'scheduled', percent: null, maxOff: 1, minPresent: 0, reservePending: true, skills: [], numerator: 'scheduled_requests' }],
      roster: [{ id: 'shift', employee: 'worker1', department: 'mgr', site: 'site1', start, end, breaks: [] }] } };
}
function engines(browser) {
  if (!browser) {
    const O = require(path.join(runtime, 'public/operations-engine.js'));
    const R = require(path.join(runtime, 'public/work-rules.js'));
    return { O, R, clock(asOf, timeZone = 'Europe/London') { process.env.WFM_TENANT_CLOCK_ISO = asOf; process.env.WFM_TENANT_TIMEZONE = timeZone; } };
  }
  const context = vm.createContext({ console });
  function clock(asOf, timeZone = 'Europe/London') {
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(asOf));
    context.WFMTenantCalendarSnapshot = { asOf, timeZone, localDate };
  }
  clock('2026-10-29T12:00:00Z');
  for (const name of ['engine.js', 'cost-engine.js', 'economic-cost-engine.js', 'work-rules.js', 'payroll-control.js', 'demand-engine.js', 'operations-engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(runtime, 'public', name), 'utf8'), context, { filename: name });
  }
  return { O: context.WFMOps, R: context.WFMWorkRules, clock };
}

for (const browser of [false, true]) {
  const { O, R, clock } = engines(browser);
  const check = (name, fn) => test(`${browser ? 'browser' : 'server'} ${name}`, () => { clock('2026-10-29T12:00:00Z'); fn(); });

  check('same-year reservation and approval preserve the dated opening', () => {
    const s = state();
    const created = R.requestLeave(s, employee, { date: '2026-11-02', hours: 8 });
    assert.equal(created.status, 'pending'); assert.equal(created.capacity.status, 'prechecks_clear');
    assert.equal(O.leaveBudget(s, 'worker1'), 2);
    assert.equal(R.decideLeave(s, manager, { id: created.id, decision: 'approved', reviewed: true }).status, 'approved');
    assert.equal(O.leaveBudget(s, 'worker1'), 2);
    assert.equal(s.operations.leaveOpenings.worker1.remainingMinutes, 600);
  });

  check('next-year capacity cannot present the prior-year opening as spendable', () => {
    const s = state('2027-01-04T08:00:00Z', '2027-01-04T16:00:00Z');
    const result = R.capacity(s, employee, { employee: 'worker1', start: s.workRules.roster[0].start, end: s.workRules.roster[0].end });
    assert.equal(result.status, 'blocked'); assert.equal(Number.isFinite(result.balanceBefore), false);
  });

  check('next-year request refuses without changing state or audit', () => {
    const s = state('2027-01-04T08:00:00Z', '2027-01-04T16:00:00Z'), before = JSON.stringify(s);
    assert.throws(() => R.requestLeave(s, employee, { date: '2027-01-04', hours: 8 }), /Insufficient recorded leave balance/);
    assert.equal(JSON.stringify(s), before);
  });

  check('existing next-year pending request cannot be approved from an old opening', () => {
    const s = state('2027-01-04T08:00:00Z', '2027-01-04T16:00:00Z');
    s.requests.push({ id: 'existing', employee: 'worker1', date: '2027-01-04', start: s.workRules.roster[0].start, end: s.workRules.roster[0].end, hours: 8, status: 'pending' });
    const before = JSON.stringify(s);
    assert.throws(() => R.decideLeave(s, manager, { id: 'existing', decision: 'approved', reviewed: true }), /Leave approval blocked/);
    assert.equal(JSON.stringify(s), before);
  });

  check('expired opening cannot authorize new booking after the year rolls over', () => {
    clock('2027-01-01T12:00:00Z');
    const s = state('2027-01-04T08:00:00Z', '2027-01-04T16:00:00Z');
    assert.equal(Number.isFinite(O.leaveBudget(s, 'worker1')), false);
    assert.throws(() => R.requestLeave(s, employee, { date: '2027-01-04', hours: 8 }), /Insufficient recorded leave balance/);
  });

  check('non-calendar leave year permits a covered next-calendar-year request', () => {
    const s = state('2027-01-04T08:00:00Z', '2027-01-04T16:00:00Z');
    Object.assign(s.operations.leaveOpenings.worker1, { yearStart: '2026-04-01', yearEnd: '2027-03-31' });
    assert.equal(R.requestLeave(s, employee, { date: '2027-01-04', hours: 8 }).capacity.status, 'prechecks_clear');
  });

  check('interval ending at leave-year midnight belongs wholly to the old year', () => {
    const s = state('2026-12-31T16:00:00Z', '2027-01-01T00:00:00Z');
    assert.equal(R.requestLeave(s, employee, { date: '2026-12-31', hours: 8 }).capacity.status, 'prechecks_clear');
  });

  check('interval crossing leave-year midnight needs an applicable future balance', () => {
    const s = state('2026-12-31T16:00:00Z', '2027-01-01T00:01:00Z'), before = JSON.stringify(s);
    assert.throws(() => R.requestLeave(s, employee, { date: '2026-12-31' }), /Insufficient recorded leave balance/);
    assert.equal(JSON.stringify(s), before);
  });

  check('leave-year boundary uses tenant-local dates rather than UTC dates', () => {
    clock('2026-10-29T00:00:00Z', 'Pacific/Kiritimati');
    const s = state('2026-12-31T08:00:00Z', '2026-12-31T16:00:00Z');
    // 22:00 on December 31 through 06:00 on January 1 in the tenant timezone.
    assert.throws(() => R.requestLeave(s, employee, { date: '2026-12-31', hours: 8 }), /Insufficient recorded leave balance/);
  });

  check('same loaded engines honor timezone changes for an already-inspected interval', () => {
    const s = state('2026-12-31T08:00:00Z', '2026-12-31T16:00:00Z'), interval = s.workRules.roster[0];
    assert.equal(O.leaveBudget(s, 'worker1', undefined, interval), 10);
    clock('2026-10-29T12:00:00Z', 'Pacific/Kiritimati');
    assert.equal(Number.isFinite(O.leaveBudget(s, 'worker1', undefined, interval)), false);
    const before = JSON.stringify(s);
    assert.throws(() => R.requestLeave(s, employee, { date: '2026-12-31', hours: 8 }), /Insufficient recorded leave balance/);
    assert.equal(JSON.stringify(s), before);
  });

  check('malformed or reversed reviewed opening dates do not yield spendable credit', () => {
    for (const patch of [{ yearEnd: '2026-02-30' }, { yearStart: '2026-11-01' }, { asOf: '2026-12-01' }]) {
      const s = state(); Object.assign(s.operations.leaveOpenings.worker1, patch);
      assert.equal(Number.isFinite(O.leaveBudget(s, 'worker1')), false);
      assert.throws(() => R.requestLeave(s, employee, { date: '2026-11-02', hours: 8 }), /Insufficient recorded leave balance/);
    }
  });

  check('malformed supplied intervals yield unavailable credit without a formatter exception', () => {
    const s = state();
    for (const interval of [{}, { start: 'invalid', end: '2026-11-02T16:00:00Z' },
      { start: '2026-11-02T08:00:00Z' }, { start: '2026-11-02T16:00:00Z', end: '2026-11-02T08:00:00Z' },
      { start: '2026-11-02T08:00:00Z', end: '2026-11-02T08:00:00Z' }, false, 1, '', []]) {
      assert.equal(Number.isNaN(O.leaveBudget(s, 'worker1', undefined, interval)), true);
    }
    assert.equal(O.leaveBudget(s, 'worker1'), 10);
    assert.equal(O.leaveBudget(s, 'worker1', undefined, null), 10);
    const before = JSON.stringify(s);
    assert.throws(() => R.capacity(s, employee, { employee: 'worker1', start: 'invalid', end: '2026-11-02T16:00:00Z' }), /Invalid timestamp/);
    assert.equal(JSON.stringify(s), before);
  });

  check('approved and pending reservations remain separate and cancelled leave is excluded', () => {
    const s = state(); s.requests = [
      { id: 'taken', employee: 'worker1', date: '2026-10-30', hours: 2, status: 'approved' },
      { id: 'booked', employee: 'worker1', date: '2026-11-10', hours: 3, status: 'approved' },
      { id: 'pending', employee: 'worker1', date: '2026-11-12', hours: 1, status: 'pending' },
      { id: 'cancelled', employee: 'worker1', date: '2026-11-13', hours: 8, status: 'cancelled' }];
    clock('2026-11-01T12:00:00Z');
    const row = O.leaveRow(s, 'worker1');
    assert.equal(row.usedMinutes, 720); assert.equal(row.bookedMinutes, 180); assert.equal(row.pendingMinutes, 60);
    assert.equal(row.remainingMinutes, 300); assert.equal(row.availableMinutes, 240);
    assert.equal(O.leaveBudget(s, 'worker1'), 4); assert.equal(O.leaveBudget(s, 'worker1', 'pending'), 5);
  });

  check('undated legacy fallback remains explicitly unchanged by this bounded repair', () => {
    const s = state('2027-01-04T08:00:00Z', '2027-01-04T16:00:00Z');
    delete s.operations.leaveOpenings.worker1;
    assert.equal(O.leaveBudget(s, 'worker1'), null);
    assert.equal(R.requestLeave(s, employee, { date: '2027-01-04', hours: 8 }).status, 'pending');
  });
}
