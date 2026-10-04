import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderRecoveryHandoffAuthority,providerRecoveryDigest} from './provider-recovery-handoff.mjs';
import {resumeRecoveredProviderJob} from './provider-recovery-resume.mjs';

function store(){
  const rows=new Map(),events=[],grants=new Set();
  return {
    async create(row){if(rows.has(row.id)||grants.has(row.actionGrantJti))return false;rows.set(row.id,structuredClone(row));grants.add(row.actionGrantJti);return true;},
    async get(id){return rows.has(id)?structuredClone(rows.get(id)):null;},
    async consume(id,when){const row=rows.get(id);if(!row||row.consumedAt)return false;row.consumedAt=when;return true;},
    async appendEvent(event){events.push(structuredClone(event));return true;},
    async events(id,tenant){return events.filter(e=>e.handoffId===id&&e.tenant===tenant).map(e=>structuredClone(e));}
  };
}
const d=value=>providerRecoveryDigest(value);
function authority(){
  return createProviderRecoveryHandoffAuthority({
    store:store(),
    key:'0123456789abcdef0123456789abcdef0123456789abcdef',
    now:()=>1_900_000_000_000
  });
}
async function issued(a,overrides={}){
  const tenant='northstar-demo',actionType='integration.retry';
  const input={
    actorType:'deterministic-recovery-executor',tenant,providerRunId:'run-1',workerId:'adapter-worker-1',actionType,
    targetDigest:d({target:'netsuite-workers'}),evidenceDigest:d({evidence:'ok'}),verificationDigest:d({verification:'ok'}),
    stateDigest:d({state:'running',checkpoint:2}),actionGrantJti:'grant-1',
    safetyDecision:{allowed:true,type:actionType,tenant,targetTenant:tenant,decisionDigest:d({allowed:true})},
    nextRequest:{offset:2,limit:2},ttlMs:60_000,...overrides
  };
  const handoff=await a.issueInternal(input);
  return {input,handoff};
}
const checkpointDigest=d({checkpoint:'page-3'});

test('normal adapter receives retained continuation internally and green result exposes no raw continuation',async()=>{
  const a=authority(),{input,handoff}=await issued(a);
  let adapterRequest,verification;
  const result=await resumeRecoveredProviderJob({
    handoffAuthority:a,token:handoff.internalToken,tenant:input.tenant,providerRunId:input.providerRunId,
    workerId:input.workerId,currentStateDigest:input.stateDigest,
    resumeAdapter:async request=>{
      adapterRequest=request;
      return {
        providerRunId:'run-1',workerId:'adapter-worker-1',continuationDigest:request.continuationDigest,
        sourceRecords:2,stagedRecords:2,heldRecords:0,complete:true,receiptId:'receipt-1',checkpointDigest
      };
    },
    verifyCompletion:async evidence=>{verification=evidence;return true;}
  });
  assert.deepEqual(adapterRequest.nextRequest,{limit:2,offset:2});
  assert.equal(adapterRequest.authority.providerNetworkAllowed,true);
  assert.equal(adapterRequest.authority.businessApplyAllowed,false);
  assert.equal(adapterRequest.authority.checkpointCommitAllowed,false);
  assert.equal(result.status,'RECOVERED_COMPLETION_VERIFIED');
  assert.equal(result.checkpointCommitAllowed,true);
  assert.equal(result.businessApplyAllowed,false);
  assert.equal(result.writeBackAuthority,false);
  assert.equal(result.customerProofClaimAllowed,false);
  assert.equal(verification.sourceRecords,2);
  const publicText=JSON.stringify(result);
  assert.equal(publicText.includes('nextRequest'),false);
  assert.equal(publicText.includes('"offset":2'),false);
});

test('held records prevent green recovery and checkpoint commit',async()=>{
  const a=authority(),{input,handoff}=await issued(a);
  let verified=false;
  const result=await resumeRecoveredProviderJob({
    handoffAuthority:a,token:handoff.internalToken,tenant:input.tenant,providerRunId:input.providerRunId,
    workerId:input.workerId,currentStateDigest:input.stateDigest,
    resumeAdapter:async request=>({
      providerRunId:'run-1',workerId:'adapter-worker-1',continuationDigest:request.continuationDigest,
      sourceRecords:3,stagedRecords:2,heldRecords:1,complete:true,receiptId:'receipt-held',checkpointDigest
    }),
    verifyCompletion:async()=>{verified=true;return true;}
  });
  assert.equal(result.status,'RECOVERY_REVIEW_REQUIRED');
  assert.equal(result.checkpointCommitAllowed,false);
  assert.equal(verified,false);
});

test('incomplete provider continuation cannot commit checkpoint',async()=>{
  const a=authority(),{input,handoff}=await issued(a);
  const result=await resumeRecoveredProviderJob({
    handoffAuthority:a,token:handoff.internalToken,tenant:input.tenant,providerRunId:input.providerRunId,
    workerId:input.workerId,currentStateDigest:input.stateDigest,
    resumeAdapter:async request=>({
      providerRunId:'run-1',workerId:'adapter-worker-1',continuationDigest:request.continuationDigest,
      sourceRecords:2,stagedRecords:2,heldRecords:0,complete:false,receiptId:'receipt-incomplete',checkpointDigest
    }),
    verifyCompletion:async()=>true
  });
  assert.equal(result.status,'RECOVERY_INCOMPLETE');
  assert.equal(result.checkpointCommitAllowed,false);
});

test('source staged held accounting mismatch fails closed',async()=>{
  const a=authority(),{input,handoff}=await issued(a);
  await assert.rejects(
    ()=>resumeRecoveredProviderJob({
      handoffAuthority:a,token:handoff.internalToken,tenant:input.tenant,providerRunId:input.providerRunId,
      workerId:input.workerId,currentStateDigest:input.stateDigest,
      resumeAdapter:async request=>({
        providerRunId:'run-1',workerId:'adapter-worker-1',continuationDigest:request.continuationDigest,
        sourceRecords:4,stagedRecords:2,heldRecords:1,complete:true,receiptId:'receipt-bad',checkpointDigest
      }),
      verifyCompletion:async()=>true
    }),
    /source = staged \+ held/
  );
});

test('independent completion verification can withhold checkpoint after otherwise clean recovery',async()=>{
  const a=authority(),{input,handoff}=await issued(a);
  const result=await resumeRecoveredProviderJob({
    handoffAuthority:a,token:handoff.internalToken,tenant:input.tenant,providerRunId:input.providerRunId,
    workerId:input.workerId,currentStateDigest:input.stateDigest,
    resumeAdapter:async request=>({
      providerRunId:'run-1',workerId:'adapter-worker-1',continuationDigest:request.continuationDigest,
      sourceRecords:2,stagedRecords:2,heldRecords:0,complete:true,receiptId:'receipt-verify',checkpointDigest
    }),
    verifyCompletion:async()=>false
  });
  assert.equal(result.status,'RECOVERY_VERIFICATION_FAILED');
  assert.equal(result.checkpointCommitAllowed,false);
});

test('adapter failure is sanitised and raw continuation never leaves orchestration result',async()=>{
  const a=authority(),{input,handoff}=await issued(a);
  const result=await resumeRecoveredProviderJob({
    handoffAuthority:a,token:handoff.internalToken,tenant:input.tenant,providerRunId:input.providerRunId,
    workerId:input.workerId,currentStateDigest:input.stateDigest,
    resumeAdapter:async request=>{
      const error=new Error('provider exploded on offset '+request.nextRequest.offset);
      error.code='WFM_PROVIDER_TRANSPORT_ERROR';
      throw error;
    },
    verifyCompletion:async()=>true
  });
  assert.equal(result.status,'RECOVERY_RESUME_FAILED');
  assert.equal(result.failure.code,'WFM_PROVIDER_TRANSPORT_ERROR');
  assert.equal(result.failure.message,'provider recovery continuation failed');
  assert.equal(JSON.stringify(result).includes('offset'),false);
  assert.equal(result.checkpointCommitAllowed,false);
});

test('wrong scope is rejected before normal adapter receives continuation',async()=>{
  const a=authority(),{input,handoff}=await issued(a);
  let called=false;
  await assert.rejects(
    ()=>resumeRecoveredProviderJob({
      handoffAuthority:a,token:handoff.internalToken,tenant:'other-tenant',providerRunId:input.providerRunId,
      workerId:input.workerId,currentStateDigest:input.stateDigest,
      resumeAdapter:async()=>{called=true;return {};},
      verifyCompletion:async()=>true
    }),
    error=>error.code==='WFM_PROVIDER_HANDOFF_SCOPE'
  );
  assert.equal(called,false);
});

test('adapter cannot substitute another run worker or continuation digest',async()=>{
  for(const mutation of [
    result=>({...result,providerRunId:'other-run'}),
    result=>({...result,workerId:'other-worker'}),
    result=>({...result,continuationDigest:d({different:true})})
  ]){
    const a=authority(),{input,handoff}=await issued(a);
    await assert.rejects(
      ()=>resumeRecoveredProviderJob({
        handoffAuthority:a,token:handoff.internalToken,tenant:input.tenant,providerRunId:input.providerRunId,
        workerId:input.workerId,currentStateDigest:input.stateDigest,
        resumeAdapter:async request=>mutation({
          providerRunId:'run-1',workerId:'adapter-worker-1',continuationDigest:request.continuationDigest,
          sourceRecords:1,stagedRecords:1,heldRecords:0,complete:true,receiptId:'receipt-bind',checkpointDigest
        }),
        verifyCompletion:async()=>true
      }),
      /does not match recovery handoff/
    );
  }
});
