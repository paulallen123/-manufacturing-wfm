const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadVectorHelpers(options={}) {
  const source = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');
  const instrumented = source.replace(
    'window.VectorWorkforceOperations={marker:MARKER',
    'window.VectorWorkforceOperations={render:window.render,sourceIdentity,alertsMarkup,readActionContext,rememberActionContext,renderEmployeeHome,retryEmployeeHome:typeof retryEmployeeHome==="function"?retryEmployeeHome:null,state,marker:MARKER'
  );
  assert.notEqual(instrumented, source, 'Vector action markup test hook could not be attached.');
  const classList = { add() {}, remove() {}, toggle() {} };
  const sandbox = {
    fetch:options.fetch,
    ui:options.ui||{page:'overview'},
    ...(options.auth===undefined?{}:{F:options.auth}),
    me:()=>options.actor||{},isEmployee:()=>options.actor?.role==='employee',
    window: { render: options.render, addEventListener() {}, location: { href: 'https://example.test/' } },
    document: {
      get title(){return this._title||'';},set title(value){this._title=value;options.onTitleWrite?.(value);},
      addEventListener() {},
      documentElement: {},
      querySelectorAll() { return []; },
      querySelector() { return null; },
      body: { classList, dataset: {} }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout() { return 0; },
    queueMicrotask() {},
    sessionStorage: (() => {
      const values = new Map();
      return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); }
      };
    })(),
    URL,
    Intl,
    Date,
    console
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(instrumented, sandbox, { filename: 'vector-shell.js' });
  return sandbox.window.VectorWorkforceOperations;
}

test('Time Review action context uses the canonical attendance route end to end', () => {
  const vector = loadVectorHelpers();
  assert.equal(vector.rememberActionContext({
    sourceId: 'issue-1',
    workflow: 'time-review',
    route: 'attendance',
    title: 'Missing clock-out'
  }), true);
  const context = vector.readActionContext();
  assert.equal(context?.workflow, 'time-review');
  assert.equal(context?.route, 'attendance');
  assert.equal(context?.sourceId, 'issue-1');
  assert.equal(vector.rememberActionContext({
    sourceId: 'issue-2',
    workflow: 'time-review',
    route: 'time-review',
    title: 'Legacy route'
  }), false);
  const source = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');
  assert.match(source, /if\(page\(\)!=='attendance'\|\|!ctx\)/);
});

test('approved Improve navigation exposes payroll reports without reviving the retired Reports top-level nav', () => {
  const source = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');
  assert.match(source, /label:'Improve',icon:'report',routes:\['insights','costs','recommendations','benchmarks','compliance','overtime-watch','reports'\]/);
  assert.match(source, /\['reports','Reports'\]/);
});

test('source lifecycle is partitioned without presentation-word inference', () => {
  const vector = loadVectorHelpers();
  assert.equal(vector.actionDisposition({ confirmationState: 'action_required' }), 'needs-action');
  assert.equal(vector.actionDisposition({ confirmationState: 'needs_verification' }), 'needs-action');
  assert.equal(vector.actionDisposition({ status: 'Urgent' }), 'needs-action');
  assert.equal(vector.actionDisposition({ confirmationState: 'decision_sent' }), 'awaiting-source');
  assert.equal(vector.actionDisposition({ confirmationState: 'confirming_source' }), 'awaiting-source');
  assert.equal(vector.actionDisposition({ confirmationState: 'resolved' }), 'resolved');
});

test('awaiting confirmation remains present but does not inflate action-needed count', () => {
  const vector = loadVectorHelpers();
  const rows = [
    { id: 'a', confirmationState: 'action_required' },
    { id: 'b', confirmationState: 'needs_verification' },
    { id: 'c', status: 'Needs review' },
    { id: 'd', confirmationState: 'decision_sent' },
    { id: 'e', confirmationState: 'confirming_source' },
    { id: 'f', confirmationState: 'resolved' }
  ];
  const groups = vector.actionQueueGroups(rows);
  assert.deepEqual(Array.from(groups.needs, row => row.id), ['a', 'b', 'c']);
  assert.deepEqual(Array.from(groups.awaiting, row => row.id), ['d', 'e']);
});

test('rendered action queue keeps source-confirming work collapsed, visible and passive without hiding actionable work', () => {
  const vector = loadVectorHelpers();
  const row = (id, title, status, confirmationState) => ({
    id,
    title,
    status,
    confirmationState,
    detail: 'Source-owned evidence',
    tone: 'blue',
    route: 'attendance',
    action: 'Review'
  });
  const html = vector.alertsMarkup([
    row('a', 'Action A', 'Action required', 'action_required'),
    row('b', 'Decision B', 'Decision sent', 'decision_sent'),
    row('c', 'Confirming C', 'Confirming source', 'confirming_source'),
    row('d', 'Verify D', 'Needs verification', 'needs_verification'),
    row('e', 'Resolved E', 'Resolved', 'resolved'),
    row('f', 'Loose wording F', 'Urgent', undefined)
  ]);

  assert.match(html, /Needs my action <em>3<\/em>/);
  assert.match(html, /<details data-vector-awaiting-confirmation>/);
  assert.match(html, /Awaiting source confirmation · 2/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(html, /Resolved E/);

  const [needsMarkup, awaitingMarkup = ''] = html.split('<details data-vector-awaiting-confirmation>');
  assert.match(needsMarkup, /Action A/);
  assert.match(needsMarkup, /Verify D/);
  assert.match(needsMarkup, /Loose wording F/);
  assert.doesNotMatch(needsMarkup, /Decision B|Confirming C/);
  assert.match(needsMarkup, /aria-label="Review Action A">Review<\/button>/);
  assert.match(needsMarkup, /aria-label="Review Verify D">Review<\/button>/);
  assert.match(needsMarkup, /aria-label="Review Loose wording F">Review<\/button>/);
  assert.doesNotMatch(needsMarkup, />View status<\/button>/);

  assert.match(awaitingMarkup, /Decision B/);
  assert.match(awaitingMarkup, /Confirming C/);
  assert.match(awaitingMarkup, /aria-label="View status Decision B">View status<\/button>/);
  assert.match(awaitingMarkup, /aria-label="View status Confirming C">View status<\/button>/);
  assert.doesNotMatch(awaitingMarkup, /aria-label="Review (?:Decision B|Confirming C)"/);
});

test('action ordering cannot create synthetic urgency styling', () => {
  const css = fs.readFileSync(path.join(__dirname, 'vector-shell.css'), 'utf8');
  assert.doesNotMatch(css, /\.vector-alert-row:first-child>button\s*\{/);
  assert.match(css, /\.vector-alert-row>button\{[^}]*background:#edf3fb;[^}]*color:#355375;/);
});

test('shell identity uses authenticated actor with the real display-only me shape and clears after sign-out',async()=>{
 const display={id:'e0',name:'Maya Bennett',title:'Employee',costs:false},auth={ready:true,actor:{tenant:'northstar-demo',email:'maya@northstar.example',personId:'e0',role:'employee'}};
 const api=loadVectorHelpers({actor:display,auth});
 assert.equal(api.sourceIdentity().tenant,'northstar-demo');assert.equal(api.sourceIdentity().email,'maya@northstar.example');assert.equal(api.sourceIdentity().role,'employee');assert.equal(api.sourceIdentity().id,'e0');assert.equal(api.sourceIdentity().name,'Maya Bennett');
 auth.ready=false;assert.equal(api.sourceIdentity().tenant,undefined,'stale display identity cannot survive sign-out');
});

test('employee home redraws only when content changes, allowing the mutation observer to settle',async()=>{
  const actor={tenant:'alpha',email:'employee@alpha',id:'e1',role:'employee',name:'Alex'};
  let titleWrites=0;const api=loadVectorHelpers({actor,onTitleWrite:()=>titleWrites++});
  api.state.calendar={status:'ready',value:{tenant:'alpha',asOf:'2026-10-11T09:00:00Z',localDate:'2026-10-11',timeZone:'Europe/London',maxAgeMs:300000}};
  api.state.employeeHome={status:'ready',owner:'alpha:employee@alpha:e1',value:{identity:{name:'Alex'},leave:{availableMinutes:600},shifts:[],requests:[]}};
  const host=()=>({html:'',writes:0,dataset:{},get innerHTML(){return this.html;},set innerHTML(value){this.html=value;this.writes++;},querySelector(){return this.html.includes('data-vector-employee-home')?{}:null;}});
  const content=host();
  for(let i=0;i<4;i++)await api.renderEmployeeHome(content);
  assert.equal(content.writes,1,'an observer-triggered rerender of identical home content must not trigger another mutation');
  assert.equal(titleWrites,1,'reassigning the same document title must not retrigger the document observer');
  assert.match(content.html,/10 h/);
  api.state.employeeHome.value.leave.availableMinutes=660;
  await api.renderEmployeeHome(content);assert.equal(content.writes,2);assert.match(content.html,/11 h/);
  content.innerHTML='<h1>Replacement content</h1>';
  await api.renderEmployeeHome(content);assert.equal(content.writes,4,'replaced content must be restored even when the source value is unchanged');
  const replacement=host();await api.renderEmployeeHome(replacement);assert.equal(replacement.writes,1,'a new host must receive the current home');
});

test('employee home failure settles until explicit retry and recovery settles too',async()=>{
  let calls=0,unavailable=true;
  const actor={tenant:'alpha',email:'worker@alpha',id:'u1',role:'employee'};
  const api=loadVectorHelpers({actor,fetch:async()=>{calls++;return {ok:!unavailable,json:async()=>({identity:{name:'Worker'},leave:{availableMinutes:60},shifts:[],requests:[]})};}});
  api.state.calendar={status:'ready',value:{tenant:'alpha',asOf:new Date().toISOString(),timeZone:'Europe/London',maxAgeMs:300000}};
  const content={html:'',writes:0,dataset:{},get innerHTML(){return this.html;},set innerHTML(value){this.html=value;this.writes++;},querySelector(selector){return this.html.includes(selector.slice(1,-1))?{}:null;}};
  for(let i=0;i<4;i++)await api.renderEmployeeHome(content);
  assert.equal(calls,1,'observer passes must not retry an unavailable source');
  assert.equal(content.writes,2,'loading and error are rendered only once');
  assert.match(content.html,/data-vector-retry-employee-home/);
  content.innerHTML='<h1>Replaced content</h1>';
  await api.renderEmployeeHome(content);assert.equal(calls,1);assert.match(content.html,/Current work is unavailable/);
  unavailable=false;
  await api.retryEmployeeHome(content);
  for(let i=0;i<4;i++)await api.renderEmployeeHome(content);
  assert.equal(calls,2,'explicit retry makes one new request');assert.equal(api.state.employeeHome.status,'ready');
  assert.match(content.html,/Worker/);
});

test('employee home discards delayed results after navigation, account change or host removal and can recover',async()=>{
  for(const change of ['navigation-success','navigation-failure','account','detached']){
    let release,calls=0;
    const pending=new Promise(resolve=>{release=resolve;});
    const actor={tenant:'alpha',email:'worker@alpha',id:'u1',role:'employee'},ui={page:'overview'};
    const api=loadVectorHelpers({actor,ui,fetch:async()=>{calls++;if(calls===1)return pending;return {ok:true,json:async()=>({identity:{name:'Current worker'},shifts:[],requests:[]})};}});
    api.state.calendar={status:'ready',value:{tenant:'alpha',asOf:new Date().toISOString(),timeZone:'Europe/London',maxAgeMs:300000}};
    const content={isConnected:true,html:'',dataset:{},get innerHTML(){return this.html;},set innerHTML(value){this.html=value;},querySelector(selector){return this.html.includes(selector.slice(1,-1))?{}:null;}};
    const running=api.renderEmployeeHome(content);await new Promise(resolve=>setImmediate(resolve));
    if(change.startsWith('navigation'))ui.page='leave';
    if(change==='account'){actor.email='second@alpha';actor.id='u2';}
    if(change==='detached')content.isConnected=false;
    content.innerHTML='<h1>New screen</h1>';
    release({ok:change!=='navigation-failure',json:async()=>({identity:{name:'Previous worker'},shifts:[],requests:[]})});
    await running;
    assert.equal(content.html,'<h1>New screen</h1>',change+' cannot overwrite the current view');
    assert.equal(api.state.employeeHome.status,'idle',change+' releases obsolete loading state');
    ui.page='overview';content.isConnected=true;
    await api.renderEmployeeHome(content);
    assert.equal(calls,2,change+' can load again');assert.match(content.html,/Current worker/);
  }
});

test('authoritative screen render refreshes the employee personal record rather than retaining old balances',async()=>{
 let calls=0,availableMinutes=600;
 const actor={tenant:'alpha',email:'worker@alpha',id:'u1',role:'employee'};
 const api=loadVectorHelpers({actor,render:async()=>{},fetch:async()=>{calls++;return {ok:true,json:async()=>({identity:{name:'Worker'},leave:{availableMinutes},shifts:[],requests:[]})};}});
 api.state.calendar={status:'ready',value:{tenant:'alpha',asOf:new Date().toISOString(),timeZone:'Europe/London',maxAgeMs:300000}};
 const content={html:'',dataset:{},get innerHTML(){return this.html;},set innerHTML(value){this.html=value;},querySelector(selector){return this.html.includes(selector.slice(1,-1))?{}:null;}};
 await api.renderEmployeeHome(content);assert.match(content.html,/10 h/);assert.equal(calls,1);
 availableMinutes=540;await api.render();await api.renderEmployeeHome(content);
 assert.equal(calls,2,'returning after an authoritative workflow redraw must fetch a fresh personal record');assert.match(content.html,/9 h/);
 for(let i=0;i<3;i++)await api.renderEmployeeHome(content);assert.equal(calls,2,'observer-only passes still use the settled record');
});

test('a previous personal fetch cannot overwrite the fresh record after authoritative redraw',async()=>{
 let release,calls=0;const pending=new Promise(resolve=>{release=resolve;});
 const actor={tenant:'alpha',email:'worker@alpha',id:'u1',role:'employee'};
 const api=loadVectorHelpers({actor,render:async()=>{},fetch:async()=>{calls++;return calls===1?pending:{ok:true,json:async()=>({identity:{name:'Worker'},leave:{availableMinutes:540},shifts:[],requests:[]})};}});
 api.state.calendar={status:'ready',value:{tenant:'alpha',asOf:new Date().toISOString(),timeZone:'Europe/London',maxAgeMs:300000}};
 const content={html:'',dataset:{},get innerHTML(){return this.html;},set innerHTML(value){this.html=value;},querySelector(selector){return this.html.includes(selector.slice(1,-1))?{}:null;}};
 const first=api.renderEmployeeHome(content);await new Promise(resolve=>setImmediate(resolve));
 await api.render();await api.renderEmployeeHome(content);assert.equal(calls,2);assert.match(content.html,/9 h/);
 release({ok:true,json:async()=>({identity:{name:'Worker'},leave:{availableMinutes:600},shifts:[],requests:[]})});await first;
 assert.match(content.html,/9 h/);assert.equal(api.state.employeeHome.value.leave.availableMinutes,540);
});

function timeEvidenceHarness({role='manager',allowed=true,calendarLoad,evidence={}}={}){
  const source=fs.readFileSync(path.join(__dirname,'vector-shell.js'),'utf8');
  const start=source.indexOf('function actionEvidenceOwnerKey()'),end=source.indexOf('function invalidateTenantCalendar()',start);
  assert.ok(start>0&&end>start);
  const calendar={asOf:'2026-10-11T09:00:00Z',timeZone:'Europe/London',maxAgeMs:300000};
  const sandbox={state:{evidenceEpoch:0,timeReviewEvidence:{status:'idle',items:[],owner:''}},role,allowed,calls:[],
    sourceIdentity:()=>({tenant:'alpha',email:'user@alpha',id:'u1',role:sandbox.role}),employee:()=>sandbox.role==='employee',
    available:route=>route==='attendance'&&sandbox.allowed,refreshActionSurfaces:()=>{},loadTenantCalendar:calendarLoad||(()=>Promise.resolve(calendar)),
    TIME_REVIEW_EVIDENCE_PATH:'/api/workforce/lifecycle/action-evidence/time-review',ACTION_EVIDENCE_CONTRACT:'WFM_WORKFLOW_ACTION_EVIDENCE_V1',acceptTimeReviewEvidenceItem:item=>item,
    fetch:async url=>{sandbox.calls.push(url);return {ok:true,json:async()=>({contractVersion:'WFM_WORKFLOW_ACTION_EVIDENCE_V1',workflow:'time-review',items:[{sourceId:'issue-1'}],scope:{tenant:'alpha',personId:'u1',period:'2026-10-05',teamId:null,sourceId:null},contextKey:'a'.repeat(64),availability:'available',unavailable:[],...calendar,...evidence})};}
  };
  vm.runInNewContext(source.slice(start,end)+';api={loadTimeReviewEvidence};',sandbox);return {sandbox,calendar};
}
test('payroll and employee screens do not request unavailable manager Time Review evidence',async()=>{
  for(const role of ['payroll_admin','employee']){const {sandbox}=timeEvidenceHarness({role,allowed:false});assert.equal(await sandbox.api.loadTimeReviewEvidence(),false);assert.deepEqual(sandbox.calls,[]);}
});
test('authorised manager screens still load source-confirmed action evidence',async()=>{
  const {sandbox}=timeEvidenceHarness();assert.equal(await sandbox.api.loadTimeReviewEvidence(),true);assert.equal(sandbox.calls.length,1);assert.equal(sandbox.state.timeReviewEvidence.items[0].sourceId,'issue-1');
});
test('losing access while the calendar loads prevents the manager evidence request',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const {sandbox,calendar}=timeEvidenceHarness({calendarLoad:()=>pending});
  const result=sandbox.api.loadTimeReviewEvidence();sandbox.allowed=false;release(calendar);assert.equal(await result,false);assert.deepEqual(sandbox.calls,[]);
});


test('denied UI roles make zero evidence requests even when navigation is present',async()=>{
 for(const role of ['employee','payroll_admin','viewer','','MANAGER']){const {sandbox}=timeEvidenceHarness({role,allowed:true});assert.equal(await sandbox.api.loadTimeReviewEvidence(),false,role);assert.deepEqual(sandbox.calls,[],role);}
});
test('manager director and supervisor retain permitted UI evidence reads',async()=>{
 for(const role of ['manager','director','supervisor']){const {sandbox}=timeEvidenceHarness({role,allowed:true});assert.equal(await sandbox.api.loadTimeReviewEvidence(),true,role);assert.equal(sandbox.calls.length,1,role);}
});

test('source-unavailable evidence is retained as unavailable rather than a successful empty action list',async()=>{
 const {sandbox}=timeEvidenceHarness({evidence:{availability:'unavailable',items:[],unavailable:[{reasonCode:'SOURCE_EVIDENCE_UNAVAILABLE'}]}});
 assert.equal(await sandbox.api.loadTimeReviewEvidence(),false);assert.equal(sandbox.state.timeReviewEvidence.status,'unavailable');assert.equal(sandbox.state.timeReviewEvidence.unavailable.length,1);
});
test('partially available source evidence keeps admitted items and its incomplete status',async()=>{
 const {sandbox}=timeEvidenceHarness({evidence:{availability:'partial',unavailable:[{reasonCode:'SOURCE_EVIDENCE_UNAVAILABLE'}]}});
 assert.equal(await sandbox.api.loadTimeReviewEvidence(),true);assert.equal(sandbox.state.timeReviewEvidence.status,'partial');assert.equal(sandbox.state.timeReviewEvidence.items.length,1);
});
test('other-tenant or other-person response envelopes cannot enter a manager action queue',async()=>{
 for(const scope of [{tenant:'bravo',personId:'u1',period:'2026-10-05'},{tenant:'alpha',personId:'other',period:'2026-10-05'}]){
  const {sandbox}=timeEvidenceHarness({evidence:{scope}});assert.equal(await sandbox.api.loadTimeReviewEvidence(),false);assert.equal(sandbox.state.timeReviewEvidence.status,'unavailable');assert.equal(sandbox.state.timeReviewEvidence.items.length,0);
 }
});
test('a later request epoch discards an old evidence body even when the account name is unchanged',async()=>{
 const {sandbox,calendar}=timeEvidenceHarness();let release;
 sandbox.fetch=async()=>({ok:true,json:()=>new Promise(resolve=>{release=resolve;})});
 const pending=sandbox.api.loadTimeReviewEvidence();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof release,'function');sandbox.state.evidenceEpoch++;
 release({contractVersion:'WFM_WORKFLOW_ACTION_EVIDENCE_V1',workflow:'time-review',items:[],unavailable:[],availability:'available',contextKey:'a'.repeat(64),scope:{tenant:'alpha',personId:'u1',period:'2026-10-05',teamId:null,sourceId:null},...calendar});
 assert.equal(await pending,false);assert.equal(sandbox.state.timeReviewEvidence.status,'loading');
});
test('the action surface explains unavailable and partial evidence to the signed-in reviewer',()=>{
 const vector=loadVectorHelpers({actor:{tenant:'alpha',id:'u1',role:'manager'}});
 vector.state.timeReviewEvidence.status='unavailable';assert.match(vector.alertsMarkup([]),/Source evidence is unavailable/);
 vector.state.timeReviewEvidence.status='partial';assert.match(vector.alertsMarkup([]),/Some source evidence is unavailable/);
});
