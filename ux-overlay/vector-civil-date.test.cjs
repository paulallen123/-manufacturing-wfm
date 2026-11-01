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
  const sandbox = { ui: { page: 'overview' }, data: { requests }, me: () => ({tenant:snapshot?.tenant??null}), isEmployee: () => false,
    window: { addEventListener() {}, location: { href: 'https://fictional.invalid/' } },
    document: { addEventListener() {}, documentElement: {}, querySelectorAll() { return []; }, querySelector() { return null; },
      body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {} } },
    MutationObserver: class { observe() {} disconnect() {} }, setTimeout() { return 0; }, clearTimeout() {}, queueMicrotask() {}, performance: {now:()=>0},
    URL, Intl, Date, console,
    fetch() { throw Error('network is outside this pure fixture'); } };
  sandbox.window.window = sandbox.window; sandbox.window.document = sandbox.document;
  vm.runInNewContext(instrumented, sandbox, { filename: sourcePath });
  const hooks = sandbox.window.VectorWorkforceOperations.testHooks;
  hooks.state.calendar = { status: 'ready', value: snapshot?{...snapshot,maxAgeMs:snapshot.maxAgeMs??60000}:null, requestedAt:0 }; return hooks;
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

// Deterministic source/VM expiry checks; no browser or tenant configuration proof.
function snapshot(instant) {
  return createTenantCalendar({env:{WFM_TENANT_TIMEZONE:'Pacific/Kiritimati',WFM_TODAY_MAX_AGE_MS:'60000'},now:()=>Date.parse(instant)}).snapshot({tenant:'fictional',site:'fictional-site'});
}
function calendarCacheFixture(responses) {
  let elapsed = 0, calls = 0, timerId = 0; const microtasks=[];
  const timers = new Map();
  const actor = {tenant:'fictional',id:'fictional-manager',role:'manager'};
  const sandbox = {ui:{page:'overview'},data:{requests:[]},me:()=>actor,isEmployee:()=>false,
    window:{addEventListener(){},location:{href:'https://fictional.invalid/'}},
    document:{addEventListener(){},documentElement:{},querySelectorAll(){return []},querySelector(){return null},body:{classList:{add(){},remove(){},toggle(){}},dataset:{}}},
    MutationObserver:class{observe(){}disconnect(){}},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id},clearTimeout(id){timers.delete(id)},queueMicrotask(fn){microtasks.push(fn)},
    performance:{now:()=>elapsed},URL,Intl,Date,console,
    fetch:async(url,options)=>{assert.equal(url,'/api/tenant-calendar');assert.equal(options.cache,'no-store');const next=responses[calls++];if(next instanceof Error)throw next;return {ok:true,json:async()=>next};}
  };
  sandbox.window.window=sandbox.window;sandbox.window.document=sandbox.document;
  const anchor='window.VectorWorkforceOperations={marker:MARKER';assert.equal(source.split(anchor).length,2);
  vm.runInNewContext(source.replace(anchor,'window.VectorWorkforceOperations={testHooks:{loadTenantCalendar,invalidateTenantCalendar,currentDate,serverNowMs,renderHome,leaveMarkup,leaveRows,state},marker:MARKER'),sandbox);
  return {api:sandbox.window.VectorWorkforceOperations.testHooks,sandbox,timers,actor,get calls(){return calls},advance(ms){elapsed+=ms},flush(){while(microtasks.length)microtasks.shift()()}};
}
const before=snapshot('2027-01-03T09:59:00Z'),after=snapshot('2027-01-03T10:00:00Z');
test('server maximum age bounds same-tenant reuse across civil-day and ISO-week rollover',async()=>{
  const h=calendarCacheFixture([before,after]);await h.api.loadTenantCalendar();
  assert.equal(h.api.currentDate().date,'Sun, 03 Jan 2027');assert.equal(h.api.currentDate().week,53);
  h.advance(59999);assert.equal((await h.api.loadTenantCalendar()).asOf,before.asOf);assert.equal(h.calls,1);
  h.advance(1);assert.equal((await h.api.loadTenantCalendar()).asOf,after.asOf);
  assert.equal(h.calls,2);assert.equal(h.api.currentDate().date,'Mon, 04 Jan 2027');assert.equal(h.api.currentDate().week,1);
  assert.equal(h.api.serverNowMs(),Date.parse(after.asOf),'the client must obtain the next server instant rather than derive tenant time');
});
test('expiry clears the browser bootstrap snapshot if the renewal read fails',async()=>{
  const h=calendarCacheFixture([before,Error('fictional unavailable source')]);await h.api.loadTenantCalendar();h.advance(60000);
  assert.equal(await h.api.loadTenantCalendar(),null);assert.equal(h.calls,2);
  assert.equal(h.api.currentDate().date,'Timezone not verified');assert.equal(h.api.serverNowMs(),null);
  assert.equal(h.sandbox.window.WFMTenantCalendarSnapshot,null,'browser domain consumers must not retain the expired authority');
});
test('a server maximum-age timer renews the calendar without another user navigation',async()=>{
  const h=calendarCacheFixture([before,after]);await h.api.loadTenantCalendar();
  const expiry=[...h.timers.values()].find(timer=>timer.delay===60000);assert.ok(expiry,'one server-TTL expiry task must be scheduled');
  h.advance(60000);await expiry.fn();
  for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal(h.calls,2);assert.equal(h.api.currentDate().date,'Mon, 04 Jan 2027');
});

function mountHome(h) {
  const date={textContent:'Sun, 03 Jan 2027'},week={textContent:'Week 53 · Current workspace'},heading={textContent:'Upcoming leave (next 7 days)'},events=[];
  const focus={name:'fictional focused leave button'};
  const body=h.api.leaveMarkup(h.api.leaveRows()).split('<div class="vector-leave-list">')[1].split('</div>')[0];
  const list={innerHTML:body,dataset:{},contains:node=>node===focus,addEventListener(type,fn){events.push({type,fn})}};
  const section={attributes:{},querySelector:selector=>selector==='.vector-leave-list'?list:selector==='h2'?heading:null,setAttribute(k,v){this.attributes[k]=v}};
  const stamp={querySelector:selector=>selector==='b'?date:selector==='small'?week:null};
  h.sandbox.document.querySelector=selector=>selector==='.vector-concept-date'?stamp:selector==='.vector-leave'?section:null;
  return {date,week,heading,list,section,focus,events,content:{dataset:{vectorHome:'1'}}};
}
function approvedToday(h) {
  h.sandbox.data.requests=[{id:'fictional-leave',employeeName:'Fictional Person',date:'2027-01-03',status:'approved',type:'Holiday'}];
}
test('an already mounted Today view refreshes date, ISO week and the seven-day leave window',async()=>{
  const h=calendarCacheFixture([before,after]);approvedToday(h);await h.api.loadTenantCalendar();const dom=mountHome(h);
  assert.match(dom.list.innerHTML,/Fictional Person/);h.advance(60000);await h.api.loadTenantCalendar();h.api.renderHome(dom.content);
  assert.equal(dom.date.textContent,'Mon, 04 Jan 2027');assert.equal(dom.week.textContent,'Week 1 · Current workspace');
  assert.doesNotMatch(dom.list.innerHTML,/Fictional Person/);assert.match(dom.list.innerHTML,/Open Absence & Leave/);
});
test('calendar renewal preserves a focused leave control and defers changed list content until focus leaves',async()=>{
  const h=calendarCacheFixture([before,after]);approvedToday(h);await h.api.loadTenantCalendar();const dom=mountHome(h),old=dom.list.innerHTML;
  h.sandbox.document.activeElement=dom.focus;h.advance(60000);await h.api.loadTenantCalendar();h.api.renderHome(dom.content);
  assert.equal(dom.date.textContent,'Mon, 04 Jan 2027');assert.equal(dom.list.innerHTML,old);assert.equal(h.sandbox.document.activeElement,dom.focus);
  assert.equal(dom.heading.textContent,'Upcoming leave (refresh pending)');assert.match(dom.section.attributes['aria-label'],/awaiting refresh/);
  assert.equal(dom.events.length,1,'repeated redraws must not stack focus listeners');
  h.sandbox.document.activeElement=null;dom.events[0].fn();h.flush();
  assert.equal(dom.heading.textContent,'Upcoming leave (next 7 days)');assert.doesNotMatch(dom.list.innerHTML,/Fictional Person/);
});
test('a cancelled old expiry callback cannot invalidate a newer snapshot',async()=>{
  const h=calendarCacheFixture([before,after]);await h.api.loadTenantCalendar();const old=[...h.timers.values()].find(timer=>timer.delay===60000);assert.ok(old);
  h.api.invalidateTenantCalendar();await h.api.loadTenantCalendar();await old.fn();
  assert.equal(h.calls,2);assert.equal(h.api.currentDate().date,'Mon, 04 Jan 2027');
});
for(const maxAgeMs of [0,-1,NaN])test('non-positive or non-finite server TTL is unavailable: '+maxAgeMs,async()=>{
  const h=calendarCacheFixture([{...before,maxAgeMs}]),initialTimers=h.timers.size;assert.equal(await h.api.loadTenantCalendar(),null);assert.equal(h.api.currentDate().date,'Timezone not verified');
  assert.equal(h.timers.size,initialTimers,'invalid authority must not schedule a renewal timer');
});

test('network transit consumes the server TTL and delayed expiry callbacks cannot expose an expired date',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve});const h=calendarCacheFixture([pending]);
  const loading=h.api.loadTenantCalendar();h.advance(10000);release(before);await loading;
  assert.ok([...h.timers.values()].some(timer=>timer.delay===50000),'request transit must not extend server maximum age');
  h.advance(49999);assert.equal(h.api.currentDate().date,'Sun, 03 Jan 2027');h.advance(1);
  assert.equal(h.api.currentDate().date,'Timezone not verified');assert.equal(h.api.serverNowMs(),null);
});
test('a response delayed for its entire server TTL is unavailable',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve});const h=calendarCacheFixture([pending]);
  const loading=h.api.loadTenantCalendar();h.advance(60000);release(before);
  assert.equal(await loading,null);assert.equal(h.api.currentDate().date,'Timezone not verified');
});

test('mounted leave refresh settles even when DOM serialization normalizes the source HTML',async()=>{
  const h=calendarCacheFixture([before]);await h.api.loadTenantCalendar();const dom=mountHome(h);let writes=0,html='obsolete source summary';
  Object.defineProperty(dom.list,'innerHTML',{get(){return html},set(value){writes++;html=value.replaceAll('&','&amp;')}});
  h.api.renderHome(dom.content);assert.equal(writes,1);assert.match(html,/Open Absence &amp; Leave/);
  for(let i=0;i<4;i++)h.api.renderHome(dom.content);assert.equal(writes,1,'observer redraws must settle after the calendar source is rendered once');
});

// Independent peer reproduction: actual async calendar/readiness/Time Review consumers.
const renewalCalendar={schemaVersion:'tenant-calendar-1',tenant:'synthetic',site:null,timeZone:'UTC',asOf:'2026-11-01T00:00:00Z',localDate:'2026-11-01',localTime:'00:00:00',maxAgeMs:60000};
function renewalConsumerFixture(){
 let now=0,release,calendarCalls=0,evidenceCalls=0,id=0;
 const renewing=new Promise(resolve=>release=resolve),tasks=[],timers=new Map();
 const actor={tenant:'synthetic',id:'manager',email:'manager@invalid.test',role:'manager'};
 const body={contractVersion:'WFM_WORKFLOW_ACTION_EVIDENCE_V1',workflow:'time-review',availability:'available',items:[],unavailable:[],contextKey:'a'.repeat(64),scope:{tenant:'synthetic',personId:'manager',period:'2026-11-01',teamId:null,sourceId:null},asOf:renewalCalendar.asOf,timeZone:'UTC',maxAgeMs:60000};
 const sandbox={ui:{page:'overview'},data:{requests:[]},me:()=>actor,isEmployee:()=>false,
 window:{addEventListener(){},location:{href:'https://invalid.test/'}},
 document:{addEventListener(){},documentElement:{},querySelectorAll(selector){return selector.includes('.navbtn')?[{dataset:{page:'attendance'}}]:[]},querySelector(){return null},body:{classList:{add(){},remove(){},toggle(){}},dataset:{}}},
 MutationObserver:class{observe(){}disconnect(){}},URL,Intl,Date,console,performance:{now:()=>now},
 setTimeout(fn,delay){const n=++id;timers.set(n,{fn,delay});return n},clearTimeout(n){timers.delete(n)},queueMicrotask(fn){tasks.push(fn)},
 fetch:async(url)=>{
  if(url==='/api/tenant-calendar'){calendarCalls++;const value=calendarCalls===1?renewalCalendar:await renewing;return {ok:true,json:async()=>value}}
  if(url.includes('/action-evidence/')){evidenceCalls++;return {ok:true,json:async()=>body}}
  if(url==='/api/readiness')return {ok:true,json:async()=>({schemaVersion:'readiness-1',departments:[],asOf:renewalCalendar.asOf,timeZone:'UTC',maxAgeMs:60000})};
  if(url==='/api/runtime-identity')return {ok:true,json:async()=>({fixtureOnly:false})};
  throw Error('Unexpected URL '+url);
 }};
 sandbox.window.window=sandbox.window;sandbox.window.document=sandbox.document;
 const anchor='window.VectorWorkforceOperations={marker:MARKER';assert.equal(source.split(anchor).length,2);
 vm.runInNewContext(source.replace(anchor,'window.VectorWorkforceOperations={testHooks:{loadTenantCalendar,loadTimeReviewEvidence,loadReadinessEvidence,state,apply},marker:MARKER'),sandbox,{filename:sourcePath});
 const api=sandbox.window.VectorWorkforceOperations.testHooks;
 return {api,timers,advance(ms){now+=ms},release(){release({...renewalCalendar,asOf:'2026-11-01T00:01:00Z'})},get calendarCalls(){return calendarCalls},get evidenceCalls(){return evidenceCalls},async flush(){for(let i=0;i<10;i++){while(tasks.length)tasks.shift()();await Promise.resolve()}}};
}
test('normal asynchronous calendar renewal keeps dependent evidence reloadable',{timeout:5000},async()=>{
 const h=renewalConsumerFixture();await h.api.loadTenantCalendar();assert.equal(await h.api.loadTimeReviewEvidence(),true);assert.equal(h.api.state.timeReviewEvidence.status,'ready');
 await h.api.loadReadinessEvidence();assert.equal(h.api.state.readinessEvidence.status,'ready');
 const expiry=[...h.timers.values()].find(t=>t.delay===60000);assert.ok(expiry);h.advance(60000);
 const renewing=expiry.fn();await h.flush();
 // Another actual consumer can render while the network renewal is pending.
 const readiness=h.api.loadReadinessEvidence();await h.flush();h.release();await renewing;await readiness;await h.flush();
 await h.api.loadTimeReviewEvidence();await h.api.loadReadinessEvidence();await h.flush();
 console.log(JSON.stringify({source:sourcePath,calendarCalls:h.calendarCalls,evidenceCalls:h.evidenceCalls,calendar:h.api.state.calendar.status,timeReview:h.api.state.timeReviewEvidence.status,readiness:h.api.state.readinessEvidence.status}));
 assert.equal(h.api.state.calendar.status,'ready');assert.equal(h.api.state.timeReviewEvidence.status,'ready','a successful renewal must not strand Time Review in unavailable');
 assert.equal(h.api.state.readinessEvidence.status,'ready','a successful renewal must not strand readiness in unavailable');
});

test('same-tenant concurrent readers share one in-flight calendar result',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve});const h=calendarCacheFixture([pending]);
  const one=h.api.loadTenantCalendar(),two=h.api.loadTenantCalendar();assert.equal(h.calls,1);release(before);
  assert.equal((await one).asOf,before.asOf);assert.equal((await two).asOf,before.asOf);assert.equal(h.calls,1);
});
test('an old pending tenant read cannot overwrite the newer tenant or restore old authority',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve});const h=calendarCacheFixture([pending,{...after,tenant:'other-fictional'}]);
  const old=h.api.loadTenantCalendar();h.actor.tenant='other-fictional';const current=await h.api.loadTenantCalendar();
  assert.equal(current.tenant,'other-fictional');release(before);assert.equal(await old,null);
  assert.equal(h.api.state.calendar.value.tenant,'other-fictional');assert.equal(h.sandbox.window.WFMTenantCalendarSnapshot.tenant,'other-fictional');
  h.actor.tenant='third-fictional';assert.equal(h.api.currentDate().date,'Timezone not verified');assert.equal(h.api.serverNowMs(),null);
});
test('a response from another tenant is unavailable',async()=>{
  const h=calendarCacheFixture([{...before,tenant:'other-fictional'}]);assert.equal(await h.api.loadTenantCalendar(),null);assert.equal(h.sandbox.window.WFMTenantCalendarSnapshot,null);
});

// Calendar authority must describe one actual civil day in the returned zone.
for(const [label,localDate] of [
  ['non-leap February day','2027-02-29'],
  ['invalid month','2027-13-01'],
  ['invalid day','2027-01-99'],
  ['valid day contradicting the returned instant','2027-01-04'],
  ['date coerced from an array',['2027-01-03']]
])test('malformed calendar civil date stays unavailable: '+label,async()=>{
  const h=calendarCacheFixture([{...before,localDate}]),initialTimers=h.timers.size;
  assert.equal(await h.api.loadTenantCalendar(),null,'inconsistent calendar authority must be rejected');
  assert.equal(h.api.state.calendar.status,'unavailable');
  assert.equal(h.sandbox.window.WFMTenantCalendarSnapshot,null,'rejected authority must not remain available to browser domain consumers');
  assert.equal(h.api.currentDate().date,'Timezone not verified');
  assert.equal(h.api.serverNowMs(),null);
  assert.equal(h.timers.size,initialTimers,'rejected authority must not schedule renewal');
});
test('malformed renewal cannot retain bootstrap authority after expiry',async()=>{
  const h=calendarCacheFixture([before,{...after,localDate:'2027-13-01'}]);
  await h.api.loadTenantCalendar();assert.equal(h.sandbox.window.WFMTenantCalendarSnapshot.localDate,'2027-01-03');
  h.advance(60000);assert.equal(await h.api.loadTenantCalendar(),null);
  assert.equal(h.api.state.calendar.status,'unavailable');
  assert.equal(h.sandbox.window.WFMTenantCalendarSnapshot,null,'rejected renewal must clear bootstrap authority');
});
test('calendar publication failure clears bootstrap to agree with unavailable state',async()=>{
  const h=calendarCacheFixture([before]);
  h.sandbox.document.querySelector=()=>{throw Error('fictional render boundary failed')};
  assert.equal(await h.api.loadTenantCalendar(),null);
  assert.equal(h.api.state.calendar.status,'unavailable');
  assert.equal(h.sandbox.window.WFMTenantCalendarSnapshot,null,'failed publication must not leave separate consumers with ready authority');
  assert.equal(h.api.serverNowMs(),null);
});
