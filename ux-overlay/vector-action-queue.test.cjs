const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadVectorHelpers(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');
  const instrumented = source.replace(
    'window.VectorWorkforceOperations={marker:MARKER',
    'window.VectorWorkforceOperations={loadTimeReviewEvidence,alertsMarkup,readActionContext,rememberActionContext,marker:MARKER'
  );
  assert.notEqual(instrumented, source, 'Vector action markup test hook could not be attached.');
  const classList = { add() {}, remove() {}, toggle() {} };
  const sandbox = {
    window: { render: undefined, addEventListener() {}, location: { href: 'https://example.test/' } },
    document: {
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
    console,
    ...options
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

async function loadRoleEvidence(role){
  const calls=[];
  const vector=loadVectorHelpers({
    me:()=>({id:'p1',name:'Test fixture',title:role,costs:true,permissions:[]}),
    F:{actor:{personId:'p1',email:'fixture@alpha',tenant:'alpha',role}},
    isEmployee:()=>role==='employee',
    data:{tenant:'alpha'},
    fetch:async url=>{
      calls.push(url);
      if(url==='/api/tenant-calendar')return {ok:true,json:async()=>({schemaVersion:'tenant-calendar-1',tenant:'alpha',timeZone:'Europe/London',asOf:'2026-10-11T09:00:00Z',localDate:'2026-10-11',maxAgeMs:900000})};
      assert.equal(url,'/api/workforce/lifecycle/action-evidence/time-review');
      return {ok:true,json:async()=>({contractVersion:'WFM_WORKFLOW_ACTION_EVIDENCE_V1',workflow:'time-review',items:[],timeZone:'Europe/London',asOf:'2026-10-11T09:00:00Z',maxAgeMs:900000})};
    }
  });
  return {ready:await vector.loadTimeReviewEvidence(),calls};
}

test('payroll and other non-manager shells do not request manager Time Review evidence',async()=>{
  for(const role of ['payroll_admin','employee','viewer',undefined]){
    const result=await loadRoleEvidence(role);
    assert.equal(result.ready,false,String(role));
    assert.deepEqual(result.calls,[],String(role)+' must not make a manager evidence request');
  }
});

test('manager director and supervisor shells retain current Time Review evidence reads',async()=>{
  for(const role of ['manager','director','supervisor']){
    const result=await loadRoleEvidence(role);
    assert.equal(result.ready,true,role);
    assert.deepEqual(result.calls,['/api/tenant-calendar','/api/workforce/lifecycle/action-evidence/time-review']);
  }
});

test('display identity cannot grant manager evidence access over a payroll session',async()=>{
  const calls=[];
  const vector=loadVectorHelpers({
    me:()=>({id:'p1',role:'manager',name:'Display identity'}),
    F:{actor:{personId:'p1',email:'payroll@alpha',tenant:'alpha',role:'payroll_admin'}},
    isEmployee:()=>false,
    fetch:async url=>{calls.push(url);throw Error('request forbidden');}
  });
  assert.equal(await vector.loadTimeReviewEvidence(),false);
  assert.deepEqual(calls,[]);
});

test('same displayed person cannot accept pending evidence after authenticated tenant changes',async()=>{
  const auth={actor:{personId:'p1',email:'manager@alpha',tenant:'alpha',role:'manager'}};
  let release,started;const pending=new Promise(resolve=>{started=resolve;});
  const vector=loadVectorHelpers({
    me:()=>({id:'p1',name:'Same display',title:'manager',costs:true,permissions:[]}),
    F:auth,isEmployee:()=>false,
    fetch:async url=>{
      if(url==='/api/tenant-calendar')return {ok:true,json:async()=>({schemaVersion:'tenant-calendar-1',tenant:'alpha',timeZone:'Europe/London',asOf:'2026-10-11T09:00:00Z',localDate:'2026-10-11',maxAgeMs:900000})};
      assert.equal(url,'/api/workforce/lifecycle/action-evidence/time-review');
      started();return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({contractVersion:'WFM_WORKFLOW_ACTION_EVIDENCE_V1',workflow:'time-review',items:[],timeZone:'Europe/London',asOf:'2026-10-11T09:00:00Z',maxAgeMs:900000})});});
    }
  });
  const result=vector.loadTimeReviewEvidence();
  const outcome=await Promise.race([pending.then(()=> 'pending'),result.then(()=> 'finished')]);
  assert.equal(outcome,'pending','authorised manager must request evidence');
  auth.actor={personId:'p1',email:'manager@beta',tenant:'beta',role:'manager'};release();
  assert.equal(await result,false,'old tenant response must not become current evidence');
});
