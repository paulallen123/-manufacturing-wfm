'use strict';
const {createHash,randomUUID}=require('node:crypto');
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const setupPurposes=new Set(['SETUP_VIEW','SETUP_PROFILE','SETUP_QUESTIONNAIRE','SETUP_LOCAL_CONFIGURATION','INITIAL_CREDENTIAL','CURRENT_INVITATION_DELIVERY','SECURITY_OBSERVATION']);
function fail(code,statusCode=503){throw Object.assign(Error(code==='SETUP_ONLY_REQUIRED'?'Complete the authorised setup before using this resource.':'Setup mode binding unavailable.'),{code,statusCode});}
const unavailable=()=>fail('SETUP_MODE_BINDING_UNAVAILABLE');
function fields(input,allowed){
  if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))fail('INVALID_SETUP_POLICY_INPUT',400);
  for(const key of Reflect.ownKeys(input)){const d=Object.getOwnPropertyDescriptor(input,key);if(typeof key!=='string'||!allowed.includes(key)||!d.enumerable||!Object.hasOwn(d,'value'))fail('INVALID_SETUP_POLICY_INPUT',400);}
}
function text(value,max=300){if(typeof value!=='string'||!value||value!==value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))fail('INVALID_SETUP_POLICY_INPUT',400);return value;}

/** Internal phase filter, never identity/provider/owner authorization. Callers
 * resolve current authority independently and reread this policy at effects.
 * Fixed writer methods use canonical stored provenance; no caller-selected mode.
 */
function createSetupOnlyPolicy({db}={}){
  const hasTable=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  if(!db)unavailable();
  for(const table of ['customer_workspaces','customer_workspace_contracts','customer_workspace_events','customer_workspace_adoptions','customer_workspace_orders','tenants','implementation_runs'])if(!hasTable(table))unavailable();
  if(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys)!==1)unavailable();
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS customer_workspace_mode_parent ON customer_workspaces(workspace_id,tenant,customer_hash,initial_run_id);
    CREATE TABLE IF NOT EXISTS customer_workspace_runtime_state(
    workspace_id TEXT PRIMARY KEY,tenant TEXT NOT NULL UNIQUE,customer_hash TEXT NOT NULL UNIQUE,initial_run_id TEXT NOT NULL UNIQUE,
    schema_version INTEGER NOT NULL CHECK(schema_version=1),mode TEXT NOT NULL CHECK(mode IN ('SETUP_ONLY','LEGACY_EXISTING')),
    creation_provider TEXT NOT NULL,creation_contract_hash TEXT NOT NULL,creation_order_id TEXT,creation_order_revision INTEGER,created_at TEXT NOT NULL,
    CHECK((creation_order_id IS NULL AND creation_order_revision IS NULL) OR
      (creation_order_id IS NOT NULL AND creation_order_revision IS NOT NULL AND creation_order_revision>0)),
    FOREIGN KEY(workspace_id,tenant,customer_hash,initial_run_id) REFERENCES customer_workspaces(workspace_id,tenant,customer_hash,initial_run_id),
    FOREIGN KEY(creation_provider,creation_contract_hash) REFERENCES customer_workspace_contracts(provider,contract_hash));
    CREATE TABLE IF NOT EXISTS customer_workspace_runtime_state_events(
    workspace_id TEXT PRIMARY KEY REFERENCES customer_workspace_runtime_state(workspace_id),action TEXT NOT NULL CHECK(action IN ('CREATE','MIGRATE')),
    schema_version INTEGER NOT NULL,mode TEXT NOT NULL,origin_event_hash TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);`);
  for(const table of ['customer_workspace_runtime_state','customer_workspace_runtime_state_events'])for(const verb of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${verb.toLowerCase()} BEFORE ${verb} ON ${table} BEGIN SELECT RAISE(ABORT,'Setup mode bindings and receipts are immutable and append only.'); END;`);
  function atomic(action){
    const savepoint=db.isTransaction?'setup_mode_'+randomUUID().replaceAll('-',''):null;db.exec(savepoint?'SAVEPOINT '+savepoint:'BEGIN IMMEDIATE');
    try{const value=action();if(value?.then)unavailable();db.exec(savepoint?'RELEASE '+savepoint:'COMMIT');return value;}
    catch(error){db.exec(savepoint?'ROLLBACK TO '+savepoint+'; RELEASE '+savepoint:'ROLLBACK');throw error;}
  }
  const workspace=id=>db.prepare('SELECT * FROM customer_workspaces WHERE workspace_id=?').get(id);
  const mode=id=>db.prepare('SELECT * FROM customer_workspace_runtime_state WHERE workspace_id=?').get(id);
  const contract=(provider,ref)=>db.prepare('SELECT * FROM customer_workspace_contracts WHERE provider=? AND contract_hash=?').get(provider,ref);
  const event=(provider,ref)=>db.prepare('SELECT * FROM customer_workspace_events WHERE provider=? AND event_hash=?').get(provider,ref);
  function canonical(row){
    if(!row||!db.prepare('SELECT id FROM tenants WHERE id=?').get(row.tenant))unavailable();
    const run=db.prepare('SELECT * FROM implementation_runs WHERE id=?').get(row.initial_run_id);if(!run||run.tenant!==row.tenant)unavailable();return run;
  }
  function association(row,provider,contractHash,eventHash){
    const c=contract(provider,contractHash),e=event(provider,eventHash);
    if(!c||!e||c.workspace_id!==row.workspace_id||e.workspace_id!==row.workspace_id||e.contract_hash!==contractHash||e.binding_digest!==c.binding_digest)unavailable();return c;
  }
  function adoption(row,currentOwner=false){
    canonical(row);const receipt=db.prepare('SELECT * FROM customer_workspace_adoptions WHERE workspace_id=?').get(row.workspace_id);
    if(!receipt||receipt.tenant!==row.tenant||receipt.initial_run_id!==row.initial_run_id||!hasTable('tenant_environments'))unavailable();
    const runs=db.prepare('SELECT id FROM implementation_runs WHERE tenant=? LIMIT 2').all(row.tenant),env=db.prepare('SELECT * FROM tenant_environments WHERE tenant=?').get(row.tenant);
    if(runs.length!==1||runs[0].id!==row.initial_run_id||!env||env.run_id!==row.initial_run_id||env.environment_id!==receipt.environment_id||env.namespace!==receipt.namespace)unavailable();
    const c=association(row,receipt.provider,receipt.contract_hash,receipt.event_hash);
    if(receipt.binding_digest!==hash(JSON.stringify([c.binding_digest,row.initial_run_id,receipt.environment_id,receipt.namespace])))unavailable();
    if(currentOwner){
      if(!hasTable('users'))unavailable();const owners=db.prepare('SELECT email,tenant,role,permissions FROM users WHERE tenant=?').all(row.tenant).filter(u=>hash(u.email.toLowerCase())===receipt.owner_hash);
      let permissions=[];try{permissions=JSON.parse(owners[0]?.permissions||'[]');}catch{}
      if(owners.length!==1||owners[0].tenant!==row.tenant||String(owners[0].role).toLowerCase()==='employee'||!Array.isArray(permissions)||!permissions.includes('company.configure'))unavailable();
      if((hasTable('identity_tenant_control')&&db.prepare('SELECT privileged_freeze FROM identity_tenant_control WHERE tenant=?').get(row.tenant)?.privileged_freeze)||
        (hasTable('organisation_access_initial_authority')&&db.prepare("SELECT 1 FROM organisation_access_initial_authority WHERE tenant=? AND lower(owner_email)=? AND state='REVOKED'").get(row.tenant,owners[0].email.toLowerCase()))||
        db.prepare('SELECT 1 FROM customer_workspace_order_revocations WHERE customer_hash=?').get(row.customer_hash))unavailable();
    }
    return receipt;
  }
  function orderProvenance(row,provider,contractHash,id,revision,current=false){
    if((id==null)!==(revision==null))unavailable();
    const docu=typeof provider==='string'&&provider.toLowerCase().replace(/[^a-z0-9]/g,'').includes('docusign');
    if(id==null){if(docu)unavailable();return;}
    if(docu&&provider!=='docusign')unavailable();
    const o=db.prepare('SELECT * FROM customer_workspace_orders WHERE order_id=? AND revision=?').get(id,revision);let binding;try{binding=JSON.parse(o?.binding_json||'null')?.binding;}catch{}
    if(!o||o.customer_hash!==row.customer_hash||o.tenant!==row.tenant||o.provider!==provider||!binding||hash(binding.contractRef)!==contractHash)unavailable();
    if(current){const head=db.prepare('SELECT revision FROM customer_workspace_orders WHERE order_id=? ORDER BY revision DESC LIMIT 1').get(id),nominee=db.prepare('SELECT nomination_revision,nomination_digest FROM customer_workspace_orders WHERE customer_hash=? ORDER BY id DESC LIMIT 1').get(row.customer_hash);
      if(head?.revision!==revision||nominee?.nomination_revision!==o.nomination_revision||nominee?.nomination_digest!==o.nomination_digest||db.prepare('SELECT 1 FROM customer_workspace_order_revocations WHERE customer_hash=?').get(row.customer_hash))unavailable();}
  }
  const detail=row=>JSON.stringify([row.workspace_id,row.tenant,row.customer_hash,row.initial_run_id,row.schema_version,row.mode,row.creation_provider,row.creation_contract_hash,row.creation_order_id,row.creation_order_revision,row.created_at]);
  function readManaged(row,state){
    const run=canonical(row);if(!state||state.schema_version!==1||!['SETUP_ONLY','LEGACY_EXISTING'].includes(state.mode)||['workspace_id','tenant','customer_hash','initial_run_id'].some(k=>state[k]!==row[k]))unavailable();
    const journal=db.prepare('SELECT * FROM customer_workspace_runtime_state_events WHERE workspace_id=?').get(row.workspace_id);
    if(!journal||journal.schema_version!==1||journal.mode!==state.mode||journal.detail_json!==detail(state)||journal.created_at!==state.created_at||!['CREATE','MIGRATE'].includes(journal.action)||(state.mode==='SETUP_ONLY'&&journal.action!=='CREATE'))unavailable();
    const c=association(row,state.creation_provider,state.creation_contract_hash,journal.origin_event_hash);
    if(state.mode==='SETUP_ONLY'){if(c.relationship!=='initial'||run.contract_ref_hash!==state.creation_contract_hash||db.prepare('SELECT 1 FROM customer_workspace_adoptions WHERE workspace_id=?').get(row.workspace_id))unavailable();}
    else{const receipt=adoption(row);if(receipt.provider!==state.creation_provider||receipt.contract_hash!==state.creation_contract_hash||receipt.event_hash!==journal.origin_event_hash)unavailable();}
    orderProvenance(row,state.creation_provider,state.creation_contract_hash,state.creation_order_id,state.creation_order_revision);
    return Object.freeze({classification:'MANAGED',mode:state.mode,workspaceId:row.workspace_id,tenant:row.tenant,customerHash:row.customer_hash,initialSetupRunId:row.initial_run_id,schemaVersion:1});
  }
  function forTenant(tenant){
    text(tenant,120);
    try{
      const row=db.prepare('SELECT * FROM customer_workspaces WHERE tenant=?').get(tenant),state=db.prepare('SELECT * FROM customer_workspace_runtime_state WHERE tenant=?').get(tenant);
      if(row)return readManaged(row,state);if(state||db.prepare('SELECT 1 FROM customer_workspace_runtime_state_events e JOIN customer_workspace_runtime_state m ON m.workspace_id=e.workspace_id WHERE m.tenant=?').get(tenant))unavailable();
      for(const journal of db.prepare('SELECT e.detail_json FROM customer_workspace_runtime_state_events e LEFT JOIN customer_workspace_runtime_state m ON m.workspace_id=e.workspace_id WHERE m.workspace_id IS NULL').all()){
        let origin;try{origin=JSON.parse(journal.detail_json);}catch{unavailable();}
        if(!Array.isArray(origin)||origin.length!==11||typeof origin[1]!=='string'||origin[1]===tenant)unavailable();
      }
      if(db.prepare('SELECT 1 FROM customer_workspace_orders WHERE tenant=? LIMIT 1').get(tenant))return Object.freeze({classification:'REGISTERED_PENDING',mode:null});
      return Object.freeze({classification:'UNMANAGED_LEGACY',mode:null});
    }catch(error){if(error.code==='SETUP_MODE_BINDING_UNAVAILABLE')throw error;unavailable();}
  }
  function writeMode(row,provider,contractHash,eventHash,id,revision,fixedMode,action){
    const existing=mode(row.workspace_id);
    if(existing){if(existing.mode!==fixedMode||existing.creation_provider!==provider||existing.creation_contract_hash!==contractHash||existing.creation_order_id!==(id??null)||existing.creation_order_revision!==(revision??null))unavailable();return readManaged(row,existing);}
    const state={...row,schema_version:1,mode:fixedMode,creation_provider:provider,creation_contract_hash:contractHash,creation_order_id:id??null,creation_order_revision:revision??null,created_at:new Date().toISOString()};
    db.prepare('INSERT INTO customer_workspace_runtime_state VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(state.workspace_id,state.tenant,state.customer_hash,state.initial_run_id,1,fixedMode,provider,contractHash,state.creation_order_id,state.creation_order_revision,state.created_at);
    db.prepare('INSERT INTO customer_workspace_runtime_state_events VALUES(?,?,?,?,?,?,?)').run(row.workspace_id,action,1,fixedMode,eventHash,detail(state),state.created_at);
    return readManaged(row,state);
  }
  function recordInitialWorkspace(input){
    fields(input,['workspaceId','provider','contractHash','eventHash','orderId','orderRevision']);const {workspaceId,provider,contractHash,eventHash,orderId,orderRevision}=input;
    for(const value of [workspaceId,provider,contractHash,eventHash])text(value);if((orderId===undefined)!==(orderRevision===undefined))fail('INVALID_SETUP_POLICY_INPUT',400);
    if(orderId!==undefined){text(orderId);if(!Number.isSafeInteger(orderRevision)||orderRevision<1)fail('INVALID_SETUP_POLICY_INPUT',400);}
    return atomic(()=>{const row=workspace(workspaceId),run=canonical(row),c=association(row,provider,contractHash,eventHash);
      if(c.relationship!=='initial'||run.contract_ref_hash!==contractHash||db.prepare('SELECT 1 FROM customer_workspace_adoptions WHERE workspace_id=?').get(workspaceId))unavailable();
      orderProvenance(row,provider,contractHash,orderId,orderRevision,true);return writeMode(row,provider,contractHash,eventHash,orderId,orderRevision,'SETUP_ONLY','CREATE');});
  }
  function writeAdoption(workspaceId,action){
    const row=workspace(workspaceId),receipt=adoption(row,true);let origin;
    if(receipt.provider==='docusign')origin=db.prepare('SELECT * FROM customer_workspace_orders WHERE customer_hash=? AND tenant=? AND provider=? ORDER BY id DESC').all(row.customer_hash,row.tenant,receipt.provider).find(o=>{try{return hash(JSON.parse(o.binding_json).binding.contractRef)===receipt.contract_hash;}catch{return false;}});
    orderProvenance(row,receipt.provider,receipt.contract_hash,origin?.order_id,origin?.revision,true);
    return writeMode(row,receipt.provider,receipt.contract_hash,receipt.event_hash,origin?.order_id,origin?.revision,'LEGACY_EXISTING',action);
  }
  function recordVerifiedAdoption(input){fields(input,['workspaceId']);text(input.workspaceId);return atomic(()=>writeAdoption(input.workspaceId,'CREATE'));}
  function assertAllowed(input){
    fields(input,['tenant','purpose']);const current=forTenant(input.tenant),purpose=input.purpose;
    if((current.mode==='SETUP_ONLY'&&!setupPurposes.has(purpose))||(current.classification==='REGISTERED_PENDING'&&!['REGISTER_COMPLETION','SECURITY_OBSERVATION'].includes(purpose)))fail('SETUP_ONLY_REQUIRED',403);
    return current;
  }
  atomic(()=>{for(const candidate of db.prepare('SELECT a.workspace_id FROM customer_workspace_adoptions a LEFT JOIN customer_workspace_runtime_state m ON m.workspace_id=a.workspace_id WHERE m.workspace_id IS NULL').all())writeAdoption(candidate.workspace_id,'MIGRATE');});
  return Object.freeze({forTenant,assertAllowed,recordInitialWorkspace,recordVerifiedAdoption});
}
module.exports={createSetupOnlyPolicy};
