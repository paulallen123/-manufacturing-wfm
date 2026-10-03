import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {
  compileUniversalConnectorContract,
  assertConnectorOperation,
  promoteConnectorWrite,
  revokeConnectorWrites
} from './universal-connector-contract.mjs';

function contractFor(providerId,connectionId='connection-1'){
  const connector=connectorById(providerId);
  assert.ok(connector,`missing connector: ${providerId}`);
  return compileUniversalConnectorContract(connector,{
    tenantId:'northstar-demo',
    connectionId
  });
}

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

test('writes fail closed until exact hosted proof authority is presented',()=>{
  const contract=contractFor('sap-s4hana','sap-prod');
  const target=contract.resources[0].target;
  assert.throws(()=>assertConnectorOperation(contract,{
    tenantId:'northstar-demo',
    connectionId:'sap-prod',
    providerId:'sap-s4hana',
    target,
    verb:'write'
  }),error=>error.code==='WFM_CONNECTOR_WRITE_NOT_AUTHORISED');

  const authority={
    tenantId:'northstar-demo',
    connectionId:'sap-prod',
    providerId:'sap-s4hana',
    target,
    candidateSha:'74533ed802fa20ab35b811b316194a2614af009b',
    runId:'09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e',
    receiptId:'hosted-proof-receipt-1',
    status:'PROVEN',
    expiresAt:2_000_000_000_000
  };

  const promoted=promoteConnectorWrite(contract,{target,authority,now:1_900_000_000_000});
  assert.equal(promoted.security.writeEnabled,true);
  assert.equal(assertConnectorOperation(promoted,{
    tenantId:'northstar-demo',
    connectionId:'sap-prod',
    providerId:'sap-s4hana',
    target,
    verb:'write'
  }),true);

  const other=promoted.resources.find(resource=>resource.target!==target);
  if(other){
    assert.throws(()=>assertConnectorOperation(promoted,{
      tenantId:'northstar-demo',
      connectionId:'sap-prod',
      providerId:'sap-s4hana',
      target:other.target,
      verb:'write'
    }),error=>error.code==='WFM_CONNECTOR_WRITE_NOT_AUTHORISED');
  }
});

test('write proof cannot be replayed across tenant connection provider or target',()=>{
  const contract=contractFor('iris-staffology-payroll','staffology-prod');
  const target=contract.resources[0].target;
  const base={
    tenantId:'northstar-demo',
    connectionId:'staffology-prod',
    providerId:'iris-staffology-payroll',
    target,
    candidateSha:'74533ed802fa20ab35b811b316194a2614af009b',
    runId:'09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e',
    receiptId:'hosted-proof-receipt-2',
    status:'PROVEN',
    expiresAt:2_000_000_000_000
  };
  for(const authority of [
    {...base,tenantId:'other'},
    {...base,connectionId:'other'},
    {...base,providerId:'oracle-netsuite'},
    {...base,target:'not-the-target'}
  ]){
    assert.throws(
      ()=>promoteConnectorWrite(contract,{target,authority,now:1_900_000_000_000}),
      error=>error.code==='WFM_CONNECTOR_WRITE_AUTHORITY_MISMATCH'
    );
  }
});

test('revocation removes all promoted writes without changing reads',()=>{
  const contract=contractFor('oracle-netsuite','netsuite-prod');
  const target=contract.resources[0].target;
  const promoted=promoteConnectorWrite(contract,{
    target,
    authority:{
      tenantId:'northstar-demo',
      connectionId:'netsuite-prod',
      providerId:'oracle-netsuite',
      target,
      candidateSha:'74533ed802fa20ab35b811b316194a2614af009b',
      runId:'09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e',
      receiptId:'hosted-proof-receipt-3',
      status:'PROVEN',
      expiresAt:2_000_000_000_000
    },
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
