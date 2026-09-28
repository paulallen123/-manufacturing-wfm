import test from 'node:test';
import assert from 'node:assert/strict';
import {observeSchema,compareSchemas,captureExtensions} from './schema-negotiation.mjs';

const base=observeSchema({provider:'erpnext',objectType:'Employee',observedAt:'2026-09-20T15:00:00Z',fields:[
  {name:'name',type:'Data',required:true},
  {name:'company',type:'Link',referenceTarget:'Company'},
  {name:'custom_shift_group',type:'Data'},
  {name:'api_secret',type:'Password',sensitive:true}
]});

test('fingerprint is stable across field ordering',()=>{
  const reordered=observeSchema({provider:'erpnext',objectType:'Employee',observedAt:'2026-09-20T16:00:00Z',fields:[
    {name:'custom_shift_group',type:'Data'},
    {name:'api_secret',type:'Password',sensitive:true},
    {name:'company',type:'Link',referenceTarget:'Company'},
    {name:'name',type:'Data',required:true}
  ]});
  assert.equal(base.fingerprint,reordered.fingerprint);
  assert.equal(compareSchemas(base,reordered).classification,'unchanged');
});

test('optional custom field is additive and preserved as extension',()=>{
  const next=observeSchema({provider:'erpnext',objectType:'Employee',observedAt:'2026-09-20T16:00:00Z',fields:[
    ...base.fields,
    {name:'custom_union_code',type:'Data'}
  ]});
  assert.equal(compareSchemas(base,next).classification,'additive');
  assert.deepEqual(captureExtensions({name:'EMP-1',custom_shift_group:'A',custom_union_code:'U1',api_secret:'never-copy'}, {
    mappedSourceFields:['name'],schema:next
  }),{custom_shift_group:'A',custom_union_code:'U1'});
});

test('field removal or type change requires mapping review',()=>{
  const next=observeSchema({provider:'erpnext',objectType:'Employee',observedAt:'2026-09-20T16:00:00Z',fields:[
    {name:'name',type:'Data',required:true},
    {name:'company',type:'Table',referenceTarget:'Company'}
  ]});
  const result=compareSchemas(base,next);
  assert.equal(result.classification,'review-required');
  assert.ok(result.breakingReasons.some(x=>x.startsWith('field-contract-changed:company')));
  assert.ok(result.breakingReasons.some(x=>x.startsWith('field-removed:custom_shift_group')));
});

test('required field additions require review',()=>{
  const next=observeSchema({provider:'erpnext',objectType:'Employee',observedAt:'2026-09-20T16:00:00Z',fields:[
    ...base.fields,
    {name:'legal_entity_code',type:'Data',required:true}
  ]});
  assert.equal(compareSchemas(base,next).classification,'review-required');
});

test('credential-shaped extension keys are not copied even when schema exposes them',()=>{
  const schema=observeSchema({provider:'x',objectType:'y',observedAt:'2026-09-20T16:00:00Z',fields:[
    {name:'custom_api_key',type:'Data'},
    {name:'custom_language',type:'Data'}
  ]});
  assert.deepEqual(captureExtensions({custom_api_key:'secret',custom_language:'cy'}, {schema}),{custom_language:'cy'});
});
