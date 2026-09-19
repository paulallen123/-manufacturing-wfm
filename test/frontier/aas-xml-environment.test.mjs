import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAasXmlEnvironment } from '../../src/frontier/aas-xml-environment.mjs';

const capabilityXml = `<environment xmlns="https://admin-shell.io/aas/3/2">
<submodels><submodel><id>sm1</id><submodelElements><capability><idShort>Laser</idShort><semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>urn:cap:laser</value></key></keys></semanticId></capability></submodelElements></submodel></submodels>
</environment>`;

test('decodes official AAS 3.2 capability XML shape into adapter-compatible objects', () => {
  const result = decodeAasXmlEnvironment(capabilityXml);
  assert.equal(result.status, 'accepted');
  assert.equal(result.environment.submodels[0].submodelElements[0].modelType, 'Capability');
  assert.equal(result.environment.submodels[0].submodelElements[0].semanticId.keys[0].value, 'urn:cap:laser');
});

test('supports namespace aliases without depending on the prefix name', () => {
  const xml = capabilityXml.replace('<environment xmlns="https://admin-shell.io/aas/3/2">', '<aas:environment xmlns:aas="https://admin-shell.io/aas/3/2">')
    .replace('</environment>', '</aas:environment>')
    .replaceAll('<submodels>', '<aas:submodels>').replaceAll('</submodels>', '</aas:submodels>')
    .replaceAll('<submodel>', '<aas:submodel>').replaceAll('</submodel>', '</aas:submodel>')
    .replaceAll('<id>', '<aas:id>').replaceAll('</id>', '</aas:id>')
    .replaceAll('<submodelElements>', '<aas:submodelElements>').replaceAll('</submodelElements>', '</aas:submodelElements>')
    .replaceAll('<capability>', '<aas:capability>').replaceAll('</capability>', '</aas:capability>')
    .replaceAll('<idShort>', '<aas:idShort>').replaceAll('</idShort>', '</aas:idShort>')
    .replaceAll('<semanticId>', '<aas:semanticId>').replaceAll('</semanticId>', '</aas:semanticId>')
    .replaceAll('<type>', '<aas:type>').replaceAll('</type>', '</aas:type>')
    .replaceAll('<keys>', '<aas:keys>').replaceAll('</keys>', '</aas:keys>')
    .replaceAll('<key>', '<aas:key>').replaceAll('</key>', '</aas:key>')
    .replaceAll('<value>', '<aas:value>').replaceAll('</value>', '</aas:value>');
  const result = decodeAasXmlEnvironment(xml);
  assert.equal(result.status, 'accepted');
  assert.equal(result.environment.submodels[0].id, 'sm1');
});

test('decodes collections, qualifiers, relationships and ranges used by capability descriptions', () => {
  const xml = `<environment xmlns="https://admin-shell.io/aas/3/1"><submodels><submodel><id>sm</id><semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>urn:sm:cap</value></key></keys></semanticId><submodelElements><submodelElementCollection><idShort>CapabilityContainer</idShort><value><capability><idShort>Cut</idShort><qualifiers><qualifier><type>Offered</type><valueType>xs:string</valueType><value>true</value></qualifier></qualifiers></capability><range><idShort>PropertyRange</idShort><valueType>xs:double</valueType><min>2</min><max>12</max></range><relationshipElement><idShort>CapabilityRealizedBy</idShort><first><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>urn:cap</value></key></keys></first><second><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>urn:skill</value></key></keys></second></relationshipElement></value></submodelElementCollection></submodelElements></submodel></submodels></environment>`;
  const result = decodeAasXmlEnvironment(xml);
  assert.equal(result.status, 'accepted');
  const values = result.environment.submodels[0].submodelElements[0].value;
  assert.equal(values[0].modelType, 'Capability');
  assert.equal(values[0].qualifiers[0].type, 'Offered');
  assert.deepEqual({ min: values[1].min, max: values[1].max }, { min: '2', max: '12' });
  assert.equal(values[2].second.keys[0].value, 'urn:skill');
});

test('decodes concept-description unit semantics needed for deterministic matching', () => {
  const xml = `<environment xmlns="https://admin-shell.io/aas/3/2"><conceptDescriptions><conceptDescription><id>urn:prop:thickness</id><embeddedDataSpecifications><embeddedDataSpecification><dataSpecification><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>urn:iec</value></key></keys></dataSpecification><dataSpecificationContent><dataSpecificationIec61360><unit>mm</unit><unitId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>urn:unit:mm</value></key></keys></unitId><dataType>REAL_MEASURE</dataType></dataSpecificationIec61360></dataSpecificationContent></embeddedDataSpecification></embeddedDataSpecifications></conceptDescription></conceptDescriptions></environment>`;
  const result = decodeAasXmlEnvironment(xml);
  const content = result.environment.conceptDescriptions[0].embeddedDataSpecifications[0].dataSpecificationContent;
  assert.equal(content.unit, 'mm');
  assert.equal(content.unitId.keys[0].value, 'urn:unit:mm');
});

test('rejects DTD/entity expansion and non-namespace XML attributes', () => {
  assert.equal(decodeAasXmlEnvironment('<!DOCTYPE x [<!ENTITY a "b">]><environment xmlns="https://admin-shell.io/aas/3/2"/>').reason, 'xml_dtd_or_entity_forbidden');
  assert.equal(decodeAasXmlEnvironment('<environment xmlns="https://admin-shell.io/aas/3/2" suspicious="1"/>').reason, 'xml_non_namespace_attribute_forbidden');
});

test('fails closed on unsupported namespaces and depth limits', () => {
  assert.equal(decodeAasXmlEnvironment('<environment xmlns="https://example.invalid/aas"><submodels/></environment>').status, 'review_required');
  const deep = `<environment xmlns="https://admin-shell.io/aas/3/2">${'<submodels>'.repeat(5)}${'</submodels>'.repeat(5)}</environment>`;
  assert.equal(decodeAasXmlEnvironment(deep, { limits: { maxDepth: 2 } }).reason, 'xml_depth_limit_exceeded');
});
