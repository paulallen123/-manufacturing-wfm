function fail(message,code='WFM_PROVIDER_PROOF_READINESS_INVALID'){const e=new Error(message);e.code=code;throw e;}
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
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function sha(value,name){
  const v=text(value,name,80);
  if(!/^[a-f0-9]{40}$/.test(v))fail(name+' must be a full git SHA');
  return v;
}
function names(value,name){
  if(!Array.isArray(value))fail(name+' must be an array');
  const out=value.map((v,i)=>text(v,name+'['+i+']',160));
  if(new Set(out).size!==out.length)fail(name+' contains duplicates');
  return out;
}
export function assessProviderProofReadiness({
  providerId,tenantId,connectionId,candidateSha,deploymentId,proofRunId,
  requiredBindings,availableBindingNames,connectionPlan,connectionEvidence,
  connectorCertification
}={}){
  const provider=text(providerId,'providerId',128);
  const tenant=text(tenantId,'tenantId',128);
  const connection=text(connectionId,'connectionId',128);
  const candidate=sha(candidateSha,'candidateSha');
  const deployment=text(deploymentId,'deploymentId',256);
  const run=text(proofRunId,'proofRunId',256);
  const required=names(requiredBindings,'requiredBindings').sort();
  const available=new Set(names(availableBindingNames||[],'availableBindingNames'));
  const missing=required.filter(name=>!available.has(name));
  const cp=plain(connectionPlan,'connectionPlan');
  const ce=plain(connectionEvidence,'connectionEvidence');
  const cert=plain(connectorCertification,'connectorCertification');
  const reasons=[];
  if(cp.configuration?.providerKey!==provider)reasons.push('connection-plan-provider-mismatch');
  if(cp.configuration?.wfmTenantId!==tenant)reasons.push('connection-plan-tenant-mismatch');
  if(cp.configuration?.connectionId!==connection)reasons.push('connection-plan-connection-mismatch');
  if(ce.providerKey!==provider)reasons.push('connection-evidence-provider-mismatch');
  if(ce.wfmTenantId!==tenant)reasons.push('connection-evidence-tenant-mismatch');
  if(ce.connectionId!==connection)reasons.push('connection-evidence-connection-mismatch');
  if(ce.configurationFingerprint!==cp.configurationFingerprint)reasons.push('configuration-fingerprint-mismatch');
  if(ce.readOnly!==true)reasons.push('connection-evidence-not-read-only');
  if(ce.rawCredentialObserved===true)reasons.push('raw-credential-observed');
  if(!['CI_TESTED','PROVIDER_READ_PROVEN','PROVIDER_WRITE_PROVEN','PRODUCTION_CERTIFIED'].includes(cert.state))reasons.push('connector-not-ci-tested');
  if(cert.providerId!==provider)reasons.push('certification-provider-mismatch');
  if(missing.length)reasons.push('provider-bindings-missing');
  const ready=reasons.length===0;
  return freeze({
    schemaVersion:1,status:ready?'READY_FOR_PROVIDER_READ_PROOF':'BLOCKED',
    providerId:provider,tenantId:tenant,connectionId:connection,
    binding:{candidateSha:candidate,deploymentId:deployment,proofRunId:run},
    requiredBindings:required,missingBindings:missing,
    reasons,ready,
    nextAction:ready?'RUN_EXTERNAL_PROVIDER_READ_PROOF':'WAIT_FOR_REQUIRED_PROVIDER_BINDINGS',
    deploymentMutationAllowed:false,
    customerProofMutationAllowed:false,
    writeProofAllowed:false,
    productionCertificationAllowed:false,
    customerReadyClaimAllowed:false
  });
}
