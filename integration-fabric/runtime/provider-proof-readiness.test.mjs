import test from 'node:test';
import assert from 'node:assert/strict';
import {assessProviderProofReadiness} from './provider-proof-readiness.mjs';

const SHA='ff850e0cadaed8733c5db965f41347cb1d190b4a';
function base(){
  return {
    providerId:'oracle-netsuite',tenantId:'northstar-demo',connectionId:'netsuite-sandbox',
    candidateSha:SHA,deploymentId:'integration-lab-1',proofRunId:'netsuite-proof-1',
    requiredBindings:['NETSUITE_ACCOUNT_ID','NETSUITE_CLIENT_ID','NETSUITE_TOKEN_REF'],
    availableBindingNames:['NETSUITE_ACCOUNT_ID','NETSUITE_CLIENT_ID','NETSUITE_TOKEN_REF'],
    connectionPlan:{
      configuration:{
        providerKey:'oracle-netsuite',wfmTenantId:'northstar-demo',connectionId:'netsuite-sandbox'
      },
      configurationFingerprint:'cfg-1'
    },
    connectionEvidence:{
      providerKey:'oracle-netsuite',wfmTenantId:'northstar-demo',connectionId:'netsuite-sandbox',
      configurationFingerprint:'cfg-1',readOnly:true,rawCredentialObserved:false
    },
    connectorCertification:{state:'CI_TESTED',providerId:'oracle-netsuite'}
  };
}
test('all exact bindings and evidence make provider proof immediately runnable',()=>{
  const result=assessProviderProofReadiness(base());
  assert.equal(result.status,'READY_FOR_PROVIDER_READ_PROOF');
  assert.equal(result.ready,true);
  assert.equal(result.nextAction,'RUN_EXTERNAL_PROVIDER_READ_PROOF');
  assert.deepEqual(result.missingBindings,[]);
  assert.equal(result.deploymentMutationAllowed,false);
  assert.equal(result.customerProofMutationAllowed,false);
  assert.equal(result.writeProofAllowed,false);
  assert.equal(result.customerReadyClaimAllowed,false);
});
test('missing provider binding blocks proof without exposing secret values',()=>{
  const input=base();
  input.availableBindingNames=['NETSUITE_ACCOUNT_ID'];
  const result=assessProviderProofReadiness(input);
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.ready,false);
  assert.deepEqual(result.missingBindings,['NETSUITE_CLIENT_ID','NETSUITE_TOKEN_REF']);
  assert.ok(result.reasons.includes('provider-bindings-missing'));
  assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('wrong tenant connection provider or fingerprint blocks proof',()=>{
  for(const mutate of [
    x=>x.connectionPlan.configuration.providerKey='sap-s4hana',
    x=>x.connectionPlan.configuration.wfmTenantId='other',
    x=>x.connectionPlan.configuration.connectionId='other',
    x=>x.connectionEvidence.providerKey='sap-s4hana',
    x=>x.connectionEvidence.wfmTenantId='other',
    x=>x.connectionEvidence.connectionId='other',
    x=>x.connectionEvidence.configurationFingerprint='cfg-2'
  ]){
    const input=base();mutate(input);
    const result=assessProviderProofReadiness(input);
    assert.equal(result.ready,false);
    assert.ok(result.reasons.length>0);
  }
});
test('unsafe connection evidence blocks provider proof',()=>{
  for(const override of [{readOnly:false},{rawCredentialObserved:true}]){
    const input=base();Object.assign(input.connectionEvidence,override);
    const result=assessProviderProofReadiness(input);
    assert.equal(result.ready,false);
  }
});
test('catalogued or merely built connector cannot enter real provider proof',()=>{
  for(const state of ['CATALOGUED','BUILT']){
    const input=base();input.connectorCertification.state=state;
    const result=assessProviderProofReadiness(input);
    assert.equal(result.ready,false);
    assert.ok(result.reasons.includes('connector-not-ci-tested'));
  }
});
test('certification from another provider cannot be borrowed',()=>{
  const input=base();input.connectorCertification.providerId='workday';
  const result=assessProviderProofReadiness(input);
  assert.equal(result.ready,false);
  assert.ok(result.reasons.includes('certification-provider-mismatch'));
});
test('full candidate SHA and proof identities are mandatory before readiness evaluation',()=>{
  for(const override of [
    {candidateSha:'ff850e0c'},
    {deploymentId:''},
    {proofRunId:''}
  ]){
    assert.throws(()=>assessProviderProofReadiness({...base(),...override}));
  }
});
