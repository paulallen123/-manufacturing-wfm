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
function fixture(fetchImpl) {
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
    pollIntervalMs: 0, maxPolls: 2,
    statusForTenant: tenant => tenant === 'northstar-demo'
      ? { state: 'BUILDING', operationalReady: false, requirements: [{ key: 'time-policies', satisfied: false }] }
      : null
  });
  return { dir, route, close() { route.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('trusted HTTP bootstrap creates the read-only session and returns exact binding', async () => {
  const calls = [];
  const f = fixture(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/items?order=asc&limit=100')) {
      return new Response(JSON.stringify({ data: [{ type:'message', role:'assistant', content:[{type:'output_text',text:'read-only report'}] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'sess_route', status: 'idle', required_actions: [] }), { status: 200 });
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

test('server startup uses the same bootstrap without copying internal credentials', async () => {
  const f = fixture(async (url, init={}) => {
    if (String(url).endsWith('/items?order=asc&limit=100')) {
      return new Response(JSON.stringify({ data: [{ type:'message', role:'assistant', content:[{type:'output_text',text:'startup report'}] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id:'sess_startup', status:'idle', required_actions:[] }), { status:200 });
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
      state:'BUILDING',operationalReady:false,
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
        const body=JSON.parse(init.body); outputs.push(...body.events.map(x=>JSON.parse(x.output)));
        return new Response('',{status:202});
      }
      if(url.includes('/sess_route_tools/items?'))
        return new Response(JSON.stringify({data:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Active controller report'}]}]}),{status:200});
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
