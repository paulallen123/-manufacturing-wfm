import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapabilityGraph,
  assessCapabilityCoverage,
  findTrainingCandidates,
  summarizeCapabilityHome,
  applyApprovedSemanticMappings,
  measureConfigurationReuse,
} from '../../src/frontier/factory-capability-graph.mjs';

const now = '2026-09-18T16:00:00Z';
const source = { provider: 'opc-ua-isa95', observedAt: '2026-09-18T15:55:00Z', revision: 'r4', staleAfterMinutes: 30 };
const scope = { tenantId: 'tenant-a', siteId: 'site-1' };
const assets = [
  { ...scope, assetId: 'laser-1', label: 'Laser Cell 1', workCentreId: 'laser', assetClass: 'laser', semanticModel: 'OPC-UA/ISA95', source, capabilities: [{ capabilityId: 'laser-cut', label: 'Laser cutting', semanticId: 'urn:cap:laser-cut' }] },
  { ...scope, assetId: 'press-1', label: 'Press 1', workCentreId: 'press', assetClass: 'press', semanticModel: 'generic', source: { ...source, provider: 'mes' }, capabilities: [{ capabilityId: 'metal-form', label: 'Metal forming' }] },
  { ...scope, assetId: 'robot-1', label: 'Robot Cell 1', workCentreId: 'weld', assetClass: 'robot', semanticModel: 'OPC-UA', source, capabilities: [{ label: 'Arc weld program', semanticId: 'urn:vendor:arcweld' }] },
];
const requirements = [
  { ...scope, capabilityId: 'laser-cut', label: 'Laser cutting', requiredSkills: ['laser-l2', 'safety-laser'], minimumQualifiedPeople: 2 },
  { ...scope, capabilityId: 'metal-form', label: 'Metal forming', requiredSkills: ['press-l1'], minimumQualifiedPeople: 1 },
];
const people = [
  { ...scope, personId: 'p1', displayName: 'AK', availableNow: true, qualifications: [{ skillId: 'laser-l2', status: 'valid', authoritative: true }, { skillId: 'safety-laser', status: 'valid', authoritative: true }] },
  { ...scope, personId: 'p2', displayName: 'JM', availableNow: true, qualifications: [{ skillId: 'laser-l2', status: 'valid', authoritative: true }] },
  { ...scope, personId: 'p3', displayName: 'SR', availableNow: true, qualifications: [{ skillId: 'press-l1', status: 'valid', authoritative: true }] },
  { ...scope, personId: 'p4', displayName: 'TC', availableNow: true, qualifications: [{ skillId: 'safety-laser', status: 'valid', authoritative: false }] },
];

test('builds a scoped graph while preserving unmapped semantics', () => {
  const graph = buildCapabilityGraph({ ...scope, assets, capabilityRequirements: requirements, people, now });
  assert.equal(graph.assets.length, 3);
  assert.equal(graph.unmappedCapabilities.length, 1);
  assert.equal(graph.unmappedCapabilities[0].label, 'Arc weld program');
  assert.ok(graph.graphHash.length > 20);
});

test('fails closed on cross-tenant assets', () => {
  const graph = buildCapabilityGraph({ ...scope, assets: [...assets, { ...assets[0], tenantId: 'other', assetId: 'bad' }], capabilityRequirements: requirements, people, now });
  assert.equal(graph.assets.some((asset) => asset.assetId === 'bad'), false);
  assert.equal(graph.quarantined.some((item) => item.assetId === 'bad' && item.reason === 'scope_mismatch'), true);
});

test('quarantines stale discovered machine evidence', () => {
  const stale = { ...assets[0], assetId: 'stale', source: { ...source, observedAt: '2026-09-17T15:00:00Z' } };
  const graph = buildCapabilityGraph({ ...scope, assets: [stale], capabilityRequirements: requirements, people, now });
  assert.equal(graph.assets.length, 0);
  assert.equal(graph.quarantined[0].reason, 'stale_source');
});

test('never treats non-authoritative qualifications as valid', () => {
  const graph = buildCapabilityGraph({ ...scope, assets, capabilityRequirements: requirements, people, now });
  const coverage = assessCapabilityCoverage(graph);
  const laser = coverage.find((item) => item.capabilityId === 'laser-cut');
  assert.equal(laser.qualifiedAvailable, 1);
  assert.equal(laser.gap, 1);
  assert.equal(laser.status, 'at_risk');
});

test('marks a capability ready when the required qualified workforce exists', () => {
  const graph = buildCapabilityGraph({ ...scope, assets, capabilityRequirements: requirements, people, now });
  const press = assessCapabilityCoverage(graph).find((item) => item.capabilityId === 'metal-form');
  assert.equal(press.status, 'ready');
  assert.equal(press.qualifiedAvailable, 1);
});

test('training candidates are ranked by skills distance without auto-qualifying them', () => {
  const graph = buildCapabilityGraph({ ...scope, assets, capabilityRequirements: requirements, people, now });
  const candidates = findTrainingCandidates(graph, 'laser-cut');
  assert.equal(candidates[0].displayName, 'JM');
  assert.deepEqual(candidates[0].missingSkills, ['safety-laser']);
  assert.equal(candidates[0].readinessDistance, 1);
});

test('home summary exposes mapping review and readiness clearly', () => {
  const graph = buildCapabilityGraph({ ...scope, assets, capabilityRequirements: requirements, people, now });
  const summary = summarizeCapabilityHome(graph, assessCapabilityCoverage(graph));
  assert.equal(summary.assetsUnderstood, 3);
  assert.equal(summary.atRiskCount, 1);
  assert.equal(summary.needsReviewCount, 1);
  assert.match(summary.claimBoundary, /authoritative/i);
});

test('demand can raise minimum qualified staffing without mutating qualifications', () => {
  const graph = buildCapabilityGraph({ ...scope, assets, capabilityRequirements: requirements, people, now });
  const coverage = assessCapabilityCoverage(graph, { demand: [{ ...scope, capabilityId: 'metal-form', minimumQualifiedPeople: 2 }] });
  const press = coverage.find((item) => item.capabilityId === 'metal-form');
  assert.equal(press.minimumQualifiedPeople, 2);
  assert.equal(press.gap, 1);
  assert.equal(press.status, 'at_risk');
});


test('approved tenant semantic mappings are reusable across sites without granting qualifications', () => {
  const raw = { ...assets[2], siteId: 'site-2' };
  const mapping = { tenantId: 'tenant-a', scope: 'tenant', mappingId: 'm-weld', semanticId: 'urn:vendor:arcweld', capabilityId: 'robotic-weld', approvalStatus: 'approved' };
  const mapped = applyApprovedSemanticMappings(raw, [mapping]);
  assert.equal(mapped.capabilities[0].capabilityId, 'robotic-weld');
  assert.equal(mapped.capabilities[0].mappingStatus, 'reused_approved_semantic');
});

test('conflicting or unapproved semantic mappings remain review-required', () => {
  const raw = assets[2];
  const mappings = [
    { tenantId: 'tenant-a', scope: 'tenant', mappingId: 'm1', semanticId: 'urn:vendor:arcweld', capabilityId: 'robotic-weld', approvalStatus: 'approved' },
    { tenantId: 'tenant-a', scope: 'tenant', mappingId: 'm2', semanticId: 'urn:vendor:arcweld', capabilityId: 'manual-weld', approvalStatus: 'approved' },
  ];
  const mapped = applyApprovedSemanticMappings(raw, mappings);
  assert.equal(mapped.capabilities[0].capabilityId, undefined);
  assert.equal(mapped.capabilities[0].mappingStatus, 'conflict');
  const unapproved = applyApprovedSemanticMappings(raw, [{ ...mappings[0], approvalStatus: 'suggested' }]);
  assert.equal(unapproved.capabilities[0].capabilityId, undefined);
});

test('second-site semantic reuse clears the 60% repeated-configuration threshold under a mixed fixture', () => {
  const knownMappings = Array.from({ length: 8 }, (_, i) => ({ tenantId: 'tenant-a', scope: 'tenant', mappingId: `m${i}`, semanticId: `urn:cap:${i}`, capabilityId: `cap-${i}`, approvalStatus: 'approved' }));
  const secondSite = Array.from({ length: 50 }, (_, i) => ({
    tenantId: 'tenant-a',
    siteId: 'site-2',
    assetId: `a${i}`,
    source,
    capabilities: [{ semanticId: i < 40 ? `urn:cap:${i % 8}` : `urn:novel:${i}`, label: `Capability ${i}` }],
  }));
  const result = measureConfigurationReuse({ assets: secondSite, semanticMappings: knownMappings });
  assert.equal(result.manualBaselineDecisions, 50);
  assert.equal(result.autoMapped, 40);
  assert.equal(result.reviewRequired, 10);
  assert.equal(result.repeatedConfigurationReductionPct, 0.8);
  assert.ok(result.repeatedConfigurationReductionPct >= 0.6);
});
