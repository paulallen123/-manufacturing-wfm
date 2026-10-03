import {createHash} from 'node:crypto';

function required(value,name){
  if(typeof value!=='string'||!value.trim()) throw new TypeError(`${name} is required`);
  const text=value.normalize('NFC').trim();
  if(text.includes('\0')) throw new TypeError(`${name} contains NUL`);
  return text;
}
function plainObject(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)) throw new TypeError(`${name} must be a plain object`);
  return value;
}
function canonicalJson(value){
  if(Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:canonicalJson(value)).digest('hex');
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
const TARGET_ROUTE=Object.freeze({
  worker:'/workers',
  'production-demand':'/events'
});

function assertAcquisitionBinding(acquisition,contract){
  plainObject(acquisition,'acquisition');
  plainObject(contract,'contract');
  if(contract.schemaVersion!==1||!contract.binding||!contract.provider) throw new TypeError('valid universal connector contract is required');
  if(acquisition.providerId!==contract.provider.id||
     acquisition.tenantId!==contract.binding.tenantId||
     acquisition.connectionId!==contract.binding.connectionId){
    const error=new Error('acquisition is not bound to this connector contract');
    error.code='WFM_INGESTION_BINDING_MISMATCH';
    throw error;
  }
}
function assertStagingEligible(acquisition){
  if(acquisition.status!=='SAFE_TO_STAGE'||
     acquisition.reconciliation?.safeToCommit!==true||
     acquisition.reconciliation?.safeToAdvanceWatermark!==true||
     !acquisition.checkpointCandidate){
    const error=new Error('acquisition has not passed complete reconciliation');
    error.code='WFM_INGESTION_NOT_RECONCILED';
    throw error;
  }
  if(acquisition.deletionAuthority!==false||acquisition.customerProofClaimAllowed!==false){
    const error=new Error('acquisition carries authority that staging must not inherit');
    error.code='WFM_INGESTION_AUTHORITY_INVALID';
    throw error;
  }
  if(!Array.isArray(acquisition.records)) throw new TypeError('acquisition.records must be an array');
  const expectedWatermark=`sha256:${sha256(acquisition.records)}`;
  if(acquisition.sourceWatermark!==expectedWatermark||acquisition.checkpointCandidate.watermark!==expectedWatermark){
    const error=new Error('acquisition content differs from reconciled watermark');
    error.code='WFM_INGESTION_CONTENT_MISMATCH';
    throw error;
  }
  if(acquisition.reconciliation.scope?.providerId!==acquisition.providerId||
     acquisition.reconciliation.scope?.connectionId!==acquisition.connectionId||
     acquisition.reconciliation.scope?.tenant!==acquisition.tenantId||
     acquisition.reconciliation.scope?.resource!==acquisition.target||
     acquisition.reconciliation.scope?.dataset!==acquisition.dataset){
    const error=new Error('acquisition reconciliation scope does not match staging envelope');
    error.code='WFM_INGESTION_SCOPE_MISMATCH';
    throw error;
  }
}
export function buildCanonicalStagingCommand(acquisition,contract){
  assertAcquisitionBinding(acquisition,contract);
  assertStagingEligible(acquisition);
  const route=TARGET_ROUTE[acquisition.target];
  if(!route){
    const error=new Error(`no canonical staging route for target: ${acquisition.target}`);
    error.code='WFM_INGESTION_TARGET_UNSUPPORTED';
    throw error;
  }
  const batchDigest=sha256({
    tenantId:acquisition.tenantId,
    connectionId:acquisition.connectionId,
    providerId:acquisition.providerId,
    target:acquisition.target,
    runId:acquisition.runId,
    sourceWatermark:acquisition.sourceWatermark,
    records:acquisition.records
  });
  return freeze({
    schemaVersion:1,
    operation:'stage-canonical-batch',
    route,
    method:'POST',
    binding:{
      tenantId:acquisition.tenantId,
      connectionId:acquisition.connectionId,
      providerId:acquisition.providerId,
      target:acquisition.target,
      runId:acquisition.runId
    },
    batchDigest,
    idempotencyKey:`vector-ingest-v1:${batchDigest}`,
    sourceWatermark:acquisition.sourceWatermark,
    scopeNamespace:acquisition.reconciliation.scopeNamespace,
    rowCount:acquisition.records.length,
    records:structuredClone(acquisition.records),
    checkpointCandidate:structuredClone(acquisition.checkpointCandidate),
    deletionAuthority:false,
    customerProofClaimAllowed:false
  });
}
function validateStageReceipt(receipt,command){
  plainObject(receipt,'stage receipt');
  const stagingId=required(receipt.stagingId,'receipt.stagingId');
  const acceptedAt=required(receipt.acceptedAt,'receipt.acceptedAt');
  if(!Number.isFinite(Date.parse(acceptedAt))) throw new TypeError('receipt.acceptedAt must be an ISO timestamp');
  const checks={
    batchDigest:command.batchDigest,
    tenantId:command.binding.tenantId,
    connectionId:command.binding.connectionId,
    providerId:command.binding.providerId,
    target:command.binding.target,
    runId:command.binding.runId,
    rowCount:command.rowCount
  };
  for(const [key,want] of Object.entries(checks)){
    if(receipt[key]!==want){
      const error=new Error(`stage receipt ${key} does not match exact staging command`);
      error.code='WFM_INGESTION_RECEIPT_MISMATCH';
      throw error;
    }
  }
  if(receipt.complete!==true){
    const error=new Error('canonical staging writer did not accept the complete batch');
    error.code='WFM_INGESTION_PARTIAL_STAGE';
    throw error;
  }
  return freeze({stagingId,acceptedAt,...checks,complete:true});
}

export async function stageCanonicalBatch({
  acquisition,contract,stageWriter,verifyStagedBatch
}={}){
  if(typeof stageWriter!=='function') throw new TypeError('stageWriter is required');
  if(typeof verifyStagedBatch!=='function') throw new TypeError('verifyStagedBatch is required');
  const command=buildCanonicalStagingCommand(acquisition,contract);
  const rawReceipt=await stageWriter(command);
  const receipt=validateStageReceipt(rawReceipt,command);
  const verificationRequest=freeze({
    schemaVersion:1,
    stagingId:receipt.stagingId,
    batchDigest:command.batchDigest,
    binding:structuredClone(command.binding),
    sourceWatermark:command.sourceWatermark,
    scopeNamespace:command.scopeNamespace,
    rowCount:command.rowCount
  });
  if(await verifyStagedBatch(verificationRequest)!==true){
    const error=new Error('independent canonical staging verification failed');
    error.code='WFM_INGESTION_STAGE_VERIFICATION_FAILED';
    throw error;
  }
  return freeze({
    schemaVersion:1,
    status:'STAGED_VERIFIED',
    stagingId:receipt.stagingId,
    batchDigest:command.batchDigest,
    rowCount:command.rowCount,
    route:command.route,
    checkpointToCommit:structuredClone(command.checkpointCandidate),
    deletionAuthority:false,
    customerProofClaimAllowed:false
  });
}
