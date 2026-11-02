'use strict';
// Ordinary fictional, local SQLite consumer controls. No provider or HTTP listener.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const source = process.env.V089_SOURCE_ROOT || path.resolve(__dirname, '../..');
const { createAutonomousIntegrationHub } = require(path.join(source, 'integration/runtime/autonomous-integration-hub.cjs'));
const TOKEN = 'fictional-v089-worker-only';
const stamp = '2026-11-01T00:00:00.000Z';
const sha = value => createHash('sha256').update(String(value)).digest('hex');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-v089-ordinary-'));
  const dbPath = path.join(dir, 'fictional.sqlite');
  const seed = new DatabaseSync(dbPath);
  seed.exec('CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER,state TEXT);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
  seed.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha', 1, '{}');
  seed.prepare('INSERT INTO tenants VALUES(?,?,?)').run('bravo', 1, '{}');
  seed.close();
  let fetchAttempts = 0;
  const hub = createAutonomousIntegrationHub({ dbPath, internalToken: TOKEN, env: {},
    fetchImpl: async () => { fetchAttempts++; throw Error('No provider call is permitted by this fixture.'); } });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout=5000;');
  t.after(() => { assert.equal(fetchAttempts, 0); db.close(); hub.close(); fs.rmSync(dir, {recursive:true}); });
  function connection(id = 'conn-alpha', tenant = 'alpha', provider = 'workday', options = {}) {
    db.prepare('INSERT INTO integration_connections(id,tenant,candidate_id,product_key,category,state,auth_method,semantic_scopes_json,granted_scopes_json,credential_ref,source_instance_id,mapping_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, tenant, 'candidate-' + id, provider, 'hcm', options.state || 'VALIDATING', 'oauth2', '["people.read"]',
        options.grants === false ? '[]' : '["people.read"]', 'vault://fictional/' + id, 'instance-' + id, 1, stamp, stamp);
    if (options.mapping !== false) for (const [from,to] of [['employee_id','employeeId'],['first_name','firstName'],['location','location']]) {
      db.prepare('INSERT INTO integration_mappings VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id + '-' + to, tenant, id, 'Person', from, to, 1, 'ACTIVE', 1, stamp);
    }
  }
  connection();
  db.prepare('INSERT INTO integration_events(tenant,connection_id,event,detail_json,created_at) VALUES(?,?,?,?,?)')
    .run('alpha', 'conn-alpha', 'fixture-sentinel', '{}', stamp);
  const sentinel = JSON.stringify(db.prepare("SELECT * FROM integration_events WHERE event='fixture-sentinel'").get());
  const authority = id => {
    const row = db.prepare('SELECT tenant,product_key,credential_ref,granted_scopes_json,source_instance_id,mapping_version FROM integration_connections WHERE id=?').get(id);
    return JSON.stringify(row);
  };
  async function send(body, token = TOKEN) {
    const req = Readable.from([JSON.stringify(body)]);
    req.method = 'POST'; req.url = '/api/integrations/autonomous/sync-validate';
    req.headers = {'content-type':'application/json', ...(token ? {'x-wfm-integration-internal':token} : {})};
    const res = {statusCode:200,setHeader(){},end(value){this.value=String(value);this.headersSent=true;this.writableEnded=true;}};
    assert.equal(await hub.handleRequest(req,res),true);
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM integration_events WHERE event='fixture-sentinel'").get()),sentinel);
    assert.equal(db.prepare('SELECT count(*) AS n FROM gusto_company_credentials').get().n,0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM gusto_oauth_states').get().n,0);
    return {status:res.statusCode,body:JSON.parse(res.value)};
  }
  return {db,send,connection,authority};
}

const body = records => ({tenant:'alpha',connectionId:'conn-alpha',records});
const row = employee_id => ({employee_id,first_name:'A',location:'Plant 1'});
const malformed = [['true',true],['false',false],['object',{}],['identity-shaped object',{id:'E-1'}],
  ['string array',['E-1']],['number array',[1]],['boolean array',[true]]];
for (const [label,value] of malformed) test('consumer refuses declared nonprimitive employee ID: ' + label, async t => {
  const f=fixture(t),before=f.authority('conn-alpha');
  const r=await f.send(body([row(value)]));
  assert.equal(r.status,200); assert.equal(r.body.reconciliation.status,'NEEDS_REVIEW');
  assert.equal(r.body.reconciliation.invalidCount,1); assert.equal(r.body.canonicalImport,null);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM integration_canonical_batches').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM integration_canonical_people').get().n,0);
  assert.equal(f.authority('conn-alpha'),before);
});

const missing = [['omitted',undefined],['null',null],['empty',''],['spaces','  '],['tab','\t'],['empty array',[]]];
for (const [label,value] of missing) test('existing missing-ID refusal remains: ' + label, async t => {
  const f=fixture(t),r=await f.send(body([row(value)]));
  assert.equal(r.status,200); assert.equal(r.body.reconciliation.status,'NEEDS_REVIEW');
  assert.equal(r.body.reconciliation.invalidCount,1); assert.equal(r.body.canonicalImport,null);
});

const valid = [['string','E-1'],['trimmed string','  E-1  '],['literal null','null'],['literal undefined','undefined'],
  ['literal true','true'],['literal object string','[object Object]'],['zero',0],['positive integer',1],
  ['negative finite number',-1],['finite fraction',12.5],['decomposed Unicode','e\u0301']];
for (const [label,value] of valid) test('legacy scalar ID and persisted key remain: ' + label, async t => {
  const f=fixture(t),r=await f.send(body([row(value)]));
  assert.equal(r.status,200); assert.equal(r.body.reconciliation.status,'PASS');
  const saved=f.db.prepare('SELECT employee_key,canonical_json FROM integration_canonical_people').get();
  assert.equal(saved.employee_key,sha(String(value).trim()));
  assert.equal(JSON.parse(saved.canonical_json).employeeId,typeof value==='string'?value.trim():value);
});

for (const [label,ids] of [['strings',['E-1','E-1']],['number/string',[1,'1']],['trimmed',[' E-1 ','E-1']]]) {
  test('existing duplicate-ID refusal remains: ' + label, async t => {
    const f=fixture(t),r=await f.send(body(ids.map(row)));
    assert.equal(r.status,200); assert.equal(r.body.reconciliation.status,'NEEDS_REVIEW');
    assert.equal(r.body.reconciliation.duplicateCount,1); assert.equal(r.body.canonicalImport,null);
  });
}

test('distinct legacy Unicode IDs do not silently acquire a new normalization',async t=>{
  const f=fixture(t),r=await f.send(body([row('\u00e9'),row('e\u0301')]));
  assert.equal(r.body.reconciliation.status,'PASS');
  const keys=f.db.prepare('SELECT employee_key FROM integration_canonical_people ORDER BY employee_key').all().map(x=>x.employee_key);
  assert.deepEqual(keys,[sha('\u00e9'),sha('e\u0301')].sort());
});

const golden = {checksum:'3a3dc5a8d7fff67e1a51904ac4020b6fbf1931211098fd9a992a91964c52838f',
  idDigest:'fb51222685b8eee535492703438f5e6873242d66327630f02f9fe6591fc82dc2',
  keys:['fb28c424c1913c509b66de3cf69f7d32126c1b4a6ad9a8a821deccab57f94412','c1768afa867eda9271af43a6490bdced087f09ecd189d59b0d83d43f268dcb53'],
  records:['bec02fda0565acef0fddd8ed8e812671ea0701975addb3f3be61cfd1b6c82d1c','51a1300cfd21772623c5dd793728f30b2c8bbeec664d5cff46b09844a3e4aeee']};
const goldenRows = () => [row('E-1'),{employee_id:'E-2',first_name:'B',location:'Plant 1'}];
test('valid batch retains pre-change canonical checksum, record keys and digest',async t=>{
  const f=fixture(t),before=f.authority('conn-alpha'),r=await f.send(body(goldenRows()));
  assert.equal(r.status,200);assert.equal(r.body.canonicalImport.checksum,golden.checksum);
  const saved=f.db.prepare('SELECT employee_key,record_checksum FROM integration_canonical_people ORDER BY employee_key').all();
  assert.deepEqual(saved.map(x=>x.employee_key),[...golden.keys].sort());
  assert.deepEqual(saved.map(x=>x.record_checksum).sort(),[...golden.records].sort());
  assert.equal(f.db.prepare('SELECT id_digest FROM integration_reconciliation_runs').get().id_digest,golden.idDigest);
  assert.equal(f.authority('conn-alpha'),before);
});

test('pre-existing legacy canonical batch replays without replacing its identities',async t=>{
  const f=fixture(t);
  f.db.prepare('INSERT INTO integration_canonical_batches VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('legacy-batch','alpha','conn-alpha',1,golden.checksum,2,2,1,0,'PASS',stamp);
  for(let i=0;i<2;i++) f.db.prepare('INSERT INTO integration_canonical_people VALUES(?,?,?,?,?,?,?)')
    .run('legacy-batch','alpha','conn-alpha',golden.keys[i],golden.records[i],JSON.stringify({employeeId:'E-'+(i+1),firstName:i?'B':'A',location:'Plant 1'}),stamp);
  const before=JSON.stringify(f.db.prepare('SELECT * FROM integration_canonical_people ORDER BY employee_key').all());
  const r=await f.send(body(goldenRows()));
  assert.equal(r.status,200);assert.equal(r.body.canonicalImport.batchId,'legacy-batch');
  assert.equal(r.body.canonicalImport.replayed,true);assert.equal(r.body.canonicalImport.checksum,golden.checksum);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM integration_canonical_batches').get().n,1);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM integration_canonical_people ORDER BY employee_key').all()),before);
});

test('foreign requested tenant cannot use the stored connection scope',async t=>{
  const f=fixture(t),before=f.authority('conn-alpha'),r=await f.send({...body([row('E-1')]),tenant:'bravo'});
  assert.equal(r.status,403);assert.equal(f.authority('conn-alpha'),before);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM integration_canonical_batches').get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM integration_events WHERE event='cross-tenant-sync-rejected'").get().n,1);
});
test('foreign stored connection cannot be relabeled with a requested tenant',async t=>{
  const f=fixture(t);f.connection('conn-bravo','bravo');const before=f.authority('conn-bravo');
  const r=await f.send({...body([row('E-1')]),connectionId:'conn-bravo'});
  assert.equal(r.status,403);assert.equal(f.authority('conn-bravo'),before);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM integration_canonical_people').get().n,0);
});
test('missing requested tenant is still refused before canonical work',async t=>{
  const f=fixture(t),r=await f.send({connectionId:'conn-alpha',records:[row('E-1')]});
  assert.equal(r.status,400);assert.equal(f.db.prepare('SELECT count(*) AS n FROM integration_reconciliation_runs').get().n,0);
});
test('unknown connection remains refused',async t=>{
  const f=fixture(t),r=await f.send({...body([row('E-1')]),connectionId:'missing-connection'});
  assert.equal(r.status,404);
});
test('worker-token admission remains required',async t=>{
  const f=fixture(t),r=await f.send(body([row('E-1')]),null);
  assert.equal(r.status,403);assert.equal(f.db.prepare('SELECT count(*) AS n FROM integration_reconciliation_runs').get().n,0);
});
test('people.read grant remains required',async t=>{
  const f=fixture(t);f.connection('no-grant','alpha','workday',{grants:false});
  const r=await f.send({...body([row('E-1')]),connectionId:'no-grant'});assert.equal(r.status,409);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM integration_canonical_batches').get().n,0);
});
test('active reviewed mapping remains required',async t=>{
  const f=fixture(t);f.connection('no-mapping','alpha','workday',{mapping:false});
  const r=await f.send({...body([row('E-1')]),connectionId:'no-mapping'});assert.equal(r.status,409);
});
test('connection validation state remains required',async t=>{
  const f=fixture(t);f.connection('not-authorized','alpha','workday',{state:'AUTHORIZATION_REQUIRED'});
  const r=await f.send({...body([row('E-1')]),connectionId:'not-authorized'});assert.equal(r.status,409);
});
test('same local ID stays partitioned across stored tenant/provider/connection rows',async t=>{
  const f=fixture(t);f.connection('conn-sage','alpha','sage');f.connection('conn-bravo','bravo','workday');
  for(const [tenant,connectionId] of [['alpha','conn-alpha'],['alpha','conn-sage'],['bravo','conn-bravo']]) {
    const r=await f.send({tenant,connectionId,records:[row('E-1')]});assert.equal(r.body.reconciliation.status,'PASS');
  }
  const saved=f.db.prepare('SELECT tenant,connection_id,employee_key FROM integration_canonical_people ORDER BY connection_id').all();
  assert.equal(saved.length,3);assert.ok(saved.every(x=>x.employee_key===sha('E-1')));
  assert.deepEqual(saved.map(x=>[x.tenant,x.connection_id]),[['alpha','conn-alpha'],['bravo','conn-bravo'],['alpha','conn-sage']]);
});
