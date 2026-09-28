import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {resolveReadRoutePlan,versionFallbackDecision,versionTransitionPlan} from './api-version-routing.mjs';

const connector=connectorById('mrpeasy');

test('MRPeasy is spec-verified on reusable REST/OpenAPI with writes disabled',()=>{
  assert.ok(connector);
  assert.equal(connector.evidenceLevel,'spec-verified');
  assert.ok(connector.adapters.some(x=>x.id==='rest-openapi'));
  assert.equal(connector.security.writeEnabled,false);
  assert.equal(connector.security.arbitraryEndpointAllowed,false);
  assert.equal(connector.staticCredentialAuthority.credentialType,'basic-api-key-secret');
});

test('MRPeasy version routing prefers v2 and cannot downgrade on auth/rate-limit failures',()=>{
  assert.equal(connector.versionRouting.preferredVersion,'v2');
  assert.equal(connector.versionRouting.fallbackVersion,'v1');
  assert.equal(connector.versionRouting.authFailureMayTriggerDowngrade,false);
  assert.equal(connector.versionRouting.rateLimitMayTriggerDowngrade,false);
  for (const status of [401,403,429,503]) {
    assert.equal(versionFallbackDecision({status,phase:'capability-probe',providerFallbackDeclared:true}).allow,false);
  }
});

test('MRPeasy v1/v2 inventory routes have isolated paging checkpoints and reconciliation on switch',()=>{
  const v2={version:'v2',path:'/rest/v2/inventory',method:'GET',operationClass:'read',preference:1,canonicalContract:'inventory-snapshot-v1',paginationStyle:'offset-limit',capabilities:['inventory']};
  const v1={version:'v1',path:'/rest/v1/stock/inventory',method:'GET',operationClass:'read',preference:2,providerFallbackDeclared:true,canonicalContract:'inventory-snapshot-v1',paginationStyle:'range-header',capabilities:['inventory']};
  const plan=resolveReadRoutePlan({provider:'mrpeasy',resource:'inventory',routes:[v1,v2],requiredCapabilities:['inventory']});
  assert.equal(plan.primary.version,'v2');
  assert.deepEqual(plan.fallbacks.map(x=>x.version),['v1']);
  const transition=versionTransitionPlan({fromRoute:v2,toRoute:v1});
  assert.equal(transition.checkpointCompatible,false);
  assert.equal(transition.requiresOverlapReplay,true);
});

test('MRPeasy enriches production/inventory/procurement/finance without becoming payroll or HCM authority',()=>{
  for (const required of ['production-order','work-centre','inventory-snapshot','supplier','production-cost-evidence']) {
    assert.ok(connector.canonicalTargets.includes(required),required);
  }
  assert.ok(!connector.canonicalTargets.includes('payroll-authority'));
  assert.ok(connector.evidenceBlockers.some(x=>x.includes('POST/PUT/DELETE')));
});
