'use strict';
// Runs the exact shell IIFE with test-only export instrumentation, and the real
// server calendar. It proves no browser rendering or actual tenant configuration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.join(__dirname, 'vector-shell.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const { createTenantCalendar } = require('../operations/runtime/tenant-calendar.cjs');
function shell(snapshot, requests = []) {
  const anchor = 'window.VectorWorkforceOperations={marker:MARKER';
  assert.equal(source.split(anchor).length, 2);
  const instrumented = source.replace(anchor, 'window.VectorWorkforceOperations={testHooks:{currentDate,leaveWhen,leaveRows,zonedDate,leaveDate,state},marker:MARKER');
  const sandbox = { ui: { page: 'overview' }, data: { requests }, me: () => ({}), isEmployee: () => false,
    window: { addEventListener() {}, location: { href: 'https://fictional.invalid/' } },
    document: { addEventListener() {}, documentElement: {}, querySelectorAll() { return []; }, querySelector() { return null; },
      body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {} } },
    MutationObserver: class { observe() {} disconnect() {} }, setTimeout() { return 0; }, queueMicrotask() {},
    URL, Intl, Date, console,
    fetch() { throw Error('network is outside this pure fixture'); } };
  sandbox.window.window = sandbox.window; sandbox.window.document = sandbox.document;
  vm.runInNewContext(instrumented, sandbox, { filename: sourcePath });
  const hooks = sandbox.window.VectorWorkforceOperations.testHooks;
  hooks.state.calendar = { status: 'ready', value: snapshot }; return hooks;
}
// Known Gregorian labels and ISO weeks, independent of the client algorithm.
const dates = {
  '2026-10-29': ['Thu, 29 Oct 2026', 'Thu 29 Oct', 44],
  '2026-10-30': ['Fri, 30 Oct 2026', 'Fri 30 Oct', 44],
  '2026-10-31': ['Sat, 31 Oct 2026', 'Sat 31 Oct', 44],
  '2026-11-01': ['Sun, 01 Nov 2026', 'Sun 01 Nov', 44],
  '2026-12-31': ['Thu, 31 Dec 2026', 'Thu 31 Dec', 53],
  '2027-01-01': ['Fri, 01 Jan 2027', 'Fri 01 Jan', 53],
  '2027-01-03': ['Sun, 03 Jan 2027', 'Sun 03 Jan', 53],
  '2027-01-04': ['Mon, 04 Jan 2027', 'Mon 04 Jan', 1]
};
const instants = ['2026-10-30T00:00:00Z', '2026-10-31T12:00:00Z', '2026-12-31T12:00:00Z', '2027-01-03T12:00:00Z'];
const zones = ['UTC', 'Pacific/Kiritimati', 'Pacific/Auckland', 'America/Los_Angeles'];
const expectedLocalDates = {
  UTC: ['2026-10-30', '2026-10-31', '2026-12-31', '2027-01-03'],
  'Pacific/Kiritimati': ['2026-10-30', '2026-11-01', '2027-01-01', '2027-01-04'],
  'Pacific/Auckland': ['2026-10-30', '2026-11-01', '2027-01-01', '2027-01-04'],
  'America/Los_Angeles': ['2026-10-29', '2026-10-31', '2026-12-31', '2027-01-03']
};
for (const zone of zones) for (const [index, instant] of instants.entries()) {
  const snap = createTenantCalendar({ env: { WFM_TENANT_TIMEZONE: zone }, now: () => Date.parse(instant) }).snapshot({ tenant: 'fictional', site: 'fictional-site' });
  assert.equal(snap.source, 'server-authoritative-tenant-calendar');
  assert.equal(snap.localDate, expectedLocalDates[zone][index]);
  const expected = dates[snap.localDate]; assert.ok(expected);
  test('Today preserves authoritative civil day/week: ' + zone + ' @ ' + instant, () => {
    const actual = shell(snap).currentDate(); assert.equal(actual.date, expected[0]); assert.equal(actual.week, expected[2]);
  });
  test('Upcoming leave preserves approved civil day: ' + zone + ' @ ' + instant, () => {
    const request = { id: 'fictional-leave', employee: 'fictional-person', employeeName: 'Fictional Person', type: 'Holiday', status: 'approved', date: snap.localDate };
    const hooks = shell(snap, [request]); const rows = hooks.leaveRows();
    assert.equal(rows.length, 1); assert.equal(rows[0].when, expected[1]);
    assert.equal(hooks.leaveWhen(snap.localDate, zone), expected[1]);
    assert.equal(request.date, snap.localDate, 'display must not mutate the source date');
  });
}
test('instant conversion still applies tenant timezone before date-only formatting', () => {
  const hooks = shell({ timeZone: 'Pacific/Kiritimati', localDate: '2027-01-01', asOf: '2026-12-31T12:00:00Z' });
  assert.equal(hooks.leaveDate('2026-12-31T12:00:00Z', 'Pacific/Kiritimati'), '2027-01-01');
  assert.equal(hooks.zonedDate('2026-12-31T12:00:00Z', 'America/Los_Angeles'), '2026-12-31');
});
test('unverified timezone and absent dates retain fail-closed labels', () => {
  const hooks = shell(null); hooks.state.calendar.status = 'unavailable';
  assert.equal(hooks.currentDate().date, 'Timezone not verified'); assert.equal(hooks.currentDate().week, '—');
  assert.equal(hooks.leaveWhen('2026-10-30', null), 'Date unavailable');
  assert.equal(hooks.leaveWhen(null, 'Pacific/Kiritimati'), 'Date unavailable');
});

// ISO week labels from the Gregorian calendar at both kinds of year boundary.
const isoYearBoundaries = {
  '2005-01-01': 53, '2006-01-01': 52, '2007-12-31': 1,
  '2010-01-01': 53, '2014-12-29': 1, '2016-01-03': 53,
  '2018-12-31': 1, '2019-12-30': 1, '2020-12-31': 53,
  '2021-01-01': 53, '2022-01-01': 52, '2027-01-03': 53,
  '2028-01-01': 52, '2029-12-31': 1
};
for (const [localDate, week] of Object.entries(isoYearBoundaries)) {
  test('ISO week is anchored to its Thursday year: ' + localDate, () => {
    assert.equal(shell({ timeZone: 'Pacific/Kiritimati', localDate }).currentDate().week, week);
  });
}
