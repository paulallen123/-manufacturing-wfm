import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorRegistry} from './connector-registry.mjs';

test('every generated connector keeps privileged bootstrap authority out of steady-state runtime',()=>{
  for(const c of buildConnectorRegistry().connectors){
    assert.equal(c.security.bootstrapCredentialRetentionAllowed,false,c.id);
    assert.equal(c.security.bootstrapCredentialReuseAtRuntimeAllowed,false,c.id);
    assert.equal(c.security.customerControlledBootstrapAllowed,true,c.id);
  }
});
