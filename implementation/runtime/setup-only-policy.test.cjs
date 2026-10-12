'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const requestedRuntime=process.env.VECTOR_SETUP_POLICY_RUNTIME_ROOT;
if(requestedRuntime)assert.equal(path.isAbsolute(requestedRuntime),true,'Runtime test root must be absolute; no fallback.');
const runtimeRoot=requestedRuntime?path.resolve(requestedRuntime):__dirname;
for(const name of ['customer-workspace.cjs','setup-only-policy.cjs'])assert.equal(
  createHash('sha256').update(fs.readFileSync(path.join(runtimeRoot,name))).digest('hex'),
  createHash('sha256').update(fs.readFileSync(path.join(__dirname,name))).digest('hex'),'Actual runtime bytes must match the frozen test-tree source: '+name);
const {createCustomerWorkspaceRegistry}=require(path.join(runtimeRoot,'customer-workspace.cjs'));
const {createSetupOnlyPolicy}=require(path.join(runtimeRoot,'setup-only-policy.cjs'));
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
const binding=()=>({verified:true,ownerAuthorized:true,customerId:'synthetic-customer',customerAuthorityRef:'synthetic/customer',tenant:'alpha',provider:'verified-provider',eventId:'initial-event',contractRef:'initial-contract',relationship:'initial',ownerEmail:'owner@alpha.test',ownerAuthorityRef:'synthetic-owner-authority'});
function fixture(t,{legacy=false,empty=false}={}){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE tenants(id TEXT PRIMARY KEY);CREATE TABLE implementation_runs(id TEXT PRIMARY KEY,tenant TEXT,contract_ref_hash TEXT);
    CREATE TABLE tenant_environments(tenant TEXT PRIMARY KEY,environment_id TEXT,namespace TEXT,run_id TEXT);CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT,permissions TEXT);
    INSERT INTO tenants VALUES('alpha');INSERT INTO users VALUES('owner@alpha.test','alpha','manager','["company.configure"]');`);
  const registry=createCustomerWorkspaceRegistry({db,createInitialWorkspace:b=>{db.prepare('INSERT INTO implementation_runs VALUES(?,?,?)').run('initial-run',b.tenant,hash(b.contractRef));return {initialSetupRunId:'initial-run'};}});
  let workspace;
  if(!empty){
    if(legacy){db.exec("INSERT INTO implementation_runs VALUES('legacy-run','alpha','legacy-contract');INSERT INTO tenant_environments VALUES('alpha','legacy-env','legacy-namespace','legacy-run')");workspace=registry.adoptExisting({...binding(),relationship:'renewal',operation:'adopt-existing',existingRunId:'legacy-run',existingEnvironmentId:'legacy-env',existingNamespace:'legacy-namespace'});}
    else workspace=registry.accept(binding());
  }
  // A source-produced pre-upgrade DB snapshot. Once the registry acquires the new
  // dependency, remove only its two new relations to reproduce the old schema.
  db.exec('DROP TABLE IF EXISTS customer_workspace_runtime_state_events;DROP TABLE IF EXISTS customer_workspace_runtime_state');
  return {db,registry,workspace,open:()=>createSetupOnlyPolicy({db}),initial:()=>({workspaceId:workspace.workspaceId,provider:binding().provider,contractHash:hash(binding().contractRef),eventHash:hash(binding().eventId)})};
}
const unavailable=error=>error.code==='SETUP_MODE_BINDING_UNAVAILABLE'&&error.statusCode===503;
const refused=error=>error.code==='SETUP_ONLY_REQUIRED'&&error.statusCode===403;
function copyHas(docker,target){return docker.split(/\r?\n/).filter(line=>line.startsWith('COPY ')).some(line=>{const words=line.trim().split(/\s+/);const destination=words.pop();return destination===target&&words.includes('implementation/runtime/setup-only-policy.cjs');});}
test('source packaging names policy in actual app, test tree and composition; installed runtime proves exact closure',()=>{
  const root=path.resolve(__dirname,'../..'),dockerPath=path.join(root,'Dockerfile');
  if(fs.existsSync(dockerPath)){
    const docker=fs.readFileSync(dockerPath,'utf8'),final=docker.slice(docker.lastIndexOf('\nFROM ')),composer=fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8');
    for(const destination of ['/app/implementation-runtime/','/tmp/wfm-tests/implementation/runtime/']){
      assert.equal(copyHas(final,destination),true,'Exact policy COPY missing: '+destination);
      for(const changed of [final.replaceAll('implementation/runtime/setup-only-policy.cjs',''),final.replaceAll(destination,destination+'wrong/')])assert.equal(copyHas(changed,destination),false,'Missing/wrong-target control must fail');
    }
    const group=composer.match(/implementation:\s*\[([\s\S]*?)\]/)?.[1];assert.ok(group?.includes("'setup-only-policy.cjs'"),'Required policy missing from actual composer module group');
    assert.equal(group.replace("'setup-only-policy.cjs'",'').includes("'setup-only-policy.cjs'"),false);
  }else{
    assert.ok(requestedRuntime,'Absent source composition must require an explicit installed runtime; no skip/fallback.');
    assert.equal(runtimeRoot,path.resolve('/app/implementation-runtime'),'Final-image proof must select actual /app runtime.');
  }
});
test('cold runtime registry load requires its sibling policy and cannot resolve a wrong-directory copy',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'setup-policy-closure-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const registry=path.join(dir,'customer-workspace.cjs');fs.copyFileSync(path.join(runtimeRoot,'customer-workspace.cjs'),registry);
  const cold=()=>spawnSync(process.execPath,['-e','require(process.argv[1])',registry],{encoding:'utf8'});
  const missing=cold();assert.equal(missing.status,1);assert.match(missing.stderr,/Cannot find module '.\/setup-only-policy.cjs'/);
  fs.mkdirSync(path.join(dir,'wrong'));fs.copyFileSync(path.join(runtimeRoot,'setup-only-policy.cjs'),path.join(dir,'wrong/setup-only-policy.cjs'));assert.equal(cold().status,1);
  fs.copyFileSync(path.join(runtimeRoot,'setup-only-policy.cjs'),path.join(dir,'setup-only-policy.cjs'));assert.equal(cold().status,0);
});
test('policy has exact internal methods and no activation method',()=>{
  assert.equal(typeof createSetupOnlyPolicy,'function');const db=new DatabaseSync(':memory:');
  try{assert.throws(()=>createSetupOnlyPolicy({db}),unavailable);}finally{db.close();}
});
test('registered workspace without mode fails closed, while genuinely unmanaged target grants nothing',t=>{
  const f=fixture(t),p=f.open();assert.throws(()=>p.forTenant('alpha'),unavailable);
  assert.deepEqual(p.forTenant('outside'),{classification:'UNMANAGED_LEGACY',mode:null});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_workspace_runtime_state').get().n,0);
});
test('source-produced initial receipt records SETUP_ONLY and fresh frozen canonical views',t=>{
  const f=fixture(t),p=f.open();p.recordInitialWorkspace(f.initial());const first=p.forTenant('alpha'),second=p.forTenant('alpha');
  assert.deepEqual(first,{classification:'MANAGED',mode:'SETUP_ONLY',workspaceId:f.workspace.workspaceId,tenant:'alpha',customerHash:hash(binding().customerId),initialSetupRunId:'initial-run',schemaVersion:1});
  assert.equal(Object.isFrozen(first),true);assert.notEqual(first,second);p.recordInitialWorkspace(f.initial());
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_workspace_runtime_state_events').get().n,1);
  assert.equal(f.db.prepare('PRAGMA table_info(customer_workspaces)').all().length,5);
});
for(const purpose of ['SETUP_VIEW','SETUP_PROFILE','SETUP_QUESTIONNAIRE','SETUP_LOCAL_CONFIGURATION','INITIAL_CREDENTIAL','CURRENT_INVITATION_DELIVERY','SECURITY_OBSERVATION'])test(purpose+' is a phase decision only',t=>{
  const f=fixture(t),p=f.open();p.recordInitialWorkspace(f.initial());assert.equal(p.assertAllowed({tenant:'alpha',purpose}).mode,'SETUP_ONLY');
});
for(const purpose of ['OPERATIONAL_READ','REPORT_DELIVERY','REGISTER_COMPLETION','setup_view',' SETUP_VIEW','SETUP_VIEW/anything','UNKNOWN'])test(purpose+' cannot pass setup phase',t=>{
  const f=fixture(t),p=f.open();p.recordInitialWorkspace(f.initial());assert.throws(()=>p.assertAllowed({tenant:'alpha',purpose}),refused);
});
test('registered order before workspace has distinct pending classification and restricted purposes',t=>{
  const f=fixture(t,{empty:true});f.registry.recordOrder({orderId:'synthetic-order',expectedRevision:0,orderAuthorized:true,ownerAuthorized:true,orderAuthorityRef:'synthetic-order-authority',customerId:binding().customerId,customerAuthorityRef:binding().customerAuthorityRef,tenant:'alpha',provider:'docusign',envelopeId:'synthetic-envelope',contractRef:'synthetic-contract',relationship:'initial',nominatedSuperUserEmail:'owner@alpha.test',nominationAuthorityRef:'synthetic-nominee-authority'});
  const p=f.open();assert.deepEqual(p.forTenant('alpha'),{classification:'REGISTERED_PENDING',mode:null});
  assert.equal(p.assertAllowed({tenant:'alpha',purpose:'REGISTER_COMPLETION'}).classification,'REGISTERED_PENDING');
  assert.throws(()=>p.assertAllowed({tenant:'alpha',purpose:'SETUP_VIEW'}),refused);
  assert.throws(()=>p.assertAllowed({tenant:'alpha',purpose:'OPERATIONAL_READ'}),refused);
});
test('caller mode, unknown writer fields and partial order provenance cannot choose or alter authority',t=>{
  const f=fixture(t),p=f.open();for(const change of [{mode:'LEGACY_EXISTING'},{verified:true},{orderId:'only-id'},{orderRevision:1}])assert.throws(()=>p.recordInitialWorkspace({...f.initial(),...change}));
  p.recordInitialWorkspace(f.initial());assert.throws(()=>p.assertAllowed({tenant:'alpha',purpose:'SETUP_VIEW',mode:'LEGACY_EXISTING'}));
  assert.equal(p.forTenant('alpha').mode,'SETUP_ONLY');
});
for(const table of ['customer_workspace_runtime_state','customer_workspace_runtime_state_events'])for(const verb of ['UPDATE','DELETE'])test(table+' refuses '+verb,t=>{
  const f=fixture(t),p=f.open();p.recordInitialWorkspace(f.initial());
  assert.throws(()=>f.db.exec(verb==='UPDATE'?`UPDATE ${table} SET mode='LEGACY_EXISTING'`:`DELETE FROM ${table}`),/permanent|append|immutable/i);
});
for(const damage of ['missing-run','missing-tenant','wrong-run-tenant','wrong-run-contract','orphan-mode','unknown-version','unknown-mode','wrong-journal','missing-journal','cross-contract'])test('current read refuses '+damage,t=>{
  const f=fixture(t),p=f.open();p.recordInitialWorkspace(f.initial());
  if(damage==='missing-run')f.db.exec("DELETE FROM implementation_runs WHERE id='initial-run'");
  if(damage==='missing-tenant')f.db.exec("DELETE FROM tenants WHERE id='alpha'");
  if(damage==='wrong-run-tenant')f.db.exec("UPDATE implementation_runs SET tenant='other'");
  if(damage==='wrong-run-contract')f.db.exec("UPDATE implementation_runs SET contract_ref_hash='other'");
  if(damage==='orphan-mode'){f.db.exec('PRAGMA foreign_keys=OFF;DROP TRIGGER customer_workspaces_no_delete;DELETE FROM customer_workspaces');}
  if(damage==='unknown-version'){f.db.exec('PRAGMA ignore_check_constraints=ON;DROP TRIGGER customer_workspace_runtime_state_no_update;UPDATE customer_workspace_runtime_state SET schema_version=2');}
  if(damage==='unknown-mode'){f.db.exec("PRAGMA ignore_check_constraints=ON;DROP TRIGGER customer_workspace_runtime_state_no_update;UPDATE customer_workspace_runtime_state SET mode='ACTIVE'");}
  if(damage==='wrong-journal'){f.db.exec("DROP TRIGGER customer_workspace_runtime_state_events_no_update;UPDATE customer_workspace_runtime_state_events SET mode='LEGACY_EXISTING'");}
  if(damage==='missing-journal'){f.db.exec('DROP TRIGGER customer_workspace_runtime_state_events_no_delete;DELETE FROM customer_workspace_runtime_state_events');}
  if(damage==='cross-contract'){f.db.exec("DROP TRIGGER customer_workspace_contracts_no_update;UPDATE customer_workspace_contracts SET workspace_id='other'");}
  assert.throws(()=>p.forTenant('alpha'),unavailable);assert.throws(()=>p.assertAllowed({tenant:'alpha',purpose:'SETUP_VIEW'}),unavailable);
});
test('foreign key prevents alternate customer/tenant/run binding',t=>{
  const f=fixture(t),p=f.open();p.recordInitialWorkspace(f.initial());const row=f.db.prepare('SELECT * FROM customer_workspace_runtime_state').get();
  assert.throws(()=>f.db.prepare('INSERT INTO customer_workspace_runtime_state VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('foreign','bravo',row.customer_hash+'-other','other',1,'SETUP_ONLY',row.creation_provider,row.creation_contract_hash,null,null,row.created_at),/FOREIGN KEY/);
});
test('only source-produced exact verified adoption can atomically migrate to LEGACY_EXISTING',t=>{
  const f=fixture(t,{legacy:true}),p=f.open();assert.equal(p.forTenant('alpha').mode,'LEGACY_EXISTING');
  assert.equal(f.db.prepare('SELECT action FROM customer_workspace_runtime_state_events').get().action,'MIGRATE');
  f.open();assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_workspace_runtime_state_events').get().n,1);
  assert.throws(()=>p.recordInitialWorkspace(f.initial()));
});
for(const damage of ['run','environment','namespace','tenant','owner-permission','revoked-owner','revoked-customer','frozen'])test('legacy migration refuses current '+damage+' drift with zero mode/journal writes',t=>{
  const f=fixture(t,{legacy:true});
  if(damage==='run')f.db.exec("UPDATE tenant_environments SET run_id='wrong'");
  if(damage==='environment')f.db.exec("UPDATE tenant_environments SET environment_id='wrong'");
  if(damage==='namespace')f.db.exec("UPDATE tenant_environments SET namespace='wrong'");
  if(damage==='tenant')f.db.exec("UPDATE implementation_runs SET tenant='wrong'");
  if(damage==='owner-permission')f.db.exec("UPDATE users SET permissions='[]'");
  if(damage==='revoked-owner')f.db.exec("CREATE TABLE organisation_access_initial_authority(tenant TEXT,owner_email TEXT,state TEXT);INSERT INTO organisation_access_initial_authority VALUES('alpha','owner@alpha.test','REVOKED')");
  if(damage==='revoked-customer')f.db.prepare('INSERT INTO customer_workspace_order_revocations VALUES(?,?,?,?,?)').run(hash(binding().customerId),'alpha',1,hash('synthetic-revocation'),new Date().toISOString());
  if(damage==='frozen')f.db.exec("CREATE TABLE identity_tenant_control(tenant TEXT,privileged_freeze INTEGER);INSERT INTO identity_tenant_control VALUES('alpha',1)");
  assert.throws(()=>f.open(),unavailable);for(const table of ['customer_workspace_runtime_state','customer_workspace_runtime_state_events'])assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
});
test('imported orphan origin journal cannot downgrade its tenant into unmanaged legacy',t=>{
  const f=fixture(t),p=f.open();p.recordInitialWorkspace(f.initial());
  // Deliberately damaged import, outside the trusted writer API: preserve the
  // originating journal while removing its parent records with constraints off.
  f.db.exec('PRAGMA foreign_keys=OFF;DROP TRIGGER customer_workspace_runtime_state_no_delete;DROP TRIGGER customer_workspaces_no_delete;DELETE FROM customer_workspace_runtime_state;DELETE FROM customer_workspaces');
  assert.throws(()=>p.forTenant('alpha'),unavailable);
});
test('initial mode cannot be rewritten as legacy by adoption writer and missing mode never backfills from populated tenant',t=>{
  const f=fixture(t),p=f.open();p.recordInitialWorkspace(f.initial());assert.throws(()=>p.recordVerifiedAdoption({workspaceId:f.workspace.workspaceId}));
  f.db.exec('DROP TABLE customer_workspace_runtime_state_events;DROP TABLE customer_workspace_runtime_state');const reopened=f.open();assert.throws(()=>reopened.forTenant('alpha'),unavailable);
});
