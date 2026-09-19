import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCapabilityRequirement, assessProductionCapability } from '../../src/frontier/factory-capability-envelope.mjs';

const provided = {
  capabilityId: 'laser-cut',
  assetId: 'laser-1',
  properties: [
    { semanticId: 'urn:cap:max-thickness', value: 12, unit: 'mm' },
    { semanticId: 'urn:cap:tolerance', value: 0.2, unit: 'mm' },
    { semanticId: 'urn:cap:material', value: 'steel', unit: 'code' },
  ],
};

const requirement = {
  capabilityId: 'laser-cut',
  constraints: [
    { semanticId: 'urn:cap:max-thickness', operator: 'gte', value: 10, unit: 'mm' },
    { semanticId: 'urn:cap:tolerance', operator: 'lte', value: 0.3, unit: 'mm' },
    { semanticId: 'urn:cap:material', operator: 'in', value: ['steel','aluminium'], unit: 'code' },
  ],
};

test('accepts a provided capability whose envelope satisfies all requirements', () => {
  const result = evaluateCapabilityRequirement(provided, requirement);
  assert.equal(result.status, 'feasible');
  assert.equal(result.checks.every((check) => check.status === 'pass'), true);
});

test('rejects a machine that is outside a hard technical constraint', () => {
  const result = evaluateCapabilityRequirement(provided, {
    ...requirement,
    constraints: [{ semanticId: 'urn:cap:max-thickness', operator: 'gte', value: 16, unit: 'mm' }],
  });
  assert.equal(result.status, 'infeasible');
  assert.equal(result.checks[0].status, 'fail');
});

test('unknown units fail safe rather than being converted or guessed', () => {
  const result = evaluateCapabilityRequirement(provided, {
    ...requirement,
    constraints: [{ semanticId: 'urn:cap:max-thickness', operator: 'gte', value: 0.4, unit: 'inch' }],
  });
  assert.equal(result.status, 'unknown');
  assert.equal(result.checks[0].reason, 'unit_mismatch');
});

test('missing semantic property remains unknown rather than assumed feasible', () => {
  const result = evaluateCapabilityRequirement(provided, {
    ...requirement,
    constraints: [{ semanticId: 'urn:cap:temperature', operator: 'lte', value: 80, unit: 'C' }],
  });
  assert.equal(result.status, 'unknown');
});

test('unsupported constraint types require review', () => {
  const result = evaluateCapabilityRequirement(provided, {
    ...requirement,
    constraints: [{ semanticId: 'urn:cap:max-thickness', operator: 'between', value: [2,10], unit: 'mm' }],
  });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'unsupported_constraint');
});

test('technical feasibility cannot override a workforce qualification gap', () => {
  const result = assessProductionCapability({
    providedCapabilities: [provided],
    requirement,
    workforceCoverage: { status: 'at_risk', gap: 1 },
  });
  assert.equal(result.status, 'not_ready');
  assert.equal(result.reason, 'workforce_capability_gap');
});

test('production capability is ready only when both technical and workforce evidence pass', () => {
  const result = assessProductionCapability({
    providedCapabilities: [provided],
    requirement,
    workforceCoverage: { status: 'ready', gap: 0 },
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.technicallyFeasibleAssets, ['laser-1']);
});

test('mixed assets retain review-required when only unknown evidence exists', () => {
  const unknown = { ...provided, assetId: 'laser-2', properties: provided.properties.filter((p)=>p.semanticId !== 'urn:cap:tolerance') };
  const result = assessProductionCapability({
    providedCapabilities: [unknown],
    requirement,
    workforceCoverage: { status: 'ready' },
  });
  assert.equal(result.status, 'review_required');
});

test('uses unit identity when labels differ but standard unit IDs match',()=>{
  const result=evaluateCapabilityRequirement(
    {capabilityId:'laser-cut',properties:[{semanticId:'urn:p',kind:'scalar',value:12,unit:'millimetre',unitId:'urn:unit:mm'}]},
    {capabilityId:'laser-cut',constraints:[{semanticId:'urn:p',operator:'gte',value:10,unit:'mm',unitId:'urn:unit:mm'}]}
  );
  assert.equal(result.status,'feasible');
});

test('range only passes when requirement explicitly asks whether target is contained',()=>{
  const rangeProvided={capabilityId:'laser-cut',properties:[{semanticId:'urn:p',kind:'range',min:2,max:12,unit:'mm'}]};
  const pass=evaluateCapabilityRequirement(rangeProvided,{capabilityId:'laser-cut',constraints:[{semanticId:'urn:p',operator:'contains',value:10,unit:'mm'}]});
  const fail=evaluateCapabilityRequirement(rangeProvided,{capabilityId:'laser-cut',constraints:[{semanticId:'urn:p',operator:'contains',value:16,unit:'mm'}]});
  assert.equal(pass.status,'feasible');
  assert.equal(fail.status,'infeasible');
});

test('range does not infer gte/lte semantics',()=>{
  const result=evaluateCapabilityRequirement(
    {capabilityId:'laser-cut',properties:[{semanticId:'urn:p',kind:'range',min:2,max:12,unit:'mm'}]},
    {capabilityId:'laser-cut',constraints:[{semanticId:'urn:p',operator:'gte',value:10,unit:'mm'}]}
  );
  assert.equal(result.status,'unknown');
  assert.equal(result.checks[0].reason,'range_requires_contains_operator');
});

test('different unit IDs fail closed even when labels look compatible',()=>{
  const result=evaluateCapabilityRequirement(
    {capabilityId:'laser-cut',properties:[{semanticId:'urn:p',kind:'scalar',value:12,unit:'mm',unitId:'urn:unit:mm'}]},
    {capabilityId:'laser-cut',constraints:[{semanticId:'urn:p',operator:'gte',value:1,unit:'mm',unitId:'urn:unit:inch'}]}
  );
  assert.equal(result.status,'unknown');
  assert.equal(result.checks[0].reason,'unit_mismatch');
});
