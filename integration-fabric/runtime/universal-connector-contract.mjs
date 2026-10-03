import crypto from 'node:crypto';

const VERBS=new Set(['read','write','subscribe','execute']);

function requiredString(value,name){
  if(typeof value!=='string'||!value.trim()) throw new TypeError(`${name} is required`);
  const text=value.normalize('NFC').trim();
  if(text.includes('\0')) throw new TypeError(`${name} contains NUL`);
  return text;
}

function stringList(value,name){
  if(!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return Object.freeze([...new Set(value.map((item,index)=>requiredString(item,`${name}[${index}]`)))]);
}

function plainObject(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)){
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function canonicalJson(value){
  if(Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object'){
    return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function bindingHash(binding){
  return crypto.createHash('sha256').update(canonicalJson(binding)).digest('hex');
}

function freezeDeep(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function transportContracts(connector){
  if(!Array.isArray(connector.adapters)) throw new TypeError('connector adapters must be an array');
  return connector.adapters.map(adapter=>{
    plainObject(adapter,'adapter');
    return {
      profileId:requiredString(adapter.id,'adapter.id'),
      adapter:requiredString(adapter.adapter,'adapter.adapter'),
      transport:requiredString(adapter.transport,'adapter.transport'),
      supports:stringList(adapter.supports||[],'adapter.supports')
    };
  });
}

function resourceContracts(connector){
  const targets=stringList(connector.canonicalTargets||[],'connector.canonicalTargets');
  if(!targets.length) throw new TypeError('connector requires at least one canonical target');
  return targets.map(target=>({
    target,
    allowedVerbs:['read'],
    writeAuthority:null
  }));
}

function safeSecurity(connector){
  const security=plainObject(connector.security||{},'connector.security');
  if(security.readOnlyDefault!==true) throw new Error('connector must be read-only by default');
  if(security.arbitraryEndpointAllowed!==false) throw new Error('arbitrary endpoints must remain disabled');
  if(security.crossHostRedirectAllowed!==false) throw new Error('cross-host redirects must remain disabled');
  return {
    readOnlyDefault:true,
    arbitraryEndpointAllowed:false,
    crossHostRedirectAllowed:false,
    directPlantNetworkAccess:security.directPlantNetworkAccess===true,
    customerEdgeRequired:security.customerEdgeRequired===true,
    writeEnabled:false
  };
}

export function compileUniversalConnectorContract(connector,{tenantId,connectionId,region='default'}={}){
  plainObject(connector,'connector');
  const providerId=requiredString(connector.id,'connector.id');
  const binding={
    tenantId:requiredString(tenantId,'tenantId'),
    connectionId:requiredString(connectionId,'connectionId'),
    providerId,
    region:requiredString(region,'region')
  };
  const contract={
    schemaVersion:1,
    binding,
    bindingHash:bindingHash(binding),
    provider:{
      id:providerId,
      name:requiredString(connector.name,'connector.name'),
      category:requiredString(connector.category,'connector.category')
    },
    transports:transportContracts(connector),
    resources:resourceContracts(connector),
    discoveryStrategy:requiredString(connector.discoveryStrategy,'connector.discoveryStrategy'),
    proof:{
      evidenceLevel:requiredString(connector.evidenceLevel,'connector.evidenceLevel'),
      nextEvidenceGate:requiredString(connector.nextEvidenceGate,'connector.nextEvidenceGate')
    },
    security:safeSecurity(connector)
  };
  return freezeDeep(contract);
}

function resourceFor(contract,target){
  const resource=contract.resources.find(entry=>entry.target===target);
  if(!resource){
    const error=new Error(`canonical target is not exposed by connector: ${target}`);
    error.code='WFM_CONNECTOR_TARGET_UNAVAILABLE';
    throw error;
  }
  return resource;
}

function assertBinding(contract,{tenantId,connectionId,providerId}={}){
  const actual={
    tenantId:requiredString(tenantId,'tenantId'),
    connectionId:requiredString(connectionId,'connectionId'),
    providerId:requiredString(providerId??contract.provider.id,'providerId'),
    region:contract.binding.region
  };
  if(bindingHash(actual)!==contract.bindingHash){
    const error=new Error('connector execution binding mismatch');
    error.code='WFM_CONNECTOR_BINDING_MISMATCH';
    throw error;
  }
}

export function assertConnectorOperation(contract,{tenantId,connectionId,providerId,target,verb}={}){
  plainObject(contract,'contract');
  assertBinding(contract,{tenantId,connectionId,providerId});
  const normalizedTarget=requiredString(target,'target');
  const normalizedVerb=requiredString(verb,'verb');
  if(!VERBS.has(normalizedVerb)) throw new TypeError(`unsupported connector verb: ${normalizedVerb}`);
  const resource=resourceFor(contract,normalizedTarget);
  if(!resource.allowedVerbs.includes(normalizedVerb)){
    const error=new Error(`connector operation is not authorised: ${normalizedTarget}.${normalizedVerb}`);
    error.code=normalizedVerb==='write'?'WFM_CONNECTOR_WRITE_NOT_AUTHORISED':'WFM_CONNECTOR_OPERATION_NOT_AUTHORISED';
    throw error;
  }
  return true;
}

function validateProofAuthority(contract,target,authority,now){
  plainObject(authority,'authority');
  const required=['tenantId','connectionId','providerId','target','candidateSha','runId','receiptId','status','expiresAt'];
  for(const field of required){
    if(field==='expiresAt') continue;
    requiredString(authority[field],`authority.${field}`);
  }
  if(authority.status!=='PROVEN') throw new Error('write authority requires PROVEN evidence');
  if(authority.tenantId!==contract.binding.tenantId||
     authority.connectionId!==contract.binding.connectionId||
     authority.providerId!==contract.provider.id||
     authority.target!==target){
    const error=new Error('write authority is not bound to this connector target');
    error.code='WFM_CONNECTOR_WRITE_AUTHORITY_MISMATCH';
    throw error;
  }
  if(!Number.isSafeInteger(authority.expiresAt)||authority.expiresAt<=now){
    const error=new Error('write authority is expired or invalid');
    error.code='WFM_CONNECTOR_WRITE_AUTHORITY_EXPIRED';
    throw error;
  }
  return {
    candidateSha:authority.candidateSha,
    runId:authority.runId,
    receiptId:authority.receiptId,
    expiresAt:authority.expiresAt
  };
}

export function promoteConnectorWrite(contract,{target,authority,now=Date.now()}={}){
  plainObject(contract,'contract');
  if(!Number.isSafeInteger(now)||now<0) throw new TypeError('now must be a non-negative safe integer');
  const normalizedTarget=requiredString(target,'target');
  resourceFor(contract,normalizedTarget);
  const proof=validateProofAuthority(contract,normalizedTarget,authority,now);

  const promoted=structuredClone(contract);
  const resource=promoted.resources.find(entry=>entry.target===normalizedTarget);
  resource.allowedVerbs=[...new Set([...resource.allowedVerbs,'write'])];
  resource.writeAuthority=proof;
  promoted.security.writeEnabled=promoted.resources.some(entry=>entry.allowedVerbs.includes('write'));
  return freezeDeep(promoted);
}

export function revokeConnectorWrites(contract){
  plainObject(contract,'contract');
  const revoked=structuredClone(contract);
  for(const resource of revoked.resources){
    resource.allowedVerbs=resource.allowedVerbs.filter(verb=>verb!=='write');
    resource.writeAuthority=null;
  }
  revoked.security.writeEnabled=false;
  return freezeDeep(revoked);
}
