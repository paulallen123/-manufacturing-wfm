'use strict';
const {createHash,randomUUID}=require('node:crypto');
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
function fail(message,statusCode=409){throw Object.assign(Error(message),{statusCode});}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))fail(label+' is required.',400);return value.trim();}
function isDocuSignProvider(value){return typeof value==='string'&&value.toLowerCase().replace(/[^a-z0-9]/g,'').includes('docusign');}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

// Trusted orchestration only. The HTTP boundary must verify the actual event and
// resolve customer, tenant and owner authority independently of submitted fields.
function createCustomerWorkspaceRegistry({db,createInitialWorkspace,onInvitationBound,onNominationRevoked}){
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
    binding_digest TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customer_workspace_orders(
    id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT NOT NULL,revision INTEGER NOT NULL,
    customer_hash TEXT NOT NULL,tenant TEXT NOT NULL,provider TEXT NOT NULL,envelope_id TEXT NOT NULL,
    nomination_revision INTEGER NOT NULL,nomination_digest TEXT NOT NULL,binding_json TEXT NOT NULL,binding_digest TEXT NOT NULL,
    created_at TEXT NOT NULL,UNIQUE(order_id,revision),UNIQUE(provider,envelope_id));
    CREATE INDEX IF NOT EXISTS customer_workspace_order_customer ON customer_workspace_orders(customer_hash,id DESC);
    CREATE TABLE IF NOT EXISTS customer_workspace_order_revocations(
    customer_hash TEXT PRIMARY KEY,tenant TEXT NOT NULL,nomination_revision INTEGER NOT NULL,reason_hash TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customer_workspace_invitation_bindings(
    invitation_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,order_id TEXT NOT NULL,order_revision INTEGER NOT NULL,
    nomination_revision INTEGER NOT NULL,nomination_digest TEXT NOT NULL,envelope_digest TEXT NOT NULL,created_at TEXT NOT NULL);`);
  for(const table of ['customer_workspaces','customer_workspace_contracts','customer_workspace_events','customer_workspace_adoptions',
    'customer_workspace_orders','customer_workspace_order_revocations','customer_workspace_invitation_bindings']){
    for(const action of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table}
      BEGIN SELECT RAISE(ABORT,'Customer workspace associations are permanent.'); END;`);
  }
  const byCustomer=db.prepare('SELECT * FROM customer_workspaces WHERE customer_hash=?');
  const byTenant=db.prepare('SELECT * FROM customer_workspaces WHERE tenant=?');
  const resolvedBindings=new WeakMap();
  const hasTable=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const orderById=(orderId,revision)=>revision===undefined?
    db.prepare('SELECT * FROM customer_workspace_orders WHERE order_id=? ORDER BY revision DESC LIMIT 1').get(orderId):
    db.prepare('SELECT * FROM customer_workspace_orders WHERE order_id=? AND revision=?').get(orderId,revision);
  const latestNomination=customerHash=>db.prepare('SELECT * FROM customer_workspace_orders WHERE customer_hash=? ORDER BY id DESC LIMIT 1').get(customerHash);
  function authorityRevoked(row){
    if(db.prepare('SELECT 1 FROM customer_workspace_order_revocations WHERE customer_hash=?').get(row.customer_hash))return true;
    return hasTable('organisation_access_initial_authority')&&Boolean(db.prepare("SELECT 1 FROM organisation_access_initial_authority WHERE tenant=? AND state='REVOKED'").get(row.tenant));
  }
  function assertNominationCurrent(row){
    const nomination=row&&latestNomination(row.customer_hash);
    if(!nomination||nomination.nomination_revision!==row.nomination_revision||nomination.nomination_digest!==row.nomination_digest)fail('Stored order nomination is superseded.');
    if(authorityRevoked(row))fail('Stored order nomination authority is revoked.',403);
    return row;
  }
  function assertOrderCurrent(row){
    const head=row&&orderById(row.order_id);
    if(!head||head.revision!==row.revision)fail('Stored order revision is superseded.');
    return assertNominationCurrent(row);
  }
  function notify(callback,input){
    if(typeof callback!=='function')return;
    if(callback.constructor?.name==='AsyncFunction')throw Error('Register authority adapters must be synchronous.');
    if(callback(input)?.then)throw Error('Register authority adapters must be synchronous.');
  }
  function assertResolved(input){
    const receipt=resolvedBindings.get(input);
    if(!receipt)fail('A stored DocuSign order binding is required.',403);
    const row=orderById(receipt.orderId,receipt.revision);
    if(!row||row.binding_digest!==receipt.digest)fail('Stored order binding changed.');
    return assertOrderCurrent(row);
  }
  function invalidateOrderInvitations(customerHash){
    if(!hasTable('implementation_invitations'))return;
    const ids=db.prepare('SELECT b.invitation_id FROM customer_workspace_invitation_bindings b JOIN customer_workspace_orders o ON o.order_id=b.order_id AND o.revision=b.order_revision WHERE o.customer_hash=?').all(customerHash);
    for(const {invitation_id:id}of ids){
      db.prepare("UPDATE implementation_invitations SET status='REVOKED' WHERE id=? AND status='PENDING'").run(id);
      if(hasTable('implementation_notification_outbox'))db.prepare("UPDATE implementation_notification_outbox SET state='BLOCKED' WHERE invitation_id=?").run(id);
    }
  }
  // Trusted VECTOR register writer only: the caller authenticates the customer's
  // order/nomination authority before calling. This is not a webhook/HTTP approval
  // switch, provider verifier, CRM, credential issuer, or recovery authority.
  function recordOrder(input){
    if(!input||input.orderAuthorized!==true||input.ownerAuthorized!==true)fail('Verified order and nomination authority is required.',403);
    const allowed=['orderId','expectedRevision','orderAuthorized','ownerAuthorized','orderAuthorityRef','customerId','customerAuthorityRef','tenant','provider','envelopeId','contractRef','relationship','nominatedSuperUserEmail','nominationAuthorityRef','profile','existingWorkspaceId','operation','existingRunId','existingEnvironmentId','existingNamespace'];
    if(Object.keys(input).some(key=>!allowed.includes(key)))fail('Unsupported stored order fields.',400);
    const orderId=text(input.orderId,180,'Order identity'),envelopeId=text(input.envelopeId,300,'DocuSign envelope');
    if(text(input.provider,120,'Provider').toLowerCase()!=='docusign')fail('Stored order provider must be DocuSign.',400);
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('Expected order revision is required.',400);
    const ownerEmail=text(input.nominatedSuperUserEmail,254,'Nominated super user').toLowerCase();
    if(!/^[^\s@]+@[^\s@]+$/.test(ownerEmail))fail('Nominated super user email is invalid.',400);
    const binding={customerId:text(input.customerId,300,'Customer identity'),customerAuthorityRef:text(input.customerAuthorityRef,300,'Customer authority'),
      tenant:text(input.tenant,120,'Tenant'),provider:'docusign',contractRef:text(input.contractRef,300,'Contract reference'),
      relationship:input.relationship,ownerEmail,ownerAuthorityRef:text(input.nominationAuthorityRef,300,'Nomination authority'),
      profile:input.profile};
    const authorityRef=text(input.orderAuthorityRef,300,'Order authority');
    if(!['initial','renewal','amendment'].includes(binding.relationship))fail('Explicit contract relationship is required.',400);
    for(const field of ['existingWorkspaceId','operation','existingRunId','existingEnvironmentId','existingNamespace'])if(input[field]!==undefined)binding[field]=text(input[field],300,field);
    const customerHash=hash(binding.customerId),nominationDigest=hash(JSON.stringify([customerHash,binding.tenant,ownerEmail,binding.ownerAuthorityRef]));
    const bindingJson=JSON.stringify({binding,authorityRef}),bindingDigest=hash(bindingJson);
    return atomic(()=>{
      const prior=orderById(orderId),nomination=latestNomination(customerHash),tenantOrder=db.prepare('SELECT customer_hash FROM customer_workspace_orders WHERE tenant=? LIMIT 1').get(binding.tenant);
      const workspace=byCustomer.get(customerHash),tenantWorkspace=byTenant.get(binding.tenant);
      if((prior&&(prior.customer_hash!==customerHash||prior.tenant!==binding.tenant))||(nomination&&nomination.tenant!==binding.tenant)||
        (tenantOrder&&tenantOrder.customer_hash!==customerHash)||(workspace&&workspace.tenant!==binding.tenant)||(tenantWorkspace&&tenantWorkspace.customer_hash!==customerHash))fail('Order customer and tenant binding conflicts.');
      if(prior&&prior.revision===input.expectedRevision+1&&prior.binding_digest===bindingDigest&&prior.envelope_id===envelopeId)return orderView(prior);
      if((prior?.revision||0)!==input.expectedRevision)fail('Stale order revision.');
      if(db.prepare('SELECT 1 FROM customer_workspace_orders WHERE provider=? AND envelope_id=?').get('docusign',envelopeId))fail('DocuSign envelope is already bound to an order revision.');
      const nominationChanged=Boolean(nomination&&nomination.nomination_digest!==nominationDigest);
      const nominationRevision=nomination?(nomination.nomination_revision+(nominationChanged?1:0)):1;
      db.prepare('INSERT INTO customer_workspace_orders(order_id,revision,customer_hash,tenant,provider,envelope_id,nomination_revision,nomination_digest,binding_json,binding_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(orderId,input.expectedRevision+1,customerHash,binding.tenant,'docusign',envelopeId,nominationRevision,nominationDigest,bindingJson,bindingDigest,new Date().toISOString());
      if(nominationChanged)invalidateOrderInvitations(customerHash);
      return orderView(orderById(orderId));
    });
  }
  function orderView(row){return {orderId:row.order_id,revision:row.revision,tenant:row.tenant,provider:row.provider,envelopeId:row.envelope_id,
    nominatedSuperUserEmail:JSON.parse(row.binding_json).binding.ownerEmail,nominationRevision:row.nomination_revision};}
  // Read-only trusted authoriseEnvelope seam for a provider verifier. Calling this
  // does not verify a webhook or mint a completion/workspace/invitation receipt.
  function authorizeOrderEnvelope({provider,envelopeId}){
    if(typeof provider!=='string'||provider.trim().toLowerCase()!=='docusign')fail('DocuSign envelope provider is required.',403);
    const row=assertOrderCurrent(db.prepare('SELECT * FROM customer_workspace_orders WHERE provider=? AND envelope_id=?').get('docusign',text(envelopeId,300,'Verified DocuSign envelope')));
    return {...orderView(row),contractId:JSON.parse(row.binding_json).binding.contractRef};
  }
  function resolveCompletedOrder(event){
    if(event?.verified!==true||typeof event.provider!=='string'||event.provider.trim().toLowerCase()!=='docusign'||String(event.status||'').toLowerCase()!=='completed')fail('Verified DocuSign completion is required.',403);
    // The historical verifier normalizes signedAt to canonical UTC. Validate any
    // supplied time before creating a receipt or invoking a workspace adapter.
    if(Object.hasOwn(event,'signedAt')&&(typeof event.signedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.signedAt)||!Number.isFinite(Date.parse(event.signedAt))||new Date(event.signedAt).toISOString()!==event.signedAt))fail('Verified DocuSign signedAt must be a valid canonical UTC timestamp.',400);
    const envelopeId=text(event.envelopeId,300,'Verified DocuSign envelope'),eventId=text(event.eventId,300,'Verified event identity');
    const row=assertOrderCurrent(db.prepare('SELECT * FROM customer_workspace_orders WHERE provider=? AND envelope_id=?').get('docusign',envelopeId));
    const binding=freeze({...JSON.parse(row.binding_json).binding,verified:true,ownerAuthorized:true,eventId,
      orderId:row.order_id,orderRevision:row.revision,nominationRevision:row.nomination_revision,envelopeId:row.envelope_id});
    resolvedBindings.set(binding,{orderId:row.order_id,revision:row.revision,digest:row.binding_digest});
    return binding;
  }
  function resolveSigningBinding(event){
    return isDocuSignProvider(event?.provider)||event?.envelopeId!==undefined||event?.orderId!==undefined?resolveCompletedOrder(event):event;
  }
  function revokeOrderNomination({orderId,expectedRevision,reasonRef}){
    const reasonHash=hash(text(reasonRef,300,'Revocation authority'));
    return atomic(()=>{
      const row=orderById(text(orderId,180,'Order identity'));
      if(!row||row.revision!==expectedRevision)fail('Stale order revision.');
      db.prepare('INSERT OR IGNORE INTO customer_workspace_order_revocations VALUES(?,?,?,?,?)').run(row.customer_hash,row.tenant,row.nomination_revision,reasonHash,new Date().toISOString());
      invalidateOrderInvitations(row.customer_hash);
      const workspace=byCustomer.get(row.customer_hash);
      if(workspace)notify(onNominationRevoked,{tenant:row.tenant,runId:workspace.initial_run_id,reasonRef});
      return {...orderView(row),authority:'REVOKED'};
    });
  }
  function bindOrderInvitation(input,workspace){
    if(!resolvedBindings.has(input)||!hasTable('implementation_invitations'))return;
    const row=assertResolved(input),run=db.prepare('SELECT contract_ref_hash FROM implementation_runs WHERE id=? AND tenant=?').get(workspace.initial_run_id,row.tenant);
    const invitation=db.prepare('SELECT * FROM implementation_invitations WHERE tenant=? AND contract_ref_hash=?').get(row.tenant,run?.contract_ref_hash);
    if(!invitation)return;
    if(input.operation==='adopt-existing'&&invitation.contract_ref_hash!==hash(input.contractRef))return;
    // A renewal cannot nominate a replacement owner through an initial invitation.
    if(invitation.recipient_hash!==hash(input.ownerEmail)&&input.relationship!=='initial')return;
    if(invitation.recipient_hash!==hash(input.ownerEmail)||(invitation.started_run_id&&invitation.started_run_id!==workspace.initial_run_id))fail('Stored order invitation binding conflicts.');
    const values=[invitation.id,workspace.workspace_id,row.order_id,row.revision,row.nomination_revision,row.nomination_digest,hash(row.envelope_id)];
    const existing=db.prepare('SELECT * FROM customer_workspace_invitation_bindings WHERE invitation_id=?').get(invitation.id);
    if(existing){if(existing.workspace_id!==workspace.workspace_id||existing.nomination_revision!==row.nomination_revision||existing.nomination_digest!==row.nomination_digest)fail('Invitation cannot be rebound to another nomination.');return;}
    db.prepare('INSERT INTO customer_workspace_invitation_bindings VALUES(?,?,?,?,?,?,?,?)').run(...values,new Date().toISOString());
    if(input.operation!=='adopt-existing')notify(onInvitationBound,{invitation,binding:input});
  }
  function invitationCurrent(invitation){
    const binding=db.prepare('SELECT * FROM customer_workspace_invitation_bindings WHERE invitation_id=?').get(invitation.id);
    if(!binding)return !(hasTable('organisation_access_setup')&&isDocuSignProvider(db.prepare('SELECT provider FROM organisation_access_setup WHERE tenant=? AND contract_hash=?').get(invitation.tenant,invitation.contract_ref_hash)?.provider));
    try{
      const row=assertNominationCurrent(orderById(binding.order_id,binding.order_revision)),workspace=byCustomer.get(row.customer_hash),stored=JSON.parse(row.binding_json).binding;
      return workspace?.workspace_id===binding.workspace_id&&workspace.tenant===invitation.tenant&&binding.nomination_revision===row.nomination_revision&&binding.nomination_digest===row.nomination_digest&&binding.envelope_digest===hash(row.envelope_id)&&
        invitation.contract_ref_hash===hash(stored.contractRef)&&invitation.recipient_hash===hash(stored.ownerEmail)&&(!invitation.started_run_id||invitation.started_run_id===workspace.initial_run_id);
    }catch{return false;}
  }
  function ownerAuthorityRevoked({tenant,email}){
    if(!db.prepare('SELECT 1 FROM customer_workspace_order_revocations WHERE tenant=?').get(tenant))return false;
    const owner=String(email||'').trim().toLowerCase();
    return db.prepare('SELECT binding_json FROM customer_workspace_orders WHERE tenant=?').all(tenant).some(row=>JSON.parse(row.binding_json).binding.ownerEmail===owner);
  }
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
    if(isDocuSignProvider(input.provider)&&!resolvedBindings.has(input))fail('A stored DocuSign order binding is required.',403);
    const allowed=['verified','ownerAuthorized','customerId','customerAuthorityRef','tenant','provider','eventId','contractRef','relationship','ownerEmail','ownerAuthorityRef','existingWorkspaceId','profile'];
    if(resolvedBindings.has(input))allowed.push('orderId','orderRevision','nominationRevision','envelopeId');
    if(adoption)allowed.push('operation','existingRunId','existingEnvironmentId','existingNamespace');
    if(Object.keys(input).some(key=>!allowed.includes(key)))fail('Unsupported workspace binding fields.',400);
    const customerHash=hash(text(input.customerId,300,'Customer identity')),tenant=text(input.tenant,120,'Tenant');
    const provider=text(input.provider,120,'Provider'),eventHash=hash(text(input.eventId,300,'Event identity'));
    if(!/^[A-Za-z0-9_.:-]+$/.test(provider))fail('Provider identity is invalid.',400);
    const contractRef=text(input.contractRef,300,'Contract reference'),contractHash=hash(contractRef);
    const ownerEmail=text(input.ownerEmail,254,'Owner email').toLowerCase();
    if(!/^[^\s@]+@[^\s@]+$/.test(ownerEmail))fail('Owner email is invalid.',400);
    const ownerAuthorityRef=text(input.ownerAuthorityRef,300,'Owner authority'),customerAuthorityRef=text(input.customerAuthorityRef,300,'Customer authority');
    const relationship=input.relationship;
    if(!['initial','renewal','amendment'].includes(relationship))fail('Explicit contract relationship is required.',400);
    const bindingDigest=hash(JSON.stringify([customerHash,tenant,provider,contractHash,ownerEmail,ownerAuthorityRef,customerAuthorityRef,relationship,
      ...(resolvedBindings.has(input)?[input.orderId,input.orderRevision,input.nominationRevision,input.envelopeId]:[])]));
    return {customerHash,tenant,provider,eventHash,contractRef,contractHash,ownerEmail,bindingDigest,relationship};
  }
  function accept(input){
    const {customerHash,tenant,provider,eventHash,contractRef,contractHash,ownerEmail,bindingDigest,relationship}=validated(input);
    return atomic(()=>{
      if(resolvedBindings.has(input))assertResolved(input);
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
      bindOrderInvitation(input,row);
      return {...view(row),created,replayed:Boolean(event)};
    });
  }
  function adoptExisting(input){
    const {customerHash,tenant,provider,eventHash,contractHash,ownerEmail,bindingDigest,relationship}=validated(input,true);
    if(input.operation!=='adopt-existing'||input.existingWorkspaceId||input.profile)fail('An explicit existing-tuple adoption is required.',400);
    const runId=text(input.existingRunId,300,'Existing run'),environmentId=text(input.existingEnvironmentId,300,'Existing environment'),namespace=text(input.existingNamespace,300,'Existing namespace');
    const adoptionDigest=hash(JSON.stringify([bindingDigest,runId,environmentId,namespace]));
    return atomic(()=>{
      if(resolvedBindings.has(input))assertResolved(input);
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
      bindOrderInvitation(input,row);
      return {...view(row),environmentId,namespace,created:false,adopted:true,replayed:false};
    });
  }
  return {accept,adoptExisting,recordOrder,authorizeOrderEnvelope,resolveCompletedOrder,resolveSigningBinding,revokeOrderNomination,invitationCurrent,ownerAuthorityRevoked,forTenant:tenant=>view(byTenant.get(tenant))};
}
module.exports={createCustomerWorkspaceRegistry};
