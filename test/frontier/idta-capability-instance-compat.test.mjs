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
