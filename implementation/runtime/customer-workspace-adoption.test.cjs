'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Worker}=require('node:worker_threads');
const {createCustomerWorkspaceRegistry}=require('./customer-workspace.cjs');
const binding=()=>({operation:'adopt-existing',verified:true,ownerAuthorized:true,customerId:'legacy-customer',customerAuthorityRef:'crm/legacy',tenant:'alpha',provider:'verified-provider',eventId:'adoption-event',contractRef:'renewal-contract',relationship:'renewal',ownerEmail:'owner@alpha.test',ownerAuthorityRef:'verified-owner',existingRunId:'legacy-run',existingEnvironmentId:'legacy-env',existingNamespace:'legacy-namespace'});
function fixture(t,dbPath=':memory:'){
  const db=new DatabaseSync(dbPath);t.after(()=>db.close());
  db.exec(`CREATE TABLE tenants(id TEXT PRIMARY KEY);CREATE TABLE implementation_runs(id TEXT PRIMARY KEY,tenant TEXT,contract_ref_hash TEXT);
    CREATE TABLE tenant_environments(tenant TEXT PRIMARY KEY,environment_id TEXT UNIQUE,namespace TEXT UNIQUE,run_id TEXT,configuration_json TEXT);
    CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT,permissions TEXT);
    CREATE TABLE workspace_setup_drafts(tenant TEXT,run_id TEXT,status TEXT,answers_json TEXT);
    INSERT INTO tenants VALUES('alpha'),('bravo');INSERT INTO implementation_runs VALUES('legacy-run','alpha','old-contract');
    INSERT INTO tenant_environments VALUES('alpha','legacy-env','legacy-namespace','legacy-run','{"sourceSystems":["Existing"]}');
    INSERT INTO users VALUES('owner@alpha.test','alpha','manager','["company.configure"]');
    INSERT INTO workspace_setup_drafts VALUES('alpha','legacy-run','APPLIED','{"completed":true}');`);
  let calls=0;const registry=createCustomerWorkspaceRegistry({db,createInitialWorkspace(){calls++;throw Error('must not create');}});
  const preserved=()=>['implementation_runs','tenant_environments','users','workspace_setup_drafts'].map(table=>db.prepare('SELECT * FROM '+table).all());
  const registryRows=()=>['customer_workspaces','customer_workspace_contracts','customer_workspace_events','customer_workspace_adoptions'].map(table=>db.prepare('SELECT * FROM '+table).all());
  return {db,registry,preserved,registryRows,get calls(){return calls;}};
}
test('verified adoption preserves the exact legacy tuple and completion through replay, restart, renewal and upgrade',t=>{
  const f=fixture(t),before=f.preserved(),first=f.registry.adoptExisting(binding());
  assert.equal(first.created,false);assert.equal(first.adopted,true);assert.equal(first.initialSetupRunId,'legacy-run');assert.equal(first.environmentId,'legacy-env');assert.equal(first.namespace,'legacy-namespace');
  const replay=f.registry.adoptExisting(binding());assert.equal(replay.workspaceId,first.workspaceId);assert.equal(replay.replayed,true);
  const reopened=createCustomerWorkspaceRegistry({db:f.db,createInitialWorkspace(){throw Error('must not create');}});
  assert.equal(reopened.forTenant('alpha').workspaceId,first.workspaceId);
  for(const relationship of ['renewal','amendment']){
    const next={...binding(),eventId:relationship,contractRef:relationship,relationship,existingWorkspaceId:first.workspaceId};
    for(const key of ['operation','existingRunId','existingEnvironmentId','existingNamespace'])delete next[key];
    assert.equal(reopened.accept(next).initialSetupRunId,'legacy-run');
  }
  assert.equal(f.calls,0);assert.deepEqual(f.preserved(),before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_workspace_adoptions').get().n,1);
  assert.throws(()=>f.db.exec('DELETE FROM customer_workspace_adoptions'),/permanent|append/i);
  assert.throws(()=>f.db.exec("UPDATE customer_workspace_adoptions SET namespace='rebind'"),/permanent|append/i);
});
for(const [name,change,seed] of [
  ['missing verification',{verified:false}],['missing owner authority',{ownerAuthorized:false}],['missing customer authority',{customerAuthorityRef:''}],
  ['wrong tenant',{tenant:'bravo'}],['wrong run',{existingRunId:'wrong'}],['wrong environment',{existingEnvironmentId:'wrong'}],['wrong namespace',{existingNamespace:'wrong'}],
  ['cross-tenant owner',{ownerEmail:'other@bravo.test'},"INSERT INTO users VALUES('other@bravo.test','bravo','manager','[\"company.configure\"]')"],
  ['owner without permission',{},"UPDATE users SET permissions='[]'"],['employee owner',{},"UPDATE users SET role='employee'"],
  ['frozen tenant',{},"CREATE TABLE identity_tenant_control(tenant TEXT PRIMARY KEY,privileged_freeze INTEGER); INSERT INTO identity_tenant_control VALUES('alpha',1)"],
  ['revoked owner',{},"CREATE TABLE organisation_access_initial_authority(tenant TEXT,owner_email TEXT,state TEXT); INSERT INTO organisation_access_initial_authority VALUES('alpha','owner@alpha.test','REVOKED')"],
  ['ambiguous runs',{},"INSERT INTO implementation_runs VALUES('another','alpha','another-contract')"],
  ['environment bound to different run',{},"UPDATE tenant_environments SET run_id='other'"],
  ['raw fields',{runId:'legacy-run'}],['unsupported operation',{operation:'guess-existing'}]
])test(name+' adoption fails before any mutation',t=>{
  const f=fixture(t);if(seed)f.db.exec(seed);const before=f.preserved();
  assert.equal(typeof f.registry.adoptExisting,'function','verified adoption must exist before checking its rejection behavior');
  assert.throws(()=>f.registry.adoptExisting({...binding(),...change}));assert.deepEqual(f.preserved(),before);assert.equal(f.calls,0);
  assert.equal(f.registry.forTenant('alpha'),null);
  for(const table of ['customer_workspaces','customer_workspace_contracts','customer_workspace_events'])assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
});
for(const table of ['customer_workspaces','customer_workspace_contracts','customer_workspace_events','customer_workspace_adoptions'])test(table+' insertion failure rolls back the full adoption and leaves legacy state unchanged',t=>{
  const f=fixture(t),before=f.preserved();
  f.db.exec(`CREATE TRIGGER refuse_adoption BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'adoption audit unavailable'); END`);
  assert.throws(()=>f.registry.adoptExisting(binding()),/adoption audit unavailable/);assert.deepEqual(f.preserved(),before);
  for(const rows of f.registryRows())assert.equal(rows.length,0);
  f.db.exec('DROP TRIGGER refuse_adoption');assert.equal(f.registry.adoptExisting(binding()).adopted,true);
});
test('conflicting customer, event and tuple cannot rebind adoption; savepoint remains caller owned',t=>{
  const f=fixture(t);f.db.exec('BEGIN IMMEDIATE');const first=f.registry.adoptExisting(binding());assert.equal(f.db.isTransaction,true);f.db.exec('ROLLBACK');assert.equal(f.registry.forTenant('alpha'),null);
  f.registry.adoptExisting(binding());const before=f.registryRows();
  for(const change of [{customerId:'different'},{contractRef:'different'},{existingRunId:'different'},{ownerEmail:'different@alpha.test'}])assert.throws(()=>f.registry.adoptExisting({...binding(),...change}));
  assert.deepEqual(f.registryRows(),before);assert.equal(f.calls,0);
});
for(const conflict of [false,true])test('concurrent '+(conflict?'conflicting':'identical')+' adoption produces one permanent association and one receipt',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-adopt-concurrent-')),dbPath=path.join(directory,'state.sqlite');
  const f=fixture(t,dbPath);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const before=f.preserved();
  const barrier=new SharedArrayBuffer(4),signal=new Int32Array(barrier);
  const results=await Promise.all([0,1].map(index=>new Promise((resolve,reject)=>{
    const worker=new Worker(`const {workerData,parentPort}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');
      const {createCustomerWorkspaceRegistry}=require(workerData.module);const db=new DatabaseSync(workerData.dbPath);db.exec('PRAGMA busy_timeout=10000');
      const registry=createCustomerWorkspaceRegistry({db,createInitialWorkspace(){throw Error('must not create');}});
      const signal=new Int32Array(workerData.barrier);Atomics.add(signal,0,1);Atomics.notify(signal,0);
      while(Atomics.load(signal,0)<2)Atomics.wait(signal,0,1,1000);
      try{parentPort.postMessage({ok:true,result:registry.adoptExisting(workerData.binding)});}catch(error){parentPort.postMessage({ok:false,message:error.message,status:error.statusCode});}finally{db.close();}`,{eval:true,workerData:{module:require.resolve('./customer-workspace.cjs'),dbPath,barrier,binding:{...binding(),...(conflict&&index===1?{customerId:'other-customer',eventId:'conflicting-event'}:{})}}});
    worker.once('message',resolve);worker.once('error',reject);
  })));
  assert.equal(results.filter(result=>result.ok).length,conflict?1:2,JSON.stringify(results));
  if(!conflict)assert.equal(results[0].result.workspaceId,results[1].result.workspaceId);
  else assert.equal(results.find(result=>!result.ok).status,409);
  for(const rows of f.registryRows())assert.equal(rows.length,1);assert.deepEqual(f.preserved(),before);
});
