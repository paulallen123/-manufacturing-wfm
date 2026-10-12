'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const requested=process.env.VECTOR_NATIVE_SETUP_RUNTIME_ROOT;
if(requested)assert.equal(path.isAbsolute(requested),true);
const runtime=requested||__dirname;
function moduleFresh(){
  const file=path.join(runtime,'native-setup-containment.cjs');
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),createHash('sha256').update(fs.readFileSync(path.join(__dirname,'native-setup-containment.cjs'))).digest('hex'),'Actual native guard bytes must match test-tree source');
  delete require.cache[require.resolve(file)];return require(file);
}
const unavailable=e=>e.code==='SETUP_MODE_BINDING_UNAVAILABLE'&&e.statusCode===503;
const setupDenied=e=>e.code==='SETUP_ONLY_REQUIRED'&&e.statusCode===403;
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
function foundational(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);
    CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL,issued_at INTEGER,last_seen INTEGER,source_hash TEXT,source_basis TEXT,source_authoritative INTEGER NOT NULL DEFAULT 0,client_hash TEXT);
    CREATE TABLE personnel_links(email TEXT PRIMARY KEY REFERENCES users(email),tenant TEXT NOT NULL REFERENCES tenants(id),staff_id TEXT NOT NULL,status TEXT NOT NULL,linked_by TEXT NOT NULL,linked_at TEXT NOT NULL);
    CREATE TABLE onboarding_invites(id TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),source_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires INTEGER NOT NULL,revoked_at INTEGER,used_at INTEGER,issued_by TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE kiosk_devices(id TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),site TEXT NOT NULL,name TEXT NOT NULL,secret_hash TEXT NOT NULL UNIQUE,status TEXT NOT NULL,last_sequence INTEGER NOT NULL DEFAULT 0,last_seen INTEGER,created_by TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at INTEGER);
    CREATE TABLE kiosk_events(device_id TEXT NOT NULL REFERENCES kiosk_devices(id),event_id TEXT NOT NULL,sequence INTEGER NOT NULL,digest TEXT NOT NULL,employee TEXT NOT NULL,kind TEXT NOT NULL,client_at INTEGER NOT NULL,server_at INTEGER NOT NULL,result TEXT NOT NULL,PRIMARY KEY(device_id,event_id),UNIQUE(device_id,sequence));
    CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX kiosk_events_employee_time ON kiosk_events(employee,client_at);
    CREATE TRIGGER no_audit_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit events are append only.'); END;
    CREATE TRIGGER no_audit_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit events are append only.'); END;`);
  return db;
}
function initialize(db){
  require(path.join(runtime,'implementation-run-schema.cjs')).initializeImplementationRunSchema({db});
  require(path.join(runtime,'customer-workspace.cjs')).initializeCustomerWorkspaceSchema({db});
  require(path.join(runtime,'setup-only-policy.cjs')).initializeSetupOnlySchema({db});
}
function bind(db,{install=true}={}){
  const api=moduleFresh();if(install)api.installNativeSetupFactory({initializeSchema:initialize,createReader:require(path.join(runtime,'setup-only-policy.cjs')).createSetupOnlyReader});
  const guard=api.bindNativeDatabase({db,requestSource:req=>({identity:req.socket.remoteAddress,basis:'direct',containmentEligible:true}),clientFingerprint:req=>hash(String(req.headers['user-agent']||'unknown-client').trim().toLowerCase().slice(0,256)).slice(0,24)});
  return {api,guard};
}
function addTenant(db,id='alpha',state={version:1,org:[{id:'d1',parent:null},{id:'m1',parent:'d1'}],staff:[{id:'e1',manager:'m1',site:'A'}]}){db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(id,state.version,JSON.stringify(state));return state;}

test('native containment trusted factory is installed once and native db is bound once',t=>{
  const db=foundational(t),{api,guard}=bind(db);
  assert.throws(()=>api.installNativeSetupFactory({initializeSchema:initialize,createReader:()=>null}),unavailable);
  assert.throws(()=>api.bindNativeDatabase({db:new DatabaseSync(':memory:')}),unavailable);
  assert.equal(guard.canSeedUnmanagedDemo('northstar-demo'),true);
  assert.equal(guard.canSeedUnmanagedDemo('customer-alpha'),false);
});
test('native containment empty foundational store initializes only schemas and never customer rows',t=>{
  const db=foundational(t),{guard}=bind(db);
  assert.equal(guard.assertOperationalTenant('outside').classification,'UNMANAGED_LEGACY');
  for(const {name}of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())assert.equal(db.prepare('SELECT count(*) AS n FROM '+name).get().n,0,name);
});
test('native containment missing factory holds process without seed or canonical repair',t=>{
  const db=foundational(t),{guard}=bind(db,{install:false});
  assert.equal(guard.canSeedUnmanagedDemo('northstar-demo'),false);
  assert.throws(()=>guard.assertOperationalTenant('outside'),unavailable);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='customer_workspaces'").get().n,0);
});
test('native containment populated pre-register store stays held after opportunistic later DDL',t=>{
  const db=foundational(t);addTenant(db);const {guard}=bind(db);
  assert.throws(()=>guard.assertOperationalTenant('alpha'),unavailable);
  assert.equal(guard.canSeedUnmanagedDemo('northstar-demo'),false);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='customer_workspaces'").get().n,0);
  initialize(db);assert.throws(()=>guard.assertOperationalTenant('alpha'),unavailable,'Process hold cannot be cleared by empty replacement schemas');
});
test('native containment partial canonical schema is held without creating missing relations',t=>{
  const db=foundational(t);db.exec('CREATE TABLE customer_workspaces(workspace_id TEXT)');const {guard}=bind(db);
  assert.throws(()=>guard.assertOperationalTenant('outside'),unavailable);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='customer_workspace_orders'").get().n,0);
});
test('native containment canonical run constraints cannot be erased and relabelled unmanaged',t=>{
  const db=foundational(t);initialize(db);db.exec('DROP TABLE implementation_runs;CREATE TABLE implementation_runs(id TEXT,tenant TEXT,contract_ref_hash TEXT,state TEXT,started_at_ms INTEGER,deadline_at_ms INTEGER,target_hours INTEGER,created_at TEXT,updated_at TEXT)');
  const {guard}=bind(db);assert.throws(()=>guard.assertOperationalTenant('outside'),unavailable);
});
test('native containment intact legacy schema remains usable while missing managed mode is denied',t=>{
  const db=foundational(t);initialize(db);addTenant(db);const {guard}=bind(db);
  assert.equal(guard.assertOperationalTenant('alpha').classification,'UNMANAGED_LEGACY');
  db.exec("INSERT INTO customer_workspaces VALUES('customer','workspace','alpha','run','2026-10-12T00:00:00.000Z')");
  assert.throws(()=>guard.assertOperationalTenant('alpha'),unavailable);
  assert.equal(guard.assertOperationalTenant('outside').classification,'UNMANAGED_LEGACY','Tenant-specific missing mode does not globally latch healthy schemas');
});
test('native containment setup and pending tenants cannot borrow operational or demo purpose',t=>{
  const db=foundational(t);initialize(db);addTenant(db,'northstar-demo');
  const {createCustomerWorkspaceRegistry}=require(path.join(runtime,'customer-workspace.cjs'));
  const registry=createCustomerWorkspaceRegistry({db,createInitialWorkspace:b=>{db.prepare('INSERT INTO implementation_runs VALUES(?,?,?,?,?,?,?,?,?)').run('run',b.tenant,hash(b.contractRef),'OPEN',1,2,8,'now','now');return {initialSetupRunId:'run'};}});
  registry.accept({verified:true,ownerAuthorized:true,customerId:'synthetic-customer',customerAuthorityRef:'synthetic',tenant:'northstar-demo',provider:'verified-provider',eventId:'synthetic-event',contractRef:'synthetic-contract',relationship:'initial',ownerEmail:'synthetic@northstar.test',ownerAuthorityRef:'synthetic'});
  const {guard}=bind(db);assert.throws(()=>guard.assertOperationalTenant('northstar-demo'),setupDenied);assert.equal(guard.canSeedUnmanagedDemo('northstar-demo'),false);
  assert.equal(guard.assertOperationalTenant('outside').classification,'UNMANAGED_LEGACY','Ordinary phase denial is not schema corruption');
  db.prepare('INSERT INTO customer_workspace_orders(order_id,revision,customer_hash,tenant,provider,envelope_id,nomination_revision,nomination_digest,binding_json,binding_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('synthetic-order',1,'pending-customer','isolation-test','docusign','synthetic-envelope',1,'nomination','{}','binding','now');
  assert.throws(()=>guard.assertOperationalTenant('isolation-test'),setupDenied);assert.equal(guard.canSeedUnmanagedDemo('isolation-test'),false);
});

function currentActor(t,{role='manager',personId='d1',link=null}={}){
  const db=foundational(t);initialize(db);const state=addTenant(db);addTenant(db,'beta');
  db.prepare('INSERT INTO users(email,tenant,person_id,role,costs,salt,password_hash,permissions) VALUES(?,?,?,?,?,?,?,?)').run('native@alpha.test','alpha',personId,role,1,'synthetic','synthetic','["company.configure"]');
  if(link)db.prepare('INSERT INTO personnel_links VALUES(?,?,?,?,?,?)').run('native@alpha.test','alpha',link,'active','synthetic','now');
  const req={method:'POST',url:'/api/command',headers:{cookie:'wfm_session=synthetic-original-bearer','user-agent':'native-test'},socket:{remoteAddress:'127.0.0.1'}};
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?)').run(hash('synthetic-original-bearer'),'native@alpha.test',Date.now()+60000,Date.now()-1000,Date.now(),hash('127.0.0.1').slice(0,24),'direct',1,hash('native-test').slice(0,24));
  const {guard}=bind(db),actor={email:'native@alpha.test',tenant:'alpha',personId,personnelId:link,role,costs:true,permissions:['company.configure']};
  guard.captureRequestActor(req,actor);return {db,state,req,actor,guard};
}
test('native containment original captured actor and request are current without identity writes',t=>{
  const f=currentActor(t),before=f.db.prepare('SELECT total_changes() AS n').get().n;
  assert.equal(f.guard.assertActorCurrent(f.actor),f.actor);assert.equal(f.guard.assertRequestCurrent(f.req),f.actor);
  f.guard.assertPrincipalAnchor(f.actor,f.state);
  assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,before);
});
test('native containment strict private binding rejects actor and request copies',t=>{
  const f=currentActor(t);assert.throws(()=>f.guard.assertActorCurrent({...f.actor}),e=>e.status===401);
  assert.throws(()=>f.guard.assertRequestCurrent({...f.req}),e=>e.status===401);
  assert.equal(f.guard.assertCapturedRequestCurrent({...f.req}),undefined,'Uncaptured pre-actor body grants no actor or permission');
});
for(const [name,sql]of [
  ['role',"UPDATE users SET role='employee' WHERE email='native@alpha.test'"],
  ['tenant',"UPDATE users SET tenant='beta' WHERE email='native@alpha.test'"],
  ['person',"UPDATE users SET person_id='m1' WHERE email='native@alpha.test'"],
  ['permissions',"UPDATE users SET permissions='[]' WHERE email='native@alpha.test'"],
  ['costs',"UPDATE users SET costs=0 WHERE email='native@alpha.test'"],
  ['active personnel link',"INSERT INTO personnel_links VALUES('native@alpha.test','alpha','e1','active','synthetic','now')"]
])test('native containment rejects pending original '+name+' authority drift',async t=>{
  const f=currentActor(t);await Promise.resolve();f.db.exec(sql);
  assert.throws(()=>f.guard.assertCapturedRequestCurrent(f.req),e=>e.status===403&&e.statusCode===403&&e.code==='WFM_NATIVE_AUTHORITY_CHANGED');
});
for(const [name,sql]of [
  ['deleted',"DELETE FROM sessions"],['expired',"UPDATE sessions SET expires=0"],
  ['reissued',"UPDATE sessions SET issued_at=issued_at+1"],
  ['source fingerprint',"UPDATE sessions SET source_hash='changed-source'"],
  ['client fingerprint',"UPDATE sessions SET client_hash='changed-client'"]
])test('native containment rejects '+name+' original session after await',async t=>{
  const f=currentActor(t);await Promise.resolve();f.db.exec(sql);
  assert.throws(()=>f.guard.assertActorCurrent(f.actor),e=>e.status===401&&e.statusCode===401);
});
test('native containment cannot replace revoked bearer with another valid session',t=>{
  const f=currentActor(t);f.db.prepare('UPDATE sessions SET token_hash=?').run(hash('valid-replacement-bearer'));f.req.headers.cookie='wfm_session=valid-replacement-bearer';
  assert.throws(()=>f.guard.assertRequestCurrent(f.req),e=>e.status===401);
});
test('native containment changed original actor cannot borrow its private binding',t=>{
  const f=currentActor(t);f.actor.permissions.push('payroll.export');
  assert.throws(()=>f.guard.assertActorCurrent(f.actor),e=>e.status===403&&e.code==='WFM_NATIVE_AUTHORITY_CHANGED');
});
test('native containment reuses native source and client resolvers after capture, never at early bind',t=>{
  const db=foundational(t),api=moduleFresh();let sourceCalls=0,clientCalls=0;
  api.installNativeSetupFactory({initializeSchema:initialize,createReader:require(path.join(runtime,'setup-only-policy.cjs')).createSetupOnlyReader});
  api.bindNativeDatabase({db,requestSource:()=>{sourceCalls++;throw Error('TDZ');},clientFingerprint:()=>{clientCalls++;throw Error('TDZ');}});
  assert.equal(sourceCalls,0);assert.equal(clientCalls,0);
  const f=currentActor(t);f.req.headers['user-agent']='different-client';
  assert.throws(()=>f.guard.assertRequestCurrent(f.req),e=>e.status===401);
});
test('native containment active link revocation and cross-tenant link cannot retain prior actor',t=>{
  const f=currentActor(t,{link:'e1'});f.db.exec("UPDATE personnel_links SET tenant='beta'");
  assert.throws(()=>f.guard.assertActorCurrent(f.actor),e=>e.status===403);
});
test('native containment outer business rollback cannot resurrect revoked original session',t=>{
  const f=currentActor(t);f.db.exec('DELETE FROM sessions');f.db.exec('BEGIN IMMEDIATE');
  assert.throws(()=>f.guard.assertActorCurrent(f.actor),e=>e.status===401);f.db.exec('ROLLBACK');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
});
test('native containment graph check requires current canonical graph and existing managerial root',t=>{
  const f=currentActor(t);f.guard.assertPrincipalAnchor(f.actor,f.state);
  for(const personId of ['',null,'unknown'])assert.throws(()=>f.guard.assertPrincipalAnchor({...f.actor,personId},f.state),e=>e.status===403&&e.code==='WFM_NATIVE_PRINCIPAL_ANCHOR_REQUIRED');
  const foreign=structuredClone(f.state);foreign.org=[{id:'d1',parent:null},{id:'outside',parent:'d1'}];
  assert.throws(()=>f.guard.assertPrincipalAnchor(f.actor,foreign),e=>e.status===403);
});
test('native containment employee traversal requires genuine current staff anchor',t=>{
  const f=currentActor(t,{role:'employee',personId:'e1'});f.guard.assertPrincipalAnchor(f.actor,f.state);
  const absent=structuredClone(f.state);absent.staff=[];assert.throws(()=>f.guard.assertPrincipalAnchor(f.actor,absent),e=>e.status===403);
});
test('native containment payroll and admin non-traversal keep identity but never bypass graph root',t=>{
  for(const role of ['payroll_admin','admin']){
    const f=currentActor(t,{role,personId:'non-traversal-only'});assert.equal(f.guard.assertActorCurrent(f.actor),f.actor);
    assert.equal(f.guard.assertOperationalTenant('alpha').classification,'UNMANAGED_LEGACY');
    assert.throws(()=>f.guard.assertPrincipalAnchor(f.actor,f.state),e=>e.status===403);
  }
});
test('native containment cyclic or missing-parent current graph fails closed without root repair',t=>{
  const f=currentActor(t);for(const parent of ['m1','unknown']){
    const state=structuredClone(f.state);state.org[0].parent=parent;
    f.db.prepare('UPDATE tenants SET state=? WHERE id=?').run(JSON.stringify(state),'alpha');
    assert.throws(()=>f.guard.assertPrincipalAnchor(f.actor,state),e=>e.status===403);
  }
});
for(const [name,sql]of [
  ['populated unreserved sqliteX table','CREATE TABLE sqliteXfacts(value TEXT);INSERT INTO sqliteXfacts VALUES(\'existing customer fact\')'],
  ['unreserved sqliteX view','CREATE VIEW sqliteXview AS SELECT * FROM tenants'],
  ['extra view','CREATE VIEW hidden_foundation AS SELECT * FROM tenants'],
  ['extra trigger',"CREATE TRIGGER hidden_foundation AFTER INSERT ON tenants BEGIN SELECT 1; END"],
  ['erased tenant primary key','DROP TABLE tenants;CREATE TABLE tenants(id TEXT,version INTEGER NOT NULL,state TEXT NOT NULL)'],
  ['erased user foreign key',"DROP TABLE users;CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]')"],
  ['malformed empty onboarding relation','DROP TABLE onboarding_invites;CREATE TABLE onboarding_invites(id TEXT)'],
  ['malformed empty kiosk relation','DROP TABLE kiosk_events;CREATE TABLE kiosk_events(device_id TEXT,event_id TEXT,employee TEXT,client_at INTEGER)'],
  ['erased audit not-null','DROP TABLE audit_events;CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);CREATE TRIGGER no_audit_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,\'Audit events are append only.\'); END;CREATE TRIGGER no_audit_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,\'Audit events are append only.\'); END']
])test('native containment fresh foundational '+name+' cannot establish readiness',t=>{
  const db=foundational(t);db.exec(sql);const {guard}=bind(db);
  assert.throws(()=>guard.assertOperationalTenant('outside'),unavailable);
  assert.equal(guard.canSeedUnmanagedDemo('northstar-demo'),false);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='customer_workspaces'").get().n,0,'No empty replacement canonical family');
});
test('native containment existing canonical store permits ordinary later business objects',t=>{
  const db=foundational(t);initialize(db);addTenant(db);db.exec('CREATE TABLE later_business(id TEXT);CREATE VIEW later_view AS SELECT id FROM later_business;CREATE TRIGGER later_trigger AFTER INSERT ON later_business BEGIN SELECT 1;END');
  const {guard}=bind(db);assert.equal(guard.assertOperationalTenant('alpha').classification,'UNMANAGED_LEGACY');
});
for(const method of ['assertOperationalTenant','canSeedUnmanagedDemo'])test('native containment mode schema corruption latches process via '+method,t=>{
  const db=foundational(t),{guard}=bind(db);db.exec('DROP TRIGGER customer_workspace_runtime_state_no_update');
  if(method==='canSeedUnmanagedDemo')assert.equal(guard[method]('northstar-demo'),false);else assert.throws(()=>guard[method]('outside'),unavailable);
  require(path.join(runtime,'setup-only-policy.cjs')).initializeSetupOnlySchema({db});
  assert.throws(()=>guard.assertOperationalTenant('outside'),unavailable,'DDL repair cannot remove process schema hold');
});
test('native containment bootstrap installs schema-only factory before native entry',()=>{
  const file=requested?path.resolve(runtime,'../security-runtime/bootstrap.cjs'):path.resolve(__dirname,'../../security/runtime/bootstrap.cjs'),source=fs.readFileSync(file,'utf8');
  const install=source.indexOf('installNativeSetupFactory({'),native=source.lastIndexOf("require('/app/server.cjs');"),uid=source.indexOf('enforceHostedApplicationUser({ hosted });'),durable=source.indexOf('const durableState = enforceDurableState();');
  assert.ok(install>uid&&install>durable&&install<native,'Factory must install after existing guards and before native boot');
  const block=source.slice(install,native);
  for(const name of ['initializeImplementationRunSchema','initializeCustomerWorkspaceSchema','initializeSetupOnlySchema'])assert.ok(block.includes(name+'({db})'));
  assert.match(block,/createReader:\s*createSetupOnlyReader/);
  for(const forbidden of ['createInitialWorkspace','createCleanCustomerState','createSetupOnlyPolicy','recordVerifiedAdoption','provisionInitialOwner'])assert.equal(block.includes(forbidden),false,forbidden);
});
