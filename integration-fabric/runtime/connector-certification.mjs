import {createHash} from 'node:crypto';

const STATES=['CATALOGUED','BUILT','CI_TESTED','PROVIDER_READ_PROVEN','PROVIDER_WRITE_PROVEN','PRODUCTION_CERTIFIED'];

function fail(message,code='WFM_CONNECTOR_CERTIFICATION_INVALID'){const e=new Error(message);e.code=code;throw e;}
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
function gitSha(value,name){
  const v=text(value,name,80);
  if(!/^[a-f0-9]{40}$/.test(v))fail(name+' must be a full 40-character git SHA');
  return v;
}
function fingerprint(value,name){
  const v=text(value,name,80);
  if(!/^sha256:[a-f0-9]{64}$/.test(v))fail(name+' must be a canonical sha256 fingerprint');
  return v;
}
function schemas(value){
  if(!Array.isArray(value)||!value.length)fail('schemaFingerprints must contain at least one item');
  return [...new Set(value.map((v,i)=>{
    const x=text(v,'schemaFingerprints['+i+']',80);
    if(!/^[a-f0-9]{64}$/.test(x))fail('schema fingerprint must be 64 hex');
    return x;
  }))].sort();
}
function assertContract(contract,target){
  plain(contract,'contract');
  if(contract.schemaVersion!==1||!contract.provider||!contract.binding||!contract.bindingHash)fail('valid connector contract is required');
  if(!contract.resources?.some(r=>r.target===target))fail('connector does not expose target '+target,'WFM_CONNECTOR_CERTIFICATION_TARGET_UNAVAILABLE');
}
function exactInstant(value,name){
  const v=text(value,name,40),ms=Date.parse(v);
  if(!Number.isFinite(ms))fail(name+' must be an ISO timestamp');
  return new Date(ms).toISOString();
}

export function createConnectorBuildManifest({
  contract,target,sourceSha,implementationKind,implementationFingerprint,
  mappingFingerprint,schemaFingerprints
}={}){
  const canonicalTarget=text(target,'target',128);
  assertContract(contract,canonicalTarget);
  const manifest={
    schemaVersion:1,
    providerId:contract.provider.id,
    target:canonicalTarget,
    sourceSha:gitSha(sourceSha,'sourceSha'),
    contractBindingHash:text(contract.bindingHash,'contract.bindingHash',128),
    implementationKind:text(implementationKind,'implementationKind',80),
    implementationFingerprint:fingerprint(implementationFingerprint,'implementationFingerprint'),
    mappingFingerprint:fingerprint(mappingFingerprint,'mappingFingerprint'),
    schemaFingerprints:schemas(schemaFingerprints)
  };
  return freeze({...manifest,packageFingerprint:digest(manifest)});
}

function validateCiReceipt(manifest,receipt){
  plain(receipt,'ciReceipt');
  if(receipt.status!=='PASS')fail('CI receipt is not PASS','WFM_CONNECTOR_CERTIFICATION_CI_FAILED');
  if(receipt.sourceSha!==manifest.sourceSha||receipt.packageFingerprint!==manifest.packageFingerprint){
    fail('CI receipt does not match connector build manifest','WFM_CONNECTOR_CERTIFICATION_CI_MISMATCH');
  }
  const workflowRunId=text(String(receipt.workflowRunId),'ciReceipt.workflowRunId',128);
  const observedAt=exactInstant(receipt.observedAt,'ciReceipt.observedAt');
  return {workflowRunId,observedAt};
}
function validateProviderReadProof(manifest,proof){
  plain(proof,'providerReadProof');
  if(proof.status!=='PROVIDER_READ_ROUNDTRIP_PROVEN')fail('provider read proof has wrong status','WFM_CONNECTOR_CERTIFICATION_PROVIDER_PROOF_INVALID');
  if(proof.providerId!==manifest.providerId||proof.target!==manifest.target||
     proof.binding?.candidateSha!==manifest.sourceSha||
     proof.mappingFingerprint!==manifest.mappingFingerprint||
     canonical(schemas(proof.schemaFingerprints))!==canonical(manifest.schemaFingerprints)){
    fail('provider read proof does not match connector package','WFM_CONNECTOR_CERTIFICATION_PROVIDER_PROOF_MISMATCH');
  }
  if(proof.readProven!==true||proof.recoveryProven!==true||
     proof.writeProven!==false||proof.productionCertified!==false||
     proof.customerReady!==false||proof.customerProofClaimAllowed!==false){
    fail('provider read proof contains inconsistent claim authority','WFM_CONNECTOR_CERTIFICATION_PROVIDER_PROOF_INVALID');
  }
  return {
    tenantId:text(proof.tenantId,'providerReadProof.tenantId',128),
    connectionId:text(proof.connectionId,'providerReadProof.connectionId',128),
    deploymentId:text(proof.binding.deploymentId,'providerReadProof.binding.deploymentId',256),
    proofRunId:text(proof.binding.proofRunId,'providerReadProof.binding.proofRunId',256),
    evidenceFingerprint:fingerprint(proof.evidenceFingerprint,'providerReadProof.evidenceFingerprint'),
    observedAt:exactInstant(proof.observedAt,'providerReadProof.observedAt')
  };
}
function validateWriteProof(manifest,proof){
  plain(proof,'writeProof');
  if(proof.status!=='PROVIDER_WRITE_ROUNDTRIP_PROVEN')fail('write proof has wrong status','WFM_CONNECTOR_CERTIFICATION_WRITE_PROOF_INVALID');
  if(proof.providerId!==manifest.providerId||proof.target!==manifest.target||
     proof.sourceSha!==manifest.sourceSha||proof.packageFingerprint!==manifest.packageFingerprint){
    fail('write proof does not match connector package','WFM_CONNECTOR_CERTIFICATION_WRITE_PROOF_MISMATCH');
  }
  if(proof.idempotencyProven!==true||proof.readBackProven!==true||proof.rollbackOrCompensationProven!==true){
    fail('write proof is missing required write controls','WFM_CONNECTOR_CERTIFICATION_WRITE_PROOF_INVALID');
  }
  return {
    evidenceFingerprint:fingerprint(proof.evidenceFingerprint,'writeProof.evidenceFingerprint'),
    observedAt:exactInstant(proof.observedAt,'writeProof.observedAt')
  };
}
function validateProductionProof(manifest,proof){
  plain(proof,'productionProof');
  if(proof.status!=='PRODUCTION_CERTIFIED')fail('production proof has wrong status','WFM_CONNECTOR_CERTIFICATION_PRODUCTION_PROOF_INVALID');
  if(proof.providerId!==manifest.providerId||proof.target!==manifest.target||
     proof.sourceSha!==manifest.sourceSha||proof.packageFingerprint!==manifest.packageFingerprint){
    fail('production proof does not match connector package','WFM_CONNECTOR_CERTIFICATION_PRODUCTION_PROOF_MISMATCH');
  }
  if(proof.securityProven!==true||proof.recoveryProven!==true||proof.operationalSloProven!==true){
    fail('production proof is missing mandatory controls','WFM_CONNECTOR_CERTIFICATION_PRODUCTION_PROOF_INVALID');
  }
  return {
    evidenceFingerprint:fingerprint(proof.evidenceFingerprint,'productionProof.evidenceFingerprint'),
    observedAt:exactInstant(proof.observedAt,'productionProof.observedAt')
  };
}

export async function assessConnectorCertification({
  contract,manifest,ciReceipt=null,verifyCiReceipt,
  providerReadProof=null,verifyProviderReadProof,
  writeProof=null,verifyWriteProof,
  productionProof=null,verifyProductionProof
}={}){
  plain(manifest,'manifest');
  assertContract(contract,manifest.target);
  if(manifest.providerId!==contract.provider.id||manifest.contractBindingHash!==contract.bindingHash){
    fail('manifest does not match connector contract','WFM_CONNECTOR_CERTIFICATION_MANIFEST_MISMATCH');
  }
  const rebuilt=createConnectorBuildManifest({
    contract,target:manifest.target,sourceSha:manifest.sourceSha,
    implementationKind:manifest.implementationKind,implementationFingerprint:manifest.implementationFingerprint,
    mappingFingerprint:manifest.mappingFingerprint,schemaFingerprints:manifest.schemaFingerprints
  });
  if(rebuilt.packageFingerprint!==manifest.packageFingerprint){
    fail('manifest package fingerprint is invalid','WFM_CONNECTOR_CERTIFICATION_MANIFEST_MISMATCH');
  }

  let state='BUILT',ci=null,provider=null,write=null,production=null;
  if(ciReceipt!==null){
    if(typeof verifyCiReceipt!=='function')throw new TypeError('verifyCiReceipt is required');
    ci=validateCiReceipt(manifest,ciReceipt);
    if(await verifyCiReceipt(freeze({...structuredClone(ciReceipt),manifestFingerprint:manifest.packageFingerprint}))!==true){
      fail('independent CI receipt verification failed','WFM_CONNECTOR_CERTIFICATION_CI_VERIFICATION_FAILED');
    }
    state='CI_TESTED';
  }
  if(providerReadProof!==null){
    if(state!=='CI_TESTED')fail('provider proof requires verified CI first','WFM_CONNECTOR_CERTIFICATION_ORDER_INVALID');
    if(typeof verifyProviderReadProof!=='function')throw new TypeError('verifyProviderReadProof is required');
    provider=validateProviderReadProof(manifest,providerReadProof);
    if(await verifyProviderReadProof(freeze(structuredClone(providerReadProof)))!==true){
      fail('independent provider read proof verification failed','WFM_CONNECTOR_CERTIFICATION_PROVIDER_VERIFICATION_FAILED');
    }
    state='PROVIDER_READ_PROVEN';
  }
  if(writeProof!==null){
    if(state!=='PROVIDER_READ_PROVEN')fail('write proof requires provider read proof first','WFM_CONNECTOR_CERTIFICATION_ORDER_INVALID');
    if(typeof verifyWriteProof!=='function')throw new TypeError('verifyWriteProof is required');
    write=validateWriteProof(manifest,writeProof);
    if(await verifyWriteProof(freeze(structuredClone(writeProof)))!==true){
      fail('independent write proof verification failed','WFM_CONNECTOR_CERTIFICATION_WRITE_VERIFICATION_FAILED');
    }
    state='PROVIDER_WRITE_PROVEN';
  }
  if(productionProof!==null){
    if(!['PROVIDER_READ_PROVEN','PROVIDER_WRITE_PROVEN'].includes(state))fail('production certification requires provider proof first','WFM_CONNECTOR_CERTIFICATION_ORDER_INVALID');
    if(typeof verifyProductionProof!=='function')throw new TypeError('verifyProductionProof is required');
    production=validateProductionProof(manifest,productionProof);
    if(await verifyProductionProof(freeze(structuredClone(productionProof)))!==true){
      fail('independent production proof verification failed','WFM_CONNECTOR_CERTIFICATION_PRODUCTION_VERIFICATION_FAILED');
    }
    state='PRODUCTION_CERTIFIED';
  }
  if(!STATES.includes(state))fail('unknown certification state');

  return freeze({
    schemaVersion:1,state,
    providerId:manifest.providerId,target:manifest.target,sourceSha:manifest.sourceSha,
    packageFingerprint:manifest.packageFingerprint,mappingFingerprint:manifest.mappingFingerprint,
    schemaFingerprints:structuredClone(manifest.schemaFingerprints),
    evidence:{ci,providerRead:provider,write,production},
    catalogVisible:true,
    customerSelectable:['PROVIDER_READ_PROVEN','PROVIDER_WRITE_PROVEN','PRODUCTION_CERTIFIED'].includes(state),
    readProven:['PROVIDER_READ_PROVEN','PROVIDER_WRITE_PROVEN','PRODUCTION_CERTIFIED'].includes(state),
    writeProven:['PROVIDER_WRITE_PROVEN','PRODUCTION_CERTIFIED'].includes(state)&&write!==null,
    productionCertified:state==='PRODUCTION_CERTIFIED',
    customerReadyClaimAllowed:false
  });
}
