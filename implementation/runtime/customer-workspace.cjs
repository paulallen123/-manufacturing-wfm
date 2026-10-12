'use strict';
const {createHash,randomUUID}=require('node:crypto');
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
function fail(message,statusCode=409){throw Object.assign(Error(message),{statusCode});}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))fail(label+' is required.',400);return value.trim();}

// Trusted orchestration only. The HTTP boundary must verify the actual event and
// resolve customer, tenant and owner authority independently of submitted fields.
function createCustomerWorkspaceRegistry({db,createInitialWorkspace}){
  if(!db||typeof createInitialWorkspace!=='function'||createInitialWorkspace.constructor?.name==='AsyncFunction')throw Error('A database and synchronous workspace adapter are required.');
  db.exec(`CREATE TABLE IF NOT EXISTS customer_workspaces(
    customer_hash TEXT PRIMARY KEY,workspace_id TEXT NOT NULL UNIQUE,tenant TEXT NOT NULL UNIQUE,
    initial_run_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customer_workspace_contracts(
    provider TEXT NOT NULL,contract_hash TEXT NOT NULL,workspace_id TEXT NOT NULL,
    relationship TEXT NOT NULL,binding_digest TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(provider,contract_hash));
    CREATE TABLE IF NOT EXISTS customer_workspace_events(
    provider TEXT NOT NULL,event_hash TEXT NOT NULL,contract_hash TEXT NOT NULL,workspace_id TEXT NOT NULL,
    binding_digest TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(provider,event_hash));
    CREATE TABLE IF NOT EXISTS customer_workspace_adoptions(
    workspace_id TEXT PRIMARY KEY,tenant TEXT NOT NULL UNIQUE,initial_run_id TEXT NOT NULL UNIQUE,
    environment_id TEXT NOT NULL UNIQUE,namespace TEXT NOT NULL UNIQUE,owner_hash TEXT NOT NULL,
    provider TEXT NOT NULL,event_hash TEXT NOT NULL,contract_hash TEXT NOT NULL,
    binding_digest TEXT NOT NULL,created_at TEXT NOT NULL);`);
  for(const table of ['customer_workspaces','customer_workspace_contracts','customer_workspace_events','customer_workspace_adoptions']){
    for(const action of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table}
      BEGIN SELECT RAISE(ABORT,'Customer workspace associations are permanent.'); END;`);
  }
  const byCustomer=db.prepare('SELECT * FROM customer_workspaces WHERE customer_hash=?');
  const byTenant=db.prepare('SELECT * FROM customer_workspaces WHERE tenant=?');
  function view(row){
    if(!row)return null;
    const receipt=db.prepare('SELECT environment_id,namespace FROM customer_workspace_adoptions WHERE workspace_id=?').get(row.workspace_id);
    return {workspaceId:row.workspace_id,tenant:row.tenant,initialSetupRunId:row.initial_run_id,createdAt:row.created_at,
      ...(receipt?{adopted:true,environmentId:receipt.environment_id,namespace:receipt.namespace}:{})};
  }
  function atomic(fn){
    const sp=db.isTransaction?'customer_workspace_'+randomUUID().replaceAll('-',''):null;
    db.exec(sp?'SAVEPOINT '+sp:'BEGIN IMMEDIATE');
    try{const out=fn();db.exec(sp?'RELEASE '+sp:'COMMIT');return out;}
    catch(error){try{db.exec(sp?'ROLLBACK TO '+sp+'; RELEASE '+sp:'ROLLBACK');}catch{}throw error;}
  }
  function validated(input,adoption=false){
    if(input?.verified!==true||input.ownerAuthorized!==true)fail('Verified customer and owner authority is required.',403);
    const allowed=['verified','ownerAuthorized','customerId','customerAuthorityRef','tenant','provider','eventId','contractRef','relationship','ownerEmail','ownerAuthorityRef','existingWorkspaceId','profile'];
    if(adoption)allowed.push('operation','existingRunId','existingEnvironmentId','existingNamespace');
    if(Object.keys(input).some(key=>!allowed.includes(key)))fail('Unsupported workspace binding fields.',400);
    const customerHash=hash(text(input.customerId,300,'Customer identity')),tenant=text(input.tenant,120,'Tenant');
    const provider=text(input.provider,120,'Provider'),eventHash=hash(text(input.eventId,300,'Event identity'));
    const contractRef=text(input.contractRef,300,'Contract reference'),contractHash=hash(contractRef);
    const ownerEmail=text(input.ownerEmail,254,'Owner email').toLowerCase();
    if(!/^[^\s@]+@[^\s@]+$/.test(ownerEmail))fail('Owner email is invalid.',400);
    const ownerAuthorityRef=text(input.ownerAuthorityRef,300,'Owner authority'),customerAuthorityRef=text(input.customerAuthorityRef,300,'Customer authority');
    const relationship=input.relationship;
    if(!['initial','renewal','amendment'].includes(relationship))fail('Explicit contract relationship is required.',400);
    const bindingDigest=hash(JSON.stringify([customerHash,tenant,provider,contractHash,ownerEmail,ownerAuthorityRef,customerAuthorityRef,relationship]));
    return {customerHash,tenant,provider,eventHash,contractRef,contractHash,ownerEmail,bindingDigest,relationship};
  }
  function accept(input){
    const {customerHash,tenant,provider,eventHash,contractRef,contractHash,ownerEmail,bindingDigest,relationship}=validated(input);
    return atomic(()=>{
      let row=byCustomer.get(customerHash);const tenantRow=byTenant.get(tenant);
      if((row&&row.tenant!==tenant)||(tenantRow&&tenantRow.customer_hash!==customerHash))fail('Customer workspace binding conflicts with the permanent identity.');
      const contract=db.prepare('SELECT * FROM customer_workspace_contracts WHERE provider=? AND contract_hash=?').get(provider,contractHash);
      const event=db.prepare('SELECT * FROM customer_workspace_events WHERE provider=? AND event_hash=?').get(provider,eventHash);
      if(event&&(event.contract_hash!==contractHash||event.binding_digest!==bindingDigest||event.workspace_id!==row?.workspace_id))fail('Signing event identity is already bound to another contract or customer.');
      if(contract&&(contract.binding_digest!==bindingDigest||contract.workspace_id!==row?.workspace_id))fail('Contract authority conflicts with its existing customer workspace.');
      if(relationship!=='initial'&&(!row||input.existingWorkspaceId!==row.workspace_id))fail('Renewals and amendments require an explicit existing workspace association.');
      if(row&&!contract&&relationship==='initial')fail('A customer already has a workspace. Associate this contract as a renewal or amendment.');
      const created=!row;
      if(!row){
        if(input.existingWorkspaceId||relationship!=='initial')fail('An initial workspace cannot rebind an existing association.');
        const result=createInitialWorkspace({...input,tenant,contractRef,ownerEmail});
        if(!result||typeof result.then==='function')throw Error('Workspace creation must be synchronous.');
        const run=db.prepare('SELECT id,tenant,contract_ref_hash FROM implementation_runs WHERE id=?').get(result.initialSetupRunId);
        if(!run||run.tenant!==tenant||run.contract_ref_hash!==contractHash||!db.prepare('SELECT id FROM tenants WHERE id=?').get(tenant))throw Error('Workspace creation did not establish the canonical tenant/run binding.');
        const workspaceId=randomUUID(),ts=new Date().toISOString();
        db.prepare('INSERT INTO customer_workspaces VALUES(?,?,?,?,?)').run(customerHash,workspaceId,tenant,run.id,ts);
        row=byCustomer.get(customerHash);
      }
      const run=db.prepare('SELECT tenant FROM implementation_runs WHERE id=?').get(row.initial_run_id);
      if(!run||run.tenant!==tenant||!db.prepare('SELECT id FROM tenants WHERE id=?').get(tenant))fail('The canonical customer workspace requires recovery.');
      const ts=new Date().toISOString();
      if(!contract)db.prepare('INSERT INTO customer_workspace_contracts VALUES(?,?,?,?,?,?)').run(provider,contractHash,row.workspace_id,relationship,bindingDigest,ts);
      if(!event)db.prepare('INSERT INTO customer_workspace_events VALUES(?,?,?,?,?,?)').run(provider,eventHash,contractHash,row.workspace_id,bindingDigest,ts);
      return {...view(row),created,replayed:Boolean(event)};
    });
  }
  function adoptExisting(input){
    const {customerHash,tenant,provider,eventHash,contractHash,ownerEmail,bindingDigest,relationship}=validated(input,true);
    if(input.operation!=='adopt-existing'||input.existingWorkspaceId||input.profile)fail('An explicit existing-tuple adoption is required.',400);
    const runId=text(input.existingRunId,300,'Existing run'),environmentId=text(input.existingEnvironmentId,300,'Existing environment'),namespace=text(input.existingNamespace,300,'Existing namespace');
    const adoptionDigest=hash(JSON.stringify([bindingDigest,runId,environmentId,namespace]));
    return atomic(()=>{
      const runs=db.prepare('SELECT id,tenant FROM implementation_runs WHERE tenant=? LIMIT 2').all(tenant);
      const environment=db.prepare('SELECT tenant,environment_id,namespace,run_id FROM tenant_environments WHERE tenant=?').get(tenant);
      if(runs.length!==1||runs[0].id!==runId||!db.prepare('SELECT id FROM tenants WHERE id=?').get(tenant)||
        !environment||environment.run_id!==runId||environment.environment_id!==environmentId||environment.namespace!==namespace)fail('The exact existing workspace tuple must be unambiguous.');
      const owner=db.prepare('SELECT tenant,role,permissions FROM users WHERE lower(email)=? LIMIT 2').all(ownerEmail);
      let permissions=[];try{permissions=JSON.parse(owner[0]?.permissions||'[]');}catch{}
      if(owner.length!==1||owner[0].tenant!==tenant||String(owner[0].role).toLowerCase()==='employee'||!Array.isArray(permissions)||!permissions.includes('company.configure'))fail('Existing owner authority is required.',403);
      const hasTable=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
      if((hasTable('identity_tenant_control')&&db.prepare('SELECT privileged_freeze FROM identity_tenant_control WHERE tenant=?').get(tenant)?.privileged_freeze)||
        (hasTable('organisation_access_initial_authority')&&db.prepare("SELECT 1 FROM organisation_access_initial_authority WHERE tenant=? AND lower(owner_email)=? AND state='REVOKED'").get(tenant,ownerEmail)))fail('Existing owner authority is frozen or revoked.',403);
      let row=byCustomer.get(customerHash);const tenantRow=byTenant.get(tenant);
      if((row&&(row.tenant!==tenant||row.initial_run_id!==runId))||(tenantRow&&tenantRow.customer_hash!==customerHash))fail('Customer workspace binding conflicts with the permanent identity.');
      const contract=db.prepare('SELECT * FROM customer_workspace_contracts WHERE provider=? AND contract_hash=?').get(provider,contractHash);
      const event=db.prepare('SELECT * FROM customer_workspace_events WHERE provider=? AND event_hash=?').get(provider,eventHash);
      const receipt=row?db.prepare('SELECT * FROM customer_workspace_adoptions WHERE workspace_id=?').get(row.workspace_id):null;
      if(row){
        if(!receipt||receipt.binding_digest!==adoptionDigest||receipt.provider!==provider||receipt.event_hash!==eventHash||
          receipt.environment_id!==environmentId||receipt.namespace!==namespace||!contract||!event||
          contract.workspace_id!==row.workspace_id||event.workspace_id!==row.workspace_id||contract.binding_digest!==bindingDigest||event.binding_digest!==bindingDigest||event.contract_hash!==contractHash)fail('Adoption cannot rebind a permanent workspace or receipt.');
        return {...view(row),environmentId,namespace,created:false,adopted:true,replayed:true};
      }
      if(contract||event)fail('Contract or event identity is already associated.');
      const workspaceId=randomUUID(),ts=new Date().toISOString();
      db.prepare('INSERT INTO customer_workspaces VALUES(?,?,?,?,?)').run(customerHash,workspaceId,tenant,runId,ts);
      db.prepare('INSERT INTO customer_workspace_contracts VALUES(?,?,?,?,?,?)').run(provider,contractHash,workspaceId,relationship,bindingDigest,ts);
      db.prepare('INSERT INTO customer_workspace_events VALUES(?,?,?,?,?,?)').run(provider,eventHash,contractHash,workspaceId,bindingDigest,ts);
      db.prepare('INSERT INTO customer_workspace_adoptions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(workspaceId,tenant,runId,environmentId,namespace,hash(ownerEmail),provider,eventHash,contractHash,adoptionDigest,ts);
      row=byCustomer.get(customerHash);
      return {...view(row),environmentId,namespace,created:false,adopted:true,replayed:false};
    });
  }
  return {accept,adoptExisting,forTenant:tenant=>view(byTenant.get(tenant))};
}
module.exports={createCustomerWorkspaceRegistry};
