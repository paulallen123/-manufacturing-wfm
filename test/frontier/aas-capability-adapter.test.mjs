import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAasCapabilities, aasShellToCapabilityAsset } from '../../src/frontier/aas-capability-adapter.mjs';
import { buildCapabilityGraph } from '../../src/frontier/factory-capability-graph.mjs';

const source = { provider: 'aas-server', observedAt: '2026-09-18T17:00:00Z', revision: 'aas-r1', staleAfterMinutes: 60 };
const shell = { id: 'urn:aas:laser-1', idShort: 'LaserCell1', assetInformation: { globalAssetId: 'urn:asset:laser-1' } };
const submodels = [{
  id: 'urn:sm:capabilities',
  semanticId: { keys: [{ type: 'GlobalReference', value: 'urn:sm-template:capabilities' }] },
  submodelElements: [
    { modelType: 'Property', idShort: 'SerialNumber', semanticId: { keys: [{ type: 'GlobalReference', value: 'urn:property:serial' }] }, value: 'SN-1' },
    { modelType: 'Capability', idShort: 'LaserCutting', semanticId: { keys: [{ type: 'GlobalReference', value: 'urn:cap:laser-cut' }] } },
    { modelType: 'SubmodelElementCollection', idShort: 'Nested', value: [
      { modelType: 'Capability', idShort: 'FineCutting', semanticId: { keys: [{ type: 'GlobalReference', value: 'urn:cap:fine-cut' }] } },
    ] },
  ],
}];

test('extracts only AAS Capability elements and preserves semantic identity', () => {
  const result = extractAasCapabilities(submodels);
  assert.equal(result.status, 'accepted');
  assert.equal(result.capabilities.length, 2);
  assert.deepEqual(result.capabilities.map((item) => item.semanticId), ['urn:cap:laser-cut', 'urn:cap:fine-cut']);
  assert.equal(result.capabilities.some((item) => item.label === 'SerialNumber'), false);
});

test('converts an AAS shell into the existing canonical capability asset shape', () => {
  const result = aasShellToCapabilityAsset({ tenantId: 'tenant-a', siteId: 'site-1', shell, submodels, source, workCentreId: 'laser' });
  assert.equal(result.status, 'accepted');
  assert.equal(result.asset.assetId, 'urn:asset:laser-1');
  assert.equal(result.asset.semanticModel, 'IDTA-AAS-3.x');
  assert.equal(result.asset.capabilities.length, 2);
  assert.equal(result.asset.semanticEvidence.discoveredCapabilityCount, 2);
});

test('does not invent meaning when a Capability has no semanticId', () => {
  const result = extractAasCapabilities([{ id: 'sm', submodelElements: [{ modelType: 'Capability', idShort: 'MysteryCapability' }] }]);
  assert.equal(result.capabilities[0].label, 'MysteryCapability');
  assert.equal(result.capabilities[0].semanticId, null);
});

test('approved AAS semantic identity can reuse an existing capability mapping but not a qualification', () => {
  const adapted = aasShellToCapabilityAsset({ tenantId: 'tenant-a', siteId: 'site-1', shell, submodels, source, workCentreId: 'laser' });
  const graph = buildCapabilityGraph({
    tenantId: 'tenant-a', siteId: 'site-1', now: '2026-09-18T17:10:00Z', assets: [adapted.asset],
    semanticMappings: [{ tenantId: 'tenant-a', scope: 'tenant', mappingId: 'aas-laser', semanticId: 'urn:cap:laser-cut', capabilityId: 'laser-cut', approvalStatus: 'approved' }],
    capabilityRequirements: [{ tenantId: 'tenant-a', siteId: 'site-1', capabilityId: 'laser-cut', label: 'Laser cutting', requiredSkills: ['laser-l2'] }],
    people: [{ tenantId: 'tenant-a', siteId: 'site-1', personId: 'p1', qualifications: [{ skillId: 'laser-l2', status: 'valid', authoritative: false }] }],
  });
  const mapped = graph.assets[0].capabilities.find((item) => item.semanticId === 'urn:cap:laser-cut');
  assert.equal(mapped.capabilityId, 'laser-cut');
  assert.equal(graph.edges.some((edge) => edge.type === 'qualified_for'), false);
});

test('fails closed when AAS payload nesting exceeds the configured limit', () => {
  const deeplyNested = { modelType: 'SubmodelElementCollection', value: [] };
  let cursor = deeplyNested;
  for (let i = 0; i < 6; i += 1) {
    const child = { modelType: 'SubmodelElementCollection', value: [] };
    cursor.value.push(child);
    cursor = child;
  }
  const result = extractAasCapabilities([{ id: 'sm', submodelElements: [deeplyNested] }], { maxDepth: 3 });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'aas_depth_limit_exceeded');
});

test('fails closed when an AAS payload exceeds the configured element count', () => {
  const many = Array.from({ length: 6 }, (_, index) => ({ modelType: 'Property', idShort: `P${index}` }));
  const result = extractAasCapabilities([{ id: 'sm', submodelElements: many }], { maxElements: 5 });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'aas_element_limit_exceeded');
});
