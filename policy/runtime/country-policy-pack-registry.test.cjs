'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createCountryPolicyPackRegistry}=require('./country-policy-pack-registry.cjs');
// A DRAFT fixture supplies no country policy or verified-coverage claim.
function datePack(overrides={}){return {id:'synthetic-date-only',country:'GB',version:'fixture-1',status:'DRAFT',effectiveFrom:'2026-01-01T00:00:00Z',effectiveTo:'2027-01-01T00:00:00Z',verifiedAt:'2026-01-01T00:00:00Z',sourceRefs:[],rules:[],...overrides};}
for(const field of ['effectiveFrom','effectiveTo','verifiedAt'])test('pack registration rejects impossible civil '+field,()=>{
  assert.throws(()=>createCountryPolicyPackRegistry([datePack({[field]:'2026-02-30T00:00:00Z'})]),new RegExp(field+'.*valid ISO'));
});
test('pack resolution rejects an impossible civil at timestamp',()=>{
  const registry=createCountryPolicyPackRegistry([datePack()]);
  assert.throws(()=>registry.resolve({country:'GB',at:'2026-02-30T00:00:00Z'}),/at.*valid ISO/);
});
test('pack registration rejects a non-leap century date',()=>{
  assert.throws(()=>createCountryPolicyPackRegistry([datePack({effectiveFrom:'1900-02-29T12:00:00Z'})]),/effectiveFrom.*valid ISO/);
});
for(const [input,expected] of [['2024-02-29T12:00:00Z','2024-02-29T12:00:00.000Z'],['2026-03-01T00:30:00+01:00','2026-02-28T23:30:00.000Z']])test('pack registration preserves valid leap/offset instant '+input,()=>{
  const registry=createCountryPolicyPackRegistry([datePack({effectiveFrom:input})]),pack=registry.all()[0];
  assert.equal(pack.effectiveFrom,expected);assert.equal(pack.grantsExecutionAuthority,false);
  const context=registry.resolve({country:'GB',at:'2026-06-01T00:00:00Z'});assert.equal(context.executionAuthority,false);assert.equal(context.verifiedCoverage,false);
});
const verified={id:'uk-workforce-baseline',country:'GB',version:'2026.09.1',status:'VERIFIED',effectiveFrom:'2026-09-01T00:00:00Z',verifiedAt:'2026-09-20T10:00:00Z',verifiedBy:'compliance-review:42',sourceRefs:['gov.uk:working-time'],rules:[{id:'rest-evidence',domain:'rest',effect:'REQUIRE_EVIDENCE',summary:'Rest checks require authoritative evidence.',sourceRefs:['gov.uk:working-time']}]};
test('registry resolves only verified effective packs and never grants authority',()=>{const registry=createCountryPolicyPackRegistry([verified,{...verified,id:'draft',version:'0.1',status:'DRAFT',verifiedAt:null,verifiedBy:null,sourceRefs:[],rules:[]}]);const context=registry.resolve({country:'GB',at:'2026-09-23T12:00:00Z'});assert.equal(context.verifiedCoverage,true);assert.equal(context.packs.length,1);assert.equal(context.executionAuthority,false);assert.equal(context.rules[0].authorityRequired,'EXTERNAL_RULE_AUTHORITY');});
test('missing country pack fails closed with explicit limitation',()=>{const registry=createCountryPolicyPackRegistry([verified]);const context=registry.resolve({country:'DE',at:'2026-09-23T12:00:00Z'});assert.equal(context.verifiedCoverage,false);assert.match(context.limitations[0],/Fail closed/);});
test('verified pack requires provenance',()=>{assert.throws(()=>createCountryPolicyPackRegistry([{...verified,sourceRefs:[]}]),/sourceRefs/);});
test('country codes are validated whole, not silently truncated to a supported country',()=>{
  assert.throws(()=>createCountryPolicyPackRegistry([{...verified,country:'GBX'}]),/ISO alpha-2/);
  assert.throws(()=>createCountryPolicyPackRegistry([{...verified,country:['GB']}]),/ISO alpha-2/);
  const registry=createCountryPolicyPackRegistry([verified]);
  assert.throws(()=>registry.resolve({country:'GBX',at:'2026-09-23T12:00:00Z'}),/ISO alpha-2/);
  assert.throws(()=>registry.resolve({country:['GB'],at:'2026-09-23T12:00:00Z'}),/ISO alpha-2/);
});
