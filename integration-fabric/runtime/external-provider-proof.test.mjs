import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {acquireNetSuiteWorkers} from './provider-acquisition.mjs';
import {stageCanonicalBatch} from './provider-ingestion-gate.mjs';
import {runExternalProviderReadProof} from './external-provider-proof.mjs';

const NOW=Date.parse('2026-10-04T17:30:00.000Z');
const CANDIDATE='40482dc091ea57bb04d14fee8ae4de9ba36ebc2d';

function setup(){
  const contract=compileUniversalConnectorContract(connectorById('oracle-netsuite'),{
    tenantId:'northstar-demo',connectionId:'netsuite-provider-proof'
  });
  const credentialRef='secret://tenant/northstar/netsuite-provider-proof';
  const connectionPlan=buildSafeConnectionTest({
    providerKey:'oracle-netsuite',sourceInstanceId:'netsuite-sandbox-1',
    wfmTenantId:'northstar-demo',connectionId:'netsuite-provider-proof',
    endpointHost:'1234567-sb1.suitetalk.api.netsuite.com',
    environment:'sandbox',adapter:'http-json',authMethod:'oauth2',credentialRef,
    capabilities:['metadata','read'],requestedSemanticScopes:['worker.read']
  });
  const connectionEvidence={
    configurationFingerprint:connectionPlan.configurationFingerprint,
    providerKey:'oracle-netsuite',sourceInstanceId:'netsuite-sandbox-1',
    wfmTenantId:'northstar-demo',connectionId:'netsuite-provider-proof',
    endpointHost:'1234567-sb1.suitetalk.api.netsuite.com',
    environment:'sandbox',readOnly:true,rawCredentialObserved:false,
    employeeOrPayrollDataObserved:false,latencyMs:14,
    observedAt:'2026-10-04T17:29:30.000Z',
    steps:connectionPlan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  return {
    contract,credentialRef,connectionPlan,connectionEvidence,
    proofBinding:{candidateSha:CANDIDATE,deploymentId:'integration-lab-deployment-1',proofRunId:'provider-proof-run-1'}
  };
}
function netSuiteRows(){
  return {
    count:2,offset:0,totalResults:2,hasMore:false,
    items:[
      {id:'1',entityid:'EMP1',firstname:'Ada',lastname:'Lovelace',email:'ada@example.test',isinactive:'F'},
      {id:'2',entityid:'EMP2',firstname:'Grace',lastname:'Hopper',email:'grace@example.test',isinactive:'F'}
    ]
  };
}
async function acquire(ctx){
  return acquireNetSuiteWorkers({
    contract:ctx.contract,connectionPlan:ctx.connectionPlan,connectionEvidence:ctx.connectionEvidence,
    credentialRef:ctx.credentialRef,runId:'netsuite-read-roundtrip-1',pageSize:100,nowMs:NOW,
    credentialAuthorizer:async()=>({authorization:'Bearer fixture'}),
    fetchImpl:async()=>new Response(JSON.stringify(netSuiteRows()),{status:200}),
    clock:()=>NOW
  });
}
async function stage(ctx,acquisition){
  let command;
  return stageCanonicalBatch({
    acquisition,contract:ctx.contract,
    stageWriter:async c=>{
      command=c;
      return {
        stagingId:'provider-proof-stage-1',acceptedAt:'2026-10-04T17:30:00.000Z',
        batchDigest:c.batchDigest,tenantId:c.binding.tenantId,connectionId:c.binding.connectionId,
        providerId:c.binding.providerId,target:c.binding.target,runId:c.binding.runId,
        rowCount:c.rowCount,complete:true
      };
    },
    verifyStagedBatch:async request=>request.batchDigest===command.batchDigest&&request.rowCount===2
  });
}
function recovery(ctx,overrides={}){
  return {
    status:'RECOVERED_VERIFIED',
    providerId:'oracle-netsuite',tenantId:'northstar-demo',connectionId:'netsuite-provider-proof',
    receiptId:'provider-recovery-receipt-1',
    observedAt:'2026-10-04T17:30:00.000Z',
    configurationFingerprint:ctx.connectionPlan.configurationFingerprint,
    readOnly:true,reconciliationVerified:true,writeRecoveryPerformed:false,businessMutationAllowed:false,
    ...overrides
  };
}

test('exact NetSuite provider proof reaches read-roundtrip proven but never write/customer-ready',async()=>{
  const ctx=setup();
  let verifierPayload;
  const result=await runExternalProviderReadProof({
    ...ctx,nowMs:NOW,
    acquireProvider:async authority=>{
      assert.equal(authority.readOnly,true);
      assert.equal(authority.writeAllowed,false);
      assert.equal(authority.binding.candidateSha,CANDIDATE);
      return acquire(ctx);
    },
    stageProvider:async ({authority,acquisition})=>{
      assert.equal(authority.businessApplyAllowed,false);
      assert.equal(authority.writeBackAllowed,false);
      return stage(ctx,acquisition);
    },
    recoverProvider:async authority=>{
      assert.equal(authority.writeAllowed,false);
      assert.equal(authority.destructiveAllowed,false);
      return recovery(ctx);
    },
    verifyProof:async payload=>{verifierPayload=payload;return true;}
  });
  assert.equal(result.status,'PROVIDER_READ_ROUNDTRIP_PROVEN');
  assert.equal(result.readProven,true);
  assert.equal(result.recoveryProven,true);
  assert.equal(result.writeProven,false);
  assert.equal(result.productionCertified,false);
  assert.equal(result.customerReady,false);
  assert.equal(result.customerProofClaimAllowed,false);
  assert.equal(result.promotionEligibility,'SHADOW_READ_ONLY');
  assert.equal(result.binding.candidateSha,CANDIDATE);
  assert.equal(result.binding.deploymentId,'integration-lab-deployment-1');
  assert.equal(verifierPayload.claims.writeRoundtripProven,false);
  assert.equal(verifierPayload.claims.customerReady,false);
  assert.match(result.evidenceFingerprint,/^sha256:[a-f0-9]{64}$/);
});

test('partial/quarantined acquisition cannot advance to staging',async()=>{
  const ctx=setup();
  let staged=false,recovered=false;
  await assert.rejects(()=>runExternalProviderReadProof({
    ...ctx,nowMs:NOW,
    acquireProvider:async()=>({
      status:'QUARANTINED',providerId:'oracle-netsuite',tenantId:'northstar-demo',
      connectionId:'netsuite-provider-proof',reconciliation:{safeToCommit:false,safeToAdvanceWatermark:false},
      checkpointCandidate:null,deletionAuthority:false,customerProofClaimAllowed:false,records:[]
    }),
    stageProvider:async()=>{staged=true;return {};},
    recoverProvider:async()=>{recovered=true;return {};},
    verifyProof:async()=>true
  }),error=>error.code==='WFM_PROVIDER_PROOF_ACQUISITION_NOT_PROVEN');
  assert.equal(staged,false);
  assert.equal(recovered,false);
});

test('stage mismatch fails before recovery',async()=>{
  const ctx=setup();
  let recovered=false;
  await assert.rejects(()=>runExternalProviderReadProof({
    ...ctx,nowMs:NOW,
    acquireProvider:async()=>acquire(ctx),
    stageProvider:async ({acquisition})=>{
      const valid=await stage(ctx,acquisition);
      return {...valid,batchDigest:'sha256:'+'0'.repeat(64)};
    },
    recoverProvider:async()=>{recovered=true;return recovery(ctx);},
    verifyProof:async()=>true
  }),error=>error.code==='WFM_PROVIDER_PROOF_STAGE_MISMATCH');
  assert.equal(recovered,false);
});

test('recovery cannot widen into writes, destructive actions or business mutation',async()=>{
  for(const override of [
    {readOnly:false},
    {writeRecoveryPerformed:true},
    {businessMutationAllowed:true},
    {reconciliationVerified:false}
  ]){
    const ctx=setup();
    await assert.rejects(()=>runExternalProviderReadProof({
      ...ctx,nowMs:NOW,
      acquireProvider:async()=>acquire(ctx),
      stageProvider:async ({acquisition})=>stage(ctx,acquisition),
      recoverProvider:async()=>recovery(ctx,override),
      verifyProof:async()=>true
    }),error=>error.code==='WFM_PROVIDER_PROOF_RECOVERY_AUTHORITY_INVALID');
  }
});

test('recovery from another tenant connection or configuration cannot satisfy proof',async()=>{
  for(const override of [
    {tenantId:'other-tenant'},
    {connectionId:'other-connection'}
  ]){
    const ctx=setup();
    await assert.rejects(()=>runExternalProviderReadProof({
      ...ctx,nowMs:NOW,
      acquireProvider:async()=>acquire(ctx),
      stageProvider:async ({acquisition})=>stage(ctx,acquisition),
      recoverProvider:async()=>recovery(ctx,override),
      verifyProof:async()=>true
    }),error=>error.code==='WFM_PROVIDER_PROOF_BINDING_MISMATCH');
  }

  const ctx=setup();
  await assert.rejects(()=>runExternalProviderReadProof({
    ...ctx,nowMs:NOW,
    acquireProvider:async()=>acquire(ctx),
    stageProvider:async ({acquisition})=>stage(ctx,acquisition),
    recoverProvider:async()=>recovery(ctx,{configurationFingerprint:'different-config'}),
    verifyProof:async()=>true
  }),error=>error.code==='WFM_PROVIDER_PROOF_RECOVERY_MISMATCH');
});

test('independent verifier can reject an otherwise clean provider proof',async()=>{
  const ctx=setup();
  await assert.rejects(()=>runExternalProviderReadProof({
    ...ctx,nowMs:NOW,
    acquireProvider:async()=>acquire(ctx),
    stageProvider:async ({acquisition})=>stage(ctx,acquisition),
    recoverProvider:async()=>recovery(ctx),
    verifyProof:async()=>false
  }),error=>error.code==='WFM_PROVIDER_PROOF_VERIFICATION_FAILED');
});

test('proof binding requires full candidate SHA and exact deployment/run identities',async()=>{
  const ctx=setup();
  for(const proofBinding of [
    {...ctx.proofBinding,candidateSha:'40482dc0'},
    {...ctx.proofBinding,deploymentId:''},
    {...ctx.proofBinding,proofRunId:''}
  ]){
    await assert.rejects(()=>runExternalProviderReadProof({
      ...ctx,proofBinding,nowMs:NOW,
      acquireProvider:async()=>{throw new Error('must not run');},
      stageProvider:async()=>{throw new Error('must not run');},
      recoverProvider:async()=>{throw new Error('must not run');},
      verifyProof:async()=>true
    }));
  }
});

test('connection evidence from another endpoint/tenant is rejected before provider acquisition',async()=>{
  const ctx=setup();
  let acquired=false;
  await assert.rejects(()=>runExternalProviderReadProof({
    ...ctx,nowMs:NOW,
    connectionEvidence:{...ctx.connectionEvidence,endpointHost:'attacker.example'},
    acquireProvider:async()=>{acquired=true;return {};},
    stageProvider:async()=>({}),recoverProvider:async()=>({}),verifyProof:async()=>true
  }),error=>error.code==='WFM_PROVIDER_PROOF_CONNECTION_NOT_PROVEN');
  assert.equal(acquired,false);
});
