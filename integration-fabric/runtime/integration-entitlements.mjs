function fail(message,code='WFM_INTEGRATION_ENTITLEMENT_INVALID'){const e=new Error(message);e.code=code;throw e;}
function text(value,name,max=256){
  if(typeof value!=='string'||!value.trim())fail(name+' is required');
  const v=value.normalize('NFC').trim();
  if(v.length>max||/[\u0000-\u001f\u007f]/.test(v))fail(name+' is invalid');
  return v;
}
function integer(value,name,min,max){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max)fail(name+' is outside supported bounds');
  return n;
}
function plain(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))fail(name+' must be a plain object');
  return value;
}
function instantOrNull(value,name){
  if(value===null||value===undefined||value==='')return null;
  const v=text(value,name,40),ms=Date.parse(v);
  if(!Number.isFinite(ms))fail(name+' must be an ISO timestamp');
  return new Date(ms).toISOString();
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

export function createIntegrationEntitlement({
  tenantId,entitlementId,revision,baseConnections,connectionPacks=[]
}={}){
  const tenant=text(tenantId,'tenantId',128);
  const id=text(entitlementId,'entitlementId',128);
  const rev=integer(revision,'revision',1,1_000_000_000);
  const base=integer(baseConnections,'baseConnections',0,100_000);
  if(!Array.isArray(connectionPacks)||connectionPacks.length>1000)fail('connectionPacks must be an array of at most 1000 packs');
  const seen=new Set();
  const packs=connectionPacks.map((raw,index)=>{
    const p=plain(raw,'connectionPacks['+index+']');
    const packId=text(p.packId,'connectionPacks['+index+'].packId',128);
    if(seen.has(packId))fail('duplicate connection pack: '+packId);
    seen.add(packId);
    return {
      packId,
      connections:integer(p.connections,'connectionPacks['+index+'].connections',1,100_000),
      startsAt:instantOrNull(p.startsAt,'connectionPacks['+index+'].startsAt'),
      expiresAt:instantOrNull(p.expiresAt,'connectionPacks['+index+'].expiresAt'),
      enabled:p.enabled!==false
    };
  });
  for(const p of packs){
    if(p.startsAt&&p.expiresAt&&Date.parse(p.startsAt)>=Date.parse(p.expiresAt))fail('connection pack start must precede expiry');
  }
  return freeze({
    schemaVersion:1,tenantId:tenant,entitlementId:id,revision:rev,
    baseConnections:base,connectionPacks:packs
  });
}
export function integrationCapacity(entitlement,{nowMs=Date.now()}={}){
  plain(entitlement,'entitlement');
  const now=Number(nowMs);
  if(!Number.isSafeInteger(now)||now<0)fail('nowMs is invalid');
  let additional=0;
  const activePacks=[];
  for(const p of entitlement.connectionPacks||[]){
    if(p.enabled!==true)continue;
    if(p.startsAt&&Date.parse(p.startsAt)>now)continue;
    if(p.expiresAt&&Date.parse(p.expiresAt)<=now)continue;
    additional+=p.connections;
    activePacks.push(p.packId);
  }
  return freeze({
    baseConnections:entitlement.baseConnections,
    additionalConnections:additional,
    totalConnections:entitlement.baseConnections+additional,
    activePackIds:activePacks
  });
}
function normalizeActiveConnections(value,tenantId){
  if(!Array.isArray(value))fail('activeConnections must be an array');
  const ids=new Set();
  return value.map((raw,index)=>{
    const c=plain(raw,'activeConnections['+index+']');
    if(c.tenantId!==tenantId)fail('active connection belongs to another tenant','WFM_INTEGRATION_ENTITLEMENT_TENANT_MISMATCH');
    const connectionId=text(c.connectionId,'activeConnections['+index+'].connectionId',128);
    if(ids.has(connectionId))fail('duplicate active connection: '+connectionId);
    ids.add(connectionId);
    return {
      tenantId,connectionId,providerId:text(c.providerId,'activeConnections['+index+'].providerId',128),
      state:text(c.state||'active','activeConnections['+index+'].state',32)
    };
  }).filter(c=>c.state==='active');
}
function assertCertification(certification,providerId){
  plain(certification,'certification');
  if(certification.providerId!==providerId)fail('connector certification provider mismatch','WFM_INTEGRATION_CERTIFICATION_MISMATCH');
  if(certification.customerSelectable!==true||certification.readProven!==true){
    fail('connector has not earned customer-selectable provider-read proof','WFM_INTEGRATION_CONNECTOR_NOT_CERTIFIED');
  }
  if(!['PROVIDER_READ_PROVEN','PROVIDER_WRITE_PROVEN','PRODUCTION_CERTIFIED'].includes(certification.state)){
    fail('connector certification state is not selectable','WFM_INTEGRATION_CONNECTOR_NOT_CERTIFIED');
  }
}

export function authorizeIntegrationActivation({
  entitlement,certification,activeConnections,requested,nowMs=Date.now()
}={}){
  plain(entitlement,'entitlement');
  const tenantId=text(entitlement.tenantId,'entitlement.tenantId',128);
  const req=plain(requested,'requested');
  if(req.tenantId!==tenantId)fail('requested integration belongs to another tenant','WFM_INTEGRATION_ENTITLEMENT_TENANT_MISMATCH');
  const connectionId=text(req.connectionId,'requested.connectionId',128);
  const providerId=text(req.providerId,'requested.providerId',128);
  const active=normalizeActiveConnections(activeConnections||[],tenantId);
  const existing=active.find(c=>c.connectionId===connectionId);
  if(existing){
    if(existing.providerId!==providerId)fail('connection id already belongs to another provider','WFM_INTEGRATION_CONNECTION_ID_CONFLICT');
    return freeze({
      status:'ALREADY_ACTIVE',tenantId,connectionId,providerId,
      capacity:integrationCapacity(entitlement,{nowMs}),activeConnections:active.length,
      consumesAdditionalSlot:false,readEnabled:true,
      writeEnabled:certification?.writeProven===true,
      customerProofClaimAllowed:false
    });
  }
  assertCertification(certification,providerId);
  const capacity=integrationCapacity(entitlement,{nowMs});
  if(active.length>=capacity.totalConnections){
    return freeze({
      status:active.length>capacity.totalConnections?'OVER_CAPACITY_NO_NEW_CONNECTIONS':'CAPACITY_REACHED',
      tenantId,connectionId,providerId,capacity,activeConnections:active.length,
      allowed:false,consumesAdditionalSlot:false,readEnabled:false,writeEnabled:false,
      customerProofClaimAllowed:false
    });
  }
  return freeze({
    status:'ACTIVATION_AUTHORISED',tenantId,connectionId,providerId,capacity,
    activeConnectionsBefore:active.length,activeConnectionsAfter:active.length+1,
    allowed:true,consumesAdditionalSlot:true,readEnabled:true,
    writeEnabled:certification.writeProven===true,
    productionCertified:certification.productionCertified===true,
    customerProofClaimAllowed:false
  });
}
