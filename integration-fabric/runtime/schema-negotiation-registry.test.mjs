import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorRegistry} from './connector-registry.mjs';

test('every connector inherits fail-closed schema negotiation policy',()=>{
  const registry=buildConnectorRegistry();
  assert.ok(registry.connectors.length>0);
  for(const connector of registry.connectors){
    assert.equal(connector.schemaNegotiation.fingerprintRequired,true,connector.id);
    assert.equal(connector.schemaNegotiation.preserveOptionalExtensions,true,connector.id);
    assert.equal(connector.schemaNegotiation.silentBreakingChangeAllowed,false,connector.id);
    assert.equal(connector.schemaNegotiation.credentialLikeExtensionsAllowed,false,connector.id);
    assert.equal(connector.schemaNegotiation.historicalFingerprintRetentionRequired,true,connector.id);
  }
});
