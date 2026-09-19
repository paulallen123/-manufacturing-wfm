import test from 'node:test';
import assert from 'node:assert/strict';
import { IDTA_02020 } from '../../src/frontier/idta-02020-capability-profile.mjs';
import { aasShellToCapabilityAsset, extractAasCapabilities } from '../../src/frontier/aas-capability-adapter.mjs';
import { buildCapabilityGraph } from '../../src/frontier/factory-capability-graph.mjs';
import { assessGraphProductionCapability } from '../../src/frontier/factory-capability-envelope.mjs';

const ref=(value)=>({type:'ExternalReference',keys:[{type:'GlobalReference',value}]});
const capability=(role,semantic,value='12',unit='mm')=>({
  idShort:`${role}Laser`,modelType:'Capability',semanticId:ref(IDTA_02020.capability),supplementalSemanticIds:[ref(semantic)],
  qualifiers:[{type:role,value:'true',semanticId:ref(IDTA_02020[`role${role}`])}],
  _value:value,_unit:unit,
});
function container(c){return {idShort:'CapabilityContainer',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.capabilityContainer),value:[
  c,
  {idShort:'PropertySet',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.propertySet),value:[
    {idShort:'PropertyContainer',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.propertyContainer),value:[
      {idShort:'SameProperty',modelType:'RelationshipElement',semanticId:ref(IDTA_02020.sameProperty),second:ref('urn:prop:max-thickness')},
      {idShort:'PropertyProperty',modelType:'Property',semanticId:ref(IDTA_02020.propertyValue),valueType:'xs:double',value:c._value,unit:c._unit},
    ]},
  ]},
]};}
function sm(containers){return {id:'urn:sm:02020',semanticId:ref(IDTA_02020.submodel),submodelElements:[{idShort:'CapabilitySet',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.capabilitySet),value:containers}]};}

const shell={id:'urn:aas:laser-1',idShort:'Laser1',assetInformation:{globalAssetId:'urn:asset:laser-1'}};
const source={provider:'aas-server',observedAt:'2026-09-18T18:20:00Z',revision:'r2',staleAfterMinutes:180};

test('IDTA required capability cannot leak into machine-provided capability graph',()=>{
  const data=sm([container(capability('Offered','urn:cap:laser-cut')),container(capability('Required','urn:cap:paint'))]);
  const extracted=extractAasCapabilities([data]);
  assert.equal(extracted.capabilities.length,1);
  assert.equal(extracted.requiredCapabilities.length,1);
  assert.equal(extracted.capabilities[0].semanticId,'urn:cap:laser-cut');
});

test('offered IDTA property envelope survives adapter -> approved mapping -> capability graph -> deterministic feasibility',()=>{
  const data=sm([container(capability('Offered','urn:cap:laser-cut','12','mm'))]);
  const adapted=aasShellToCapabilityAsset({tenantId:'tenant-a',siteId:'site-1',shell,submodels:[data],source});
  const graph=buildCapabilityGraph({
    tenantId:'tenant-a',siteId:'site-1',now:'2026-09-18T18:30:00Z',assets:[adapted.asset],
    semanticMappings:[{tenantId:'tenant-a',scope:'tenant',mappingId:'m1',semanticId:'urn:cap:laser-cut',capabilityId:'laser-cut',approvalStatus:'approved'}],
    capabilityRequirements:[{tenantId:'tenant-a',siteId:'site-1',capabilityId:'laser-cut',requiredSkills:['laser-l2']}],
    people:[{tenantId:'tenant-a',siteId:'site-1',personId:'p1',availableNow:true,qualifications:[{skillId:'laser-l2',status:'valid',authoritative:true}]}],
  });
  assert.equal(graph.assets[0].capabilities[0].properties[0].value,12);
  const result=assessGraphProductionCapability({
    graph,
    requirement:{capabilityId:'laser-cut',constraints:[{semanticId:'urn:prop:max-thickness',operator:'gte',value:10,unit:'mm'}]},
    workforceCoverage:{status:'ready',gap:0},
  });
  assert.equal(result.status,'ready');
  assert.deepEqual(result.technicallyFeasibleAssets,['urn:asset:laser-1']);
});

test('missing unit remains review-required through end-to-end technical matching',()=>{
  const c=capability('Offered','urn:cap:laser-cut','12',null);
  const data=sm([container(c)]);
  const adapted=aasShellToCapabilityAsset({tenantId:'tenant-a',siteId:'site-1',shell,submodels:[data],source});
  const graph=buildCapabilityGraph({
    tenantId:'tenant-a',siteId:'site-1',now:'2026-09-18T18:30:00Z',assets:[adapted.asset],
    semanticMappings:[{tenantId:'tenant-a',scope:'tenant',mappingId:'m1',semanticId:'urn:cap:laser-cut',capabilityId:'laser-cut',approvalStatus:'approved'}],
  });
  const result=assessGraphProductionCapability({
    graph,
    requirement:{capabilityId:'laser-cut',constraints:[{semanticId:'urn:prop:max-thickness',operator:'gte',value:10,unit:'mm'}]},
  });
  assert.equal(result.status,'review_required');
  assert.equal(result.candidates[0].reason,'missing_property_unit');
});

test('IEC61360 unit identity and IDTA range survive adapter -> graph -> deterministic feasibility',()=>{
  const offered={
    idShort:'OfferedLaser',modelType:'Capability',semanticId:ref(IDTA_02020.capability),supplementalSemanticIds:[ref('urn:cap:laser-cut')],
    qualifiers:[{type:'Offered',value:'true',semanticId:ref(IDTA_02020.roleOffered)}],
  };
  const rangeContainer={idShort:'CapabilityContainer',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.capabilityContainer),value:[
    offered,
    {idShort:'PropertySet',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.propertySet),value:[
      {idShort:'PropertyContainer',modelType:'SubmodelElementCollection',semanticId:ref(IDTA_02020.propertyContainer),value:[
        {idShort:'SameProperty',modelType:'RelationshipElement',semanticId:ref(IDTA_02020.sameProperty),second:ref('urn:prop:max-thickness')},
        {idShort:'PropertyRange',modelType:'Range',semanticId:ref(IDTA_02020.propertyRange),valueType:'xs:double',min:'2',max:'12'},
      ]},
    ]},
  ]};
  const data=sm([rangeContainer]);
  const conceptDescriptions=[{id:'urn:prop:max-thickness',embeddedDataSpecifications:[{dataSpecificationContent:{modelType:'DataSpecificationIec61360',dataType:'REAL_MEASURE',unit:'millimetre',unitId:ref('urn:unit:mm')}}]}];
  const adapted=aasShellToCapabilityAsset({tenantId:'tenant-a',siteId:'site-1',shell,submodels:[data],conceptDescriptions,source});
  const graph=buildCapabilityGraph({
    tenantId:'tenant-a',siteId:'site-1',now:'2026-09-18T18:30:00Z',assets:[adapted.asset],
    semanticMappings:[{tenantId:'tenant-a',scope:'tenant',mappingId:'m1',semanticId:'urn:cap:laser-cut',capabilityId:'laser-cut',approvalStatus:'approved'}],
  });
  const property=graph.assets[0].capabilities[0].properties[0];
  assert.equal(property.kind,'range');
  assert.equal(property.unitId,'urn:unit:mm');
  const result=assessGraphProductionCapability({
    graph,
    requirement:{capabilityId:'laser-cut',constraints:[{semanticId:'urn:prop:max-thickness',operator:'contains',value:10,unit:'mm',unitId:'urn:unit:mm'}]},
  });
  assert.equal(result.status,'ready');
});
