import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAasXmlEnvironment } from '../../src/frontier/aas-xml-environment.mjs';
import { extractAasCapabilities } from '../../src/frontier/aas-capability-adapter.mjs';
import { evaluatePublicInstanceCapabilityRequirement } from '../../src/frontier/factory-capability-envelope-public-instance.mjs';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<environment xmlns="https://admin-shell.io/aas/3/0">
  <assetAdministrationShells />
  <submodels>
    <submodel>
      <idShort>CapabilityDescription</idShort>
      <id>urn:test:hc20:capability-description</id>
      <semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>https://admin-shell.io/idta/CapabilityDescription/1/0/Submodel</value></key></keys></semanticId>
      <submodelElements>
        <submodelElementCollection>
          <idShort>HC20CapabilitySet</idShort>
          <semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>https://admin-shell.io/idta/CapabilityDescription/CapabilitySet/1/0</value></key></keys></semanticId>
          <value>
            <submodelElementCollection>
              <idShort>StirringContinuousContainer</idShort>
              <semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>https://admin-shell.io/idta/CapabilityDescription/CapabilityContainer/1/0</value></key></keys></semanticId>
              <value>
                <capability>
                  <idShort>StirringContinuous</idShort>
                  <semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>https://admin-shell.io/idta/CapabilityDescription/Capability/1/0</value></key></keys></semanticId>
                  <supplementalSemanticIds><reference><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>urn:test:capability:stirring-continuous</value></key></keys></reference></supplementalSemanticIds>
                  <qualifiers><qualifier><semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>https://admin-shell.io/idta/CapabilityDescription/CapabilityRoleQualifiers/Offered/1/0</value></key></keys></semanticId><type>Offered</type><valueType>xs:boolean</valueType><value>true</value></qualifier></qualifiers>
                </capability>
                <submodelElementCollection>
                  <idShort>PropertySet</idShort>
                  <semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>https://admin-shell.io/idta/CapabilityDescription/PropertySet/1/0</value></key></keys></semanticId>
                  <value>
                    <submodelElementCollection>
                      <idShort>RevolutionsPerMinuteContainer</idShort>
                      <semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>https://admin-shell.io/idta/CapabilityDescription/PropertyContainer/1/0</value></key></keys></semanticId>
                      <value>
                        <submodelElementList>
                          <idShort>RevolutionsPerMinute</idShort>
                          <semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>https://admin-shell.io/idta/CapabilityPropertyEnumType/SubmodelElementList/1/0</value></key></keys></semanticId>
                          <supplementalSemanticIds><reference><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>http://qudt.org/vocab/quantitykind/RotationalVelocity</value></key></keys></reference></supplementalSemanticIds>
                          <embeddedDataSpecifications><embeddedDataSpecification><dataSpecification><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>http://qudt.org/vocab/unit/REV-PER-MIN</value></key></keys></dataSpecification><dataSpecificationContent><dataSpecificationIec61360><preferredName /></dataSpecificationIec61360></dataSpecificationContent></embeddedDataSpecification></embeddedDataSpecifications>
                          <value>
                            <property><valueType>xs:int</valueType><value>200</value></property>
                            <property><valueType>xs:int</valueType><value>300</value></property>
                          </value>
                        </submodelElementList>
                      </value>
                    </submodelElementCollection>
                    <submodelElementCollection>
                      <idShort>DurationContainer</idShort>
                      <semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>https://admin-shell.io/idta/CapabilityDescription/PropertyContainer/1/0</value></key></keys></semanticId>
                      <value>
                        <range>
                          <idShort>Duration</idShort>
                          <semanticId><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>https://admin-shell.io/idta/CapabilityPropertyEnumType/Range/1/0</value></key></keys></semanticId>
                          <supplementalSemanticIds><reference><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>http://qudt.org/vocab/quantitykind/Time</value></key></keys></reference></supplementalSemanticIds>
                          <embeddedDataSpecifications><embeddedDataSpecification><dataSpecification><type>ExternalReference</type><keys><key><type>GlobalReference</type><value>http://qudt.org/vocab/unit/SEC</value></key></keys></dataSpecification><dataSpecificationContent><dataSpecificationIec61360><preferredName /></dataSpecificationIec61360></dataSpecificationContent></embeddedDataSpecification></embeddedDataSpecifications>
                          <valueType>xs:int</valueType><min>1</min><max></max>
                        </range>
                      </value>
                    </submodelElementCollection>
                  </value>
                </submodelElementCollection>
              </value>
            </submodelElementCollection>
          </value>
        </submodelElementCollection>
      </submodelElements>
    </submodel>
  </submodels>
</environment>`;

test('public-style IDTA XML preserves discrete values, one-sided ranges and explicit QUDT unit identity', () => {
  const decoded = decodeAasXmlEnvironment(xml);
  assert.equal(decoded.status, 'accepted');
  const extracted = extractAasCapabilities(decoded.environment.submodels, { conceptDescriptions: decoded.environment.conceptDescriptions });
  assert.equal(extracted.status, 'accepted');
  assert.equal(extracted.capabilities.length, 1);
  assert.equal(extracted.idta02020.publicInstanceEnrichment.discreteSets, 1);
  assert.equal(extracted.idta02020.publicInstanceEnrichment.oneSidedRanges, 1);
  assert.equal(extracted.idta02020.publicInstanceEnrichment.embeddedUnits, 2);

  const capability = extracted.capabilities[0];
  const rpm = capability.properties.find((item) => item.semanticId === 'http://qudt.org/vocab/quantitykind/RotationalVelocity');
  const duration = capability.properties.find((item) => item.semanticId === 'http://qudt.org/vocab/quantitykind/Time');
  assert.deepEqual(rpm.value, [200, 300]);
  assert.equal(rpm.kind, 'set');
  assert.equal(rpm.unitId, 'http://qudt.org/vocab/unit/REV-PER-MIN');
  assert.equal(duration.kind, 'range');
  assert.equal(duration.min, 1);
  assert.equal(duration.max, null);
  assert.equal(duration.unitId, 'http://qudt.org/vocab/unit/SEC');
});

test('deterministic matching accepts only explicitly supported discrete values and one-sided bounds', () => {
  const decoded = decodeAasXmlEnvironment(xml);
  const capability = extractAasCapabilities(decoded.environment.submodels).capabilities[0];
  const provided = { ...capability, capabilityId: 'stirring-continuous' };
  const result = evaluatePublicInstanceCapabilityRequirement(provided, {
    capabilityId: 'stirring-continuous',
    constraints: [
      { semanticId: 'http://qudt.org/vocab/quantitykind/RotationalVelocity', operator: 'contains', value: 200, unitId: 'http://qudt.org/vocab/unit/REV-PER-MIN' },
      { semanticId: 'http://qudt.org/vocab/quantitykind/Time', operator: 'contains', value: 5, unitId: 'http://qudt.org/vocab/unit/SEC' },
    ],
  });
  assert.equal(result.status, 'feasible');

  const unsupportedSpeed = evaluatePublicInstanceCapabilityRequirement(provided, {
    capabilityId: 'stirring-continuous',
    constraints: [{ semanticId: 'http://qudt.org/vocab/quantitykind/RotationalVelocity', operator: 'contains', value: 250, unitId: 'http://qudt.org/vocab/unit/REV-PER-MIN' }],
  });
  assert.equal(unsupportedSpeed.status, 'infeasible');

  const belowMinimum = evaluatePublicInstanceCapabilityRequirement(provided, {
    capabilityId: 'stirring-continuous',
    constraints: [{ semanticId: 'http://qudt.org/vocab/quantitykind/Time', operator: 'contains', value: 0, unitId: 'http://qudt.org/vocab/unit/SEC' }],
  });
  assert.equal(belowMinimum.status, 'infeasible');
});

test('discrete values fail closed for unsupported operators or incompatible units', () => {
  const decoded = decodeAasXmlEnvironment(xml);
  const capability = extractAasCapabilities(decoded.environment.submodels).capabilities[0];
  const provided = { ...capability, capabilityId: 'stirring-continuous' };

  const operator = evaluatePublicInstanceCapabilityRequirement(provided, {
    capabilityId: 'stirring-continuous',
    constraints: [{ semanticId: 'http://qudt.org/vocab/quantitykind/RotationalVelocity', operator: 'gte', value: 200, unitId: 'http://qudt.org/vocab/unit/REV-PER-MIN' }],
  });
  assert.equal(operator.status, 'unknown');
  assert.equal(operator.checks[0].reason, 'set_requires_contains_operator');

  const unit = evaluatePublicInstanceCapabilityRequirement(provided, {
    capabilityId: 'stirring-continuous',
    constraints: [{ semanticId: 'http://qudt.org/vocab/quantitykind/RotationalVelocity', operator: 'contains', value: 200, unitId: 'http://qudt.org/vocab/unit/RAD-PER-SEC' }],
  });
  assert.equal(unit.status, 'unknown');
  assert.equal(unit.checks[0].reason, 'unit_mismatch');
});
