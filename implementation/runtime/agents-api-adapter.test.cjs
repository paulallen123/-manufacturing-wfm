'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createAgentsApiAdapter } = require('./agents-api-adapter.cjs');

function seed(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE implementation_runs(' +
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,contract_ref_hash TEXT NOT NULL,state TEXT NOT NULL,' +
      'started_at_ms INTEGER NOT NULL,deadline_at_ms INTEGER NOT NULL,target_hours INTEGER NOT NULL,' +
      'created_at TEXT NOT NULL,updated_at TEXT NOT NULL);'
  );
  const now = Date.now();
  db.prepare('INSERT INTO implementation_runs VALUES(?,?,?,?,?,?,?,?,?)')
    .run('run-1', 'northstar-demo', 'contract', 'BUILDING', now, now + 3600000, 1, new Date(now).toISOString(), new Date(now).toISOString());
  db.close();
}
function fixture(fetchImpl, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-agents-adapter-'));
  const dbPath = path.join(dir, 'test.sqlite');
  seed(dbPath);
  const adapter = createAgentsApiAdapter({
    dbPath, apiKey: 'test-key', candidateSha: 'a'.repeat(40), deploymentId: 'deployment-1',
    model: 'gpt-6-sol', fetchImpl, ...options
  });
  return { dir, dbPath, adapter, close() { adapter.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('creates and persists one no-sandbox session bound to exact VECTOR identity', async () => {
  const calls = [];
  const f = fixture(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'sess_123', status: 'idle' }), { status: 200 });
  });
  try {
    const result = await f.adapter.ensureSession({ runId: 'run-1', tenant: 'northstar-demo', initialInput: 'Read-only bootstrap.' });
    assert.equal(result.sessionId, 'sess_123');
    assert.equal(result.reused, false);
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.environment.type, 'none');
    assert.equal(body.agent.model, 'gpt-6-sol');
    assert.equal(body.metadata.vector_sha, 'a'.repeat(40));
    assert.equal(body.metadata.vector_deployment, 'deployment-1');
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT session_id FROM vector_agents_sessions').get().session_id, 'sess_123');
    db.close();
  } finally { f.close(); }
});

test('reuses only after retrieving the persisted session and never blindly recreates', async () => {
  let phase = 'create';
  const calls = [];
  const f = fixture(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (phase === 'create') return new Response(JSON.stringify({ id: 'sess_reuse', status: 'idle' }), { status: 200 });
    if (phase === 'reuse') return new Response(JSON.stringify({ id: 'sess_reuse', status: 'idle' }), { status: 200 });
    return new Response(JSON.stringify({ error: { type: 'server_error' } }), { status: 503 });
  });
  try {
    await f.adapter.ensureSession({ runId: 'run-1', tenant: 'northstar-demo', initialInput: 'first' });
    phase = 'reuse'; calls.length = 0;
    const reused = await f.adapter.ensureSession({ runId: 'run-1', tenant: 'northstar-demo', initialInput: 'ignored' });
    assert.equal(reused.reused, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'GET');
    phase = 'fail'; calls.length = 0;
    await assert.rejects(
      () => f.adapter.ensureSession({ runId: 'run-1', tenant: 'northstar-demo', initialInput: 'no duplicate' }),
      error => error?.code === 'AGENTS_SESSION_RECONCILIATION_REQUIRED'
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'GET');
  } finally { f.close(); }
});

test('concurrent bootstrap reserves the exact identity before calling OpenAI', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let posts = 0;
  const f = fixture(async url => {
    if (String(url).endsWith('/v1/agents/sessions')) {
      posts += 1;
      if (posts === 1) { await gate; return new Response(JSON.stringify({ id: 'sess_one', status: 'idle' }), { status: 200 }); }
    }
    return new Response('{}', { status: 409 });
  });
  try {
    const first = f.adapter.ensureSession({ runId: 'run-1', tenant: 'northstar-demo', initialInput: 'first' });
    await new Promise(resolve => setTimeout(resolve, 10));
    await assert.rejects(
      () => f.adapter.ensureSession({ runId: 'run-1', tenant: 'northstar-demo', initialInput: 'second' }),
      error => error?.code === 'AGENTS_SESSION_CREATION_IN_PROGRESS'
    );
    assert.equal(posts, 1);
    release();
    assert.equal((await first).sessionId, 'sess_one');
  } finally { release?.(); f.close(); }
});

test('wrong tenant is rejected before any OpenAI call', async () => {
  let calls = 0;
  const f = fixture(async () => { calls += 1; return new Response('{}', { status: 500 }); });
  try {
    await assert.rejects(() => f.adapter.ensureSession({ runId: 'run-1', tenant: 'other', initialInput: 'x' }), /IDENTITY_MISMATCH/);
    assert.equal(calls, 0);
  } finally { f.close(); }
});

test('new canonical build supersedes the previous build session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-agents-rebind-'));
  const dbPath = path.join(dir, 'test.sqlite'); seed(dbPath);
  let n = 0;
  const fetchImpl = async url => String(url).endsWith('/v1/agents/sessions')
    ? new Response(JSON.stringify({ id: 'sess_' + (++n), status: 'idle' }), { status: 200 })
    : new Response('{}', { status: 404 });
  const a = createAgentsApiAdapter({ dbPath, apiKey: 'k', candidateSha: 'a'.repeat(40), deploymentId: 'd1', fetchImpl });
  await a.ensureSession({ runId: 'run-1', tenant: 'northstar-demo', initialInput: 'a' }); a.close();
  const b = createAgentsApiAdapter({ dbPath, apiKey: 'k', candidateSha: 'b'.repeat(40), deploymentId: 'd2', fetchImpl });
  try {
    await b.ensureSession({ runId: 'run-1', tenant: 'northstar-demo', initialInput: 'b' });
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare('SELECT candidate_sha,status FROM vector_agents_sessions ORDER BY candidate_sha').all(); db.close();
    assert.equal(rows[0].status, 'SUPERSEDED');
    assert.equal(rows[1].status, 'idle');
  } finally { b.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});


test('active analysis ignores transient idle until all read-only tools run and a report exists', async () => {
  let read = 0;
  const submitted = [];
  const f = fixture(async (url, init = {}) => {
    url = String(url);
    if (url.endsWith('/sessions/sess_active') && init.method === 'GET') {
      read += 1;
      if (read <= 2) return new Response(JSON.stringify({ id:'sess_active', status:'idle', required_actions:[] }), { status:200 });
      if (read === 3) return new Response(JSON.stringify({
        id:'sess_active', status:'requires_action', required_actions:[
          { type:'function_call', turn_id:'turn-1', call_id:'call-1', name:'get_vector_binding', arguments:{} },
          { type:'function_call', turn_id:'turn-1', call_id:'call-2', name:'get_implementation_status', arguments:{} },
          { type:'function_call', turn_id:'turn-1', call_id:'call-3', name:'get_customer_proof_gaps', arguments:{} }
        ]
      }), { status:200 });
      return new Response(JSON.stringify({ id:'sess_active', status:'idle', required_actions:[] }), { status:200 });
    }
    if (url.endsWith('/sessions/sess_active/events') && init.method === 'POST') {
      submitted.push(...JSON.parse(init.body).events);
      return new Response('', { status:202 });
    }
    if (url.includes('/sessions/sess_active/items?')) {
      return new Response(JSON.stringify({
        data:[{ id:'msg-new', type:'message', role:'assistant', content:[{type:'output_text',text:'fresh active report'}] }]
      }), { status:200 });
    }
    if (url.includes('/turns?')) return new Response(JSON.stringify({data:[]}), {status:200});
    throw new Error('unexpected ' + init.method + ' ' + url);
  }, { pollIntervalMs:0, maxPolls:8 });
  try {
    const result = await f.adapter.analyzeSession({
      sessionId:'sess_active', runId:'run-1', tenant:'northstar-demo', startTurn:true,
      toolHandler: async name => ({ name, readOnly:true })
    });
    assert.equal(result.status,'PASS');
    assert.equal(result.toolCalls,3);
    assert.equal(result.report,'fresh active report');
    assert.equal(submitted.some(event => event.type === 'agent.session.input.message'), true);
    assert.equal(submitted.filter(event => event.type === 'agent.session.input.tool_result').length,3);
  } finally { f.close(); }
});


test('an idle session with a failed billing turn stops before another message or a false timeout',async()=>{
 const calls=[],f=fixture(async(url,init={})=>{url=String(url);calls.push({url,method:init.method});if(url.endsWith('/v1/agents/sessions'))return new Response(JSON.stringify({id:'sess_billing',status:'idle'}),{status:200});if(url.endsWith('/sess_billing'))return new Response(JSON.stringify({id:'sess_billing',status:'idle',error:null,required_actions:[]}),{status:200});if(url.includes('/turns?'))return new Response(JSON.stringify({data:[{id:'turn_failed',status:'failed',error:{code:'usage_limit_exceeded',message:'private provider detail must not leak'}}]}),{status:200});if(url.endsWith('/events'))return new Response('',{status:202});throw Error('unexpected '+url);},{pollIntervalMs:0,maxPolls:3});try{await f.adapter.ensureSession({runId:'run-1',tenant:'northstar-demo',initialInput:'first'});await assert.rejects(f.adapter.analyzeSession({sessionId:'sess_billing',runId:'run-1',tenant:'northstar-demo',startTurn:true,toolHandler:()=>assert.fail('no tools expected')}),e=>e.code==='AGENTS_PROVIDER_USAGE_LIMIT_EXCEEDED'&&e.statusCode===429&&!e.message.includes('private provider detail'));assert.equal(calls.filter(c=>c.url.endsWith('/events')).length,0);const db=new DatabaseSync(f.dbPath);assert.equal(db.prepare('SELECT status FROM vector_agents_sessions').get().status,'failed');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vector_agents_reports').get().n,0);db.close();}finally{f.close();}
});

test('failed turns preserve the difference between provider quota, rate limit and authentication',async()=>{
 for(const [providerCode,statusCode] of [['insufficient_quota',429],['rate_limit_exceeded',429],['invalid_api_key',401]]){let posts=0;const f=fixture(async(url,init={})=>{url=String(url);if(url.endsWith('/sessions/sess_error'))return new Response(JSON.stringify({id:'sess_error',status:'idle',error:null}),{status:200});if(url.includes('/turns?'))return new Response(JSON.stringify({data:[{id:'failed',status:'failed',error:{code:providerCode}}]}),{status:200});if(init.method==='POST')posts++;return new Response('',{status:202});},{pollIntervalMs:0,maxPolls:2});try{await assert.rejects(f.adapter.analyzeSession({sessionId:'sess_error',runId:'run-1',tenant:'northstar-demo',startTurn:true,toolHandler:async()=>({})}),{code:'AGENTS_PROVIDER_'+providerCode.toUpperCase(),statusCode});assert.equal(posts,0);}finally{f.close();}}
});

test('unavailable turn readback fails closed before another message is submitted',async()=>{let posts=0;const f=fixture(async(url,init={})=>{if(String(url).endsWith('/sessions/sess_readback'))return new Response(JSON.stringify({id:'sess_readback',status:'idle'}),{status:200});if(String(url).includes('/turns?'))return new Response('{}',{status:503});if(init.method==='POST')posts++;return new Response('',{status:202});},{pollIntervalMs:0,maxPolls:2});try{await assert.rejects(f.adapter.analyzeSession({sessionId:'sess_readback',runId:'run-1',tenant:'northstar-demo',startTurn:true,toolHandler:async()=>({})}),{code:'AGENTS_SESSION_RECONCILIATION_REQUIRED'});assert.equal(posts,0);}finally{f.close();}});
