import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCapabilityRequirement, assessProductionCapability } from '../../src/frontier/factory-capability-envelope.mjs';

const rel=(child,parent,approvalStatus='approved')=>({childCapabilityId:child,parentCapabilityId:parent,approvalStatus});
const properties=[{semanticId:'urn:p:max-thickness',kind:'scalar',value:12,unit:'mm'}];

test('approved generalization allows a specific offered capability to satisfy a general requirement',()=>{
  const result=evaluateCapabilityRequirement(
    {capabilityId:'laser-cut',properties},
    {capabilityId:'cutting',constraints:[{semanticId:'urn:p:max-thickness',operator:'gte',value:10,unit:'mm'}]},
    {capabilityHierarchy:[rel('laser-cut','thermal-cutting'),rel('thermal-cutting','cutting')]}
  );
  assert.equal(result.status,'feasible');
  assert.equal(result.capabilityMatch.reason,'approved_generalization_match');
});

test('unapproved hierarchy edge does not convert a capability mismatch into a match',()=>{
  const result=evaluateCapabilityRequirement(
    {capabilityId:'laser-cut',properties},
    {capabilityId:'cutting',constraints:[]},
    {capabilityHierarchy:[rel('laser-cut','cutting','suggested')]}
  );
  assert.equal(result.status,'infeasible');
  assert.equal(result.reason,'capability_mismatch');
});

test('hierarchy cannot run in reverse',()=>{
  const result=evaluateCapabilityRequirement(
    {capabilityId:'cutting',properties},
    {capabilityId:'laser-cut',constraints:[]},
    {capabilityHierarchy:[rel('laser-cut','cutting')]}
  );
  assert.equal(result.status,'infeasible');
});

test('cycle degrades to review rather than claiming feasibility',()=>{
  const result=evaluateCapabilityRequirement(
    {capabilityId:'laser-cut',properties},
    {capabilityId:'machining',constraints:[]},
    {capabilityHierarchy:[rel('laser-cut','cutting'),rel('cutting','laser-cut')]}
  );
  assert.equal(result.status,'unknown');
  assert.equal(result.reason,'capability_hierarchy_cycle');
});

test('technical hierarchy match still cannot override workforce readiness',()=>{
  const result=assessProductionCapability({
    providedCapabilities:[{assetId:'laser-1',capabilityId:'laser-cut',properties}],
    requirement:{capabilityId:'cutting',constraints:[]},
    capabilityHierarchy:[rel('laser-cut','cutting')],
    workforceCoverage:{status:'at_risk',gap:1},
  });
  assert.equal(result.status,'not_ready');
  assert.equal(result.reason,'workforce_capability_gap');
});
