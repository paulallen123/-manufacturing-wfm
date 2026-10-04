import {createHash} from 'node:crypto';
import {
  buildStaffologyWorkerPageRead,
  buildStaffologyWorkerDetailRead,
  buildNetSuiteWorkerSuiteQLRead,
  buildSapS4ProductionOrderRead
} from './provider-read-requests.mjs';
import {executeProviderRead} from './provider-read-executor.mjs';
import {
  mapStaffologyWorkerDetail,
  mapNetSuiteWorkerPage,
  mapSapS4ProductionDemandPage
} from './provider-canonical-mappers.mjs';
import {assessBatchRun} from './batch-reconciliation.mjs';

function required(value,name){
  if(typeof value!=='string'||!value.trim()) throw new TypeError(`${name} is required`);
  const text=value.normalize('NFC').trim();
  if(text.includes('\0')) throw new TypeError(`${name} contains NUL`);
  return text;
}
function boundedInt(value,name,min,max,defaultValue){
  const raw=value===undefined?defaultValue:value;
  const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<min||n>max) throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  return n;
}
function canonicalJson(value){
  if(Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object'){
    return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:canonicalJson(value)).digest('hex');
function deepFreeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(deepFreeze);Object.freeze(value);}
  return value;
}
function validateContext(contract,connectionPlan,runId){
  if(!contract||contract.schemaVersion!==1||!contract.binding||!contract.provider) throw new TypeError('universal connector contract is required');
  if(!connectionPlan?.configuration) throw new TypeError('connectionPlan is required');
  required(runId,'runId');
  if(connectionPlan.configuration.providerKey!==contract.provider.id||
     connectionPlan.configuration.wfmTenantId!==contract.binding.tenantId||
     connectionPlan.configuration.connectionId!==contract.binding.connectionId){
    const error=new Error('acquisition connection plan is not bound to connector contract');
    error.code='WFM_ACQUISITION_BINDING_MISMATCH';
    throw error;
  }
}
function receiptChecksumValid(receipt){
  return Boolean(receipt&&/^[a-f0-9]{64}$/.test(String(receipt.responseSha256||'')));
}
function schemaSetCompatible(observations){
  const observed=new Map();
  for(const schema of observations){
    if(!schema||!Array.isArray(schema.fields)||!/^[a-f0-9]{64}$/.test(String(schema.fingerprint||''))) return false;
    for(const field of schema.fields){
      const id=required(field.stableId??field.sourceName,'schema field id');
      const type=String(field.type??'unknown').toLowerCase();
      if(type==='null'||type==='unknown') continue;
      if(type==='mixed') return false;
      const prior=observed.get(id);
      if(prior&&prior!==type&&!(new Set([prior,type]).size===2&&new Set([prior,type]).has('integer')&&new Set([prior,type]).has('number'))) return false;
      if(!prior) observed.set(id,type);
    }
  }
  return true;
}
function addRecords(records,incoming,identityOf,seen,duplicates,maxRows,diagnostics){
  for(const record of incoming){
    const id=required(identityOf(record),'canonical record identity');
    if(seen.has(id)){duplicates.push(id);continue;}
    if(records.length>=maxRows){
      diagnostics.push('max-row-bound-reached');
      return false;
    }
    seen.add(id);
    records.push(record);
  }
  return true;
}
function sourceScope(contract,connectionPlan,target,dataset){
  return {
    providerId:contract.provider.id,
    connectionId:contract.binding.connectionId,
    resource:target,
    tenant:contract.binding.tenantId,
    environment:connectionPlan.configuration.environment,
    serverInstance:connectionPlan.configuration.sourceInstanceId,
    dataset
  };
}
function finalizeAcquisition({
  contract,connectionPlan,runId,target,dataset,records,receipts,schemas,mappingProfiles=[],complete,
  expectedRowCount=null,duplicates=[],diagnostics=[],previousCheckpoint=null
}){
  const sourceWatermark=`sha256:${sha256(records)}`;
  const checksumVerified=receipts.length>0&&receipts.every(receiptChecksumValid);
  const schemaVerified=schemas.length>0&&schemaSetCompatible(schemas);
  const schemaFingerprints=[...new Set(schemas.map(schema=>schema?.fingerprint).filter(value=>/^[a-f0-9]{64}$/.test(String(value))))].sort();
  const normalizedMappingProfiles=[...new Set(mappingProfiles.map(value=>required(value,'mappingProfile')))].sort();
  const mappingFingerprint='sha256:'+sha256({
    providerId:contract.provider.id,
    target,
    mappingProfiles:normalizedMappingProfiles,
    schemaFingerprints
  });
  const scope=sourceScope(contract,connectionPlan,target,dataset);
  const reconciliation=assessBatchRun({
    provider:contract.provider.id,
    connector:`vector-${target}`,
    runId,
    scope,
    requiredScopeDimensions:['tenant','environment','serverInstance','dataset'],
    sourceWatermark,
    previousCheckpoint,
    watermarkKind:'opaque',
    rowCount:records.length,
    expectedRowCount,
    complete,
    checksumVerified,
    schemaVerified,
    duplicateRowKeys:[...new Set(duplicates)],
    parseErrors:0,
    transferErrors:diagnostics.length,
    sourceDeclaresDelta:false
  });
  const checkpointCandidate=reconciliation.safeToAdvanceWatermark?deepFreeze({
    schemaVersion:1,
    scopeNamespace:reconciliation.scopeNamespace,
    watermark:sourceWatermark,
    watermarkKind:'opaque',
    runId,
    rowCount:records.length
  }):null;
  return deepFreeze({
    schemaVersion:1,
    status:reconciliation.safeToCommit?'SAFE_TO_STAGE':'QUARANTINED',
    providerId:contract.provider.id,
    tenantId:contract.binding.tenantId,
    connectionId:contract.binding.connectionId,
    target,
    dataset,
    runId,
    records,
    sourceWatermark,
    schemaFingerprints,
    mappingProfiles:normalizedMappingProfiles,
    mappingFingerprint,
    receiptCount:receipts.length,
    diagnostics:[...diagnostics],
    reconciliation,
    checkpointCandidate,
    deletionAuthority:false,
    customerProofClaimAllowed:false
  });
}
async function boundedMap(items,limit,fn){
  const out=new Array(items.length);
  let next=0;
  async function worker(){
    while(true){
      const index=next++;
      if(index>=items.length) return;
      out[index]=await fn(items[index],index);
    }
  }
  const workers=Math.min(limit,items.length);
  await Promise.all(Array.from({length:workers},()=>worker()));
  return out;
}
function executorOptions(options){
  return {
    credentialAuthorizer:options.credentialAuthorizer,
    fetchImpl:options.fetchImpl,
    maxResponseBytes:options.maxResponseBytes,
    timeoutMs:options.timeoutMs,
    clock:options.clock
  };
}

export async function acquireNetSuiteWorkers({
  contract,connectionPlan,connectionEvidence,credentialRef,credentialAuthorizer,fetchImpl,
  runId,previousCheckpoint=null,pageSize=1000,maxPages=100,maxRows=100000,nowMs=Date.now(),
  maxResponseBytes,timeoutMs,clock
}={}){
  validateContext(contract,connectionPlan,runId);
  if(contract.provider.id!=='oracle-netsuite') throw new TypeError('NetSuite contract required');
  const size=boundedInt(pageSize,'pageSize',1,1000,1000);
  const pages=boundedInt(maxPages,'maxPages',1,1000,100);
  const rowBound=boundedInt(maxRows,'maxRows',1,100000,100000);
  const records=[],receipts=[],schemas=[],duplicates=[],diagnostics=[],seen=new Set();
  let expectedTotal=null,offset=0,complete=false;
  for(let page=0;page<pages;page++){
    const plan=buildNetSuiteWorkerSuiteQLRead({contract,connectionPlan,connectionEvidence,credentialRef,limit:size,offset,nowMs});
    const execution=await executeProviderRead({plan,contract,...executorOptions({credentialAuthorizer,fetchImpl,maxResponseBytes,timeoutMs,clock})});
    const mapped=mapNetSuiteWorkerPage({plan,execution,contract});
    receipts.push(execution.receipt);schemas.push(mapped.schemaObservation);
    if(expectedTotal===null) expectedTotal=mapped.page.totalResults;
    else if(mapped.page.totalResults!==expectedTotal){diagnostics.push('netsuite-total-results-changed');break;}
    if(expectedTotal>rowBound){diagnostics.push('source-row-count-exceeds-bound');break;}
    if(!addRecords(records,mapped.records,r=>r.externalId,seen,duplicates,rowBound,diagnostics)) break;
    if(mapped.page.complete){complete=true;break;}
    offset+=size;
    if(offset>=rowBound){diagnostics.push('max-row-bound-reached');break;}
  }
  if(!complete&&diagnostics.length===0) diagnostics.push('max-page-bound-reached');
  return finalizeAcquisition({
    contract,connectionPlan,runId,target:'worker',dataset:'workers',records,receipts,schemas,mappingProfiles:['netsuite-worker-v1'],complete,
    expectedRowCount:expectedTotal,duplicates,diagnostics,previousCheckpoint
  });
}

function staffologyListIdentity(item,employerId){
  if(!item||typeof item!=='object'||Array.isArray(item)) throw new TypeError('Staffology list item must be an object');
  const employeeId=required(item.id,'Staffology list employee id');
  if(item.url!==undefined&&item.url!==null&&String(item.url).trim()!==''){
    const expectedPath=`/employers/${encodeURIComponent(employerId)}/employees/${encodeURIComponent(employeeId)}`;
    const url=new URL(String(item.url),'https://api.staffology.co.uk');
    if(url.origin!=='https://api.staffology.co.uk'||url.pathname!==expectedPath||url.search||url.hash||url.username||url.password){
      const error=new Error('Staffology list item URL contradicts exact employee identity');
      error.code='WFM_STAFFOLOGY_LIST_IDENTITY_MISMATCH';
      throw error;
    }
  }
  return employeeId;
}
export async function acquireStaffologyWorkers({
  contract,connectionPlan,connectionEvidence,credentialRef,credentialAuthorizer,fetchImpl,
  employerId,runId,previousCheckpoint=null,pageSize=100,maxPages=100,maxRows=50000,detailConcurrency=8,
  nowMs=Date.now(),maxResponseBytes,timeoutMs,clock
}={}){
  validateContext(contract,connectionPlan,runId);
  if(contract.provider.id!=='iris-staffology-payroll') throw new TypeError('Staffology contract required');
  const employer=required(employerId,'employerId');
  const size=boundedInt(pageSize,'pageSize',1,500,100);
  const pages=boundedInt(maxPages,'maxPages',1,10000,100);
  const rowBound=boundedInt(maxRows,'maxRows',1,1000000,50000);
  const concurrency=boundedInt(detailConcurrency,'detailConcurrency',1,32,8);
  const records=[],receipts=[],schemas=[],duplicates=[],diagnostics=[],seenIds=new Set();
  let complete=false;
  for(let pageNum=0;pageNum<pages;pageNum++){
    const listPlan=buildStaffologyWorkerPageRead({contract,connectionPlan,connectionEvidence,credentialRef,employerId:employer,pageNum,pageSize:size,nowMs});
    const listExecution=await executeProviderRead({plan:listPlan,contract,...executorOptions({credentialAuthorizer,fetchImpl,maxResponseBytes,timeoutMs,clock})});
    receipts.push(listExecution.receipt);
    if(!Array.isArray(listExecution.data)||listExecution.data.length>size) throw new TypeError('Staffology employee page violates Item[] page contract');
    const pageIds=[];
    for(const item of listExecution.data){
      const id=staffologyListIdentity(item,employer);
      if(seenIds.has(id)){duplicates.push(id);continue;}
      if(seenIds.size>=rowBound){diagnostics.push('max-row-bound-reached');break;}
      seenIds.add(id);pageIds.push(id);
    }
    if(diagnostics.includes('max-row-bound-reached')) break;
    const details=await boundedMap(pageIds,concurrency,async employeeId=>{
      const plan=buildStaffologyWorkerDetailRead({contract,connectionPlan,connectionEvidence,credentialRef,employerId:employer,employeeId,nowMs});
      const execution=await executeProviderRead({plan,contract,...executorOptions({credentialAuthorizer,fetchImpl,maxResponseBytes,timeoutMs,clock})});
      const mapped=mapStaffologyWorkerDetail({plan,execution,contract});
      return {record:mapped.records[0],receipt:execution.receipt,schema:mapped.schemaObservation};
    });
    for(const detail of details){records.push(detail.record);receipts.push(detail.receipt);schemas.push(detail.schema);}
    if(listExecution.data.length<size){complete=true;break;}
  }
  if(!complete&&diagnostics.length===0) diagnostics.push('max-page-bound-reached');
  return finalizeAcquisition({
    contract,connectionPlan,runId,target:'worker',dataset:'workers',records,receipts,schemas,mappingProfiles:['staffology-worker-detail-v1'],complete,
    expectedRowCount:seenIds.size,duplicates,diagnostics,previousCheckpoint
  });
}

export async function acquireSapS4ProductionDemand({
  contract,connectionPlan,connectionEvidence,credentialRef,credentialAuthorizer,fetchImpl,
  runId,previousCheckpoint=null,pageSize=500,maxPages=1000,maxRows=500000,nowMs=Date.now(),
  maxResponseBytes,timeoutMs,clock
}={}){
  validateContext(contract,connectionPlan,runId);
  if(contract.provider.id!=='sap-s4hana') throw new TypeError('SAP S/4HANA contract required');
  const size=boundedInt(pageSize,'pageSize',1,1000,500);
  const pages=boundedInt(maxPages,'maxPages',1,10000,1000);
  const rowBound=boundedInt(maxRows,'maxRows',1,1000000,500000);
  const records=[],receipts=[],schemas=[],duplicates=[],diagnostics=[],seen=new Set();
  let skip=0,complete=false;
  for(let page=0;page<pages;page++){
    const plan=buildSapS4ProductionOrderRead({contract,connectionPlan,connectionEvidence,credentialRef,top:size,skip,nowMs});
    const execution=await executeProviderRead({plan,contract,...executorOptions({credentialAuthorizer,fetchImpl,maxResponseBytes,timeoutMs,clock})});
    const mapped=mapSapS4ProductionDemandPage({plan,execution,contract});
    receipts.push(execution.receipt);schemas.push(mapped.schemaObservation);
    if(mapped.page.hasMore&&mapped.records.length===0){diagnostics.push('sap-empty-page-with-continuation');break;}
    if(!addRecords(records,mapped.records,r=>r.sourceRecordId,seen,duplicates,rowBound,diagnostics)) break;
    if(mapped.page.complete){complete=true;break;}
    skip+=mapped.records.length;
    if(skip>=rowBound){diagnostics.push('max-row-bound-reached');break;}
  }
  if(!complete&&diagnostics.length===0) diagnostics.push('max-page-bound-reached');
  return finalizeAcquisition({
    contract,connectionPlan,runId,target:'production-demand',dataset:'production-demand',records,receipts,schemas,mappingProfiles:['sap-s4-production-demand-v1'],complete,
    expectedRowCount:null,duplicates,diagnostics,previousCheckpoint
  });
}
