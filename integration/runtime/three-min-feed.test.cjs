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

test('rejected deliveries and valid source IDs cannot collide in either arrival order',async t=>{
 for(const rejectionFirst of [true,false]){
  const f=await fixture(t),id=randomUUID();
  const reject=()=>f.send(null,{recordId:id,raw:'{bad'});
  const accept=()=>f.send(payload({eventId:'rejected.'+id}));
  const [first,second]=rejectionFirst?[await reject(),await accept()]:[await accept(),await reject()];
  assert.equal(first.status,202);assert.equal(second.status,202);
  assert.notEqual(first.body.receiptId,second.body.receiptId);
  const rows=f.db.prepare('SELECT event_id,status FROM integration_feed_inbox ORDER BY status').all();
  assert.deepEqual(rows.map(r=>[r.event_id,r.status]),[['rejected.'+id,'RECEIVED_UNVALIDATED'],['!rejected:'+id,'REJECTED_VALIDATION']]);
  f.reopen();assert.equal((await reject()).status,200);assert.equal((await accept()).status,200);
  assert.equal(f.db.prepare('SELECT count(*) n FROM integration_feed_inbox').get().n,2);
 }
});

test('legacy rejection migration preserves receipt aliases, payload custody and original audit across reopen',async t=>{
 const f=await fixture(t),id=randomUUID();
 const rejected=await f.send(null,{recordId:id,raw:'{bad'});
 f.db.prepare('UPDATE integration_feed_inbox SET event_id=? WHERE id=?').run('rejected.'+id,rejected.body.receiptId);
 const valid=await f.send(payload({eventId:'rejected.'+randomUUID()}));
 const before=f.db.prepare('SELECT * FROM integration_feed_inbox WHERE id=?').get(rejected.body.receiptId);
 const validBefore=f.db.prepare('SELECT * FROM integration_feed_inbox WHERE id=?').get(valid.body.receiptId);
 const deliveries=f.db.prepare('SELECT * FROM integration_feed_deliveries ORDER BY record_id').all();
 const originalAudit=f.db.prepare('SELECT * FROM integration_events').all();
 f.reopen();
 assert.deepEqual({...f.db.prepare('SELECT * FROM integration_feed_inbox WHERE id=?').get(rejected.body.receiptId)},{...before,event_id:'!rejected:'+id});
 assert.deepEqual(f.db.prepare('SELECT * FROM integration_feed_inbox WHERE id=?').get(valid.body.receiptId),validBefore);
 assert.deepEqual(f.db.prepare('SELECT * FROM integration_feed_deliveries ORDER BY record_id').all(),deliveries);
 const audit=f.db.prepare('SELECT * FROM integration_events ORDER BY rowid').all();
 assert.deepEqual(audit.slice(0,originalAudit.length),originalAudit);
 const migrated=JSON.parse(audit.at(-1).detail_json);
 assert.equal(audit.at(-1).event,'three-min-feed-rejection-identity-migrated');
 assert.equal(migrated.receiptId,rejected.body.receiptId);assert.equal(migrated.previousEventId,'rejected.'+id);assert.equal(migrated.eventId,'!rejected:'+id);
 f.reopen();assert.equal(f.db.prepare("SELECT count(*) n FROM integration_events WHERE event='three-min-feed-rejection-identity-migrated'").get().n,1);
 const replay=await f.send(null,{recordId:id,raw:'{bad'});assert.equal(replay.status,200);assert.equal(replay.body.receiptId,rejected.body.receiptId);
 assert.equal((await f.send(payload({eventId:'rejected.'+id}))).status,202);
});

test('migration audit failure atomically rolls back legacy IDs and allows a later retry',async t=>{
 const {createThreeMinFeed}=require('./three-min-feed.cjs');
 const f=await fixture(t);const id=randomUUID();const r=await f.send(null,{recordId:id,raw:'{bad'});
 f.db.prepare('UPDATE integration_feed_inbox SET event_id=? WHERE id=?').run('rejected.'+id,r.body.receiptId);
 const before=f.db.prepare('SELECT * FROM integration_feed_inbox').all();
 f.db.exec("CREATE TRIGGER reject_namespace_audit BEFORE INSERT ON integration_events WHEN NEW.event='three-min-feed-rejection-identity-migrated' BEGIN SELECT RAISE(ABORT,'synthetic-migration-audit-failure'); END;");
 assert.throws(()=>createThreeMinFeed({db:f.db,env:f.env}),/synthetic-migration-audit-failure/);
 assert.deepEqual(f.db.prepare('SELECT * FROM integration_feed_inbox').all(),before);
 assert.equal(f.db.prepare("SELECT count(*) n FROM integration_events WHERE event='three-min-feed-rejection-identity-migrated'").get().n,0);
 f.db.exec('DROP TRIGGER reject_namespace_audit');createThreeMinFeed({db:f.db,env:f.env});
 assert.equal(f.db.prepare('SELECT event_id FROM integration_feed_inbox').get().event_id,'!rejected:'+id);
});

test('migration update failure rolls back every prior row and its migration audit',async t=>{
 const {createThreeMinFeed}=require('./three-min-feed.cjs');const f=await fixture(t);
 for(let n=0;n<2;n++){const id=randomUUID();const r=await f.send(null,{recordId:id,raw:'{bad'});f.db.prepare('UPDATE integration_feed_inbox SET event_id=? WHERE id=?').run('rejected.'+id,r.body.receiptId);}
 const before=f.db.prepare('SELECT * FROM integration_feed_inbox ORDER BY rowid').all();
 f.db.exec("CREATE TRIGGER reject_second_namespace_update BEFORE UPDATE OF event_id ON integration_feed_inbox WHEN (SELECT count(*) FROM integration_feed_inbox WHERE event_id LIKE '!rejected:%')>0 BEGIN SELECT RAISE(ABORT,'synthetic-migration-update-failure'); END;");
 assert.throws(()=>createThreeMinFeed({db:f.db,env:f.env}),/synthetic-migration-update-failure/);
 assert.deepEqual(f.db.prepare('SELECT * FROM integration_feed_inbox ORDER BY rowid').all(),before);
 assert.equal(f.db.prepare("SELECT count(*) n FROM integration_events WHERE event='three-min-feed-rejection-identity-migrated'").get().n,0);
});

test('reserved rejection namespace is never accepted as a public source event',async t=>{
 const f=await fixture(t);const r=await f.send(payload({eventId:'!rejected:'+randomUUID()}));
 assert.equal(r.status,202);assert.equal(r.body.status,'REJECTED_VALIDATION');
 assert.equal(f.db.prepare("SELECT count(*) n FROM integration_feed_inbox WHERE status='RECEIVED_UNVALIDATED'").get().n,0);
});

// Offline historical compatibility fixture, never selected by application code.
// Commit bf7dc01b57d152b8950514f63f042ff26bb1eb85, exact pre-namespace feed
// blob 4299c8f31796220151f8cf06c062d8727f085f25. Decoded bytes are verified
// before compiling only in a newly spawned disposable child process.
const PRE_NAMESPACE_FEED_GZIP_BASE64 = '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';
const PRE_NAMESPACE_FEED_BLOB = '4299c8f31796220151f8cf06c062d8727f085f25';
const PRE_NAMESPACE_FEED_SHA256 = 'd25210d288282bf5abe1a988a52fdc41b252287890863f7834c10678aafc2ee6';

function recoveryDb(dbPath,operation) {
 const db=new DatabaseSync(dbPath);
 try{db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=1500;');return operation(db);}
 finally{db.close();}
}
function recoverySeed(dbPath) {
 recoveryDb(dbPath,db=>{
  // Deliberately exercise committed WAL recovery rather than just copying the
  // main database file. This changes only a disposable synthetic fixture.
  db.exec('PRAGMA journal_mode=WAL;CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
  for(const [token,tenant,role] of [['alpha-session','alpha','manager'],['bravo-session','bravo','manager'],['employee-session','alpha','employee']]){
   db.prepare('INSERT INTO users VALUES(?,?,?)').run(token,tenant,role);
   db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),token,Date.now()+3600000);
  }
 });
}
function recoveryRows(dbPath) {
 return recoveryDb(dbPath,db=>({
  inbox:db.prepare('SELECT * FROM integration_feed_inbox ORDER BY rowid').all().map(row=>({...row})),
  deliveries:db.prepare('SELECT * FROM integration_feed_deliveries ORDER BY binding_id,record_id').all().map(row=>({...row})),
  audit:db.prepare('SELECT * FROM integration_events ORDER BY rowid').all().map(row=>({...row})),
  canonicalPeople:db.prepare('SELECT count(*) n FROM integration_canonical_people').get().n,
  connections:db.prepare('SELECT count(*) n FROM integration_connections').get().n,
  integrity:db.prepare('PRAGMA integrity_check').get().integrity_check
 }));
}
const recoveryChildCode=String.raw`
 'use strict';
 const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{createHash}=require('node:crypto');
 const config=JSON.parse(process.argv[1]);
 if(config.legacy){
  const source=require('node:zlib').gunzipSync(Buffer.from(config.legacy,'base64'));
  const blob=createHash('sha1').update(Buffer.from('blob '+source.length+'\0')).update(source).digest('hex');
  if(blob!==config.legacyBlob||createHash('sha256').update(source).digest('hex')!==config.legacySha256)throw Error('Historical compatibility fixture custody mismatch');
  const Module=require('node:module'),filename=path.join(path.dirname(config.hub),'three-min-feed.cjs'),old=new Module(filename,module);
  old.filename=filename;old.paths=Module._nodeModulePaths(path.dirname(filename));old._compile(source.toString('utf8'),filename);require.cache[filename]=old;
 }
 const {createAutonomousIntegrationHub}=require(config.hub);
 const hub=createAutonomousIntegrationHub({dbPath:config.dbPath,env:{WFM_3MIN_FEEDS_JSON:JSON.stringify(config.disabled?[]:[config.binding]),WFM_3MIN_ALPHA_TOKEN:config.token}});
 const server=http.createServer(async(req,res)=>{if(!await hub.handleRequest(req,res)){res.statusCode=404;res.end();}});
 server.listen(0,'127.0.0.1',()=>process.send({nonce:config.nonce,pid:process.pid,address:server.address()}));
`;
async function recoveryStart(workers,dbPath,options={}) {
 const {spawn}=require('node:child_process');
 let actualPath=dbPath;
 // Test-only negative controls are consumed by this harness, never by a runtime
 // module. They demonstrate that the persisted-readback or compatibility oracle
 // fails if a restart selects an empty database or the wrong historical module.
 if(options.restart&&process.env.V006_RECOVERY_TEST_FAULT==='empty-restart'){
  actualPath=path.join(path.dirname(dbPath),'empty-'+randomUUID()+'.sqlite');recoverySeed(actualPath);
  recoveryDb(actualPath,db=>db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('fresh-alpha-session').digest('hex'),'alpha-session',Date.now()+3600000));
 }
 const legacy=options.legacy&&process.env.V006_RECOVERY_TEST_FAULT!=='masquerade-legacy'?PRE_NAMESPACE_FEED_GZIP_BASE64:null;
 const nonce=randomUUID(),config={dbPath:actualPath,hub:path.join(__dirname,'autonomous-integration-hub.cjs'),binding,token:TOKEN,disabled:options.disabled===true,nonce,legacy,legacyBlob:PRE_NAMESPACE_FEED_BLOB,legacySha256:PRE_NAMESPACE_FEED_SHA256};
 const child=spawn(process.execPath,['-e',recoveryChildCode,JSON.stringify(config)],{
  env:{PATH:process.env.PATH,TZ:'UTC',NODE_ENV:'test',...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})},
  stdio:['ignore','ignore','pipe','ipc']
 });
 const worker={child,dbPath:actualPath,diagnostics:''};workers.push(worker);
 child.stderr.on('data',bytes=>{worker.diagnostics=(worker.diagnostics+bytes).slice(-8000);});
 worker.origin=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(Error('Owned recovery child endpoint unavailable: '+worker.diagnostics)),10000);
  const finish=(error,value)=>{clearTimeout(timer);child.off('message',message);child.off('exit',exited);child.off('error',failed);error?reject(error):resolve(value);};
  const exited=(code,signal)=>finish(Error('Recovery child exited: '+JSON.stringify({code,signal})+' '+worker.diagnostics));
  const failed=error=>finish(error);
  const message=value=>{
   const address=value?.address;
   if(value?.nonce!==nonce||value.pid!==child.pid||address?.address!=='127.0.0.1'||address.family!=='IPv4'||!Number.isInteger(address.port)||address.port<1||address.port>65535)return finish(Error('Unowned recovery child listener'));
   finish(null,'http://127.0.0.1:'+address.port);
  };
  child.on('message',message);child.once('exit',exited);child.once('error',failed);
 });
 return worker;
}
async function recoveryKill(worker) {
 if(worker.child.exitCode!==null||worker.child.signalCode!==null)return;
 const exited=new Promise(resolve=>worker.child.once('exit',(code,signal)=>resolve({code,signal})));
 assert.equal(worker.child.kill('SIGKILL'),true);const result=await exited;assert.equal(result.signal,'SIGKILL');
}
async function recoveryRequest(worker,suffix,{token,recordId,body,raw}={}) {
 const sending=recordId!==undefined;
 const response=await fetch(worker.origin+PREFIX+suffix,{
  method:sending?'POST':'GET',signal:AbortSignal.timeout(10000),
  headers:sending?{'content-type':'application/json','x-vector-feed-token':TOKEN,'x-3minapi-record-id':recordId}:token?{cookie:'wfm_session='+token}:{},
  ...(sending?{body:raw===undefined?JSON.stringify(webhook(body||payload(),recordId)):raw}:{})
 });
 return {status:response.status,body:await response.json()};
}
function recoverySend(worker,body,recordId,raw) {return recoveryRequest(worker,'/feeds/3min/'+binding.id,{body,recordId,raw});}
function recoveryStatus(worker,token='alpha-session') {return recoveryRequest(worker,'/feeds/3min',{token});}
function recoveryFixture(t) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vector-feed-process-recovery-')),dbPath=path.join(directory,'state.sqlite'),workers=[];
 recoverySeed(dbPath);
 t.after(async()=>{for(const worker of workers)await recoveryKill(worker);fs.rmSync(directory,{recursive:true,force:true});});
 return {directory,dbPath,workers};
}

test('feed acknowledgement, aliases and audit survive SIGKILL and a fresh process/session with no partial failed write',async t=>{
 const f=recoveryFixture(t),firstId=randomUUID(),aliasId=randomUUID(),failedId=randomUUID();
 let worker=await recoveryStart(f.workers,f.dbPath);
 const accepted=await recoverySend(worker,payload(),firstId);assert.equal(accepted.status,202);
 assert.equal(accepted.body.status,'RECEIVED_UNVALIDATED');assert.equal(accepted.body.sourceAuthenticated,false);assert.equal(accepted.body.executionAuthority,false);
 assert.equal((await recoverySend(worker,payload(),aliasId)).body.receiptId,accepted.body.receiptId);
 recoveryDb(f.dbPath,db=>db.exec("CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON integration_events WHEN NEW.event='three-min-feed-received' BEGIN SELECT RAISE(ABORT,'synthetic-recovery-audit-failure');END;"));
 const failed=await recoverySend(worker,payload({eventId:'failed-before-crash'}),failedId);assert.equal(failed.status,503);
 recoveryDb(f.dbPath,db=>{
  db.exec('DROP TRIGGER fail_recovery_audit');db.prepare('UPDATE sessions SET expires=0 WHERE email=?').run('alpha-session');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('fresh-alpha-session').digest('hex'),'alpha-session',Date.now()+3600000);
 });
 const originalPid=worker.child.pid;await recoveryKill(worker);
 assert.ok(fs.statSync(f.dbPath+'-wal').size>0,'acknowledged records must be recovered from the deliberately uncheckpointed WAL');
 worker=await recoveryStart(f.workers,f.dbPath,{restart:true});assert.notEqual(worker.child.pid,originalPid);
 const read=await recoveryStatus(worker,'fresh-alpha-session');assert.equal(read.status,200);assert.equal(read.body.receipts.length,1);assert.equal(read.body.receipts[0].receiptId,accepted.body.receiptId);
 assert.equal(read.body.sourceAuthenticated,false);assert.equal(read.body.executionAuthority,false);
 assert.doesNotMatch(JSON.stringify(read.body),new RegExp(TOKEN+'|synthetic-1'));
 assert.deepEqual((await recoveryStatus(worker,'bravo-session')).body.receipts,[]);
 assert.equal((await recoveryStatus(worker,'employee-session')).status,403);assert.equal((await recoveryStatus(worker,'alpha-session')).status,401);assert.equal((await recoveryStatus(worker,'missing-session')).status,401);
 const replay=await recoverySend(worker,payload(),aliasId);assert.equal(replay.status,200);assert.equal(replay.body.receiptId,accepted.body.receiptId);assert.equal(replay.body.replayed,true);
 assert.equal((await recoverySend(worker,payload({eventId:'changed-alias'}),aliasId)).status,409);
 const recovered=await recoverySend(worker,payload({eventId:'failed-before-crash'}),failedId);assert.equal(recovered.status,202);
 await recoveryKill(worker);
 const state=recoveryRows(f.dbPath);assert.equal(state.inbox.length,2);assert.equal(state.deliveries.length,3);assert.equal(state.audit.filter(row=>row.event==='three-min-feed-received').length,2);
 assert.equal(state.canonicalPeople,0);assert.equal(state.connections,0);assert.equal(state.integrity,'ok');
});

test('consistent snapshot restore replays migration once while exact pre-fix code refuses migrated rejection replay',async t=>{
 const decoded=require('node:zlib').gunzipSync(Buffer.from(PRE_NAMESPACE_FEED_GZIP_BASE64,'base64'));
 assert.equal(createHash('sha1').update(Buffer.from('blob '+decoded.length+'\0')).update(decoded).digest('hex'),PRE_NAMESPACE_FEED_BLOB);
 assert.equal(createHash('sha256').update(decoded).digest('hex'),PRE_NAMESPACE_FEED_SHA256);
 const f=recoveryFixture(t),rejectedId=randomUUID(),validId=randomUUID(),aliasId=randomUUID();
 let worker=await recoveryStart(f.workers,f.dbPath);
 const rejected=await recoverySend(worker,null,rejectedId,'{bad');assert.equal(rejected.status,202);assert.equal(rejected.body.status,'REJECTED_VALIDATION');
 const accepted=await recoverySend(worker,payload(),validId);assert.equal(accepted.status,202);assert.equal((await recoverySend(worker,payload(),aliasId)).body.receiptId,accepted.body.receiptId);
 await recoveryKill(worker);
 recoveryDb(f.dbPath,db=>db.prepare('UPDATE integration_feed_inbox SET event_id=? WHERE id=?').run('rejected.'+rejectedId,rejected.body.receiptId));
 const before=recoveryRows(f.dbPath),snapshot=path.join(f.directory,'pre-migration-snapshot.sqlite');
 // VACUUM INTO captures the complete committed SQLite state. Only closed,
 // consistent snapshots are copied, always into NEW disposable destinations.
 recoveryDb(f.dbPath,db=>db.prepare('VACUUM INTO ?').run(snapshot));
 assert.deepEqual(recoveryRows(snapshot),before);
 const migratedPath=path.join(f.directory,'migrated-copy.sqlite');fs.copyFileSync(snapshot,migratedPath);
 worker=await recoveryStart(f.workers,migratedPath);
 let replay=await recoverySend(worker,null,rejectedId,'{bad');assert.equal(replay.status,200);assert.equal(replay.body.receiptId,rejected.body.receiptId);
 assert.equal((await recoverySend(worker,payload(),aliasId)).body.receiptId,accepted.body.receiptId);await recoveryKill(worker);
 const migrated=recoveryRows(migratedPath);
 assert.deepEqual(migrated.inbox,before.inbox.map(row=>row.id===rejected.body.receiptId?{...row,event_id:'!rejected:'+rejectedId}:row));
 assert.deepEqual(migrated.deliveries,before.deliveries);assert.deepEqual(migrated.audit.slice(0,before.audit.length),before.audit);
 const expectedMigration={receiptId:rejected.body.receiptId,bindingId:binding.id,previousEventId:'rejected.'+rejectedId,eventId:'!rejected:'+rejectedId};
 const migrationAudit=migrated.audit.filter(row=>row.event==='three-min-feed-rejection-identity-migrated');
 assert.equal(migrationAudit.length,1);assert.equal(migrationAudit[0].tenant,'alpha');assert.deepEqual(JSON.parse(migrationAudit[0].detail_json),expectedMigration);assert.equal(migrated.integrity,'ok');
 worker=await recoveryStart(f.workers,migratedPath,{restart:true});assert.equal((await recoveryStatus(worker)).body.receipts.length,2);await recoveryKill(worker);
 assert.equal(recoveryRows(migratedPath).audit.filter(row=>row.event==='three-min-feed-rejection-identity-migrated').length,1);
 const oldCopy=path.join(f.directory,'pre-fix-on-migrated-copy.sqlite');fs.copyFileSync(migratedPath,oldCopy);const oldBefore=recoveryRows(oldCopy);
 worker=await recoveryStart(f.workers,oldCopy,{legacy:true});
 const incompatible=await recoverySend(worker,null,rejectedId,'{bad');assert.equal(incompatible.status,409);assert.equal(incompatible.body.code,'FEED_REPLAY_CONFLICT');
 await recoveryKill(worker);assert.deepEqual(recoveryRows(oldCopy),oldBefore);
 worker=await recoveryStart(f.workers,oldCopy,{legacy:true,disabled:true});assert.equal((await recoverySend(worker,null,rejectedId,'{bad')).status,503);await recoveryKill(worker);assert.deepEqual(recoveryRows(oldCopy),oldBefore);
 const restoredPath=path.join(f.directory,'restored-from-reviewed-snapshot.sqlite');fs.copyFileSync(snapshot,restoredPath);
 worker=await recoveryStart(f.workers,restoredPath);
 replay=await recoverySend(worker,null,rejectedId,'{bad');assert.equal(replay.status,200);assert.equal(replay.body.receiptId,rejected.body.receiptId);
 assert.equal((await recoverySend(worker,payload(),aliasId)).body.receiptId,accepted.body.receiptId);
 const restoredRead=await recoveryStatus(worker);assert.equal(restoredRead.body.sourceAuthenticated,false);assert.equal(restoredRead.body.executionAuthority,false);assert.equal(restoredRead.body.receipts.length,2);
 await recoveryKill(worker);const restored=recoveryRows(restoredPath);assert.deepEqual(restored.inbox,migrated.inbox);assert.deepEqual(restored.deliveries,before.deliveries);assert.deepEqual(restored.audit.slice(0,before.audit.length),before.audit);
 const restoredMigration=restored.audit.filter(row=>row.event==='three-min-feed-rejection-identity-migrated');assert.equal(restoredMigration.length,1);assert.equal(restoredMigration[0].tenant,'alpha');assert.deepEqual(JSON.parse(restoredMigration[0].detail_json),expectedMigration);assert.equal(restored.canonicalPeople,0);assert.equal(restored.connections,0);assert.equal(restored.integrity,'ok');
});
