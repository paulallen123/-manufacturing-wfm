import {createHash} from 'node:crypto';
import {validateConnectionEvidence} from './connection-test-plan.mjs';
import {buildCanonicalStagingCommand} from './provider-ingestion-gate.mjs';

function required(value,name){
  if(typeof value!=='string'||!value.trim()) throw new TypeError(`${name} is required`);
  const text=value.normalize('NFC').trim();
  if(text.includes('\0')) throw new TypeError(`${name} contains NUL`);
  return text;
}
function safeInt(value,name,min,max,defaultValue){
  const raw=value===undefined?defaultValue:value;
  const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<min||n>max) throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  return n;
}
function plain(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)) throw new TypeError(`${name} must be a plain object`);
  return value;
}
function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
function sortedUnique(values,name){
  if(!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  return [...new Set(values.map((v,i)=>required(v,`${name}[${i}]`)))].sort();
}
function assertContract(contract){
  plain(contract,'contract');
  if(contract.schemaVersion!==1||!contract.binding||!contract.provider||!contract.bindingHash) throw new TypeError('valid universal connector contract is required');
}
function assertBound(contract,providerId,tenantId,connectionId,label){
  if(providerId!==contract.provider.id||tenantId!==contract.binding.tenantId||connectionId!==contract.binding.connectionId){
    const error=new Error(`${label} is not bound to the connector contract`);
    error.code='WFM_ACTIVATION_BINDING_MISMATCH';
    throw error;
  }
}
function assertHealth(healthState,contract,now,maxHealthAgeMs){
  plain(healthState,'healthState');
  const b=plain(healthState.binding,'healthState.binding');
  assertBound(contract,b.providerId,b.tenantId,b.connectionId,'health state');
  if(healthState.state!=='healthy'){
    const error=new Error(`connector health is not healthy: ${healthState.state}`);
    error.code='WFM_ACTIVATION_HEALTH_NOT_READY';
    throw error;
  }
  const checked=Date.parse(required(healthState.checkedAt,'healthState.checkedAt'));
  if(!Number.isFinite(checked)||checked>now+60_000||now-checked>maxHealthAgeMs){
    const error=new Error('connector health evidence is stale or invalid');
    error.code='WFM_ACTIVATION_HEALTH_STALE';
    throw error;
  }
  if(healthState.writeRecoveryAllowed!==false) throw new Error('health state must not carry write-recovery authority');
}
function assertAcquisition(acquisition,contract){
  plain(acquisition,'acquisition');
  assertBound(contract,acquisition.providerId,acquisition.tenantId,acquisition.connectionId,'acquisition');
  if(acquisition.status!=='SAFE_TO_STAGE'||acquisition.reconciliation?.safeToCommit!==true||acquisition.reconciliation?.safeToAdvanceWatermark!==true||!acquisition.checkpointCandidate){
    const error=new Error('activation requires a fully reconciled acquisition');
    error.code='WFM_ACTIVATION_ACQUISITION_NOT_READY';
    throw error;
  }
  required(acquisition.mappingFingerprint,'acquisition.mappingFingerprint');
  sortedUnique(acquisition.schemaFingerprints,'acquisition.schemaFingerprints');
  if(acquisition.customerProofClaimAllowed!==false||acquisition.deletionAuthority!==false) throw new Error('acquisition contains forbidden inherited authority');
}
function assertStaged(staged,acquisition,contract){
  plain(staged,'staged');
  if(staged.status!=='STAGED_VERIFIED'){
    const error=new Error('activation requires independently verified canonical staging');
    error.code='WFM_ACTIVATION_STAGE_NOT_VERIFIED';
    throw error;
  }
  const command=buildCanonicalStagingCommand(acquisition,contract);
  if(staged.batchDigest!==command.batchDigest||
     staged.mappingFingerprint!==command.mappingFingerprint||
     canonical(staged.schemaFingerprints)!==canonical(command.schemaFingerprints)||
     staged.rowCount!==command.rowCount||
     staged.checkpointToCommit?.watermark!==command.checkpointCandidate?.watermark){
    const error=new Error('verified staging result does not match the acquisition being activated');
    error.code='WFM_ACTIVATION_STAGE_MISMATCH';
    throw error;
  }
  if(staged.customerProofClaimAllowed!==false||staged.deletionAuthority!==false) throw new Error('staged result contains forbidden inherited authority');
}
function activationMaterial({contract,connectionPlan,acquisition,staged,issuedAt,expiresAt}){
  return {
    schemaVersion:1,
    binding:{
      providerId:contract.provider.id,
      tenantId:contract.binding.tenantId,
      connectionId:contract.binding.connectionId,
      target:acquisition.target,
      contractBindingHash:contract.bindingHash
    },
    sourceInstanceId:connectionPlan.configuration.sourceInstanceId,
    endpointHost:connectionPlan.configuration.endpointHost,
    environment:connectionPlan.configuration.environment,
    configurationFingerprint:connectionPlan.configurationFingerprint,
    mappingFingerprint:acquisition.mappingFingerprint,
    schemaFingerprints:sortedUnique(acquisition.schemaFingerprints,'acquisition.schemaFingerprints'),
    lastVerifiedBatchDigest:staged.batchDigest,
    checkpointNamespace:staged.checkpointToCommit.scopeNamespace,
    checkpointWatermark:staged.checkpointToCommit.watermark,
    issuedAt,
    expiresAt
  };
}

export function createReadActivation({
  contract,connectionPlan,connectionEvidence,acquisition,staged,healthState,
  nowMs=Date.now(),leaseMs=24*60*60*1000,maxConnectionAgeMs=30*60*1000,maxHealthAgeMs=5*60*1000
}={}){
  assertContract(contract);
  const now=safeInt(nowMs,'nowMs',0,Number.MAX_SAFE_INTEGER,Date.now());
  const lease=safeInt(leaseMs,'leaseMs',60_000,7*24*60*60*1000,24*60*60*1000);
  const connectionAge=safeInt(maxConnectionAgeMs,'maxConnectionAgeMs',60_000,24*60*60*1000,30*60*1000);
  const healthAge=safeInt(maxHealthAgeMs,'maxHealthAgeMs',1_000,60*60*1000,5*60*1000);
  if(!connectionPlan?.configuration) throw new TypeError('connectionPlan is required');
  if(connectionPlan.configuration.providerKey!==contract.provider.id||
     connectionPlan.configuration.wfmTenantId!==contract.binding.tenantId||
     connectionPlan.configuration.connectionId!==contract.binding.connectionId){
    const error=new Error('connection plan is not bound to connector contract');
    error.code='WFM_ACTIVATION_BINDING_MISMATCH';
    throw error;
  }
  const connection=validateConnectionEvidence(connectionPlan,connectionEvidence,{nowMs:now,maxAgeMs:connectionAge});
  if(!['CONNECTION_VERIFIED','CONNECTION_AND_SAMPLE_VERIFIED'].includes(connection.status)){
    const error=new Error(`connection proof rejected: ${connection.reasons.join(', ')}`);
    error.code='WFM_ACTIVATION_CONNECTION_NOT_VERIFIED';
    error.reasons=connection.reasons;
    throw error;
  }
  assertAcquisition(acquisition,contract);
  assertStaged(staged,acquisition,contract);
  assertHealth(healthState,contract,now,healthAge);

  const issuedAt=new Date(now).toISOString();
  const expiresAt=new Date(now+lease).toISOString();
  const material=activationMaterial({contract,connectionPlan,acquisition,staged,issuedAt,expiresAt});
  return freeze({
    ...material,
    activationFingerprint:'sha256:'+sha256(material),
    state:'READ_ACTIVE',
    readEnabled:true,
    writeEnabled:false,
    destructiveAuthority:false,
    deletionAuthority:false,
    customerProofClaimAllowed:false,
    zeroHumanMonitoringRequired:true,
    recertificationRequired:false
  });
}

export function authorizeActivatedRead(activation,{providerId,tenantId,connectionId,target,nowMs=Date.now()}={}){
  plain(activation,'activation');
  if(activation.state!=='READ_ACTIVE'||activation.readEnabled!==true||activation.writeEnabled!==false){
    const error=new Error('connector read activation is not active');
    error.code='WFM_READ_ACTIVATION_INACTIVE';
    throw error;
  }
  const now=safeInt(nowMs,'nowMs',0,Number.MAX_SAFE_INTEGER,Date.now());
  if(Date.parse(activation.expiresAt)<=now){
    const error=new Error('connector read activation lease expired');
    error.code='WFM_READ_ACTIVATION_EXPIRED';
    throw error;
  }
  if(providerId!==activation.binding.providerId||tenantId!==activation.binding.tenantId||connectionId!==activation.binding.connectionId||target!==activation.binding.target){
    const error=new Error('read request does not match active connector binding');
    error.code='WFM_READ_ACTIVATION_BINDING_MISMATCH';
    throw error;
  }
  return true;
}

export function assessReadRecertification(activation,{
  healthState,configurationFingerprint,mappingFingerprint,schemaFingerprints,nowMs=Date.now(),maxHealthAgeMs=5*60*1000
}={}){
  plain(activation,'activation');
  const now=safeInt(nowMs,'nowMs',0,Number.MAX_SAFE_INTEGER,Date.now());
  const reasons=[];
  if(activation.state!=='READ_ACTIVE'||activation.readEnabled!==true) reasons.push('activation-not-active');
  if(Date.parse(activation.expiresAt)<=now) reasons.push('activation-expired');
  if(configurationFingerprint!==activation.configurationFingerprint) reasons.push('connection-configuration-changed');
  if(mappingFingerprint!==activation.mappingFingerprint) reasons.push('mapping-changed');
  const currentSchemas=sortedUnique(schemaFingerprints||[],'schemaFingerprints');
  if(canonical(currentSchemas)!==canonical(activation.schemaFingerprints)) reasons.push('schema-changed');
  try{
    const binding=healthState?.binding;
    if(!binding||
       binding.providerId!==activation.binding.providerId||
       binding.tenantId!==activation.binding.tenantId||
       binding.connectionId!==activation.binding.connectionId) reasons.push('health-binding-changed');
    else if(healthState.state!=='healthy') reasons.push(`health-${healthState.state}`);
    else{
      const checked=Date.parse(healthState.checkedAt);
      if(!Number.isFinite(checked)||checked>now+60_000||now-checked>maxHealthAgeMs) reasons.push('health-stale');
    }
  }catch{reasons.push('health-invalid');}
  return freeze({
    status:reasons.length?'REPROOF_REQUIRED':'ACTIVE',
    reasons,
    readEnabled:reasons.length===0,
    writeEnabled:false,
    customerProofClaimAllowed:false
  });
}
