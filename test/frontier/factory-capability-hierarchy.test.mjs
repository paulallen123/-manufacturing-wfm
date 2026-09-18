import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApprovedCapabilityHierarchy, resolveCapabilitySubsumption } from '../../src/frontier/factory-capability-hierarchy.mjs';

const approved=(child,parent)=>({childCapabilityId:child,parentCapabilityId:parent,approvalStatus:'approved',source:'idta-02020'});

test('exact identity remains the simplest match',()=>{
  const result=resolveCapabilitySubsumption('laser-cut','laser-cut',[]);
  assert.equal(result.status,'match');
  assert.equal(result.reason,'exact_capability_match');
});

test('specific offered capability can satisfy a more general requirement through approved generalization',()=>{
  const result=resolveCapabilitySubsumption('laser-cut','cutting',[approved('laser-cut','thermal-cutting'),approved('thermal-cutting','cutting')]);
  assert.equal(result.status,'match');
  assert.deepEqual(result.path,['laser-cut','thermal-cutting','cutting']);
});

test('general capability cannot satisfy a more specific requirement by reversing the hierarchy',()=>{
  const result=resolveCapabilitySubsumption('cutting','laser-cut',[approved('laser-cut','cutting')]);
  assert.equal(result.status,'no_match');
});

test('suggested or unapproved relations never create authority',()=>{
  const result=resolveCapabilitySubsumption('laser-cut','cutting',[{...approved('laser-cut','cutting'),approvalStatus:'suggested'}]);
  assert.equal(result.status,'no_match');
});

test('self-generalization is rejected',()=>{
  const graph=buildApprovedCapabilityHierarchy([approved('cutting','cutting')]);
  assert.equal(graph.status,'rejected');
  assert.equal(graph.reason,'self_generalization');
});

test('cycles fail closed when they are encountered without a valid target path',()=>{
  const result=resolveCapabilitySubsumption('laser-cut','machining',[approved('laser-cut','cutting'),approved('cutting','laser-cut')]);
  assert.equal(result.status,'review_required');
  assert.equal(result.reason,'capability_hierarchy_cycle');
});

test('bounded traversal prevents pathological semantic graphs',()=>{
  const relations=[];
  for(let i=0;i<20;i+=1) relations.push(approved(`c${i}`,`c${i+1}`));
  const result=resolveCapabilitySubsumption('c0','c20',relations,{maxDepth:5});
  assert.equal(result.status,'review_required');
  assert.equal(result.reason,'capability_hierarchy_depth_limit');
});
