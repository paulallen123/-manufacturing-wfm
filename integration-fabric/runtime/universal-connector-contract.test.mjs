import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {
  compileUniversalConnectorContract,
  assertConnectorOperation,
  promoteConnectorWrite,
  revokeConnectorWrites
} from './universal-connector-contract.mjs';

const DEPLOYMENT_ID='vector-proof-deployment-20261003';

function contractFor(providerId,connectionId='connection-1'){
  const connector=connectorById(providerId);
  assert.ok(connector,`missing connector: ${providerId}`);
  return compileUniversalConnectorContract(connector,{
    tenantId:'northstar-demo',
    connectionId
  });
}

function authorityFor(contract,target,overrides={}){
  return {
    tenantId:contract.binding.tenantId,
    connectionId:contract.binding.connectionId,
    providerId:contract.provider.id,
    target,
    candidateSha:'74533ed802fa20ab35b811b316194a2614af009b',
    deploymentId:DEPLOYMENT_ID,
    runId:'09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e',
    receiptId:'hosted-proof-receipt-1',
    status:'PROVEN',
    expiresAt:2_000_000_000_000,
    ...overrides
  };
}

const verifier=expected=>async payload=>{
  assert.deepEqual(payload,{schemaVersion:1,...expected});
  return true;
};

test('Staffology NetSuite and SAP compile through one provider-neutral contract',()=>{
  for(const providerId of ['iris-staffology-payroll','oracle-netsuite','sap-s4hana']){
    const contract=contractFor(providerId,providerId+'-connection');
    assert.equal(contract.binding.tenantId,'northstar-demo');
    assert.equal(contract.provider.id,providerId);
    assert.ok(contract.transports.length>0,providerId);
    assert.ok(contract.resources.length>0,providerId);
    assert.equal(contract.security.readOnlyDefault,true,providerId);
    assert.equal(contract.security.writeEnabled,false,providerId);
    assert.equal(contract.security.arbitraryEndpointAllowed,false,providerId);
    for(const resource of contract.resources){
      assert.deepEqual(resource.allowedVerbs,['read'],`${providerId}:${resource.target}`);
      assert.equal(resource.writeAuthority,null);
    }
  }
});

test('reads are tenant and connection bound',()=>{
  const contract=contractFor('oracle-netsuite','netsuite-prod');
  const target=contract.resources[0].target;
  assert.equal(assertConnectorOperation(contract,{
    tenantId:'northstar-demo',
    connectionId:'netsuite-prod',
    providerId:'oracle-netsuite',
    target,
    verb:'read'
  }),true);

  assert.throws(()=>assertConnectorOperation(contract,{
    tenantId:'another-tenant',
    connectionId:'netsuite-prod',
    providerId:'oracle-netsuite',
    target,
    verb:'read'
  }),error=>error.code==='WFM_CONNECTOR_BINDING_MISMATCH');
});

test('writes require an independent exact hosted proof verifier',async()=>{
  const contract=contractFor('sap-s4hana','sap-prod');
  const target=contract.resources[0].target;
  const authority=authorityFor(contract,target);

  await assert.rejects(
    ()=>promoteConnectorWrite(contract,{target,authority,now:1_900_000_000_000}),
    error=>error.code==='WFM_CONNECTOR_PROOF_VERIFIER_REQUIRED'
  );

  await assert.rejects(
    ()=>promoteConnectorWrite(contract,{
      target,authority,now:1_900_000_000_000,
      verifyAuthority:async()=>false
    }),
    error=>error.code==='WFM_CONNECTOR_PROOF_VERIFICATION_FAILED'
  );

  const promoted=await promoteConnectorWrite(contract,{
    target,
    authority,
    now:1_900_000_000_000,
    verifyAuthority:verifier(authority)
  });
  assert.equal(promoted.security.writeEnabled,true);
  assert.equal(promoted.resources.find(resource=>resource.target===target).writeAuthority.deploymentId,DEPLOYMENT_ID);
  assert.equal(assertConnectorOperation(promoted,{
    tenantId:'northstar-demo',
    connectionId:'sap-prod',
    providerId:'sap-s4hana',
    target,
    verb:'write'
  }),true);
});

test('write proof cannot be replayed across tenant connection provider target or deployment',async()=>{
  const contract=contractFor('iris-staffology-payroll','staffology-prod');
  const target=contract.resources[0].target;
  const base=authorityFor(contract,target,{receiptId:'hosted-proof-receipt-2'});
  for(const authority of [
    {...base,tenantId:'other'},
    {...base,connectionId:'other'},
    {...base,providerId:'oracle-netsuite'},
    {...base,target:'not-the-target'}
  ]){
    await assert.rejects(
      ()=>promoteConnectorWrite(contract,{
        target,authority,now:1_900_000_000_000,
        verifyAuthority:async()=>true
      }),
      error=>error.code==='WFM_CONNECTOR_WRITE_AUTHORITY_MISMATCH'
    );
  }

  const wrongDeployment={...base,deploymentId:'retired-deployment'};
  await assert.rejects(
    ()=>promoteConnectorWrite(contract,{
      target,
      authority:wrongDeployment,
      now:1_900_000_000_000,
      verifyAuthority:async payload=>payload.deploymentId===DEPLOYMENT_ID
    }),
    error=>error.code==='WFM_CONNECTOR_PROOF_VERIFICATION_FAILED'
  );
});

test('unproven or expired evidence cannot promote writes',async()=>{
  const contract=contractFor('oracle-netsuite','netsuite-prod');
  const target=contract.resources[0].target;
  await assert.rejects(
    ()=>promoteConnectorWrite(contract,{
      target,
      authority:authorityFor(contract,target,{status:'TESTED'}),
      now:1_900_000_000_000,
      verifyAuthority:async()=>true
    }),
    /PROVEN/
  );
  await assert.rejects(
    ()=>promoteConnectorWrite(contract,{
      target,
      authority:authorityFor(contract,target,{expiresAt:1_800_000_000_000}),
      now:1_900_000_000_000,
      verifyAuthority:async()=>true
    }),
    error=>error.code==='WFM_CONNECTOR_WRITE_AUTHORITY_EXPIRED'
  );
});

test('revocation removes all promoted writes without changing reads',async()=>{
  const contract=contractFor('oracle-netsuite','netsuite-prod');
  const target=contract.resources[0].target;
  const authority=authorityFor(contract,target,{receiptId:'hosted-proof-receipt-3'});
  const promoted=await promoteConnectorWrite(contract,{
    target,
    authority,
    verifyAuthority:verifier(authority),
    now:1_900_000_000_000
  });
  const revoked=revokeConnectorWrites(promoted);
  assert.equal(revoked.security.writeEnabled,false);
  assert.equal(assertConnectorOperation(revoked,{
    tenantId:'northstar-demo',
    connectionId:'netsuite-prod',
    providerId:'oracle-netsuite',
    target,
    verb:'read'
  }),true);
  assert.throws(()=>assertConnectorOperation(revoked,{
    tenantId:'northstar-demo',
    connectionId:'netsuite-prod',
    providerId:'oracle-netsuite',
    target,
    verb:'write'
  }),error=>error.code==='WFM_CONNECTOR_WRITE_NOT_AUTHORISED');
});
