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
    return new Response(JSON.stringify({ id: 'sess_route', status: 'idle' }), { status: 200 });
  });
  try {
    const res = response();
    await f.route.handleRequest(request('POST','/api/implementation/autonomous/agents/bootstrap',{runId:'run-1',tenant:'northstar-demo'},'internal-token'),res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.agentsApi.sessionId, 'sess_route');
    assert.equal(body.binding.candidateSha, 'a'.repeat(40));
    assert.equal(body.binding.deploymentId, 'deployment-1');
    assert.match(JSON.parse(calls[0].init.body).input, /time-policies/);
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
  const f = fixture(async () => new Response(JSON.stringify({ id:'sess_startup', status:'idle' }), { status:200 }));
  try {
    const result = await f.route.bootstrap({ runId:'run-1', tenant:'northstar-demo' });
    assert.equal(result.agentsApi.sessionId,'sess_startup');
    assert.equal(result.binding.runId,'run-1');
  } finally { f.close(); }
});
