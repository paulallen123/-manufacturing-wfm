'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../ux-overlay/vector-shell.js'), 'utf8');
function load(extra = {}) {
  const selectors = extra.selectors || {};
  const routes = extra.routes || ['overview', 'leave', 'attendance', 'time-review', 'personal', 'availability', 'offers'];
  const events = [], microtasks = [];
  const buttons = routes.map(route => ({ dataset: { page: route }, textContent: route }));
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  const context = {
    window: { addEventListener() {}, scrollTo() {}, render: async () => {}, location: { href: 'https://example.test/' } },
    document: { querySelector: s => selectors[s] || null, querySelectorAll: () => buttons,
      addEventListener() {}, getElementById: () => null, documentElement: {}, body: { classList, dataset: {} } },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout() {}, queueMicrotask: fn => microtasks.push(fn),
    ui: { page: 'overview' }, history: { replaceState() {}, pushState() {} }, location: { hash: '' },
    isEmployee: () => Boolean(extra.employee), URL, Intl, Date,
    data: { requests: [] }, people: () => [], me: () => ({ id: 'manager' }),
    ...extra
  };
  const hook = 'window.VectorWorkforceOperations={marker:MARKER';
  assert.ok(source.includes(hook), 'existing Vector test hook is present');
  const augmented = source.replace(hook,
    'window.VectorWorkforceOperations={NAV,labourCost,metrics,loadTimeReviewEvidence,setTestCalendar(value){state.calendar={status:"ready",value};},sectionItems:typeof sectionItems==="function"?sectionItems:spec=>spec.tabs.filter(([route])=>available(route)),' +
    'exerciseHome(){ensureSidebar=()=>{};ensureTopbar=()=>{};updateNav=()=>{};loadTenantCalendar=async()=>({tenant:null,timeZone:"Europe/London",asOf:"2026-10-05T12:00:00.000Z",localDate:"2026-10-05",localTime:"13:00:00",maxAgeMs:900000});state.calendar={status:"ready",value:{tenant:null,timeZone:"Europe/London",asOf:"2026-10-05T12:00:00.000Z",localDate:"2026-10-05",localTime:"13:00:00",maxAgeMs:900000}};loadTimeReviewEvidence=async()=>{};renderHome=()=>events.push("manager-home");renderEmployeeHome=()=>events.push("employee-current-personal");generalPage=()=>events.push("employee-source");if(employee())renderEmployeeHome({});else apply();},marker:MARKER');
  context.events = events;
  vm.runInNewContext(augmented, context);
  return { api: context.window.VectorWorkforceOperations, context, events,
    flush() { let count = 0; while (microtasks.length) { assert.ok(++count < 100, 'no render loop'); microtasks.shift()(); } } };
}

test('retains exactly the approved five primary sections', () => {
  const { api } = load();
  assert.deepEqual(Array.from(api.NAV, n => n.label), ['Today', 'People', 'Plan', 'Factory', 'Improve']);
});
test('consolidation retains the engine repair: absent or invalid cost is not zero', () => {
  for (const value of [undefined, null, '', '  ', false, true, [], {}]) {
    const { api } = load({ VCU: { report: () => ({ summary: { labourCostPence: value } }) } });
    assert.equal(api.labourCost(), null, `unverified input: ${JSON.stringify(value)}`);
  }
  for (const value of [0, '0', 12345, '12345']) {
    const { api } = load({ VCU: { report: () => ({ summary: { labourCostPence: value } }) } });
    assert.equal(api.labourCost(), Number(value) / 100);
  }
});
test('zero attendance is preserved when the authoritative tenant calendar is current and overtime is not borrowed from other DOM figures', () => {
  const { api } = load({ WFM: { scopedStaff: () => [], stats: () => ({ onsite: 0, sick: 0 }) } });
  api.setTestCalendar({tenant:null,timeZone:'Europe/London',asOf:'2026-10-06T05:30:00Z',localDate:'2026-10-06',localTime:'06:30:00',maxAgeMs:900000});
  const result = api.metrics({ querySelectorAll() { throw Error('unrelated presentation must not supply figures'); } });
  assert.equal(result[0].value, 0); assert.equal(result[1].value, 0); assert.equal(result[2].value, '—');
});
test('attendance renders em dash only when current authority is genuinely unavailable', () => {
  const { api } = load({ WFM: { scopedStaff: () => [], stats: () => ({ onsite: 0, sick: 0 }) } });
  const result = api.metrics({ querySelectorAll() { throw Error('presentation must not manufacture authority'); } });
  assert.equal(result[0].value, '—'); assert.equal(result[1].value, '—');
  assert.equal(result[0].detail, 'Source unavailable'); assert.equal(result[1].detail, 'Source unavailable');
});
test('five-section navigation keeps every registered workflow reachable exactly once', () => {
  const routes = ['overview', 'personal', 'leave', 'availability', 'offers', 'shifts', 'time-review', 'payroll-run', 'new-extension'];
  const { api } = load({ routes, employee: true });
  const assigned = api.NAV.flatMap(n => api.sectionItems(n).map(([route]) => route));
  const settings = routes.filter(route => !api.NAV.some(n => n.routes.includes(route)));
  assert.deepEqual(Array.from(assigned).concat(settings).sort(), routes.slice().sort());
  assert.equal(new Set([...assigned, ...settings]).size, routes.length);
});
test('employee Today renders the authenticated current personal home instead of the legacy sample overview', () => {
  const { api, events, flush } = load({ employee: true, selectors: { '.app': { dataset: {} }, '.content': {} } });
  api.exerciseHome(); flush();
  assert.deepEqual(events, ['employee-current-personal']);
});
test('an unregistered payroll page cannot be opened by an employee', async () => {
  const { api, context } = load({ employee: true, routes: ['overview', 'leave'] });
  assert.equal(await api.go('payroll-run'), false); assert.equal(context.ui.page, 'overview');
  assert.equal(await api.go('vector-people'), false); assert.equal(context.ui.page, 'overview');
});
test('late action evidence updates the queue and notification and preserves accessible authority detail', async () => {
  const badge = { textContent: '0', hidden: true }, queue = { outerHTML: '' };
  const item = { contractVersion: 'WFM_WORKFLOW_ACTION_EVIDENCE_V1', workflow: 'time-review', sourceId: 'time-1', reasonCode: 'MISSING_CLOCK_OUT', authorityRequired: 'manager', observedAt: '2026-10-05T11:55:00Z', timeZone: 'Europe/London', maxAgeMs: 900000, freshness: { state: 'unknown' }, confirmation: { state: 'action_required' }, title: 'Missing clock out' };
  const { api } = load({ selectors: { '.vector-alerts': queue, '.vector-notification-count': badge },
    fetch: async () => ({ ok: true, json: async () => ({ contractVersion: item.contractVersion, workflow: item.workflow, timeZone:'Europe/London', asOf:'2026-10-05T12:00:00Z', maxAgeMs:900000, items: [item] }) }) });
  api.setTestCalendar({tenant:null,timeZone:'Europe/London',asOf:'2026-10-05T12:00:00Z',localDate:'2026-10-05',localTime:'13:00:00',maxAgeMs:900000});
  await api.loadTimeReviewEvidence();
  assert.equal(badge.textContent, '1'); assert.equal(badge.hidden, false);
  assert.match(queue.outerHTML, /Missing clock out/); assert.match(queue.outerHTML, /Authority: manager/);
  assert.match(queue.outerHTML, /<details class="vector-action-detail">/);
});

test('stale Time Review evidence cannot become a current Today priority', async () => {
  const badge = { textContent: '9', hidden: false }, queue = { outerHTML: '' };
  const stale = { contractVersion:'WFM_WORKFLOW_ACTION_EVIDENCE_V1', workflow:'time-review', sourceId:'stale-time-1', reasonCode:'MISSING_CLOCK_OUT', authorityRequired:'manager', observedAt:'2026-10-05T11:30:00Z', confirmation:{state:'action_required'}, title:'Stale missing clock out' };
  const { api } = load({ selectors:{'.vector-alerts':queue,'.vector-notification-count':badge},
    fetch: async () => ({ok:true,json:async()=>({contractVersion:stale.contractVersion,workflow:stale.workflow,timeZone:'Europe/London',asOf:'2026-10-05T12:00:00Z',maxAgeMs:900000,items:[stale]})}) });
  api.setTestCalendar({tenant:null,timeZone:'Europe/London',asOf:'2026-10-05T12:00:00Z',localDate:'2026-10-05',localTime:'13:00:00',maxAgeMs:900000});
  await api.loadTimeReviewEvidence();
  assert.equal(badge.textContent,'0');assert.equal(badge.hidden,true);
  assert.doesNotMatch(queue.outerHTML,/Stale missing clock out/);
});

test('a completed older request cannot overwrite refreshed action evidence after a screen render', async () => {
  const queue = { outerHTML: '' }, pending = [];
  const response = title => ({ ok: true, json: async () => ({ contractVersion: 'WFM_WORKFLOW_ACTION_EVIDENCE_V1', workflow: 'time-review', timeZone:'Europe/London', asOf:'2026-10-05T12:00:00Z', maxAgeMs:900000, items: [{ contractVersion: 'WFM_WORKFLOW_ACTION_EVIDENCE_V1', workflow: 'time-review', sourceId: title, reasonCode: 'MISSING_CLOCK_OUT', authorityRequired: 'manager', observedAt: '2026-10-05T11:55:00Z', freshness: { state: 'unknown' }, confirmation: { state: 'action_required' }, title }] }) });
  const { api, context } = load({ selectors: { '.vector-alerts': queue }, fetch: () => new Promise(resolve => pending.push(resolve)) });
  api.setTestCalendar({tenant:null,timeZone:'Europe/London',asOf:'2026-10-05T12:00:00Z',localDate:'2026-10-05',localTime:'13:00:00',maxAgeMs:900000});
  const oldRequest = api.loadTimeReviewEvidence();
  await Promise.resolve();
  await context.window.render();
  const newRequest = api.loadTimeReviewEvidence();
  await Promise.resolve();
  assert.equal(pending.length, 2, 'a screen render must reload authoritative evidence');
  pending[1](response('current-record')); await newRequest;
  pending[0](response('obsolete-record')); await oldRequest;
  assert.match(queue.outerHTML, /current-record/); assert.doesNotMatch(queue.outerHTML, /obsolete-record/);
});

test('an in-flight manager response is discarded after the role becomes employee', async () => {
  const queue = { outerHTML: 'employee-self-service' }; let resolve, employee = false;
  const { api } = load({ isEmployee: () => employee, selectors: { '.vector-alerts': queue }, fetch: () => new Promise(r => { resolve = r; }) });
  api.setTestCalendar({tenant:null,timeZone:'Europe/London',asOf:'2026-10-05T12:00:00Z',localDate:'2026-10-05',localTime:'13:00:00',maxAgeMs:900000});
  const request = api.loadTimeReviewEvidence();
  await Promise.resolve();
  assert.equal(typeof resolve,'function');
  employee = true;
  resolve({ ok: true, json: async () => ({ contractVersion: 'WFM_WORKFLOW_ACTION_EVIDENCE_V1', workflow: 'time-review', timeZone:'Europe/London', asOf:'2026-10-05T12:00:00Z', maxAgeMs:900000, items: [] }) });
  await request; assert.equal(queue.outerHTML, 'employee-self-service');
});
