'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createCountryPolicyPackRegistry}=require('./country-policy-pack-registry.cjs');

const verified={id:'uk-workforce-baseline',country:'GB',version:'2026.09.1',status:'VERIFIED',effectiveFrom:'2026-09-01T00:00:00Z',verifiedAt:'2026-09-20T10:00:00Z',verifiedBy:'compliance-review:42',sourceRefs:['gov.uk:working-time'],rules:[{id:'rest-evidence',domain:'rest',effect:'REQUIRE_EVIDENCE',summary:'Rest checks require authoritative evidence.',sourceRefs:['gov.uk:working-time']}]};

test('registry resolves only verified effective packs and never grants authority',()=>{
  const registry=createCountryPolicyPackRegistry([verified,{...verified,id:'draft',version:'0.1',status:'DRAFT',verifiedAt:null,verifiedBy:null,sourceRefs:[],rules:[]}]);
  const context=registry.resolve({country:'GB',at:'2026-09-23T12:00:00Z'});
  assert.equal(context.verifiedCoverage,true);
  assert.equal(context.packs.length,1);
  assert.equal(context.executionAuthority,false);
  assert.equal(context.rules[0].authorityRequired,'EXTERNAL_RULE_AUTHORITY');
});

test('missing country pack fails closed with explicit limitation',()=>{
  const registry=createCountryPolicyPackRegistry([verified]);
  const context=registry.resolve({country:'DE',at:'2026-09-23T12:00:00Z'});
  assert.equal(context.verifiedCoverage,false);
  assert.match(context.limitations[0],/Fail closed/);
});

test('verified pack requires provenance',()=>{
  assert.throws(()=>createCountryPolicyPackRegistry([{...verified,sourceRefs:[]}]),/sourceRefs/);
});
