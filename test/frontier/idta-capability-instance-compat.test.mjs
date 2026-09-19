import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdta02020InstanceSubmodels } from '../../src/frontier/idta-02020-instance-compat.mjs';

const ref=(value)=>({type:'ExternalReference',keys:[{type:'GlobalReference',value}]});
const sm=(element)=>({
  semanticId:ref('https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0'),
  submodelElements:[{
    idShort:'CapabilitySet_ToolServices',
    value:[{
      idShort:'CapabilityContainer_Recoating',
      value:[{
        idShort:'PropertySet_Recoating',
        value:[{
          idShort:'PropertyContainer_OperationType',
          semanticId:ref('https://admin-shell.io/idta/CapabilityDescription/PropertyContainer/1/0'),
          value:[element],
        }],
      }],
    }],
  }],
});

const legacyPublicShape=(name)=>({
  id:`urn:public:${name}`,
  semanticId:ref('https://admin-shell.io/idta/CapabilityDescription/1/0/Submodel'),
  submodelElements:[{
    idShort:`${name}CapabilitySet`,
    modelType:'SubmodelElementCollection',
    semanticId:ref('https://admin-shell.io/idta/CapabilityDescription/CapabilitySet/1/0'),
    value:[{
      idShort:`${name}Container`,
      modelType:'SubmodelElementCollection',
      semanticId:ref('https://admin-shell.io/idta/CapabilityDescription/CapabilityContainer/1/0'),
      value:[{
        idShort:name,
        modelType:'Capability',
        semanticId:ref('https://admin-shell.io/idta/CapabilityDescription/Capability/1/0'),
        supplementalSemanticIds:[ref(`urn:cap:${name.toLowerCase()}`)],
        qualifiers:[{
          type:'Offered',
          valueType:'xs:boolean',
          value:'true',
          semanticId:ref('https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifiers/Offered/1/0'),
        }],
      }],
    }],
  }],
});

test('normalizes direct domain Property shape used by public IDTA 02020 instances without mutating input',()=>{
  const input=sm({idShort:'OperationType',modelType:'Property',semanticId:ref('https://example.test/semantic/OperationType'),valueType:'xs:string',value:'Recoating'});
  const before=JSON.stringify(input);
  const result=normalizeIdta02020InstanceSubmodels([input]);
  const prop=result.submodels[0].submodelElements[0].value[0].value[0].value[0].value[0];
  assert.equal(result.normalizedProperties,1);
  assert.equal(prop.idShort,'OperationType');
  assert.equal(prop.semanticId.keys[0].value,'https://admin-shell.io/idta/CapabilityPropertyType/Property/1/0');
  assert.equal(prop.supplementalSemanticIds[0].keys[0].value,'https://example.test/semantic/OperationType');
  assert.equal(JSON.stringify(input),before);
  assert.equal(result.sourceMutation,false);
});

test('normalizes direct domain Range while preserving domain identity',()=>{
  const input=sm({idShort:'SupportedDiameter',modelType:'Range',semanticId:ref('https://example.test/semantic/SupportedDiameter'),valueType:'xs:double',min:'2',max:'12'});
  const result=normalizeIdta02020InstanceSubmodels([input]);
  const range=result.submodels[0].submodelElements[0].value[0].value[0].value[0].value[0];
  assert.equal(range.semanticId.keys[0].value,'https://admin-shell.io/idta/CapabilityPropertyEnumType/Range/1/0');
  assert.equal(range.supplementalSemanticIds[0].keys[0].value,'https://example.test/semantic/SupportedDiameter');
});

test('ambiguous domain semantics fail closed rather than selecting one',()=>{
  const input=sm({
    idShort:'OperationType',
    modelType:'Property',
    semanticId:ref('https://example.test/semantic/OperationType'),
    supplementalSemanticIds:[ref('https://other.example/semantic/OperationType')],
    valueType:'xs:string',
    value:'Recoating',
  });
  const result=normalizeIdta02020InstanceSubmodels([input]);
  assert.equal(result.normalizedProperties,0);
  assert.equal(result.reviewRequired[0].reason,'ambiguous_domain_property_semantics');
});

test('normalizes the exact legacy IDTA submodel and role references used by public capability instances',()=>{
  const input=legacyPublicShape('HeatingControlled');
  const before=JSON.stringify(input);
  const result=normalizeIdta02020InstanceSubmodels([input]);
  const normalized=result.submodels[0];
  const capability=normalized.submodelElements[0].value[0].value[0];
  assert.equal(result.matchedSubmodels,1);
  assert.equal(result.normalizedAliases,2);
  assert.equal(normalized.semanticId.keys[0].value,'https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0');
  assert.equal(capability.qualifiers[0].semanticId.keys[0].value,'https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifier/Offered/1/0');
  assert.equal(JSON.stringify(input),before);
  assert.equal(result.sourceMutation,false);
});

test('three representative public RWTH capability-instance shapes normalize deterministically with no manual URI mapping',()=>{
  const inputs=['HeatingControlled','StirringContinuous','PumpingContinuous'].map(legacyPublicShape);
  const result=normalizeIdta02020InstanceSubmodels(inputs);
  assert.equal(result.matchedSubmodels,3);
  assert.equal(result.normalizedAliases,6);
  assert.equal(result.reviewRequired.length,0);
  assert.equal(result.submodels.every((item)=>item.semanticId.keys[0].value==='https://admin-shell.io/idta/SubmodelTemplate/CapabilityDescription/1/0'),true);
});

test('near-match legacy-looking semantics are not widened into trusted IDTA aliases',()=>{
  const input=legacyPublicShape('HeatingControlled');
  input.semanticId=ref('https://admin-shell.io/idta/CapabilityDescription/1/0/Submodel-v2');
  input.submodelElements[0].value[0].value[0].qualifiers[0].semanticId=ref('https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifiers/OfferedExperimental/1/0');
  const result=normalizeIdta02020InstanceSubmodels([input]);
  assert.equal(result.matchedSubmodels,0);
  assert.equal(result.normalizedAliases,0);
  assert.equal(result.submodels[0].semanticId.keys[0].value,'https://admin-shell.io/idta/CapabilityDescription/1/0/Submodel-v2');
});
