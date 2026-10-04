import {createHash} from 'node:crypto';
import {validateConnectionEvidence} from './connection-test-plan.mjs';
import {buildCanonicalStagingCommand} from './provider-ingestion-gate.mjs';

function fail(message,code='WFM_PROVIDER_PROOF_INVALID'){const e=new Error(message);e.code=code;throw e;}
function text(value,name,max=256){
  if(typeof value!=='string'||!value.trim())fail(name+' is required');
  const v=value.normalize('NFC').trim();
  if(v.length>max||/[\u0000-\u001f\u007f]/.test(v))fail(name+' is invalid');
  return v;
}
function plain(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))fail(name+' must be a plain object');
  return value;
}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const digest=value=>'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function instant(value,name){
  const v=text(value,name,40),ms=Date.parse(v);
  if(!Number.isFinite(ms))fail(name+' is not a valid timestamp');
  return new Date(ms).toISOString();
}
function sha(value,name){
  const v=text(value,name,80);
  if(!/^[a-f0-9]{40}$/.test(v))fail(name+' must be a full 40-character git SHA');
  return v;
}
function schemaFingerprints(value){
  if(!Array.isArray(value)||!value.length)fail('schemaFingerprints must contain at least one fingerprint');
  const list=[...new Set(value.map((v,i)=>{
    const x=text(v,'schemaFingerprints['+i+']',80);
    if(!/^[a-f0-9]{64}$/.test(x))fail('schema fingerprint must be 64 hex');
    return x;
  }))].sort();
  return list;
}
function assertContract(contract){
  plain(contract,'contract');
  if(contract.schemaVersion!==1||!contract.binding||!contract.provider||!contract.bindingHash)fail('valid connector contract is required');
}
function assertBinding(contract,value,label){
  plain(value,label);
  if(value.providerId!==contract.provider.id||
     value.tenantId!==contract.binding.tenantId||
     value.connectionId!==contract.binding.connectionId){
    fail(label+' does not match connector binding','WFM_PROVIDER_PROOF_BINDING_MISMATCH');
  }
}
function assertAcquisition(contract,acquisition){
  plain(acquisition,'acquisition');
  assertBinding(contract,acquisition,'acquisition');
  if(acquisition.status!=='SAFE_TO_STAGE'||
     acquisition.reconciliation?.safeToCommit!==true||
     acquisition.reconciliation?.safeToAdvanceWatermark!==true||
     !acquisition.checkpointCandidate){
    fail('provider acquisition has not passed complete reconciliation','WFM_PROVIDER_PROOF_ACQUISITION_NOT_PROVEN');
  }
  if(acquisition.deletionAuthority!==false||acquisition.customerProofClaimAllowed!==false){
    fail('provider acquisition carries forbidden inherited authority');
  }
  if(!Array.isArray(acquisition.records))fail('provider acquisition records are required');
  const mappingFingerprint=text(acquisition.mappingFingerprint,'acquisition.mappingFingerprint',80);
  if(!/^sha256:[a-f0-9]{64}$/.test(mappingFingerprint))fail('acquisition mapping fingerprint is invalid');
  return {
    target:text(acquisition.target,'acquisition.target',128),
    dataset:text(acquisition.dataset,'acquisition.dataset',128),
    runId:text(acquisition.runId,'acquisition.runId',128),
    mappingFingerprint,
    schemaFingerprints:schemaFingerprints(acquisition.schemaFingerprints),
    sourceWatermark:text(acquisition.sourceWatermark,'acquisition.sourceWatermark',96),
    rowCount:acquisition.records.length
  };
}
function assertStage(contract,acquisition,staged){
  plain(staged,'staged');
  if(staged.status!=='STAGED_VERIFIED')fail('canonical staging is not independently verified','WFM_PROVIDER_PROOF_STAGE_NOT_PROVEN');
  const command=buildCanonicalStagingCommand(acquisition,contract);
  if(staged.batchDigest!==command.batchDigest||
     staged.rowCount!==command.rowCount||
     staged.mappingFingerprint!==command.mappingFingerprint||
     canonical(staged.schemaFingerprints)!==canonical(command.schemaFingerprints)||
     staged.checkpointToCommit?.watermark!==command.checkpointCandidate?.watermark){
    fail('staged provider batch does not match reconciled acquisition','WFM_PROVIDER_PROOF_STAGE_MISMATCH');
  }
  if(staged.deletionAuthority!==false||staged.customerProofClaimAllowed!==false)fail('staging result carries forbidden authority');
  return {
    route:text(staged.route,'staged.route',128),
    batchDigest:text(staged.batchDigest,'staged.batchDigest',80),
    rowCount:staged.rowCount,
    checkpointWatermark:text(staged.checkpointToCommit.watermark,'staged.checkpointToCommit.watermark',96)
  };
}
function assertRecovery(contract,recovery){
  plain(recovery,'recovery');
  assertBinding(contract,recovery,'recovery');
  if(recovery.status!=='RECOVERED_VERIFIED')fail('provider recovery has not been independently verified','WFM_PROVIDER_PROOF_RECOVERY_NOT_PROVEN');
  if(recovery.readOnly!==true||
     recovery.reconciliationVerified!==true||
     recovery.writeRecoveryPerformed!==false||
     recovery.businessMutationAllowed!==false){
    fail('provider recovery proof widened authority','WFM_PROVIDER_PROOF_RECOVERY_AUTHORITY_INVALID');
  }
  return {
    receiptId:text(recovery.receiptId,'recovery.receiptId',256),
    observedAt:instant(recovery.observedAt,'recovery.observedAt'),
    configurationFingerprint:text(recovery.configurationFingerprint,'recovery.configurationFingerprint',128)
  };
}
function proofBinding(raw,contract){
  const b=plain(raw,'proofBinding');
  return {
    candidateSha:sha(b.candidateSha,'proofBinding.candidateSha'),
    deploymentId:text(b.deploymentId,'proofBinding.deploymentId',256),
    proofRunId:text(b.proofRunId,'proofBinding.proofRunId',256),
    providerId:contract.provider.id,
    tenantId:contract.binding.tenantId,
    connectionId:contract.binding.connectionId
  };
}

export async function runExternalProviderReadProof({
  contract,proofBinding:bindingInput,connectionPlan,connectionEvidence,
  acquireProvider,stageProvider,recoverProvider,verifyProof,
  nowMs=Date.now(),maxConnectionAgeMs=15*60*1000
}={}){
  assertContract(contract);
  if(typeof acquireProvider!=='function')throw new TypeError('acquireProvider is required');
  if(typeof stageProvider!=='function')throw new TypeError('stageProvider is required');
  if(typeof recoverProvider!=='function')throw new TypeError('recoverProvider is required');
  if(typeof verifyProof!=='function')throw new TypeError('verifyProof is required');
  const binding=proofBinding(bindingInput,contract);
  if(!connectionPlan?.configuration)fail('connectionPlan is required');
  if(connectionPlan.configuration.providerKey!==contract.provider.id||
     connectionPlan.configuration.wfmTenantId!==contract.binding.tenantId||
     connectionPlan.configuration.connectionId!==contract.binding.connectionId){
    fail('connection plan does not match provider proof binding','WFM_PROVIDER_PROOF_BINDING_MISMATCH');
  }
  const connection=validateConnectionEvidence(connectionPlan,connectionEvidence,{nowMs,maxAgeMs:maxConnectionAgeMs});
  if(!['CONNECTION_VERIFIED','CONNECTION_AND_SAMPLE_VERIFIED'].includes(connection.status)){
    fail('provider connection proof rejected: '+connection.reasons.join(', '),'WFM_PROVIDER_PROOF_CONNECTION_NOT_PROVEN');
  }

  const readAuthority=freeze({
    schemaVersion:1,binding:structuredClone(binding),
    configurationFingerprint:connectionPlan.configurationFingerprint,
    endpointHost:connectionPlan.configuration.endpointHost,
    readOnly:true,writeAllowed:false,destructiveAllowed:false,
    customerProofClaimAllowed:false,productionCertificationAllowed:false
  });
  const acquisition=await acquireProvider(readAuthority);
  const acquisitionEvidence=assertAcquisition(contract,acquisition);

  const stagingAuthority=freeze({
    schemaVersion:1,binding:structuredClone(binding),
    target:acquisitionEvidence.target,
    sourceWatermark:acquisitionEvidence.sourceWatermark,
    mappingFingerprint:acquisitionEvidence.mappingFingerprint,
    schemaFingerprints:structuredClone(acquisitionEvidence.schemaFingerprints),
    readOnlySource:true,businessApplyAllowed:false,writeBackAllowed:false,
    customerProofClaimAllowed:false
  });
  const staged=await stageProvider(freeze({authority:stagingAuthority,acquisition}));
  const stageEvidence=assertStage(contract,acquisition,staged);

  const recoveryAuthority=freeze({
    schemaVersion:1,binding:structuredClone(binding),
    configurationFingerprint:connectionPlan.configurationFingerprint,
    readOnly:true,writeAllowed:false,destructiveAllowed:false,
    businessMutationAllowed:false,customerProofClaimAllowed:false
  });
  const recovery=await recoverProvider(recoveryAuthority);
  const recoveryEvidence=assertRecovery(contract,recovery);
  if(recoveryEvidence.configurationFingerprint!==connectionPlan.configurationFingerprint){
    fail('recovery verified a different provider configuration','WFM_PROVIDER_PROOF_RECOVERY_MISMATCH');
  }

  const observedAt=new Date(nowMs).toISOString();
  const evidence={
    schemaVersion:1,
    binding,
    observedAt,
    configurationFingerprint:connectionPlan.configurationFingerprint,
    sourceInstanceId:connectionPlan.configuration.sourceInstanceId,
    endpointHost:connectionPlan.configuration.endpointHost,
    acquisition:acquisitionEvidence,
    staging:stageEvidence,
    recovery:recoveryEvidence,
    claims:{
      providerReadRoundtripProven:true,
      canonicalStagingProven:true,
      providerRecoveryProven:true,
      writeRoundtripProven:false,
      productionCertified:false,
      customerReady:false
    }
  };
  const evidenceFingerprint=digest(evidence);
  const verifierPayload=freeze({
    schemaVersion:1,
    ...structuredClone(evidence),
    evidenceFingerprint
  });
  if(await verifyProof(verifierPayload)!==true){
    fail('independent external-provider proof verification failed','WFM_PROVIDER_PROOF_VERIFICATION_FAILED');
  }
  return freeze({
    schemaVersion:1,
    status:'PROVIDER_READ_ROUNDTRIP_PROVEN',
    binding:structuredClone(binding),
    providerId:contract.provider.id,
    tenantId:contract.binding.tenantId,
    connectionId:contract.binding.connectionId,
    target:acquisitionEvidence.target,
    configurationFingerprint:connectionPlan.configurationFingerprint,
    mappingFingerprint:acquisitionEvidence.mappingFingerprint,
    schemaFingerprints:structuredClone(acquisitionEvidence.schemaFingerprints),
    batchDigest:stageEvidence.batchDigest,
    recoveryReceiptId:recoveryEvidence.receiptId,
    evidenceFingerprint,
    observedAt,
    readProven:true,
    recoveryProven:true,
    writeProven:false,
    productionCertified:false,
    customerReady:false,
    customerProofClaimAllowed:false,
    promotionEligibility:'SHADOW_READ_ONLY'
  });
}
