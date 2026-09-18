import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDTA_02020,
  extractIdta02020CapabilityProfile,
  benchmarkIdtaConfiguration,
  resolveCapabilityRole,
} from '../../src/frontier/idta-02020-capability-profile.mjs';

const ref=(value,type='GlobalReference')=>({type:'ExternalReference',keys:[{type,value}]});
const q=(role,value='true')=>({type:role,value,semanticId:ref(IDTA_02020[`role${role}`])});
const cap=(role='Offered',semantic='urn:cap:laser-cut')=>({
  idShort:'LaserCutting',modelType:'Capability',semanticId:ref(IDTA_02020.capability),
  supplementalSemanticIds: semantic ? [ref(semantic)] : [], qualifiers:[q(role)],
});
const prop=()=>({
  idShort:'PropertyContainer',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.propertyContainer),value:[
    {idShort:'SameProperty',modelType:'RelationshipElement',semanticId:ref(IDTA_02020.sameProperty),second:ref('urn:prop:max-thickness')},
    {idShort:'PropertyProperty',modelType:'Property',semanticId:ref(IDTA_02020.propertyValue),valueType:'xs:double',value:'12',unit:'mm'},
  ],
});
const container=(capability)=>({
  idShort:'CapabilityContainer',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.capabilityContainer),value:[
    capability,
    {idShort:'PropertySet',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.propertySet),value:[prop()]},
    {idShort:'CapabilityRelations',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.capabilityRelations),value:[
      {idShort:'CapabilityRealizedBy',modelType:'RelationshipElement',semanticId:ref(IDTA_02020.realizedBy),second:ref('urn:machine-skill:laser-program')},
    ]},
  ],
});
const submodel=(containers)=>({
  id:'urn:sm:capability-description',semanticId:ref(IDTA_02020.submodel),submodelElements:[
    {idShort:'CapabilitySet',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.capabilitySet),value:containers},
  ],
});

test('parses an offered IDTA 02020 capability with property and technical skill evidence',()=>{
  const result=extractIdta02020CapabilityProfile([submodel([container(cap())])]);
  assert.equal(result.status,'accepted');
  assert.equal(result.offered.length,1);
  assert.equal(result.required.length,0);
  assert.equal(result.offered[0].semanticId,'urn:cap:laser-cut');
  assert.deepEqual(result.offered[0].properties,[{semanticId:'urn:prop:max-thickness',value:12,unit:'mm',matchingStatus:'eligible'}]);
  assert.deepEqual(result.offered[0].technicalSkillRefs,['urn:machine-skill:laser-program']);
});

test('required capabilities are kept separate and never promoted as machine-provided capability',()=>{
  const result=extractIdta02020CapabilityProfile([submodel([container(cap('Required','urn:cap:precision-cut'))])]);
  assert.equal(result.offered.length,0);
  assert.equal(result.required.length,1);
  assert.equal(result.required[0].role,'required');
});

test('the official template-style three role declarations are ambiguous, not treated as offered',()=>{
  const capability=cap('Offered');
  capability.qualifiers=[
    {type:'Required',value:'[1, 0]',semanticId:ref(IDTA_02020.roleRequired)},
    {type:'Offered',value:'[1, 0]',semanticId:ref(IDTA_02020.roleOffered)},
    {type:'NotAssigned',value:'[1, 0]',semanticId:ref(IDTA_02020.roleNotAssigned)},
  ];
  const role=resolveCapabilityRole(capability);
  assert.equal(role.status,'review_required');
  const result=extractIdta02020CapabilityProfile([submodel([container(capability)])]);
  assert.equal(result.offered.length,0);
  assert.equal(result.reviewRequired[0].reason,'ambiguous_capability_role');
});

test('generic template semantic alone is not mistaken for domain capability meaning',()=>{
  const result=extractIdta02020CapabilityProfile([submodel([container(cap('Offered',null))])]);
  assert.equal(result.offered.length,0);
  assert.equal(result.reviewRequired[0].reason,'missing_domain_capability_semantic');
});

test('missing property unit remains visible but is not eligible for deterministic envelope matching',()=>{
  const c=container(cap());
  delete c.value[1].value[0].value[1].unit;
  const result=extractIdta02020CapabilityProfile([submodel([c])]);
  assert.equal(result.offered[0].properties[0].matchingStatus,'review_required');
  assert.equal(result.offered[0].evidence.propertyReview[0].reason,'missing_explicit_unit');
});

test('synthetic direct-standard benchmark clears the 95% representation and 60% configuration-reduction thresholds',()=>{
  const containers=[];
  for(let i=0;i<100;i+=1){
    const capability=cap('Offered',`urn:cap:${i}`);
    if(i>=96) capability.qualifiers=[];
    containers.push(container(capability));
  }
  const result=extractIdta02020CapabilityProfile([submodel(containers)]);
  const benchmark=benchmarkIdtaConfiguration(result);
  assert.equal(benchmark.totalCapabilityContainers,100);
  assert.equal(benchmark.representedWithoutManualRoleOrSemanticRepair,96);
  assert.equal(benchmark.reviewRequired,4);
  assert.ok(benchmark.representationPct>=0.95);
  assert.ok(benchmark.repeatedConfigurationReductionPct>=0.60);
});

test('fails closed on pathological nesting',()=>{
  const deep={idShort:'CapabilitySet',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.capabilitySet),value:[]};
  let cursor=deep;
  for(let i=0;i<8;i+=1){const child={modelType:'SubmodelElementCollection',value:[]};cursor.value.push(child);cursor=child;}
  const sm={id:'sm',semanticId:ref(IDTA_02020.submodel),submodelElements:[deep]};
  const result=extractIdta02020CapabilityProfile([sm],{maxDepth:3});
  assert.equal(result.status,'rejected');
  assert.equal(result.reason,'aas_depth_limit_exceeded');
});
