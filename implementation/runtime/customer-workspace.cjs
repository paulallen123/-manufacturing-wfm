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
    binding_digest TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(provider,event_hash));`);
  for(const table of ['customer_workspaces','customer_workspace_contracts','customer_workspace_events']){
    for(const action of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table}
      BEGIN SELECT RAISE(ABORT,'Customer workspace associations are permanent.'); END;`);
  }
  const byCustomer=db.prepare('SELECT * FROM customer_workspaces WHERE customer_hash=?');
  const byTenant=db.prepare('SELECT * FROM customer_workspaces WHERE tenant=?');
  function view(row){return row?{workspaceId:row.workspace_id,tenant:row.tenant,initialSetupRunId:row.initial_run_id,createdAt:row.created_at}:null;}
  function atomic(fn){
    const sp=db.isTransaction?'customer_workspace_'+randomUUID().replaceAll('-',''):null;
    db.exec(sp?'SAVEPOINT '+sp:'BEGIN IMMEDIATE');
    try{const out=fn();db.exec(sp?'RELEASE '+sp:'COMMIT');return out;}
    catch(error){try{db.exec(sp?'ROLLBACK TO '+sp+'; RELEASE '+sp:'ROLLBACK');}catch{}throw error;}
  }
  function accept(input){
    if(input?.verified!==true||input.ownerAuthorized!==true)fail('Verified customer and owner authority is required.',403);
    const allowed=['verified','ownerAuthorized','customerId','customerAuthorityRef','tenant','provider','eventId','contractRef','relationship','ownerEmail','ownerAuthorityRef','existingWorkspaceId','profile'];
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
  return {accept,forTenant:tenant=>view(byTenant.get(tenant))};
}
module.exports={createCustomerWorkspaceRegistry};
