'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');
const { createAgentsApiBootstrapRoute } = require('./agents-api-bootstrap-route.cjs');

function response() {
  return { statusCode: 200, headersSent: false, writableEnded: false, body: '', headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = '') { this.body = String(value); this.headersSent = true; this.writableEnded = true; } };
}
function request(method, url, body, token) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method; req.url = url;
  req.headers = token ? { 'x-wfm-implementation-internal': token } : {};
  return req;
}
function fixture(fetchImpl, statusForTenant = tenant => tenant === 'northstar-demo'
  ? { runId: 'run-1', tenant, state: 'BUILDING', operationalReady: false, requirements: [{ key: 'time-policies', satisfied: false }] }
  : null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-agents-route-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE implementation_runs(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,contract_ref_hash TEXT NOT NULL,state TEXT NOT NULL,started_at_ms INTEGER NOT NULL,deadline_at_ms INTEGER NOT NULL,target_hours INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);');
  const now = Date.now();
  db.prepare('INSERT INTO implementation_runs VALUES(?,?,?,?,?,?,?,?,?)').run('run-1','northstar-demo','c','BUILDING',now,now+3600000,1,new Date(now).toISOString(),new Date(now).toISOString());
  db.close();
  const route = createAgentsApiBootstrapRoute({
    dbPath, internalToken: 'internal-token', candidateSha: 'a'.repeat(40), deploymentId: 'deployment-1',
    apiKey: 'test-key', model: 'gpt-6-sol', fetchImpl,
    pollIntervalMs: 0, maxPolls: 8,
    statusForTenant
  });
  return { dir, route, close() { route.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('trusted HTTP bootstrap creates the read-only session and returns exact binding', async () => {
  const calls = [];
  let sessionReads = 0;
  const f = fixture(async (url, init = {}) => {
    url = String(url);
    calls.push({ url, init });
    if (url.endsWith('/v1/agents/sessions') && init.method === 'POST') {
      return new Response(JSON.stringify({ id: 'sess_route', status: 'idle' }), { status: 200 });
    }
    if (url.endsWith('/sess_route') && init.method === 'GET') {
      sessionReads += 1;
      if (sessionReads === 1) return new Response(JSON.stringify({ id:'sess_route', status:'idle', required_actions:[] }), { status:200 });
      if (sessionReads === 2) return new Response(JSON.stringify({
        id:'sess_route', status:'requires_action', required_actions:[
          {type:'function_call',turn_id:'turn',call_id:'1',name:'get_vector_binding',arguments:{}},
          {type:'function_call',turn_id:'turn',call_id:'2',name:'get_implementation_status',arguments:{}},
          {type:'function_call',turn_id:'turn',call_id:'3',name:'get_customer_proof_gaps',arguments:{}}
        ]
      }), { status:200 });
      return new Response(JSON.stringify({ id:'sess_route', status:'idle', required_actions:[] }), { status:200 });
    }
    if (url.endsWith('/sess_route/events') && init.method === 'POST') return new Response('', { status:202 });
    if (url.endsWith('/items?order=asc&limit=100')) {
      return new Response(JSON.stringify({ data: [{ type:'message', role:'assistant', content:[{type:'output_text',text:'read-only report'}] }] }), { status: 200 });
    }
    if (url.includes('/turns?')) return new Response(JSON.stringify({data:[]}), {status:200});
    throw new Error('unexpected '+init.method+' '+url);
  });
  try {
    const res = response();
    await f.route.handleRequest(request('POST','/api/implementation/autonomous/agents/bootstrap',{runId:'run-1',tenant:'northstar-demo'},'internal-token'),res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.agentsApi.sessionId, 'sess_route');
    assert.equal(body.binding.candidateSha, 'a'.repeat(40));
    assert.equal(body.binding.deploymentId, 'deployment-1');
    assert.match(JSON.parse(calls[0].init.body).input, /ACTIVE READ-ONLY|customer-proof/i);
    assert.equal(calls.some(call =>
      call.url.endsWith('/sess_route/events') &&
      JSON.parse(call.init.body).events?.[0]?.type === 'agent.session.input.message'
    ), true);
  } finally { f.close(); }
});

test('wrong internal token fails before contacting OpenAI', async () => {
  let calls = 0;
  const f = fixture(async () => { calls += 1; return new Response('{}', { status: 500 }); });
  try {
    const res = response();
    await f.route.handleRequest(request('POST','/api/implementation/autonomous/agents/bootstrap',{runId:'run-1',tenant:'northstar-demo'},'wrong'),res);
    assert.equal(res.statusCode,403);
    assert.equal(calls,0);
  } finally { f.close(); }
});

test('historical same-tenant run cannot read current-run readiness or create a session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-agents-run-binding-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE implementation_runs(id TEXT PRIMARY KEY,tenant TEXT NOT NULL);');
  db.prepare('INSERT INTO implementation_runs VALUES(?,?)').run('historical-run', 'northstar-demo');
  db.prepare('INSERT INTO implementation_runs VALUES(?,?)').run('current-run', 'northstar-demo');
  db.close();
  let networkCalls = 0;
  const route = createAgentsApiBootstrapRoute({
    dbPath, internalToken: 'internal', candidateSha: 'a'.repeat(40), deploymentId: 'dep-1', apiKey: 'test-key',
    fetchImpl: async () => { networkCalls++; throw new Error('network must not be reached'); },
    statusForTenant: () => ({ runId: 'current-run', tenant: 'northstar-demo', operationalReady: true })
  });
  try {
    await assert.rejects(route.bootstrap({ runId: 'historical-run', tenant: 'northstar-demo' }),
      /VECTOR_AGENTS_CURRENT_RUN_MISMATCH/);
    assert.equal(networkCalls, 0);
    const check = new DatabaseSync(dbPath);
    try { assert.equal(check.prepare('SELECT COUNT(*) AS n FROM vector_agents_sessions').get().n, 0); }
    finally { check.close(); }
  } finally { route.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('run rotation after session creation blocks the agent turn', async () => {
  let activeRun = 'run-1';
  const calls = [];
  const f = fixture(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method });
    if (String(url).endsWith('/v1/agents/sessions') && init.method === 'POST') {
      activeRun = 'run-2';
      return new Response(JSON.stringify({ id: 'sess_rotated', status: 'idle' }), { status: 200 });
    }
    throw new Error('agent turn must not start');
  }, tenant => ({ runId: activeRun, tenant, operationalReady: false }));
  try {
    await assert.rejects(f.route.bootstrap({ runId: 'run-1', tenant: 'northstar-demo' }),
      /VECTOR_AGENTS_CURRENT_RUN_MISMATCH/);
    assert.deepEqual(calls.map(call => call.method), ['POST']);
  } finally { f.close(); }
});

test('run rotation while reading session state blocks message submission', async () => {
  let activeRun = 'run-1';
  const calls = [];
  const f = fixture(async (url, init = {}) => {
    url = String(url); calls.push({ url, method: init.method });
    if (url.endsWith('/v1/agents/sessions') && init.method === 'POST')
      return new Response(JSON.stringify({ id: 'sess_rotated_during_get', status: 'idle' }), { status: 200 });
    if (url.endsWith('/sess_rotated_during_get') && init.method === 'GET') {
      activeRun = 'run-2';
      return new Response(JSON.stringify({ id: 'sess_rotated_during_get', status: 'idle', required_actions: [] }), { status: 200 });
    }
    if (url.includes('/turns?')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    throw new Error('stale run must not submit an agent event');
  }, tenant => ({ runId: activeRun, tenant, operationalReady: false }));
  try {
    await assert.rejects(f.route.bootstrap({ runId: 'run-1', tenant: 'northstar-demo' }),
      /VECTOR_AGENTS_CURRENT_RUN_MISMATCH/);
    assert.equal(calls.some(call => call.url.endsWith('/events') && call.method === 'POST'), false);
  } finally { f.close(); }
});

test('server startup uses the same bootstrap without copying internal credentials', async () => {
  let sessionReads = 0;
  const f = fixture(async (url, init={}) => {
    url=String(url);
    if (url.endsWith('/v1/agents/sessions') && init.method === 'POST') {
      return new Response(JSON.stringify({ id:'sess_startup', status:'idle' }), { status:200 });
    }
    if (url.endsWith('/sess_startup') && init.method === 'GET') {
      sessionReads += 1;
      if (sessionReads === 1) return new Response(JSON.stringify({ id:'sess_startup', status:'idle', required_actions:[] }), { status:200 });
      if (sessionReads === 2) return new Response(JSON.stringify({
        id:'sess_startup', status:'requires_action', required_actions:[
          {type:'function_call',turn_id:'turn',call_id:'1',name:'get_vector_binding',arguments:{}},
          {type:'function_call',turn_id:'turn',call_id:'2',name:'get_implementation_status',arguments:{}},
          {type:'function_call',turn_id:'turn',call_id:'3',name:'get_customer_proof_gaps',arguments:{}}
        ]
      }), { status:200 });
      return new Response(JSON.stringify({ id:'sess_startup', status:'idle', required_actions:[] }), { status:200 });
    }
    if (url.endsWith('/sess_startup/events') && init.method === 'POST') return new Response('', { status:202 });
    if (url.endsWith('/items?order=asc&limit=100')) {
      return new Response(JSON.stringify({ data: [{ type:'message', role:'assistant', content:[{type:'output_text',text:'startup report'}] }] }), { status: 200 });
    }
    if (url.includes('/turns?')) return new Response(JSON.stringify({data:[]}), {status:200});
    throw new Error('unexpected '+init.method+' '+url);
  });
  try {
    const result = await f.route.bootstrap({ runId:'run-1', tenant:'northstar-demo' });
    assert.equal(result.agentsApi.sessionId,'sess_startup');
    assert.equal(result.binding.runId,'run-1');
    assert.equal(result.writeEnabled,false);
  } finally { f.close(); }
});

test('bootstrap tool outputs are fresh sanitized read-only state', async () => {
  const { ACTIVE_READONLY_PROFILE } = require('./agents-api-adapter.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-active-route-tools-'));
  const dbPath=path.join(dir,'state.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE implementation_runs(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,contract_ref_hash TEXT NOT NULL,state TEXT NOT NULL,started_at_ms INTEGER NOT NULL,deadline_at_ms INTEGER NOT NULL,target_hours INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);');
  const now=Date.now();
  db.prepare('INSERT INTO implementation_runs VALUES(?,?,?,?,?,?,?,?,?)').run('run-1','northstar-demo','c','BUILDING',now,now+3600000,1,new Date(now).toISOString(),new Date(now).toISOString());
  db.close();
  let stage=0; const outputs=[];
  const route=createAgentsApiBootstrapRoute({
    dbPath,internalToken:'internal',candidateSha:'a'.repeat(40),deploymentId:'dep-1',
    apiKey:'k',model:'gpt-6-sol',pollIntervalMs:0,maxPolls:8,
    statusForTenant:()=>({
      runId:'run-1',tenant:'northstar-demo',state:'BUILDING',operationalReady:false,
      requirements:[
        {key:'tenant-environment',satisfied:false,status:'MISSING',detail:{secret:'must-not-leak'}},
        {key:'time-policies',satisfied:false,status:'MISSING'}
      ],
      workPlan:{runnable:['time-policies'],blocked:[],failedClosed:[],jobs:[
        {requirementKey:'tenant-environment',status:'AWAITING_EVIDENCE',blockedReason:null,attempts:1},
        {requirementKey:'time-policies',status:'PENDING',blockedReason:null,attempts:0}
      ]},
      blockingDecisions:[{key:'time-policy-authority',status:'PENDING',risk:'HIGH'}]
    }),
    fetchImpl:async (url,init={})=>{
      url=String(url);
      if(url.endsWith('/v1/agents/sessions') && init.method==='POST')
        return new Response(JSON.stringify({id:'sess_route_tools',status:'in_progress'}),{status:200});
      if(url.endsWith('/sess_route_tools') && init.method==='GET'){
        stage++;
        if(stage===1) return new Response(JSON.stringify({id:'sess_route_tools',status:'in_progress',required_actions:[
          {type:'function_call',turn_id:'t',call_id:'1',name:'get_vector_binding',arguments:{}},
          {type:'function_call',turn_id:'t',call_id:'2',name:'get_implementation_status',arguments:{}},
          {type:'function_call',turn_id:'t',call_id:'3',name:'get_customer_proof_gaps',arguments:{}}
        ]}),{status:200});
        return new Response(JSON.stringify({id:'sess_route_tools',status:'idle',required_actions:[]}),{status:200});
      }
      if(url.endsWith('/sess_route_tools/events') && init.method==='POST'){
        const body=JSON.parse(init.body);
        outputs.push(...body.events
          .filter(x=>x.type==='agent.session.input.tool_result')
          .map(x=>JSON.parse(x.output)));
        return new Response('',{status:202});
      }
      if(url.includes('/sess_route_tools/items?'))
        return new Response(JSON.stringify({data:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Active controller report'}]}]}),{status:200});
      if (url.includes('/turns?')) return new Response(JSON.stringify({data:[]}), {status:200});
    throw new Error('unexpected '+init.method+' '+url);
    }
  });
  try {
    const result=await route.bootstrap({runId:'run-1',tenant:'northstar-demo'});
    assert.equal(result.writeEnabled,false);
    assert.equal(result.profile,ACTIVE_READONLY_PROFILE);
    assert.equal(result.analysis.status,'PASS');
    const binding=outputs.find(x=>x.profile);
    assert.equal(binding.writeEnabled,false);
    assert.equal(binding.candidateSha,'a'.repeat(40));
    const status=outputs.find(x=>x.state==='BUILDING');
    assert.equal(JSON.stringify(status).includes('must-not-leak'),false);
    assert.equal(status.requirements.some(x=>Object.prototype.hasOwnProperty.call(x,'detail')),false);
    const gaps=outputs.find(x=>Array.isArray(x.unsatisfiedRequirements));
    assert.deepEqual(gaps.runnable,['time-policies']);
    assert.deepEqual(gaps.pendingDecisions,[{key:'time-policy-authority',risk:'HIGH'}]);
  } finally { route.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
