import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorRegistry} from './connector-registry.mjs';

test('every generated connector fails closed on unauthenticated or replay-unsafe webhooks',()=>{
  const registry=buildConnectorRegistry();
  assert.ok(registry.connectors.length>0);
  for(const c of registry.connectors){
    assert.equal(c.security.unauthenticatedWebhookAllowed,false,c.id);
    assert.equal(c.security.webhookAuthenticationRequired,true,c.id);
    assert.equal(c.security.webhookReplayProtectionRequired,true,c.id);
    assert.equal(c.security.webhookSchemaVersionPinRequired,true,c.id);
  }
});
