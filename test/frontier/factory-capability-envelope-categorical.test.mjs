import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCapabilityRequirement, normalizeCapabilityEnvelope } from '../../src/frontier/factory-capability-envelope.mjs';

test('unitless categorical semantic values can match eq/in without inventing a unit',()=>{
  const provided={capabilityId:'recoat',properties:[{semanticId:'urn:p:operation',value:'Recoating'}]};
  const eq=evaluateCapabilityRequirement(provided,{capabilityId:'recoat',constraints:[{semanticId:'urn:p:operation',operator:'eq',value:'Recoating'}]});
  const allowed=evaluateCapabilityRequirement(provided,{capabilityId:'recoat',constraints:[{semanticId:'urn:p:operation',operator:'in',value:['Recoating','Grinding']}]});
  assert.equal(eq.status,'feasible');
  assert.equal(allowed.status,'feasible');
});

test('unitless categorical mismatch fails deterministically',()=>{
  const result=evaluateCapabilityRequirement(
    {capabilityId:'recoat',properties:[{semanticId:'urn:p:operation',value:'Recoating'}]},
    {capabilityId:'recoat',constraints:[{semanticId:'urn:p:operation',operator:'eq',value:'Grinding'}]}
  );
  assert.equal(result.status,'infeasible');
});

test('numeric property without unit remains rejected',()=>{
  const normalized=normalizeCapabilityEnvelope({capabilityId:'recoat',properties:[{semanticId:'urn:p:latitude',value:48.3}]});
  assert.equal(normalized.status,'rejected');
  assert.equal(normalized.reason,'missing_property_unit');
});

test('categorical explicit unit on only one side fails closed',()=>{
  const result=evaluateCapabilityRequirement(
    {capabilityId:'recoat',properties:[{semanticId:'urn:p:operation',value:'Recoating',unit:'code'}]},
    {capabilityId:'recoat',constraints:[{semanticId:'urn:p:operation',operator:'eq',value:'Recoating'}]}
  );
  assert.equal(result.status,'unknown');
  assert.equal(result.checks[0].reason,'unit_mismatch');
});
