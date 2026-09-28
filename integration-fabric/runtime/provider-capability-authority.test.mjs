import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProviderCapabilityAuthority,assertProviderCapabilityAuthoritySafe} from './provider-capability-authority.mjs';

const base={
  provider:'plex',wfmTenant:'tenant-a',connectionId:'conn-1',exactHost:'https://connect.plex.com',credentialRevision:'rev-7',
  approvedCapabilities:['inventory','purchasing','suppliers'],
  observedCapabilities:['inventory','purchasing','suppliers'],
  requiredCapabilities:['inventory','purchasing'],
  approvedOperations:[
    {method:'GET',path:'/inventory/v1/items',capability:'inventory',operationId:'list-items',readOnly:true},
    {method:'GET',path:'/purchasing/v1/purchase-orders',capability:'purchasing',operationId:'list-purchase-orders',readOnly:true}
  ],
  requestedOperation:{method:'GET',path:'/purchasing/v1/purchase-orders',capability:'purchasing',operationId:'list-purchase-orders',readOnly:true}
};

test('allows only an exact observed and approved read operation',()=>{
  const d=evaluateProviderCapabilityAuthority(base);
  assert.equal(d.allowed,true); assert.equal(d.mutationAuthority,false); assert.equal(d.checkpointAuthority,false);
});

test('fails closed when provider-side capability access expands without review',()=>{
  const d=evaluateProviderCapabilityAuthority({...base,observedCapabilities:[...base.observedCapabilities,'tooling-admin']});
  assert.equal(d.allowed,false); assert.ok(d.reasons.includes('unapproved-provider-capability-expansion'));
});

test('fails closed when a required provider collection disappears',()=>{
  const d=evaluateProviderCapabilityAuthority({...base,observedCapabilities:['inventory','suppliers']});
  assert.equal(d.allowed,false); assert.ok(d.reasons.includes('required-provider-capability-missing'));
});

test('rejects a read that is outside the reviewed operation allowlist',()=>{
  const d=evaluateProviderCapabilityAuthority({...base,requestedOperation:{method:'GET',path:'/iam/v1/users',capability:'suppliers',operationId:'list-users',readOnly:true}});
  assert.equal(d.allowed,false); assert.ok(d.reasons.includes('requested-operation-not-approved'));
});

test('rejects mutative or unsafe operations even inside an entitled collection',()=>{
  const d=evaluateProviderCapabilityAuthority({...base,requestedOperation:{method:'POST',path:'/purchasing/v1/purchase-orders',capability:'purchasing',operationId:'create-purchase-order',readOnly:false}});
  assert.equal(d.allowed,false); assert.ok(d.reasons.includes('WFM_CAPABILITY_OPERATION_MUTATIVE'));
});

test('rejects wildcard or non-https hosts',()=>{
  const d=evaluateProviderCapabilityAuthority({...base,exactHost:'http://*.plex.com'});
  assert.equal(d.allowed,false); assert.ok(d.reasons.includes('exact-https-host-required'));
});

test('approved expansion still does not create operation authority automatically',()=>{
  const d=evaluateProviderCapabilityAuthority({...base,approvedCapabilities:[...base.approvedCapabilities,'quality'],observedCapabilities:[...base.observedCapabilities,'quality'],customerApprovedCapabilityExpansion:true,requestedOperation:{method:'GET',path:'/quality/v1/checks',capability:'quality',operationId:'list-checks',readOnly:true}});
  assert.equal(d.allowed,false); assert.ok(d.reasons.includes('requested-operation-not-approved'));
});

test('assert helper exposes the bounded decision on rejection',()=>{
  assert.throws(()=>assertProviderCapabilityAuthoritySafe({...base,observedCapabilities:['inventory']}),e=>e?.code==='WFM_PROVIDER_CAPABILITY_AUTHORITY_BLOCKED'&&e.decision?.allowed===false);
});
