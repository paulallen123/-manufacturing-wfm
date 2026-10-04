import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {createConnectorBuildManifest,assessConnectorCertification} from './connector-certification.mjs';

const SOURCE='84f1ffd7aa6485cf40b59620df756123b6643743';
const IMPL='sha256:'+'1'.repeat(64);
const MAPPING='sha256:'+'2'.repeat(64);
const SCHEMAS=['3'.repeat(64),'4'.repeat(64)];
const OBSERVED='2026-10-04T17:40:00.000Z';

function contract(connectionId='netsuite-certification'){
  return compileUniversalConnectorContract(connectorById('oracle-netsuite'),{
    tenantId:'northstar-demo',connectionId
  });
}
function manifest(c=contract()){
  return createConnectorBuildManifest({
    contract:c,target:'worker',sourceSha:SOURCE,
    implementationKind:'declarative-rest-recipe',
    implementationFingerprint:IMPL,
    mappingFingerprint:MAPPING,
    schemaFingerprints:SCHEMAS
  });
}
function ci(m){
  return {
    status:'PASS',sourceSha:SOURCE,packageFingerprint:m.packageFingerprint,
    workflowRunId:'37218831657',observedAt:OBSERVED
  };
}
function providerProof(m,overrides={}){
  return {
    schemaVersion:1,status:'PROVIDER_READ_ROUNDTRIP_PROVEN',
    binding:{
      candidateSha:SOURCE,deploymentId:'integration-lab-deployment-1',
      proofRunId:'netsuite-provider-proof-1'
    },
    providerId:'oracle-netsuite',tenantId:'northstar-demo',connectionId:'netsuite-provider-proof',
    target:'worker',configurationFingerprint:'config-1',
    mappingFingerprint:MAPPING,schemaFingerprints:SCHEMAS,
    batchDigest:'sha256:'+'5'.repeat(64),recoveryReceiptId:'recovery-1',
    evidenceFingerprint:'sha256:'+'6'.repeat(64),observedAt:OBSERVED,
    readProven:true,recoveryProven:true,writeProven:false,
    productionCertified:false,customerReady:false,customerProofClaimAllowed:false,
    promotionEligibility:'SHADOW_READ_ONLY',
    ...overrides
  };
}
function writeProof(m,overrides={}){
  return {
    status:'PROVIDER_WRITE_ROUNDTRIP_PROVEN',providerId:'oracle-netsuite',target:'worker',
    sourceSha:SOURCE,packageFingerprint:m.packageFingerprint,
    idempotencyProven:true,readBackProven:true,rollbackOrCompensationProven:true,
    evidenceFingerprint:'sha256:'+'7'.repeat(64),observedAt:OBSERVED,
    ...overrides
  };
}
function productionProof(m,overrides={}){
  return {
    status:'PRODUCTION_CERTIFIED',providerId:'oracle-netsuite',target:'worker',
    sourceSha:SOURCE,packageFingerprint:m.packageFingerprint,
    securityProven:true,recoveryProven:true,operationalSloProven:true,
    evidenceFingerprint:'sha256:'+'8'.repeat(64),observedAt:OBSERVED,
    ...overrides
  };
}

test('build manifest is reusable across customer connections with same connector contract shape',()=>{
  const a=manifest(contract('connection-a'));
  const b=manifest(contract('connection-b'));
  assert.equal(a.contractShapeFingerprint,b.contractShapeFingerprint);
  assert.equal(a.packageFingerprint,b.packageFingerprint);
  assert.equal(a.providerId,'oracle-netsuite');
  assert.equal(a.target,'worker');
});

test('built connector stays BUILT until independent CI receipt exists',async()=>{
  const c=contract(),m=manifest(c);
  const result=await assessConnectorCertification({contract:c,manifest:m});
  assert.equal(result.state,'BUILT');
  assert.equal(result.catalogVisible,true);
  assert.equal(result.customerSelectable,false);
  assert.equal(result.readProven,false);
  assert.equal(result.writeProven,false);
  assert.equal(result.productionCertified,false);
  assert.equal(result.customerReadyClaimAllowed,false);
});

test('verified CI raises connector only to CI_TESTED, not supported/provider-proven',async()=>{
  const c=contract(),m=manifest(c),receipt=ci(m);
  const result=await assessConnectorCertification({
    contract:c,manifest:m,ciReceipt:receipt,
    verifyCiReceipt:async evidence=>{
      assert.equal(evidence.packageFingerprint,m.packageFingerprint);
      return true;
    }
  });
  assert.equal(result.state,'CI_TESTED');
  assert.equal(result.customerSelectable,false);
  assert.equal(result.readProven,false);
});

test('exact provider read proof promotes only to PROVIDER_READ_PROVEN',async()=>{
  const c=contract(),m=manifest(c),receipt=ci(m),proof=providerProof(m);
  const result=await assessConnectorCertification({
    contract:c,manifest:m,ciReceipt:receipt,verifyCiReceipt:async()=>true,
    providerReadProof:proof,verifyProviderReadProof:async evidence=>{
      assert.equal(evidence.binding.candidateSha,SOURCE);
      assert.equal(evidence.connectionId,'netsuite-provider-proof');
      return true;
    }
  });
  assert.equal(result.state,'PROVIDER_READ_PROVEN');
  assert.equal(result.customerSelectable,true);
  assert.equal(result.readProven,true);
  assert.equal(result.writeProven,false);
  assert.equal(result.productionCertified,false);
  assert.equal(result.customerReadyClaimAllowed,false);
  assert.equal(result.evidence.providerRead.connectionId,'netsuite-provider-proof');
});

test('provider proof cannot be borrowed across source build target mapping or schema',async()=>{
  const c=contract(),m=manifest(c),receipt=ci(m);
  for(const proof of [
    providerProof(m,{binding:{candidateSha:'9'.repeat(40),deploymentId:'d',proofRunId:'r'}}),
    providerProof(m,{target:'production-demand'}),
    providerProof(m,{mappingFingerprint:'sha256:'+'a'.repeat(64)}),
    providerProof(m,{schemaFingerprints:['b'.repeat(64)]})
  ]){
    await assert.rejects(()=>assessConnectorCertification({
      contract:c,manifest:m,ciReceipt:receipt,verifyCiReceipt:async()=>true,
      providerReadProof:proof,verifyProviderReadProof:async()=>true
    }),error=>error.code==='WFM_CONNECTOR_CERTIFICATION_PROVIDER_PROOF_MISMATCH');
  }
});

test('provider proof cannot skip CI and every verifier is mandatory',async()=>{
  const c=contract(),m=manifest(c),proof=providerProof(m);
  await assert.rejects(()=>assessConnectorCertification({
    contract:c,manifest:m,providerReadProof:proof,verifyProviderReadProof:async()=>true
  }),error=>error.code==='WFM_CONNECTOR_CERTIFICATION_ORDER_INVALID');

  await assert.rejects(()=>assessConnectorCertification({
    contract:c,manifest:m,ciReceipt:ci(m)
  }),/verifyCiReceipt is required/);
});

test('failed independent CI or provider verification never promotes state',async()=>{
  const c=contract(),m=manifest(c);
  await assert.rejects(()=>assessConnectorCertification({
    contract:c,manifest:m,ciReceipt:ci(m),verifyCiReceipt:async()=>false
  }),error=>error.code==='WFM_CONNECTOR_CERTIFICATION_CI_VERIFICATION_FAILED');

  await assert.rejects(()=>assessConnectorCertification({
    contract:c,manifest:m,ciReceipt:ci(m),verifyCiReceipt:async()=>true,
    providerReadProof:providerProof(m),verifyProviderReadProof:async()=>false
  }),error=>error.code==='WFM_CONNECTOR_CERTIFICATION_PROVIDER_VERIFICATION_FAILED');
});

test('write proof needs idempotency readback and rollback/compensation evidence',async()=>{
  const c=contract(),m=manifest(c);
  for(const override of [
    {idempotencyProven:false},{readBackProven:false},{rollbackOrCompensationProven:false}
  ]){
    await assert.rejects(()=>assessConnectorCertification({
      contract:c,manifest:m,ciReceipt:ci(m),verifyCiReceipt:async()=>true,
      providerReadProof:providerProof(m),verifyProviderReadProof:async()=>true,
      writeProof:writeProof(m,override),verifyWriteProof:async()=>true
    }),error=>error.code==='WFM_CONNECTOR_CERTIFICATION_WRITE_PROOF_INVALID');
  }
});

test('verified write proof raises state without inventing production certification',async()=>{
  const c=contract(),m=manifest(c);
  const result=await assessConnectorCertification({
    contract:c,manifest:m,ciReceipt:ci(m),verifyCiReceipt:async()=>true,
    providerReadProof:providerProof(m),verifyProviderReadProof:async()=>true,
    writeProof:writeProof(m),verifyWriteProof:async()=>true
  });
  assert.equal(result.state,'PROVIDER_WRITE_PROVEN');
  assert.equal(result.readProven,true);
  assert.equal(result.writeProven,true);
  assert.equal(result.productionCertified,false);
  assert.equal(result.customerReadyClaimAllowed,false);
});

test('production certification requires independent security recovery and SLO evidence',async()=>{
  const c=contract(),m=manifest(c);
  const result=await assessConnectorCertification({
    contract:c,manifest:m,ciReceipt:ci(m),verifyCiReceipt:async()=>true,
    providerReadProof:providerProof(m),verifyProviderReadProof:async()=>true,
    writeProof:writeProof(m),verifyWriteProof:async()=>true,
    productionProof:productionProof(m),verifyProductionProof:async()=>true
  });
  assert.equal(result.state,'PRODUCTION_CERTIFIED');
  assert.equal(result.productionCertified,true);
  assert.equal(result.writeProven,true);
  assert.equal(result.customerReadyClaimAllowed,false);

  await assert.rejects(()=>assessConnectorCertification({
    contract:c,manifest:m,ciReceipt:ci(m),verifyCiReceipt:async()=>true,
    providerReadProof:providerProof(m),verifyProviderReadProof:async()=>true,
    productionProof:productionProof(m,{operationalSloProven:false}),
    verifyProductionProof:async()=>true
  }),error=>error.code==='WFM_CONNECTOR_CERTIFICATION_PRODUCTION_PROOF_INVALID');
});

test('manifest cannot be reused for a different provider or target contract shape',async()=>{
  const ns=contract(),m=manifest(ns);
  const workday=compileUniversalConnectorContract(connectorById('workday'),{
    tenantId:'northstar-demo',connectionId:'workday'
  });
  await assert.rejects(()=>assessConnectorCertification({
    contract:workday,manifest:m
  }),error=>[
    'WFM_CONNECTOR_CERTIFICATION_TARGET_UNAVAILABLE',
    'WFM_CONNECTOR_CERTIFICATION_MANIFEST_MISMATCH'
  ].includes(error.code));
});
