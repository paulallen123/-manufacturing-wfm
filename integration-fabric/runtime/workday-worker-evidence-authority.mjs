import {createHash} from 'node:crypto';
import {createManagedExportAuthority} from './managed-export-authority.mjs';
import {createEffectiveDatedWorkforceAuthority} from './effective-dated-workforce-authority.mjs';

const SECRET_KEY=/(?:^|_)(?:password|passwd|secret|token|credential|authorization|cookie|api[_-]?key|client[_-]?secret)(?:$|_)/i;

function fail(message){throw new Error(message);}

function cloneInert(value,path='value',seen=new WeakSet()){
  if(value===null||typeof value==='boolean'||typeof value==='string') return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return value;
  }
  if(!value||typeof value!=='object') fail(`${path} contains executable or unsupported data`);
  if(seen.has(value)) fail(`${path} contains cyclic or shared data`);
  seen.add(value);
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype) fail(`${path} must use a plain array`);
    const descriptors=Object.getOwnPropertyDescriptors(value);
    const length=descriptors.length.value;
    if(Reflect.ownKeys(descriptors).length!==length+1) fail(`${path} contains holes or hidden values`);
    const copy=[];
    for(let index=0;index<length;index++){
      const descriptor=descriptors[index];
      if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}[${index}] contains executable or hidden data`);
      copy.push(cloneInert(descriptor.value,`${path}[${index}]`,seen));
    }
    return copy;
  }
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null) fail(`${path} must be plain data`);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const copy={};
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string') fail(`${path} contains symbol data`);
    if(SECRET_KEY.test(key)) fail(`${path}.${key} contains secret or credential material`);
    const descriptor=descriptors[key];
    if(!descriptor?.enumerable||!('value' in descriptor)) fail(`${path}.${key} contains executable or hidden data`);
    copy[key]=cloneInert(descriptor.value,`${path}.${key}`,seen);
  }
  return copy;
}

function exactKeys(value,allowed,path){
  if(!value||typeof value!=='object'||Array.isArray(value)) fail(`${path} must be an object`);
  for(const key of Object.keys(value)) if(!allowed.has(key)) fail(`${path}.${key} is not allowed`);
  for(const key of allowed) if(!Object.hasOwn(value,key)) fail(`${path}.${key} is required`);
}

function text(value,name){
  if(typeof value!=='string'||!value.normalize('NFC').trim()||value.includes('\0')) fail(`${name} is required`);
  return value.normalize('NFC').trim();
}

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function same(actual,expected,name){if(actual!==expected) fail(`${name} does not match Workday authority`);}

function deepFreeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createWorkdayWorkerEvidenceAuthority(rawPolicy){
  const policy=cloneInert(rawPolicy,'policy');
  exactKeys(policy,new Set(['workdayTenantId','exportPolicy','workforcePolicy']),'policy');
  policy.workdayTenantId=text(policy.workdayTenantId,'workdayTenantId');

  const exportAuthority=createManagedExportAuthority(policy.exportPolicy);
  const workforceAuthority=createEffectiveDatedWorkforceAuthority(policy.workforcePolicy);
  const exportPolicy=policy.exportPolicy;
  const workforcePolicy=policy.workforcePolicy;

  same(exportPolicy.provider,'workday','export provider');
  same(workforcePolicy.provider,'workday','workforce provider');
  same(exportPolicy.wfmTenantId,workforcePolicy.wfmTenantId,'VECTOR tenant');
  same(exportPolicy.connectionId,workforcePolicy.connectionId,'connection');
  same(exportPolicy.accountId,policy.workdayTenantId,'export tenant');
  same(workforcePolicy.sourceInstanceId,policy.workdayTenantId,'workforce tenant');
  if(exportPolicy.exports.length!==1) fail('Workday worker authority requires exactly one approved export');
  same(exportPolicy.exports[0].dataset,'workers','export dataset');
  same(workforcePolicy.entity,'Get_Workers','workforce entity');
  same(workforcePolicy.queryMode,'as-of-snapshot','workforce query mode');
  same(exportPolicy.exports[0].schemaFingerprint,workforcePolicy.schemaFingerprint,'worker schema');
  let workforceHost;
  try{workforceHost=new URL(workforcePolicy.apiOrigin).hostname.toLowerCase();}
  catch{fail('Workday workforce origin is invalid');}
  same(exportPolicy.regionalHost,workforceHost,'Workday regional host');
  deepFreeze(policy);

  function authorizeExport(rawRequest){
    return exportAuthority.authorize(cloneInert(rawRequest,'exportRequest'));
  }

  function admit(rawEvidence){
    const evidence=cloneInert(rawEvidence,'evidence');
    exactKeys(evidence,new Set(['exportRequest','exportReceipt','workforceBatch']),'evidence');
    const exportPlan=exportAuthority.authorize(evidence.exportRequest);
    const exportDecision=exportAuthority.admitReceipt(exportPlan,evidence.exportReceipt);
    const workforceDecision=workforceAuthority.admitBatch(evidence.workforceBatch);
    if(workforceDecision.exactReplayCount!==0) fail('duplicate Workday worker rows require quarantine');

    const exportFrom=new Date(exportDecision.sourceWindow.from).toISOString();
    const exportTo=new Date(exportDecision.sourceWindow.to).toISOString();
    same(exportFrom,workforceDecision.windowStart,'source window start');
    same(exportTo,workforceDecision.windowEnd,'source window end');
    same(exportDecision.recordCount,workforceDecision.reportedRecordCount,'record count');
    if(Date.parse(exportDecision.completedAt)>Date.parse(workforceDecision.observedAt)){
      fail('Workday export completed after the workforce observation horizon');
    }

    const decision={
      workdayWorkerReconciliationCandidate:true,
      checkpointAdvanceAllowed:false,
      deletionAuthority:false,
      workerMutationAuthority:false,
      payrollAuthority:false,
      attendanceAuthority:false,
      writeBackAuthority:false,
      causalAuthority:false,
      provider:'workday',
      wfmTenantId:workforcePolicy.wfmTenantId,
      connectionId:workforcePolicy.connectionId,
      workdayTenantFingerprint:`sha256:${digest(policy.workdayTenantId)}`,
      integrationEventFingerprint:`sha256:${digest(exportDecision.providerRunId)}`,
      sourceWindow:{from:exportFrom,to:exportTo},
      observedAt:workforceDecision.observedAt,
      reportedRecordCount:workforceDecision.reportedRecordCount,
      uniqueRecordCount:workforceDecision.uniqueRecordCount,
      exactReplayCount:workforceDecision.exactReplayCount,
      assignmentIdentityCount:workforceDecision.identityCount,
      exportPageCount:exportDecision.pageCount,
      exportByteCount:exportDecision.byteCount,
      exportEvidenceFingerprint:`sha256:${digest(exportDecision)}`,
      workforceEvidenceFingerprint:workforceDecision.reconciliationFingerprint
    };
    decision.reconciliationFingerprint=`sha256:${digest(decision)}`;
    return deepFreeze(decision);
  }

  return Object.freeze({authorizeExport,admit});
}
