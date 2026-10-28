'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createAutonomousIntegrationHub } = require('./autonomous-integration-hub.cjs');
const PREFIX = '/api/integrations/autonomous';
const TOKEN = 'synthetic-feed-secret-'.repeat(3);
const ENDPOINT_SLUG = 'synthetic-workforce-intake';
function webhook(body, recordId, overrides = {}) {
 return {id:recordId,operation:'create',status:'success',endpoint_slug:ENDPOINT_SLUG,payload:body,processed_at:'2026-10-23T12:01:00.000Z',...overrides};
}
const binding = { id: 'alpha-workday-people', tenant: 'alpha', site: 'factory-1', source: 'workday', domain: 'people', environment: 'sandbox', endpointSlug:ENDPOINT_SLUG, secretEnv: 'WFM_3MIN_ALPHA_TOKEN' };
function payload(overrides = {}) {
  return { schemaVersion: 'vector-feed-v1', tenant: 'alpha', site: 'factory-1', source: 'workday', domain: 'people', environment: 'sandbox', eventId: 'source-event-1', occurredAt: '2026-10-23T12:00:00.000Z', records: [{ employeeId: 'synthetic-1', firstName: 'Test' }], ...overrides };
}
async function fixture(t, config = [binding]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-3min-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
  for (const [token, tenant, role] of [['alpha-session','alpha','manager'],['bravo-session','bravo','manager'],['employee-session','alpha','employee']]) {
    db.prepare('INSERT INTO users VALUES(?,?,?)').run(token,tenant,role);
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),token,Date.now()+3600000);
  }
  const env = { WFM_3MIN_FEEDS_JSON: JSON.stringify(config), WFM_3MIN_ALPHA_TOKEN: TOKEN };
  let hub = createAutonomousIntegrationHub({dbPath, env});
  const server = http.createServer(async (req,res) => { if (!await hub.handleRequest(req,res)) { res.statusCode=404; res.end(); } });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));hub.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const origin = 'http://127.0.0.1:'+server.address().port;
  async function send(body=payload(), options={}) {
    const headers = {'content-type':'application/json','x-vector-feed-token':TOKEN,'x-3minapi-record-id':options.recordId||randomUUID(), ...options.headers};
    const res=await fetch(origin+PREFIX+'/feeds/3min/'+(options.bindingId||binding.id),{method:options.method||'POST',headers,body:options.raw===undefined?JSON.stringify(webhook(body,headers['x-3minapi-record-id'],options.webhook)):options.raw});
    return {status:res.status,body:await res.json()};
  }
  async function status(token='alpha-session') { const r=await fetch(origin+PREFIX+'/feeds/3min',{headers:{cookie:'wfm_session='+token}}); return {status:r.status,body:await r.json()}; }
  return {db,env,send,status,reopen(){hub.close();hub=createAutonomousIntegrationHub({dbPath,env});}};
}
test('HTTP delivery persists an unvalidated receipt, tenant readback survives reopen, and no workforce state is manufactured',async t=>{
  const f=await fixture(t); const r=await f.send();
  assert.equal(r.status,202); assert.equal(r.body.status,'RECEIVED_UNVALIDATED'); assert.equal(r.body.sourceAuthenticated,false); assert.equal(r.body.executionAuthority,false);
  f.reopen(); const s=await f.status(); assert.equal(s.status,200); assert.equal(s.body.receipts.length,1); assert.equal(s.body.receipts[0].receiptId,r.body.receiptId);
  assert.equal(JSON.stringify(s.body).includes('synthetic-1'),false); assert.equal(JSON.stringify(s.body).includes(TOKEN),false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM integration_canonical_people').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM integration_connections').get().n,0);
  assert.equal((await f.status('bravo-session')).body.receipts.length,0);
  assert.equal((await f.status('employee-session')).status,403);
  assert.notEqual((await f.status('missing-session')).status,200);
});
test('documented 3Min webhook wrapper yields an intake receipt for its original payload',async t=>{
 const f=await fixture(t);const id=randomUUID();
 const r=await f.send(null,{recordId:id,raw:JSON.stringify(webhook(payload(),id))});
 assert.equal(r.status,202);assert.equal(r.body.status,'RECEIVED_UNVALIDATED');
 assert.deepEqual(JSON.parse(f.db.prepare('SELECT payload_json FROM integration_feed_inbox').get().payload_json),payload());
});
test('webhook record identity and endpoint must match the authenticated binding',async t=>{
 const f=await fixture(t);
 assert.equal((await f.send(payload(),{webhook:{id:randomUUID()}})).body.code,'FEED_DELIVERY_MISMATCH');
 assert.equal((await f.send(payload(),{webhook:{endpoint_slug:'another-endpoint'}})).body.code,'FEED_ENDPOINT_MISMATCH');
 assert.equal(f.db.prepare('SELECT count(*) n FROM integration_feed_inbox').get().n,0);
 const missingSlug={...binding};delete missingSlug.endpointSlug;
 const unconfigured=await fixture(t,[missingSlug]);assert.equal((await unconfigured.send()).status,503);
});
test('failed, update, delete and malformed webhook results are acknowledged but never ingested',async t=>{
 const f=await fixture(t);
 for(const overrides of [{operation:'update',target_record_id:randomUUID()},{operation:'delete',payload:null,target_record_id:randomUUID()},{operation:'read'},{status:'failed'},{target_record_id:randomUUID()},{processed_at:'invalid'},{unexpected:true}]){
  const id=randomUUID();const r=await f.send(payload(),{recordId:id,webhook:overrides});
  assert.equal(r.status,202);assert.equal(r.body.status,'REJECTED_VALIDATION');
  const replay=await f.send(payload(),{recordId:id,webhook:overrides});assert.equal(replay.status,200);assert.equal(replay.body.receiptId,r.body.receiptId);
 }
 const direct=await f.send(null,{raw:JSON.stringify(payload())});assert.equal(direct.body.status,'REJECTED_VALIDATION');
 assert.equal(f.db.prepare("SELECT count(*) n FROM integration_feed_inbox WHERE payload_json != '{}'").get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM integration_canonical_people').get().n,0);
});
test('separate webhook metadata does not duplicate a source event and aliases remain reserved after restart',async t=>{
 const f=await fixture(t);const first=await f.send();const id=randomUUID();
 const alias=await f.send(payload(),{recordId:id,webhook:{processed_at:'2026-10-23T12:02:00Z',target_record_id:null}});
 assert.equal(alias.status,200);assert.equal(alias.body.receiptId,first.body.receiptId);
 f.reopen();assert.equal((await f.send(payload(),{recordId:id})).status,200);
 assert.equal((await f.send(payload({eventId:'different-event'}),{recordId:id})).status,409);
 assert.equal((await f.send(payload({records:[{employeeId:'changed'}]}),{recordId:id})).status,409);
 assert.equal(f.db.prepare('SELECT count(*) n FROM integration_feed_inbox').get().n,1);
});
test('duplicate delivery and same-event retry are idempotent; changed bytes or reused record ids conflict',async t=>{
 const f=await fixture(t);const id=randomUUID();const a=await f.send(payload(),{recordId:id});
 const b=await f.send(payload(),{recordId:id});assert.equal(b.status,200);assert.equal(b.body.receiptId,a.body.receiptId);assert.equal(b.body.replayed,true);
 const secondId=randomUUID(); const c=await f.send(payload(),{recordId:secondId});assert.equal(c.status,200);assert.equal(c.body.receiptId,a.body.receiptId);
 assert.equal((await f.send(payload({eventId:'reused-alias'}),{recordId:secondId})).status,409);
 assert.equal((await f.send(payload({records:[{employeeId:'changed'}]}),{recordId:id})).status,409);
 assert.equal((await f.send(payload({eventId:'different-event'}),{recordId:id})).status,409);
 assert.equal(f.db.prepare('SELECT count(*) n FROM integration_feed_inbox').get().n,1);
});
test('authentication, scope, content and schema failures store nothing',async t=>{
 const f=await fixture(t);
 for(const headers of [{'x-vector-feed-token':''},{'x-vector-feed-token':'wrong'},{'x-3minapi-record-id':'not-a-uuid'},{'content-type':'text/plain'},{'content-encoding':'gzip'}]) assert.ok((await f.send(payload(),{headers})).status>=400);
 for(const overrides of [{tenant:'bravo'},{site:'factory-2'},{source:'gusto'},{domain:'payroll'},{environment:'production'}]) assert.ok((await f.send(payload(overrides))).status>=400,JSON.stringify(overrides).slice(0,100));
 assert.equal((await f.send(payload({records:[{text:'x'.repeat(262145)}]}))).status,413);
 assert.equal(f.db.prepare('SELECT count(*) n FROM integration_feed_inbox').get().n,0);
});
test('unconfigured, duplicate, weak and reserved-secret bindings fail closed',async t=>{
 for(const config of [[],[binding,binding],[{...binding,secretEnv:'WFM_INTEGRATION_INTERNAL_TOKEN'}],[{...binding,domain:'unknown'}]]) {
   const f=await fixture(t,config);assert.equal((await f.send()).status,503);
 }
 const f=await fixture(t);f.env.WFM_3MIN_ALPHA_TOKEN='short';assert.equal((await f.send()).status,503);
});
test('concurrent delivery stores one durable receipt; rotated token rejects its predecessor',async t=>{
 const f=await fixture(t);const id=randomUUID();const rs=await Promise.all(Array.from({length:8},()=>f.send(payload(),{recordId:id})));
 assert.equal(rs.filter(r=>r.status===202).length,1);assert.equal(rs.filter(r=>r.status===200).length,7);
 f.env.WFM_3MIN_ALPHA_TOKEN='rotated-synthetic-secret-'.repeat(3);
 assert.equal((await f.send()).status,401);
 assert.equal((await f.send(payload({eventId:'event-2'}),{headers:{'x-vector-feed-token':f.env.WFM_3MIN_ALPHA_TOKEN}})).status,202);
});
test('receipt, payload and audit insert roll back together on storage failure',async t=>{
 const f=await fixture(t);f.db.exec("CREATE TRIGGER reject_feed_audit BEFORE INSERT ON integration_events WHEN NEW.event='three-min-feed-received' BEGIN SELECT RAISE(ABORT,'test-only-storage-failure'); END;");
 assert.equal((await f.send()).status,503);
 assert.equal(f.db.prepare('SELECT count(*) n FROM integration_feed_inbox').get().n,0);
 f.db.exec('DROP TRIGGER reject_feed_audit');assert.equal((await f.send()).status,202);
});

test('authenticated validation failures are durably acknowledged without retaining bad payloads',async t=>{
 const f=await fixture(t);
 for(const overrides of [{schemaVersion:'v2'},{eventId:''},{occurredAt:'bad'},{occurredAt:'2999-01-01T00:00:00.000Z'},{records:[]},{records:[null]},{records:new Array(501).fill({})},{unexpected:true}]){
  const r=await f.send(payload(overrides));assert.equal(r.status,202);assert.equal(r.body.status,'REJECTED_VALIDATION');
 }
 const id=randomUUID(); const r=await f.send(null,{raw:'{bad',recordId:id});assert.equal(r.status,202);assert.equal(r.body.status,'REJECTED_VALIDATION');
 assert.equal((await f.send(null,{raw:'{bad',recordId:id})).status,200);
 const unsafeId=randomUUID();
 assert.equal((await f.send(null,{recordId:unsafeId,raw:JSON.stringify(webhook(payload(),unsafeId)).replace('"Test"','{"__proto__":{"polluted":true}}')})).body.status,'REJECTED_VALIDATION');
 assert.equal(f.db.prepare("SELECT count(*) n FROM integration_feed_inbox WHERE payload_json != '{}'").get().n,0);
 assert.equal((await f.status()).body.receipts.length,10);
 assert.equal(f.db.prepare('SELECT count(*) n FROM integration_canonical_people').get().n,0);
});

test('credential revocation or rotation while reading a body cannot persist accepted or rejected intake',async t=>{
 const {createThreeMinFeed}=require('./three-min-feed.cjs');
 for(const change of ['revoke','rotate'])for(const malformed of [false,true]){
  const db=new DatabaseSync(':memory:');
  try{
   db.exec('CREATE TABLE integration_events(tenant TEXT,connection_id TEXT,event TEXT,detail_json TEXT,created_at TEXT)');
   const env={WFM_3MIN_FEEDS_JSON:JSON.stringify([binding]),WFM_3MIN_ALPHA_TOKEN:TOKEN};
   const feed=createThreeMinFeed({db,env}),id=randomUUID();
   const raw=malformed?'{bad':JSON.stringify(webhook(payload(),id));
   const req={url:PREFIX+'/feeds/3min/'+binding.id,method:'POST',headers:{'content-type':'application/json','x-vector-feed-token':TOKEN,'x-3minapi-record-id':id},async *[Symbol.asyncIterator](){
    yield raw.slice(0,1);
    if(change==='revoke')delete env.WFM_3MIN_ALPHA_TOKEN;
    else env.WFM_3MIN_ALPHA_TOKEN='replacement-synthetic-secret-'.repeat(3);
    yield raw.slice(1);
   }};
   const res={setHeader(){},end(value){this.body=JSON.parse(value);}};
   await feed.handleRequest(req,res);
   assert.equal(res.statusCode,change==='revoke'?503:401);
   assert.equal(db.prepare('SELECT count(*) n FROM integration_feed_inbox').get().n,0);
   assert.equal(db.prepare('SELECT count(*) n FROM integration_feed_deliveries').get().n,0);
   assert.equal(db.prepare('SELECT count(*) n FROM integration_events').get().n,0);
  }finally{db.close();}
 }
});
