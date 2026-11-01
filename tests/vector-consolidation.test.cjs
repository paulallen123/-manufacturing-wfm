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
    setTimeout() {}, clearTimeout() {}, performance: { now: () => 0 }, queueMicrotask: fn => microtasks.push(fn),
    ui: { page: 'overview' }, history: { replaceState() {}, pushState() {} }, location: { hash: '' },
    isEmployee: () => Boolean(extra.employee), URL, Intl, Date,
    data: { requests: [] }, people: () => [], me: () => ({ id: 'manager' }),
    F: { ready: true, actor: { personId: 'manager', email: 'fixture@example.test', tenant: 'alpha', role: extra.employee ? 'employee' : 'manager' } },
    ...extra
  };
  const hook = 'window.VectorWorkforceOperations={marker:MARKER';
  assert.ok(source.includes(hook), 'existing Vector test hook is present');
  const augmented = source.replace(hook,
    'window.VectorWorkforceOperations={NAV,labourCost,metrics,secondaryKpis,conceptKpiMarkup,loadTimeReviewEvidence,setTestCalendar(value){state.calendar={status:"ready",requestedAt:0,value};},sectionItems:typeof sectionItems==="function"?sectionItems:spec=>spec.tabs.filter(([route])=>available(route)),' +
    'exerciseHome(){ensureSidebar=()=>{};ensureTopbar=()=>{};updateNav=()=>{};loadTenantCalendar=async()=>({tenant:"alpha",timeZone:"Europe/London",asOf:"2026-10-05T12:00:00.000Z",localDate:"2026-10-05",localTime:"13:00:00",maxAgeMs:900000});state.calendar={status:"ready",requestedAt:0,value:{tenant:"alpha",timeZone:"Europe/London",asOf:"2026-10-05T12:00:00.000Z",localDate:"2026-10-05",localTime:"13:00:00",maxAgeMs:900000}};loadTimeReviewEvidence=async()=>{};renderHome=()=>events.push("manager-home");renderEmployeeHome=()=>events.push("employee-current-personal");generalPage=()=>events.push("employee-source");if(employee())renderEmployeeHome({});else apply();},marker:MARKER');
  context.events = events;
  vm.runInNewContext(augmented, context);
  return { api: context.window.VectorWorkforceOperations, context, events,
    flush() { let count = 0; while (microtasks.length) { assert.ok(++count < 100, 'no render loop'); microtasks.shift()(); } } };
}

// Literal HTTP fixture contract emitted by workflow-action-evidence-bridge.cjs.
// The request is an unfiltered manager read for alpha; the context digest is a
// fixture identity only, while request ordering remains owned by the real UI.
function timeReviewResponse(items) {
  const body = {
    contractVersion: 'WFM_WORKFLOW_ACTION_EVIDENCE_V1', workflow: 'time-review',
    source: '/api/weekly-review',
    scope: { tenant: 'alpha', personId: 'manager', period: '2026-10-05', teamId: null, sourceId: null },
    contextKey: 'a'.repeat(64), timeZone: 'Europe/London', asOf: '2026-10-05T12:00:00Z', maxAgeMs: 900000,
    availability: 'available', unavailable: [],
    items: items.map(item => ({ ...item, binding: { workflow: 'time-review', tenant: 'alpha', teamId: 'team-a', period: '2026-10-05', sourceId: item.sourceId } }))
  };
  return { ok: true, json: async () => body };
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
  api.setTestCalendar({tenant:'alpha',timeZone:'Europe/London',asOf:'2026-10-06T05:30:00Z',localDate:'2026-10-06',localTime:'06:30:00',maxAgeMs:900000});
  const result = api.metrics({ querySelectorAll() { throw Error('unrelated presentation must not supply figures'); } });
  assert.equal(result[0].value, 0); assert.equal(result[1].value, 0); assert.equal(result[2].value, '—');
});
test('attendance renders em dash only when current authority is genuinely unavailable', () => {
  const { api } = load({ WFM: { scopedStaff: () => [], stats: () => ({ onsite: 0, sick: 0 }) } });
  const result = api.metrics({ querySelectorAll() { throw Error('presentation must not manufacture authority'); } });
  assert.equal(result[0].value, '—'); assert.equal(result[1].value, '—');
  assert.equal(result[0].detail, 'Source unavailable'); assert.equal(result[1].detail, 'Source unavailable');
});

test('zero workforce values remain explicit zeroes in rendered Today KPI summaries', () => {
  const { api } = load({ WFM: { scopedStaff: () => [], stats: () => ({ onsite: 0, sick: 0 }) } });
  api.setTestCalendar({tenant:'alpha',timeZone:'Europe/London',asOf:'2026-10-06T05:30:00Z',localDate:'2026-10-06',localTime:'06:30:00',maxAgeMs:900000});
  const metrics=api.metrics({querySelectorAll(){return [];}});
  assert.match(api.secondaryKpis(metrics),/0 \/ 0/);
  assert.match(api.conceptKpiMarkup(metrics,[],{querySelectorAll(){return [];}}),/>0 \/ 0</);
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
    fetch: async () => timeReviewResponse([item]) });
  api.setTestCalendar({tenant:'alpha',timeZone:'Europe/London',asOf:'2026-10-05T12:00:00Z',localDate:'2026-10-05',localTime:'13:00:00',maxAgeMs:900000});
  assert.equal(await api.loadTimeReviewEvidence(), true, 'the complete source response is admitted');
  assert.equal(badge.textContent, '1'); assert.equal(badge.hidden, false);
  assert.match(queue.outerHTML, /Missing clock out/); assert.match(queue.outerHTML, /Authority: manager/);
  assert.match(queue.outerHTML, /<details class="vector-action-detail">/);
});

test('stale Time Review evidence cannot become a current Today priority', async () => {
  const badge = { textContent: '9', hidden: false }, queue = { outerHTML: '' };
  const stale = { contractVersion:'WFM_WORKFLOW_ACTION_EVIDENCE_V1', workflow:'time-review', sourceId:'stale-time-1', reasonCode:'MISSING_CLOCK_OUT', authorityRequired:'manager', observedAt:'2026-10-05T11:30:00Z', confirmation:{state:'action_required'}, title:'Stale missing clock out' };
  const { api } = load({ selectors:{'.vector-alerts':queue,'.vector-notification-count':badge},
    fetch: async () => timeReviewResponse([stale]) });
  api.setTestCalendar({tenant:'alpha',timeZone:'Europe/London',asOf:'2026-10-05T12:00:00Z',localDate:'2026-10-05',localTime:'13:00:00',maxAgeMs:900000});
  assert.equal(await api.loadTimeReviewEvidence(), true, 'the envelope is valid so item freshness is exercised');
  assert.equal(badge.textContent,'0');assert.equal(badge.hidden,true);
  assert.doesNotMatch(queue.outerHTML,/Stale missing clock out/);
});

test('a completed older request cannot overwrite refreshed action evidence after a screen render', async () => {
  const queue = { outerHTML: '' }, pending = [];
  const response = title => timeReviewResponse([{ contractVersion: 'WFM_WORKFLOW_ACTION_EVIDENCE_V1', workflow: 'time-review', sourceId: title, reasonCode: 'MISSING_CLOCK_OUT', authorityRequired: 'manager', observedAt: '2026-10-05T11:55:00Z', freshness: { state: 'unknown' }, confirmation: { state: 'action_required' }, title }]);
  const { api, context } = load({ selectors: { '.vector-alerts': queue }, fetch: () => new Promise(resolve => pending.push(resolve)) });
  api.setTestCalendar({tenant:'alpha',timeZone:'Europe/London',asOf:'2026-10-05T12:00:00Z',localDate:'2026-10-05',localTime:'13:00:00',maxAgeMs:900000});
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
  const { api, context } = load({ isEmployee: () => employee, selectors: { '.vector-alerts': queue }, fetch: () => new Promise(r => { resolve = r; }) });
  api.setTestCalendar({tenant:'alpha',timeZone:'Europe/London',asOf:'2026-10-05T12:00:00Z',localDate:'2026-10-05',localTime:'13:00:00',maxAgeMs:900000});
  const request = api.loadTimeReviewEvidence();
  await Promise.resolve();
  assert.equal(typeof resolve,'function');
  employee = true;
  context.F.actor = { ...context.F.actor, role: 'employee' };
  resolve(timeReviewResponse([]));
  await request; assert.equal(queue.outerHTML, 'employee-self-service');
});

for (const [name, invalidate] of [
  ['missing owner scope', body => { delete body.scope; }],
  ['cross-tenant scope', body => { body.scope.tenant = 'bravo'; }],
  ['different owner', body => { body.scope.personId = 'another-manager'; }],
  ['invalid period', body => { body.scope.period = 'not-a-period'; }],
  ['filtered team scope', body => { body.scope.teamId = 'team-b'; }],
  ['filtered source scope', body => { body.scope.sourceId = 'other-record'; }],
  ['missing context identity', body => { delete body.contextKey; }],
  ['invalid context identity', body => { body.contextKey = 'not-a-digest'; }],
  ['missing unavailable rows', body => { delete body.unavailable; }],
  ['missing availability', body => { delete body.availability; }]
]) test(name + ' cannot create a Today action or notification', async () => {
  const badge = { textContent: '9', hidden: false }, queue = { outerHTML: '' };
  const item = { contractVersion: 'WFM_WORKFLOW_ACTION_EVIDENCE_V1', workflow: 'time-review', sourceId: 'inadmissible-record', reasonCode: 'MISSING_CLOCK_OUT', authorityRequired: 'manager', observedAt: '2026-10-05T11:55:00Z', confirmation: { state: 'action_required' }, title: 'Inadmissible action' };
  const body = await timeReviewResponse([item]).json(); invalidate(body);
  const { api } = load({ selectors: { '.vector-alerts': queue, '.vector-notification-count': badge }, fetch: async () => ({ ok: true, json: async () => body }) });
  api.setTestCalendar({tenant:'alpha',timeZone:'Europe/London',asOf:'2026-10-05T12:00:00Z',localDate:'2026-10-05',localTime:'13:00:00',maxAgeMs:900000});
  assert.equal(await api.loadTimeReviewEvidence(), false);
  assert.equal(badge.textContent, '0'); assert.equal(badge.hidden, true);
  assert.match(queue.outerHTML, /Source evidence is unavailable/);
  assert.doesNotMatch(queue.outerHTML, /Inadmissible action|inadmissible-record/);
});
