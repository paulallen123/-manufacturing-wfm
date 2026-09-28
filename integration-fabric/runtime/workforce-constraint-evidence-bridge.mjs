function fail(message){ throw new Error(message); }

function plain(value,path='value',seen=new WeakSet()){
  if(value===null||typeof value==='boolean'||typeof value==='string') return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return value;
  }
  if(!value||typeof value!=='object') fail(`${path} contains unsupported data`);
  if(seen.has(value)) fail(`${path} contains cyclic or shared data`);
  seen.add(value);
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype||Object.keys(value).length!==value.length) fail(`${path} must be a dense plain array`);
    const out=value.map((item,index)=>plain(item,`${path}[${index}]`,seen));
    seen.delete(value);
    return out;
  }
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail(`${path} must be plain data`);
  const out={};
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string') fail(`${path} contains symbol data`);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}.${key} contains executable or hidden data`);
    out[key]=plain(descriptor.value,`${path}.${key}`,seen);
  }
  seen.delete(value);
  return out;
}

function text(value,name){
  if(typeof value!=='string'||!value.trim()||value.trim()!==value||/[\u0000-\u001f\u007f]/.test(value)) fail(`${name} must be a clean non-empty string`);
  return value;
}

function assertNoEscalatedAuthority(evidence){
  for(const field of [
    'operationalDecisionAuthority','controlAuthority','writeBackAuthority',
    'payrollAuthority','attendanceAuthority','causalClaimAuthority',
    'checkpointAdvanceAllowed','deletionAuthority'
  ]){
    if(evidence[field]!==false) fail(`source evidence must explicitly deny ${field}`);
  }
}

export function buildWorkforceConstraintEvidenceCandidate({evidenceType,siteId,workCenterId=null,evidence}){
  evidenceType=text(evidenceType,'evidenceType');
  siteId=text(siteId,'siteId');
  if(workCenterId!==null) workCenterId=text(workCenterId,'workCenterId');
  const source=plain(evidence,'evidence');
  assertNoEscalatedAuthority(source);

  if(evidenceType==='azure-iot-operations-keyframe'){
    if(source.stateSnapshotCandidate!==true) fail('Azure IoT Operations evidence is not an admitted state snapshot candidate');
    text(source.wfmTenantId,'evidence.wfmTenantId');
    text(source.connectionId,'evidence.connectionId');
    text(source.externalAssetId,'evidence.externalAssetId');
    text(source.reconciliationFingerprint,'evidence.reconciliationFingerprint');
  } else if(evidenceType==='manufacturing-observation'){
    if(source.transactionalEvidenceCandidate!==true && source.derivedObservationCandidate!==true){
      fail('manufacturing observation is not an admitted evidence candidate');
    }
    text(source.wfmTenantId,'evidence.wfmTenantId');
    text(source.connectionId,'evidence.connectionId');
    text(source.plantId,'evidence.plantId');
    if(source.plantId!==siteId) fail('manufacturing observation plant does not match requested VECTOR site');
    text(source.checkpointNamespace,'evidence.checkpointNamespace');
  } else {
    fail('unsupported manufacturing evidence type');
  }

  return Object.freeze({
    workforceConstraintEvidenceCandidate:true,
    eligibleForWorkforceConstraintAssessment:true,
    evidenceType,
    wfmTenantId:source.wfmTenantId,
    connectionId:source.connectionId,
    siteId,
    workCenterId,
    sourceEvidenceFingerprint:source.reconciliationFingerprint ?? source.checkpointNamespace,
    sourceCompletenessProven:source.sourceCompletenessProven===true,
    deliveryCompletenessProven:source.deliveryCompletenessProven===true,
    operationalDecisionAuthority:false,
    controlAuthority:false,
    writeBackAuthority:false,
    payrollAuthority:false,
    attendanceAuthority:false,
    causalClaimAuthority:false,
    checkpointAdvanceAllowed:false,
    deletionAuthority:false
  });
}
