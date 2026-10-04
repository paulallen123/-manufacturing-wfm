import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {defineSignedWebhookRecipe,admitSignedWebhook} from './connector-signed-webhook.mjs';

const NOW=Date.parse('2026-10-04T17:10:00.000Z');

function setup(){
  const contract=compileUniversalConnectorContract(connectorById('ukg-pro-wfm'),{
    tenantId:'northstar-demo',connectionId:'ukg-sandbox'
  });
  const credentialRef='secret://tenant/northstar/ukg';
  const connectionPlan=buildSafeConnectionTest({
    providerKey:'ukg-pro-wfm',sourceInstanceId:'ukg-sandbox-source',
    wfmTenantId:'northstar-demo',connectionId:'ukg-sandbox',
    endpointHost:'api.ukg.example',environment:'sandbox',
    adapter:'signed-events',authMethod:'oauth2',credentialRef,
    capabilities:['webhooks','read'],requestedSemanticScopes:['worker.read']
  });
  const connectionEvidence={
    configurationFingerprint:connectionPlan.configurationFingerprint,
    providerKey:'ukg-pro-wfm',sourceInstanceId:'ukg-sandbox-source',
    wfmTenantId:'northstar-demo',connectionId:'ukg-sandbox',
    endpointHost:'api.ukg.example',environment:'sandbox',
    readOnly:true,rawCredentialObserved:false,employeeOrPayrollDataObserved:false,
    latencyMs:12,observedAt:'2026-10-04T17:09:30.000Z',
    steps:connectionPlan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  const recipe=defineSignedWebhookRecipe({
    schemaVersion:1,id:'ukg-worker-change-v1',providerId:'ukg-pro-wfm',target:'worker',
    signalType:'worker-change',signatureHeader:'x-ukg-signature',timestampHeader:'x-ukg-timestamp',
    deliveryIdHeader:'x-ukg-delivery-id',timestampKind:'iso8601',maxSkewMs:5*60*1000,replayTtlMs:24*60*60*1000,
    maxBodyBytes:1024*1024,maxHints:100,
    hints:{arrayPath:['changes'],fields:{
      entityId:['employeeId'],entityKind:['entityKind'],operation:['operation'],sourceVersion:['version']
    }}
  });
  return {contract,connectionPlan,connectionEvidence,credentialRef,recipe};
}
function request(bodyObj,overrides={}){
  const body=Buffer.from(JSON.stringify(bodyObj),'utf8');
  return {
    headers:{
      'x-ukg-signature':'sig-fixture',
      'x-ukg-timestamp':'2026-10-04T17:09:45.000Z',
      'x-ukg-delivery-id':'delivery-1',
      ...(overrides.headers||{})
    },
    body:overrides.body||body
  };
}
function replayStore(){
  const seen=new Map();
  return {
    seen,
    async claim(claim){
      const prior=seen.get(claim.deliveryId);
      if(!prior){seen.set(claim.deliveryId,claim.bodySha256);return 'acquired';}
      if(prior===claim.bodySha256)return 'duplicate';
      return 'conflict';
    }
  };
}
const verifier=async input=>({
  verified:input.signature==='sig-fixture',
  keyRevision:'key-v1',
  algorithm:'hmac-sha256'
});

test('verified webhook becomes a reconciliation signal, never record or mutation authority',async()=>{
  const ctx=setup();
  const signal=await admitSignedWebhook({
    ...ctx,request:request({changes:[
      {employeeId:'EMP-1',entityKind:'worker',operation:'updated',version:'v101'},
      {employeeId:'EMP-2',entityKind:'worker',operation:'created',version:'v102'}
    ]}),
    verifySignature:verifier,replayStore:replayStore(),nowMs:NOW
  });
  assert.equal(signal.status,'SIGNAL_VERIFIED');
  assert.equal(signal.providerReadRequired,true);
  assert.equal(signal.webhookRecordAuthority,false);
  assert.equal(signal.reconciliationRequired,true);
  assert.equal(signal.checkpointAdvanceAllowed,false);
  assert.equal(signal.businessMutationAllowed,false);
  assert.equal(signal.payrollAuthority,false);
  assert.equal(signal.writeBackAuthority,false);
  assert.equal(signal.customerProofClaimAllowed,false);
  assert.deepEqual(signal.hints,[
    {entityId:'EMP-1',entityKind:'worker',operation:'updated',sourceVersion:'v101'},
    {entityId:'EMP-2',entityKind:'worker',operation:'created',sourceVersion:'v102'}
  ]);
  assert.equal('body' in signal,false);
});

test('invalid signature fails before replay claim or payload use',async()=>{
  const ctx=setup(),store=replayStore();
  let claims=0;
  const wrapped={claim:async claim=>{claims++;return store.claim(claim);}};
  await assert.rejects(()=>admitSignedWebhook({
    ...ctx,request:request({changes:[{employeeId:'EMP-1'}]},{headers:{'x-ukg-signature':'bad'}}),
    verifySignature:verifier,replayStore:wrapped,nowMs:NOW
  }),error=>error.code==='WFM_WEBHOOK_SIGNATURE_INVALID');
  assert.equal(claims,0);
});

test('stale webhook timestamp fails closed',async()=>{
  const ctx=setup();
  await assert.rejects(()=>admitSignedWebhook({
    ...ctx,request:request({changes:[{employeeId:'EMP-1'}]},{headers:{'x-ukg-timestamp':'2026-10-04T16:00:00.000Z'}}),
    verifySignature:verifier,replayStore:replayStore(),nowMs:NOW
  }),error=>error.code==='WFM_WEBHOOK_TIMESTAMP_INVALID');
});

test('exact duplicate delivery is ignored but delivery-id content conflict is rejected',async()=>{
  const ctx=setup(),store=replayStore();
  const req=request({changes:[{employeeId:'EMP-1'}]});
  const first=await admitSignedWebhook({...ctx,request:req,verifySignature:verifier,replayStore:store,nowMs:NOW});
  assert.equal(first.status,'SIGNAL_VERIFIED');
  const duplicate=await admitSignedWebhook({...ctx,request:req,verifySignature:verifier,replayStore:store,nowMs:NOW});
  assert.equal(duplicate.status,'DUPLICATE_IGNORED');
  assert.equal(duplicate.providerReadRequired,false);

  const changed=request({changes:[{employeeId:'EMP-2'}]});
  await assert.rejects(()=>admitSignedWebhook({
    ...ctx,request:changed,verifySignature:verifier,replayStore:store,nowMs:NOW
  }),error=>error.code==='WFM_WEBHOOK_REPLAY_CONFLICT');
});

test('webhook body and hint counts are bounded',async()=>{
  const ctx=setup();
  const tiny=defineSignedWebhookRecipe({
    ...ctx.recipe,maxBodyBytes:32,maxHints:1
  });
  await assert.rejects(()=>admitSignedWebhook({
    ...ctx,recipe:tiny,request:request({changes:[{employeeId:'EMP-1'},{employeeId:'EMP-2'}]}),
    verifySignature:verifier,replayStore:replayStore(),nowMs:NOW
  }),error=>error.code==='WFM_WEBHOOK_LIMIT');

  const oneHint=defineSignedWebhookRecipe({...ctx.recipe,maxBodyBytes:1024,maxHints:1});
  await assert.rejects(()=>admitSignedWebhook({
    ...ctx,recipe:oneHint,request:request({changes:[{employeeId:'EMP-1'},{employeeId:'EMP-2'}]}),
    verifySignature:verifier,replayStore:replayStore(),nowMs:NOW
  }),error=>error.code==='WFM_WEBHOOK_LIMIT');
});

test('wrong tenant/connection contract and unsupported webhook connector fail before verification',async()=>{
  const ctx=setup();
  const other=compileUniversalConnectorContract(connectorById('ukg-pro-wfm'),{
    tenantId:'other-tenant',connectionId:'ukg-sandbox'
  });
  await assert.rejects(()=>admitSignedWebhook({
    ...ctx,contract:other,request:request({changes:[{employeeId:'EMP-1'}]}),
    verifySignature:async()=>{throw new Error('must not verify');},replayStore:replayStore(),nowMs:NOW
  }),error=>error.code==='WFM_WEBHOOK_BINDING_MISMATCH');

  const noWebhook=compileUniversalConnectorContract(connectorById('oracle-netsuite'),{
    tenantId:'northstar-demo',connectionId:'netsuite'
  });
  const fakeRecipe=defineSignedWebhookRecipe({
    schemaVersion:1,id:'bad',providerId:'oracle-netsuite',target:'worker',signalType:'worker-change',
    signatureHeader:'x-signature',timestampHeader:'x-time',deliveryIdHeader:'x-id'
  });
  await assert.rejects(()=>admitSignedWebhook({
    recipe:fakeRecipe,contract:noWebhook,connectionPlan:ctx.connectionPlan,connectionEvidence:ctx.connectionEvidence,
    request:request({changes:[{employeeId:'EMP-1'}]}),verifySignature:verifier,replayStore:replayStore(),nowMs:NOW
  }),error=>['WFM_WEBHOOK_TRANSPORT_UNAVAILABLE','WFM_WEBHOOK_BINDING_MISMATCH'].includes(error.code));
});

test('malformed UTF-8 or missing hint identity is rejected after signature proof',async()=>{
  const ctx=setup();
  const badUtf8=new Uint8Array([0xc3,0x28]);
  await assert.rejects(()=>admitSignedWebhook({
    ...ctx,request:request({}, {body:badUtf8}),verifySignature:verifier,replayStore:replayStore(),nowMs:NOW
  }),error=>error.code==='WFM_WEBHOOK_PAYLOAD_INVALID');

  await assert.rejects(()=>admitSignedWebhook({
    ...ctx,request:request({changes:[{operation:'updated'}]}),verifySignature:verifier,replayStore:replayStore(),nowMs:NOW
  }),error=>error.code==='WFM_WEBHOOK_PAYLOAD_INVALID');
});
