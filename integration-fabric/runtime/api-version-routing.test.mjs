import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveReadRoutePlan,versionFallbackDecision,versionTransitionPlan,checkpointNamespace} from './api-version-routing.mjs';

const v2Inventory={version:'v2',path:'/rest/v2/inventory',method:'GET',operationClass:'read',preference:1,canonicalContract:'inventory-snapshot-v1',paginationStyle:'offset-limit',capabilities:['inventory','historical']};
const v1Inventory={version:'v1',path:'/rest/v1/stock/inventory',method:'GET',operationClass:'read',preference:2,providerFallbackDeclared:true,canonicalContract:'inventory-snapshot-v1',paginationStyle:'range-header',capabilities:['inventory','historical']};

test('prefers provider-recommended v2 while retaining declared compatible v1 fallback',()=>{
  const plan=resolveReadRoutePlan({provider:'mrpeasy',resource:'inventory',routes:[v1Inventory,v2Inventory],requiredCapabilities:['inventory']});
  assert.equal(plan.primary.version,'v2');
  assert.deepEqual(plan.fallbacks.map(x=>x.version),['v1']);
});

test('capability-probe 404 can use only a provider-declared fallback',()=>{
  assert.deepEqual(versionFallbackDecision({status:404,phase:'capability-probe',providerFallbackDeclared:true}),{
    allow:true,action:'try-declared-fallback',reason:'capability-absent-404'
  });
});

test('authentication and permission failures never cause version downgrade',()=>{
  for (const status of [401,403]) assert.equal(versionFallbackDecision({status,phase:'capability-probe',providerFallbackDeclared:true}).allow,false);
});

test('rate limits and server errors retry current version instead of silently downgrading',()=>{
  assert.equal(versionFallbackDecision({status:429,phase:'capability-probe',providerFallbackDeclared:true}).action,'retry-current-version');
  assert.equal(versionFallbackDecision({status:503,phase:'capability-probe',providerFallbackDeclared:true}).action,'retry-current-version');
});

test('pagination contract change invalidates checkpoint and requires replay reconciliation',()=>{
  const transition=versionTransitionPlan({fromRoute:v2Inventory,toRoute:v1Inventory});
  assert.equal(transition.checkpointCompatible,false);
  assert.equal(transition.requiresOverlapReplay,true);
  const a=checkpointNamespace({tenantId:'tenant-a',provider:'mrpeasy',resource:'inventory',apiVersion:'v2',paginationStyle:'offset-limit'});
  const b=checkpointNamespace({tenantId:'tenant-a',provider:'mrpeasy',resource:'inventory',apiVersion:'v1',paginationStyle:'range-header'});
  assert.notEqual(a,b);
});

test('mutation route cannot enter a read plan',()=>{
  assert.throws(()=>resolveReadRoutePlan({provider:'mrpeasy',resource:'manufacturing-order',routes:[{version:'v1',path:'/rest/v1/manufacturing-orders',method:'POST',operationClass:'mutation',preference:1}]}),/not declared read-only/);
});
