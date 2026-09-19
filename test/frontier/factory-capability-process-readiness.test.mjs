import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilityGraph } from '../../src/frontier/factory-capability-graph.mjs';
import { buildProcessCapabilityReadinessMask } from '../../src/frontier/factory-capability-process-readiness.mjs';

const scope = { tenantId: 'tenant-a', siteId: 'site-1' };
const source = { provider: 'aas', observedAt: '2026-09-19T03:00:00Z', revision: 'r1', staleAfterMinutes: 120 };
const laserProperty = (value = 12, unit = 'mm') => [{ semanticId: 'urn:prop:max-thickness', value, unit }];

function graphFixture({ qualifiedPeople = 1, includeWorkforceRequirement = true, assets = null } = {}) {
  const assetList = assets ?? [
    { ...scope, assetId: 'laser-1', source, capabilities: [{ capabilityId: 'laser-cut', properties: laserProperty(12) }] },
    { ...scope, assetId: 'press-1', source, capabilities: [{ capabilityId: 'press-form', properties: [{ semanticId: 'urn:prop:tonnage', value: 100, unit: 't' }] }] },
  ];
  const capabilityRequirements = includeWorkforceRequirement ? [
    { ...scope, capabilityId: 'laser-cut', label: 'Laser cutting', requiredSkills: ['laser-l2'], minimumQualifiedPeople: 1 },
    { ...scope, capabilityId: 'press-form', label: 'Press forming', requiredSkills: ['press-l1'], minimumQualifiedPeople: 1 },
  ] : [];
  const people = Array.from({ length: qualifiedPeople }, (_, index) => ({
    ...scope,
    personId: `laser-person-${index}`,
    availableNow: true,
    qualifications: [{ skillId: 'laser-l2', status: 'valid', authoritative: true }],
  }));
  return buildCapabilityGraph({ ...scope, assets: assetList, capabilityRequirements, people, now: '2026-09-19T03:10:00Z' });
}

const laserStep = (value = 10, extra = {}) => ({
  stepId: 'cut-1',
  label: 'Cut blank',
  requirement: {
    capabilityId: 'laser-cut',
    constraints: [{ semanticId: 'urn:prop:max-thickness', operator: 'gte', value, unit: 'mm' }],
  },
  ...extra,
});

test('produces a deterministic pre-solver mask with only confirmed machine/workforce assignments eligible', () => {
  const result = buildProcessCapabilityReadinessMask({ graph: graphFixture(), steps: [laserStep()] });
  assert.equal(result.status, 'accepted');
  assert.equal(result.planStatus, 'ready');
  assert.deepEqual(result.steps[0].eligibleAssetIds, ['laser-1']);
  assert.equal(result.steps[0].candidates.find((item) => item.assetId === 'press-1').status, 'infeasible');
  assert.equal(result.metrics.totalCandidateAssignments, 2);
  assert.equal(result.metrics.technicallyFeasibleAssignments, 1);
  assert.equal(result.metrics.technicalPruningPct, 0.5);
  assert.match(result.authorityBoundary, /cannot publish schedules/i);
});

test('rejects false-ready when no machine meets the technical envelope', () => {
  const result = buildProcessCapabilityReadinessMask({ graph: graphFixture(), steps: [laserStep(16)] });
  assert.equal(result.planStatus, 'not_feasible');
  assert.equal(result.steps[0].eligibleAssetIds.length, 0);
  assert.equal(result.steps[0].candidates.every((item) => item.status === 'infeasible'), true);
});

test('technical feasibility cannot hide an authoritative workforce gap', () => {
  const result = buildProcessCapabilityReadinessMask({ graph: graphFixture({ qualifiedPeople: 1 }), steps: [laserStep(10, { minimumQualifiedPeople: 2 })] });
  assert.equal(result.planStatus, 'not_ready');
  const laser = result.steps[0].candidates.find((item) => item.assetId === 'laser-1');
  assert.equal(laser.technicalStatus, 'feasible');
  assert.equal(laser.status, 'not_ready');
  assert.equal(laser.reason, 'workforce_capability_gap');
  assert.equal(result.steps[0].workforceCoverage.gap, 1);
});

test('missing workforce requirement fails closed instead of treating machine evidence as staffing evidence', () => {
  const result = buildProcessCapabilityReadinessMask({ graph: graphFixture({ includeWorkforceRequirement: false }), steps: [laserStep()] });
  assert.equal(result.planStatus, 'review_required');
  const laser = result.steps[0].candidates.find((item) => item.assetId === 'laser-1');
  assert.equal(laser.status, 'review_required');
  assert.equal(laser.reason, 'workforce_requirement_missing');
});

test('unknown units remain review-required and cannot become eligible', () => {
  const graph = graphFixture({ assets: [
    { ...scope, assetId: 'laser-1', source, capabilities: [{ capabilityId: 'laser-cut', properties: laserProperty(12, 'mm') }] },
  ] });
  const step = laserStep();
  step.requirement.constraints[0].unit = 'inch';
  const result = buildProcessCapabilityReadinessMask({ graph, steps: [step] });
  assert.equal(result.planStatus, 'review_required');
  assert.equal(result.steps[0].candidates[0].status, 'review_required');
  assert.equal(result.steps[0].candidates[0].reason, 'insufficient_or_incompatible_evidence');
});

test('repeated capability demand uses the strongest staffing requirement rather than the last step', () => {
  const result = buildProcessCapabilityReadinessMask({
    graph: graphFixture({ qualifiedPeople: 1 }),
    steps: [laserStep(10, { stepId: 'cut-high', minimumQualifiedPeople: 2 }), laserStep(10, { stepId: 'cut-low', minimumQualifiedPeople: 1 })],
  });
  assert.equal(result.planStatus, 'not_ready');
  assert.equal(result.steps[0].workforceCoverage.minimumQualifiedPeople, 2);
  assert.equal(result.steps[1].workforceCoverage.minimumQualifiedPeople, 2);
});

test('invalid staffing demand fails closed rather than creating a NaN-ready result', () => {
  const result = buildProcessCapabilityReadinessMask({ graph: graphFixture(), steps: [laserStep(10, { minimumQualifiedPeople: 0 })] });
  assert.equal(result.planStatus, 'review_required');
  assert.equal(result.steps[0].reason, 'invalid_process_step_requirement');
});

test('synthetic candidate mask clears the 50% pruning threshold without losing the known feasible asset', () => {
  const assets = [
    { ...scope, assetId: 'laser-1', source, capabilities: [{ capabilityId: 'laser-cut', properties: laserProperty(12) }] },
    ...Array.from({ length: 9 }, (_, index) => ({
      ...scope,
      assetId: `other-${index}`,
      source,
      capabilities: [{ capabilityId: `other-cap-${index}`, properties: [] }],
    })),
  ];
  const result = buildProcessCapabilityReadinessMask({ graph: graphFixture({ assets }), steps: [laserStep()] });
  assert.equal(result.planStatus, 'ready');
  assert.deepEqual(result.steps[0].eligibleAssetIds, ['laser-1']);
  assert.ok(result.metrics.technicalPruningPct >= 0.5);
  assert.equal(result.metrics.technicalPruningPct, 0.9);
});
