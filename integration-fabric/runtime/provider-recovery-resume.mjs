import {createHash} from 'node:crypto';

function required(value,name){
  if(typeof value!=='string'||!value.trim()) throw new TypeError(`${name} is required`);
  const text=value.normalize('NFC').trim();
  if(text.includes('\0')) throw new TypeError(`${name} contains NUL`);
  return text;
}
function count(value,name){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return n;
}
function plain(value,name){
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)){
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}
function canonical(value){
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
function sanitizedFailure(error){
  return freeze({
    code:typeof error?.code==='string'?error.code:'WFM_PROVIDER_RECOVERY_RESUME_FAILED',
    message:'provider recovery continuation failed'
  });
}
function validateAdapterResult(result,{providerRunId,workerId,continuationDigest}){
  plain(result,'adapter result');
  if(required(result.providerRunId,'adapter.providerRunId')!==providerRunId) throw new Error('adapter result provider run does not match recovery handoff');
  if(required(result.workerId,'adapter.workerId')!==workerId) throw new Error('adapter result worker does not match recovery handoff');
  if(required(result.continuationDigest,'adapter.continuationDigest')!==continuationDigest) throw new Error('adapter result continuation digest does not match recovery handoff');
  const sourceRecords=count(result.sourceRecords,'adapter.sourceRecords');
  const stagedRecords=count(result.stagedRecords,'adapter.stagedRecords');
  const heldRecords=count(result.heldRecords,'adapter.heldRecords');
  if(sourceRecords!==stagedRecords+heldRecords) throw new Error('provider recovery accounting does not reconcile source = staged + held');
  if(typeof result.complete!=='boolean') throw new TypeError('adapter.complete must be boolean');
  const receiptId=required(result.receiptId,'adapter.receiptId');
  const checkpointDigest=required(result.checkpointDigest,'adapter.checkpointDigest');
  if(!/^[a-f0-9]{64}$/i.test(checkpointDigest)) throw new TypeError('adapter.checkpointDigest must be sha256 hex');
  return {sourceRecords,stagedRecords,heldRecords,complete:result.complete,receiptId,checkpointDigest};
}

export async function resumeRecoveredProviderJob({
  handoffAuthority,token,tenant,providerRunId,workerId,currentStateDigest,
  resumeAdapter,verifyCompletion
}={}){
  if(!handoffAuthority||typeof handoffAuthority.consumeInternal!=='function') throw new TypeError('handoffAuthority is required');
  if(typeof resumeAdapter!=='function') throw new TypeError('resumeAdapter is required');
  if(typeof verifyCompletion!=='function') throw new TypeError('verifyCompletion is required');
  const scope={
    tenant:required(tenant,'tenant'),
    providerRunId:required(providerRunId,'providerRunId'),
    workerId:required(workerId,'workerId'),
    currentStateDigest:required(currentStateDigest,'currentStateDigest')
  };
  let handoff;
  try{
    handoff=await handoffAuthority.consumeInternal({token,...scope});
  }catch(error){throw error;}

  let result;
  try{
    result=await resumeAdapter(freeze({
      providerRunId:handoff.providerRunId,
      workerId:handoff.workerId,
      action:handoff.action,
      continuationDigest:handoff.continuationDigest,
      nextRequest:handoff.nextRequest,
      authority:freeze({
        providerNetworkAllowed:true,
        businessApplyAllowed:false,
        payrollMutationAllowed:false,
        workforceBusinessMutationAllowed:false,
        checkpointCommitAllowed:false,
        customerProofClaimAllowed:false
      })
    }));
  }catch(error){
    return freeze({
      status:'RECOVERY_RESUME_FAILED',
      providerRunId:handoff.providerRunId,
      workerId:handoff.workerId,
      continuationDigest:handoff.continuationDigest,
      failure:sanitizedFailure(error),
      checkpointCommitAllowed:false,
      businessApplyAllowed:false,
      customerProofClaimAllowed:false
    });
  }

  const accounting=validateAdapterResult(result,handoff);
  const evidence=freeze({
    schemaVersion:1,
    providerRunId:handoff.providerRunId,
    workerId:handoff.workerId,
    action:handoff.action,
    continuationDigest:handoff.continuationDigest,
    receiptId:accounting.receiptId,
    checkpointDigest:accounting.checkpointDigest,
    sourceRecords:accounting.sourceRecords,
    stagedRecords:accounting.stagedRecords,
    heldRecords:accounting.heldRecords,
    complete:accounting.complete,
    accountingDigest:digest({
      providerRunId:handoff.providerRunId,
      continuationDigest:handoff.continuationDigest,
      receiptId:accounting.receiptId,
      checkpointDigest:accounting.checkpointDigest,
      sourceRecords:accounting.sourceRecords,
      stagedRecords:accounting.stagedRecords,
      heldRecords:accounting.heldRecords,
      complete:accounting.complete
    })
  });

  if(!accounting.complete){
    return freeze({
      status:'RECOVERY_INCOMPLETE',
      ...evidence,
      checkpointCommitAllowed:false,
      businessApplyAllowed:false,
      customerProofClaimAllowed:false
    });
  }
  if(accounting.heldRecords!==0){
    return freeze({
      status:'RECOVERY_REVIEW_REQUIRED',
      ...evidence,
      checkpointCommitAllowed:false,
      businessApplyAllowed:false,
      customerProofClaimAllowed:false
    });
  }
  if(await verifyCompletion(evidence)!==true){
    return freeze({
      status:'RECOVERY_VERIFICATION_FAILED',
      ...evidence,
      checkpointCommitAllowed:false,
      businessApplyAllowed:false,
      customerProofClaimAllowed:false
    });
  }
  return freeze({
    status:'RECOVERED_COMPLETION_VERIFIED',
    ...evidence,
    checkpointCommitAllowed:true,
    businessApplyAllowed:false,
    writeBackAuthority:false,
    payrollAuthority:false,
    customerProofClaimAllowed:false
  });
}
