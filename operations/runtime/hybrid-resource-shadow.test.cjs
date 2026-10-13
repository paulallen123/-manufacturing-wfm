'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDecisionEpisode } = require('./decision-episode.cjs');
let api = {};
try { api = require('./hybrid-resource-shadow.cjs'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'./hybrid-resource-shadow.cjs'")) throw error; }

const NOW = '2026-10-12T08:00:00.000Z';
const START = '2026-10-12T08:10:00.000Z';
const END = '2026-10-12T08:30:00.000Z';
const BEFORE = '2026-10-12T07:59:00.000Z';
const LATER = '2026-10-12T09:00:00.000Z';
const copy = value => JSON.parse(JSON.stringify(value));
const EVIDENCE_KINDS = ['telemetry', 'availability', 'maintenance', 'inspection', 'zones', 'energy'];
function bindResourceEvidence(resource) {
  for (const kind of EVIDENCE_KINDS) Object.assign(resource[kind], {
    scope: copy(resource.scope), resourceId: resource.id, provider: resource.provider,
    sourceAssetId: resource.sourceAssetId, controllerRef: resource.controllerRef
  });
  return resource;
}
function fixture() {
  const scope = { tenant: 'synthetic-tenant', site: 'site-a', workCentre: 'wc-a' };
  const task = { id: 'task-a', revision: 'task-r1', taskClass: 'material-flow',
    capabilities: [{ id: 'transport', revision: 'cap-r1' }], zoneIds: ['zone-a'], start: START, end: END,
    requirements: { minimumPayloadKg: 10, minimumReachMm: 0, toolClass: 'carrier' } };
  const resources = [bindResourceEvidence({ kind: 'AutomatedResource', id: 'amr-a', resourceType: 'AMR', scope,
    provider: 'synthetic-provider', sourceAssetId: 'source-a', sourceRevision: 'source-r1', controllerRef: 'controller-a',
    capabilities: [{ id: 'transport', revision: 'cap-r1' }], operationalState: 'AVAILABLE',
    telemetry: { revoked: false, observedAt: BEFORE, validUntil: LATER, sourceRevision: 'source-r1', evidenceRef: 'telemetry-a' },
    availability: { revoked: false, state: 'AVAILABLE', start: START, end: END, observedAt: BEFORE, sourceRevision: 'source-r1', evidenceRef: 'availability-a' },
    maintenance: { complete: true, revoked: false, observedAt: BEFORE, validUntil: LATER, sourceRevision: 'source-r1', evidenceRef: 'maintenance-a', windows: [] },
    inspection: { status: 'VALID', revoked: false, validFrom: BEFORE, expiresAt: LATER, sourceRevision: 'source-r1', evidenceRef: 'inspection-a' },
    zones: { known: true, revoked: false, observedAt: BEFORE, validUntil: LATER, permitted: ['zone-a'], restricted: [], sourceRevision: 'source-r1', evidenceRef: 'zones-a' },
    energy: { sufficient: true, revoked: false, observedAt: BEFORE, validUntil: LATER, sourceRevision: 'source-r1', evidenceRef: 'energy-a' },
    cycleTimeSeconds: { min: 20, max: 40 }, payloadKg: 20, reachMm: 0, toolClass: 'carrier' })];
  const mappings = [{ id: 'mapping-a', scope, resourceId: 'amr-a', provider: 'synthetic-provider', sourceAssetId: 'source-a',
    sourceRevision: 'source-r1', controllerRef: 'controller-a', taskId: task.id, taskRevision: task.revision, taskClass: task.taskClass,
    capabilityId: 'transport', capabilityRevision: 'cap-r1', approved: true, revoked: false, validFrom: BEFORE, expiresAt: LATER, evidenceRef: 'mapping-evidence-a' }];
  return { scope, task, resources, mappings, now: NOW, knownZoneIds: ['zone-a'], maxTelemetryAgeMs: 300000 };
}
function twoResources() {
  const input = fixture(), b = copy(input.resources[0]), mapping = copy(input.mappings[0]);
  b.id = 'amr-b'; b.provider = 'synthetic-provider-b'; b.sourceAssetId = 'source-b'; b.controllerRef = 'controller-b';
  bindResourceEvidence(b);
  for (const kind of EVIDENCE_KINDS) b[kind].evidenceRef = kind + '-b';
  mapping.id = 'mapping-b'; mapping.resourceId = b.id; mapping.provider = b.provider;
  mapping.sourceAssetId = b.sourceAssetId; mapping.controllerRef = b.controllerRef;
  mapping.evidenceRef = 'mapping-evidence-b';
  input.resources.push(b); input.mappings.push(mapping);
  return input;
}
function capacityFor(input, resourceIds, declaredUpperBoundUnits = 200) {
  return { kind: 'RESOURCE_PLAN_CAPACITY', scope: copy(input.scope), taskId: input.task.id,
    taskRevision: input.task.revision, taskClass: input.task.taskClass,
    resourceIds: [...resourceIds], resourceContextDigest: evaluate(input).resourceContextDigest,
    observedAt: BEFORE, validUntil: LATER, revoked: false,
    declaredUpperBoundUnits, evidenceRef: 'capacity-' + resourceIds.join('-') };
}
function evaluate(input) {
  assert.equal(typeof api.evaluateAutomatedResources, 'function', 'eligibility API must exist');
  return api.evaluateAutomatedResources(input);
}
function build(input) {
  assert.equal(typeof api.buildHybridResourceShadow, 'function', 'shadow comparison API must exist');
  return api.buildHybridResourceShadow(input);
}
function decision() {
  const input = fixture();
  const flags = { feasible: true, policyAllowed: true, hardConstraintsPassed: true, uncertainty: 0.1, evidenceRefs: ['simulation-a'] };
  const output = { ...input, contextRevision: 'context-a', triggerId: 'disruption-a', sourceEvidence: ['synthetic-state-a'],
    objective: { labourCost: 0.4, throughputUnits: 0.6, uncertaintyPenalty: 0.1 },
    doNothing: { ...flags, prediction: { labourCost: 0, throughputUnits: 0, delayMinutes: 20 } },
    alternatives: [
      { ...flags, id: 'overtime', kind: 'OVERTIME', resourceIds: [], prediction: { labourCost: 100, throughputUnits: 100 } },
      { ...flags, id: 'automated', kind: 'AUTOMATED', resourceIds: ['amr-a'], prediction: { labourCost: 50, throughputUnits: 100 } },
      { ...flags, id: 'mixed', kind: 'MIXED', resourceIds: ['amr-a'], prediction: { labourCost: 70, throughputUnits: 120 } }
    ], humanFeasibility: ['overtime', 'mixed'].map(optionId => ({ optionId, scope: input.scope,
      taskId: input.task.id, taskRevision: input.task.revision, start: START, end: END, zoneIds: ['zone-a'], contextRevision: 'context-a',
      alternativeKind: optionId === 'mixed' ? 'MIXED' : 'OVERTIME', resourceIds: optionId === 'mixed' ? ['amr-a'] : [],
      resourceContextDigest: typeof api.evaluateAutomatedResources === 'function' ? (api.evaluateAutomatedResources(input).resourceContextDigest ?? null) : null,
      feasible: true, policyAllowed: true, hardConstraintsPassed: true, evidenceRef: 'human-feasibility-' + optionId })) };
  for (const candidate of output.alternatives.filter(x => ['AUTOMATED', 'MIXED'].includes(x.kind)))
    candidate.capacityEvidence = capacityFor(output, candidate.resourceIds);
  return output;
}
function denied(change, reason) {
  const input = fixture(); change(input);
  const result = evaluate(input);
  assert.equal(result.shadowUsableResourceCount, 0);
  assert.equal(result.resources[0].shadowEligible, false);
  if (reason) assert.ok(result.resources[0].reasonCodes.includes(reason), result.resources[0].reasonCodes.join(','));
}

test('typed resource eligibility is separate from employees and never authenticates supplied evidence', () => {
  const input = fixture(); input.resources[0].authenticated = true; input.mappings[0].digest = 'forged';
  const result = evaluate(input);
  assert.equal(result.shadowUsableResourceCount, 1);
  assert.equal(result.resources[0].kind, 'AutomatedResource');
  assert.equal(result.resources[0].shadowEligible, true);
  assert.equal(result.evidenceTrust, 'SUPPLIED_UNAUTHENTICATED');
  assert.equal(result.authenticatedAuthority, false);
  assert.equal(result.executionPermitted, false);
  assert.equal(result.trustedAssetAdmissionRequired, true);
});

test('resource and mapping scope must match tenant, site and work-centre exactly', () => {
  for (const field of ['tenant', 'site', 'workCentre']) {
    denied(x => { x.resources[0].scope = { ...x.scope, [field]: 'different' }; }, 'RESOURCE_SCOPE_MISMATCH');
    denied(x => { x.mappings[0].scope = { ...x.scope, [field]: 'different' }; }, 'CAPABILITY_MAPPING_MISSING_OR_AMBIGUOUS');
  }
});
test('every source, task, capability, controller and revision dimension is exact', () => {
  for (const field of ['resourceId', 'provider', 'sourceAssetId', 'sourceRevision', 'controllerRef', 'taskId', 'taskRevision', 'taskClass', 'capabilityId', 'capabilityRevision'])
    denied(x => { x.mappings[0][field] = 'different'; }, 'CAPABILITY_MAPPING_MISSING_OR_AMBIGUOUS');
  denied(x => { x.resources[0].capabilities[0].revision = 'different'; }, 'CAPABILITY_MISMATCH');
  denied(x => { x.task.capabilities.push({ id: 'lift', revision: 'cap-r1' }); }, 'CAPABILITY_MISMATCH');
});
test('unknown, offline, fault, faulted, maintenance and restricted states fail closed', () => {
  for (const state of ['UNKNOWN', 'OFFLINE', 'FAULT', 'FAULTED', 'MAINTENANCE', 'RESTRICTED', 'available', ''])
    denied(x => { x.resources[0].operationalState = state; }, 'RESOURCE_STATE_UNAVAILABLE');
});
test('busy and charging require fresh explicit availability and energy evidence for the full task window', () => {
  for (const state of ['BUSY', 'CHARGING']) {
    const input = fixture(); input.resources[0].operationalState = state;
    assert.equal(evaluate(input).shadowUsableResourceCount, 1);
    denied(x => { x.resources[0].operationalState = state; delete x.resources[0].availability; }, 'AVAILABILITY_UNPROVEN');
    denied(x => { x.resources[0].operationalState = state; x.resources[0].availability.end = START; }, 'AVAILABILITY_UNPROVEN');
  }
  denied(x => { x.resources[0].energy.sufficient = false; }, 'ENERGY_UNPROVEN');
  denied(x => { x.resources[0].availability.state = 'BUSY'; }, 'AVAILABILITY_UNPROVEN');
  denied(x => { x.resources[0].availability.observedAt = '2026-10-12T07:00:00.000Z'; }, 'AVAILABILITY_UNPROVEN');
});
test('telemetry freshness, outage, expiry and future observations fail closed', () => {
  denied(x => { x.resources[0].telemetry.observedAt = '2026-10-12T07:00:00.000Z'; }, 'TELEMETRY_UNPROVEN');
  denied(x => { x.resources[0].telemetry.validUntil = START; }, 'TELEMETRY_UNPROVEN');
  denied(x => { x.resources[0].telemetry.observedAt = LATER; }, 'TELEMETRY_UNPROVEN');
  denied(x => { delete x.resources[0].telemetry; }, 'TELEMETRY_UNPROVEN');
});
test('mapping approval is literal supplied evidence; expiry, revocation and ambiguity block capacity', () => {
  for (const approved of [false, 'true', 1, null]) denied(x => { x.mappings[0].approved = approved; }, 'MAPPING_NOT_SUPPLIED_APPROVED');
  denied(x => { x.mappings[0].revoked = true; }, 'MAPPING_NOT_SUPPLIED_APPROVED');
  denied(x => { x.mappings[0].expiresAt = START; }, 'MAPPING_NOT_SUPPLIED_APPROVED');
  denied(x => { x.mappings[0].validFrom = LATER; }, 'MAPPING_NOT_SUPPLIED_APPROVED');
  denied(x => { x.mappings.push(copy(x.mappings[0])); }, 'CAPABILITY_MAPPING_MISSING_OR_AMBIGUOUS');
});
test('inspection expiry/revocation and incomplete or overlapping maintenance block the entire task', () => {
  denied(x => { x.resources[0].inspection.revoked = true; }, 'INSPECTION_UNPROVEN');
  denied(x => { x.resources[0].inspection.expiresAt = START; }, 'INSPECTION_UNPROVEN');
  denied(x => { x.resources[0].maintenance.complete = false; }, 'MAINTENANCE_UNPROVEN');
  denied(x => { x.resources[0].maintenance.windows = [{ start: NOW, end: LATER }]; }, 'MAINTENANCE_OVERLAP');
  denied(x => { x.resources[0].maintenance.windows = [{ start: '2026-10-12T08:29:00.000Z', end: LATER }]; }, 'MAINTENANCE_OVERLAP');
  const input = fixture(); input.resources[0].maintenance.windows = [{ start: NOW, end: START }, { start: END, end: LATER }];
  assert.equal(evaluate(input).shadowUsableResourceCount, 1, 'half-open non-overlapping maintenance is permitted');
});
test('unknown and explicitly restricted zones deny capacity including shared-zone human alternatives', () => {
  denied(x => { x.knownZoneIds = []; }, 'ZONE_UNPROVEN_OR_RESTRICTED');
  denied(x => { x.resources[0].zones.known = false; }, 'ZONE_UNPROVEN_OR_RESTRICTED');
  denied(x => { x.resources[0].zones.restricted = ['zone-a']; }, 'ZONE_UNPROVEN_OR_RESTRICTED');
  denied(x => { x.resources[0].zones.permitted = ['unknown-zone']; }, 'ZONE_UNPROVEN_OR_RESTRICTED');
  const input = decision(); input.humanFeasibility.find(x => x.optionId === 'mixed').zoneIds = ['another-zone'];
  assert.equal(build(input).episode.options.find(x => x.id === 'mixed').feasible, false);
});
test('duplicate internal and source asset identities never double-count or retain a usable copy', () => {
  for (const field of ['id', 'sourceAssetId']) {
    const input = fixture(); const other = copy(input.resources[0]); other.id = 'amr-b'; other.sourceAssetId = 'source-b'; other[field] = input.resources[0][field];
    input.resources.push(other); const result = evaluate(input);
    assert.equal(result.shadowUsableResourceCount, 0);
    assert.ok(result.resources.every(x => x.reasonCodes.includes('DUPLICATE_RESOURCE_IDENTITY')));
  }
});
test('payload, reach, tool class, cycle range and resource type evidence must be valid', () => {
  denied(x => { x.resources[0].payloadKg = 9; }, 'TASK_PHYSICAL_REQUIREMENTS_UNPROVEN');
  denied(x => { x.resources[0].toolClass = 'welder'; }, 'TASK_PHYSICAL_REQUIREMENTS_UNPROVEN');
  denied(x => { x.resources[0].cycleTimeSeconds.max = 0; }, 'RESOURCE_CONTRACT_INVALID');
  denied(x => { x.resources[0].kind = 'HumanResource'; }, 'RESOURCE_CONTRACT_INVALID');
  denied(x => { x.resources[0].resourceType = 'EMPLOYEE'; }, 'RESOURCE_CONTRACT_INVALID');
  denied(x => { x.resources[0].cycleTimeSeconds.min = 1000000; x.resources[0].cycleTimeSeconds.max = 1000000; }, 'CYCLE_EXCEEDS_TASK_WINDOW');
});
test('declared physical resource metadata is valid even when task requirements are omitted', () => {
  for (const change of [
    resource => { resource.payloadKg = -1; },
    resource => { resource.reachMm = -1; },
    resource => { resource.toolClass = '*'; }
  ]) {
    const input = fixture(); delete input.task.requirements; change(input.resources[0]);
    const result = evaluate(input);
    assert.equal(result.shadowUsableResourceCount, 0);
    assert.ok(result.resources[0].reasonCodes.includes('RESOURCE_CONTRACT_INVALID'));
  }
});
test('task requirements accept only an optional object with supported physical and energy keys', () => {
  for (const requirements of [[], 'minimumPayloadKg:10', null, 10, true,
    { minimumPayloadKgs: 10 }, { minimumPayloadKg: 10, staffCount: 2 }]) {
    const input = fixture(); input.task.requirements = requirements;
    assert.throws(() => evaluate(input), /task requirements/i, JSON.stringify(requirements));
  }
  const omitted = fixture(); delete omitted.task.requirements;
  assert.equal(evaluate(omitted).shadowUsableResourceCount, 1);
  const valid = fixture(); valid.task.requirements = {
    minimumPayloadKg: 0, minimumReachMm: 0, toolClass: 'carrier', requiresEnergyEvidence: true
  };
  assert.equal(evaluate(valid).shadowUsableResourceCount, 1);
});
test('unsupported automated throughput remains unknown even with otherwise eligible assets', () => {
  const missing = decision(); delete missing.alternatives[1].capacityEvidence;
  assert.equal(evaluate(missing).shadowUsableResourceCount, 1, 'resource structure may be admissible');
  assert.equal(build(missing).episode.options.find(o => o.id === 'automated').feasible, false, 'plan capacity is unproven');
  for (const change of [
    x => { x.capacityEvidence.declaredUpperBoundUnits = 99; },
    x => { x.capacityEvidence.validUntil = START; },
    x => { x.capacityEvidence.revoked = true; },
    x => { x.capacityEvidence.scope.site = 'other-site'; },
    x => { x.capacityEvidence.resourceIds = ['other-robot']; },
    x => { x.capacityEvidence.resourceContextDigest = 'stale'; },
    x => { x.prediction.throughputUnits = null; }
  ]) {
    const input = decision(); change(input.alternatives[1]);
    assert.equal(build(input).episode.options.find(o => o.id === 'automated').feasible, false);
  }
  const complete = decision();
  assert.equal(build(complete).episode.options.find(o => o.id === 'automated').feasible, true,
    'bounded, current, exact source declaration supports only SHADOW comparison');
});
test('malformed timestamps, revision drift and omitted evidence fail closed', () => {
  denied(x => { x.resources[0].telemetry.observedAt = '2026-02-30T07:59:00.000Z'; }, 'TELEMETRY_UNPROVEN');
  for (const name of ['telemetry', 'availability', 'maintenance', 'inspection', 'zones', 'energy']) {
    denied(x => { x.resources[0][name].sourceRevision = 'different'; });
    denied(x => { delete x.resources[0][name].evidenceRef; });
  }
});
test('each dynamic evidence kind is bound to the exact resource and cannot be transplanted across robots sharing a source revision', () => {
  const valid = twoResources();
  assert.equal(valid.resources[0].sourceRevision, valid.resources[1].sourceRevision);
  assert.equal(evaluate(valid).shadowUsableResourceCount, 2, 'two separately evidenced resources remain usable in shadow');
  for (const kind of EVIDENCE_KINDS) {
    const changed = twoResources(); changed.resources[1][kind] = copy(changed.resources[0][kind]);
    const result = evaluate(changed);
    assert.equal(result.shadowUsableResourceCount, 1, `${kind} transplant must not add shadow capacity`);
    assert.equal(result.resources.find(r => r.id === 'amr-a').shadowEligible, true, `${kind} must leave A independently eligible`);
    assert.equal(result.resources.find(r => r.id === 'amr-b').shadowEligible, false, `${kind} must deny B`);
  }
});
test('each evidence record binds tenant/site/work-centre, resource, provider, source asset and controller exactly', () => {
  for (const kind of EVIDENCE_KINDS) {
    for (const field of ['tenant', 'site', 'workCentre', 'resourceId', 'provider', 'sourceAssetId', 'controllerRef']) {
      const input = twoResources(); const record = input.resources[1][kind];
      if (['tenant', 'site', 'workCentre'].includes(field)) record.scope[field] = 'other';
      else record[field] = 'other';
      const result = evaluate(input);
      assert.equal(result.shadowUsableResourceCount, 1, `${kind}.${field} drift must deny B`);
      assert.equal(result.resources.find(r => r.id === 'amr-b').shadowEligible, false);
    }
  }
});
test('invalid or oversized contexts throw without truncation, coercion or executing accessors', () => {
  const input = fixture(); input.task.end = input.task.start;
  assert.throws(() => evaluate(input), /task window/);
  const big = fixture(); big.resources = Array.from({ length: 129 }, () => copy(big.resources[0]));
  assert.throws(() => evaluate(big), /resources/);
  const accessor = fixture(); let calls = 0;
  Object.defineProperty(accessor.resources[0], 'controllerRef', { enumerable: true, get() { calls++; return 'controller-a'; } });
  assert.throws(() => evaluate(accessor), /plain JSON/); assert.equal(calls, 0);
  const invalid = fixture(); invalid.scope.tenant = '*'; assert.throws(() => evaluate(invalid), /scope/);
});
test('immutable deterministic output binds evidence revisions and ignores no claimed authentication', () => {
  const input = fixture(); const saved = copy(input); const result = evaluate(input);
  assert.deepEqual(input, saved); assert.deepEqual(result, evaluate(copy(input)));
  assert.throws(() => { result.resources[0].reasonCodes.push('forged'); }, TypeError);
  assert.throws(() => { result.resources[0].shadowEligible = false; }, TypeError);
  input.resources[0].telemetry.evidenceRef = 'new-evidence';
  assert.notEqual(result.inputDigest, evaluate(input).inputDigest);
});
test('bounded hybrid alternatives use only existing SHADOW Decision Episode and genuine do-nothing loss predictions', () => {
  const input = decision(); const output = build(input);
  assert.equal(output.episode.contractVersion, 'VECTOR_DECISION_EPISODE_V1');
  assert.equal(output.episode.mode, 'SHADOW');
  assert.equal(output.episode.recommendation.authorityRequired, 'NO_EXECUTION');
  assert.equal(output.episode.recommendation.executionPermitted, false);
  assert.equal(output.authenticatedAuthority, false); assert.deepEqual(output.commands, []);
  assert.equal(output.episode.options.find(x => x.id === 'do-nothing').prediction.delayMinutes, 20);
  const inherited = createDecisionEpisode({ ...output.episode, objective: { ...output.episode.objective.weights, uncertaintyPenalty: output.episode.objective.uncertaintyPenalty } });
  assert.equal(inherited.episodeId, output.episode.episodeId);
  input.doNothing.feasible = false; assert.equal(build(input).episode.options.find(x => x.id === 'do-nothing').feasible, false);
  const active = decision(); active.mode = 'POLICY_BOUNDED'; assert.throws(() => build(active), /SHADOW/);
});
test('existing human feasibility is consumed with exact task/scope/window/context/zone binding and literal flags', () => {
  for (const kind of ['OVERTIME', 'AGENCY', 'REDEPLOY', 'MIXED']) {
    const input = decision(); input.alternatives[0].kind = kind;
    input.humanFeasibility[0].alternativeKind = kind;
    if (kind === 'MIXED') {
      input.alternatives[0].resourceIds = ['amr-a']; input.humanFeasibility[0].resourceIds = ['amr-a'];
      input.humanFeasibility[0].resourceContextDigest = evaluate(input).resourceContextDigest ?? null;
      input.alternatives[0].capacityEvidence = capacityFor(input, ['amr-a']);
    }
    assert.equal(build(input).episode.options.find(x => x.id === 'overtime').feasible, true);
    for (const field of ['taskId', 'taskRevision', 'start', 'end', 'contextRevision']) {
      const bad = copy(input); bad.humanFeasibility[0][field] = 'different';
      assert.equal(build(bad).episode.options.find(x => x.id === 'overtime').feasible, false);
    }
    const no = copy(input); no.humanFeasibility = [];
    assert.equal(build(no).episode.options.find(x => x.id === 'overtime').feasible, false);
  }
  for (const field of ['feasible', 'policyAllowed', 'hardConstraintsPassed']) {
    const input = decision(); input.humanFeasibility.forEach(x => { x[field] = 'true'; });
    assert.ok(build(input).episode.options.filter(x => ['mixed', 'overtime'].includes(x.id)).every(x => !x.feasible));
  }
});
test('energy evidence must be current, unrevoked and valid through the complete task', () => {
  for (const state of ['AVAILABLE', 'BUSY', 'CHARGING']) {
    denied(x => { x.resources[0].operationalState = state; x.resources[0].energy.revoked = true; }, 'ENERGY_UNPROVEN');
    denied(x => { x.resources[0].operationalState = state; x.resources[0].energy.validUntil = '2025-01-01T09:00:00.000Z'; }, 'ENERGY_UNPROVEN');
    denied(x => { x.resources[0].operationalState = state; x.resources[0].energy.observedAt = '2026-10-12T07:00:00.000Z'; }, 'ENERGY_UNPROVEN');
  }
});
test('human feasibility cannot be transferred to another kind, allocation or automated evidence revision', () => {
  const changedKind = decision(); changedKind.alternatives[0].kind = 'AGENCY';
  assert.equal(build(changedKind).episode.options.find(x => x.id === 'overtime').feasible, false);
  const changedContext = decision(); changedContext.resources[0].telemetry.evidenceRef = 'new-telemetry';
  assert.equal(build(changedContext).episode.options.find(x => x.id === 'mixed').feasible, false);
  const allocation = decision(); allocation.humanFeasibility.find(x => x.optionId === 'mixed').resourceIds = ['other-asset'];
  assert.equal(build(allocation).episode.options.find(x => x.id === 'mixed').feasible, false);
  const scope = decision(); scope.humanFeasibility[0].scope = { ...scope.scope, tenant: 'other-tenant' };
  assert.equal(build(scope).episode.options.find(x => x.id === 'overtime').feasible, false);
});
test('all human alternative kinds reject task content changes even if caller revisions are reused', () => {
  for (const kind of ['OVERTIME', 'AGENCY', 'REDEPLOY', 'MIXED']) {
    const valid = decision(); valid.alternatives[0].kind = kind; valid.humanFeasibility[0].alternativeKind = kind;
    if (kind === 'MIXED') {
      valid.alternatives[0].resourceIds = ['amr-a']; valid.humanFeasibility[0].resourceIds = ['amr-a'];
      valid.alternatives[0].capacityEvidence = capacityFor(valid, ['amr-a']);
    }
    assert.equal(build(valid).episode.options.find(o => o.id === 'overtime').feasible, true, `${kind} unchanged input`);
    for (const change of [
      x => { x.task.taskClass = 'changed-class'; },
      x => { x.task.capabilities[0].id = 'changed-capability'; },
      x => { x.task.requirements.minimumPayloadKg = 15; }
    ]) {
      const changed = copy(valid); change(changed);
      assert.equal(changed.task.revision, valid.task.revision);
      assert.equal(changed.contextRevision, valid.contextRevision);
      assert.equal(build(changed).episode.options.find(o => o.id === 'overtime').feasible, false, `${kind} stale task result`);
    }
  }
});
test('immutable SHADOW option context binds each alternative to its task, window, resource identities and evidence', () => {
  const input = decision(), second = twoResources();
  input.resources = second.resources; input.mappings = second.mappings;
  input.alternatives.push({ ...copy(input.alternatives.find(x => x.id === 'automated')), id: 'automated-b', resourceIds: ['amr-b'] });
  input.alternatives.find(x => x.id === 'automated-b').capacityEvidence = capacityFor(input, ['amr-b']);
  input.alternatives.find(x => x.id === 'automated').capacityEvidence = capacityFor(input, ['amr-a']);
  input.alternatives.find(x => x.id === 'mixed').capacityEvidence = capacityFor(input, ['amr-a']);
  input.humanFeasibility.find(x => x.optionId === 'mixed').resourceContextDigest = evaluate(input).resourceContextDigest;
  const output = build(input);
  assert.equal(output.episode.mode, 'SHADOW'); assert.deepEqual(output.commands, []);
  assert.equal(output.optionContexts.length, output.episode.options.length);
  const a = output.optionContexts.find(x => x.optionId === 'automated');
  const b = output.optionContexts.find(x => x.optionId === 'automated-b');
  const mixed = output.optionContexts.find(x => x.optionId === 'mixed');
  const nothing = output.optionContexts.find(x => x.optionId === 'do-nothing');
  assert.equal(a.kind, 'AUTOMATED'); assert.equal(mixed.kind, 'MIXED'); assert.equal(nothing.kind, 'DO_NOTHING');
  assert.deepEqual(nothing.resourceIds, []);
  assert.deepEqual(a.resourceIds, ['amr-a']); assert.deepEqual(b.resourceIds, ['amr-b']);
  assert.equal(a.resourceEvidence[0].resourceId, 'amr-a'); assert.equal(a.resourceEvidence[0].sourceAssetId, 'source-a');
  assert.equal(b.resourceEvidence[0].resourceId, 'amr-b'); assert.equal(b.resourceEvidence[0].sourceAssetId, 'source-b');
  assert.equal(b.resourceEvidence[0].controllerRef, 'controller-b');
  assert.ok(a.resourceEvidence[0].evidenceRefs.includes('telemetry-a'));
  assert.ok(b.resourceEvidence[0].evidenceRefs.includes('telemetry-b'));
  assert.equal(a.task.id, input.task.id); assert.equal(a.task.revision, input.task.revision);
  assert.equal(a.task.taskClass, input.task.taskClass);
  assert.deepEqual(a.task.capabilities, input.task.capabilities);
  assert.deepEqual(a.task.requirements, input.task.requirements);
  assert.deepEqual(a.window, { start: START, end: END });
  assert.equal(a.episodeId, output.episode.episodeId);
  assert.equal(b.episodeId, output.episode.episodeId);
  assert.notEqual(a.resourceEvidence[0].sourceRecordDigest, b.resourceEvidence[0].sourceRecordDigest);
  assert.equal(a.executionPermitted, false);
  assert.throws(() => { a.resourceIds.push('amr-b'); }, TypeError);
  assert.throws(() => { a.resourceEvidence[0].controllerRef = 'forged'; }, TypeError);
});
test('proxy inputs are rejected before invoking any trap', () => {
  let traps = 0;
  const input = fixture(); input.resources[0] = new Proxy(input.resources[0], {
    get(target, key) { traps++; return target[key]; },
    getPrototypeOf(target) { traps++; return Object.getPrototypeOf(target); },
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { traps++; return Object.getOwnPropertyDescriptor(target, key); }
  });
  assert.throws(() => evaluate(input), /plain JSON/); assert.equal(traps, 0);
});
test('objective weights cannot overflow the existing Decision Episode ranker', () => {
  const input = decision(); input.objective = { labourCost: 1.6e308, throughputUnits: 1.6e308 };
  assert.throws(() => build(input), /objective/i);
  input.objective = { labourCost: 1e300, throughputUnits: 1e300 };
  assert.ok(build(input).episode.recommendation.ranking.every(x => Number.isFinite(x.score)));
  input.objective = { labourCost: '1' }; assert.throws(() => build(input), /objective/i);
});
test('revoked telemetry/availability and stale or revoked maintenance/zone declarations deny capacity', () => {
  for (const name of ['telemetry', 'availability', 'maintenance', 'zones'])
    denied(x => { x.resources[0][name].revoked = true; });
  for (const name of ['maintenance', 'zones']) {
    denied(x => { x.resources[0][name].observedAt = '2026-10-12T07:00:00.000Z'; });
    denied(x => { x.resources[0][name].validUntil = START; });
    denied(x => { delete x.resources[0][name].observedAt; });
  }
});
test('unavailable resources cannot be rescued by candidate flags, digests or predictions', () => {
  const input = decision(); input.resources[0].operationalState = 'FAULT'; input.alternatives[1].authenticated = true;
  input.humanFeasibility.find(x => x.optionId === 'overtime').resourceContextDigest = evaluate(input).resourceContextDigest;
  const output = build(input);
  assert.ok(output.episode.options.filter(x => ['automated', 'mixed'].includes(x.id)).every(x => !x.feasible));
  assert.equal(output.episode.recommendation.optionId, 'overtime');
  input.humanFeasibility.forEach(x => { x.feasible = false; });
  assert.equal(build(input).episode.recommendation.optionId, 'do-nothing');
});
test('alternative type, duplicate allocation, foreign resources and do-nothing overrides fail closed', () => {
  const input = decision(); input.alternatives[1].resourceIds = ['foreign-asset'];
  assert.equal(build(input).episode.options.find(x => x.id === 'automated').feasible, false);
  input.alternatives[1].resourceIds = ['amr-a', 'amr-a'];
  assert.throws(() => build(input), /resourceIds/);
  const human = decision(); human.alternatives[0].resourceIds = ['amr-a']; assert.throws(() => build(human), /resource/);
  const override = decision(); override.alternatives[0].id = 'do-nothing'; assert.throws(() => build(override), /do-nothing/);
  const oversized = decision(); oversized.alternatives = Array.from({ length: 33 }, (_, i) => ({ ...oversized.alternatives[1], id: 'auto-' + i }));
  assert.throws(() => build(oversized), /alternatives/);
});
test('input permutation and caller mutation cannot change an already-created episode', () => {
  const input = decision(); const output = build(input); const reversed = copy(input);
  reversed.resources.reverse(); reversed.mappings.reverse(); reversed.alternatives.reverse(); reversed.humanFeasibility.reverse();
  assert.deepEqual(output, build(reversed));
  input.alternatives[0].prediction.labourCost = 999;
  assert.equal(output.episode.options.find(x => x.id === 'overtime').prediction.labourCost, 100);
  assert.throws(() => { output.episode.options[0].prediction.labourCost = 1; }, TypeError);
  assert.throws(() => { output.episode.recommendation.ranking.pop(); }, TypeError);
  assert.deepEqual(output.commands, []); assert.equal(output.executionPermitted, false);
});

// The benchmark enumerates supplied alternatives; it measures neither a solver search nor live recovery.
// Fixed fixture strata and split are declared before implementation, without tuning eligibility to metrics.
const CATEGORIES = ['human-absence', 'robot-fault', 'charging-low-energy', 'maintenance', 'demand-spike',
  'material-bottleneck', 'human-only-task', 'stale-telemetry', 'zone-conflict', 'multiple-combinations', 'no-automated-option'];
test('1,100 synthetic scenarios report discovery and held-out Pareto outcomes without weakening constraints', t => {
  const report = { scenarios: 1100, development: 770, heldOut: 330, seed: 60, knownFeasible: 0, discovered: 0,
    heldOutParetoBetter: 0, heldOutRecommendedParetoBetter: 0, automatedConstraintViolations: 0,
    humanConstraintViolations: 0, commandOrAuthorityOutputs: 0, reproducibilityMismatches: 0, categories: {} };
  let seed = report.seed;
  const savedScenarios = [];
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const category of CATEGORIES) {
    const counts = { scenarios: 100, knownFeasible: 0, discovered: 0, heldOut: 30, paretoBetter: 0 };
    report.categories[category] = counts;
    for (let i = 0; i < 100; i++) {
      const input = decision(); input.triggerId = category + '-' + i;
      const humanCost = 100 + Math.floor(random() * 101), autoCost = 30 + Math.floor(random() * 51);
      input.alternatives[0].prediction = { labourCost: humanCost, throughputUnits: 100 };
      input.alternatives[1].prediction = { labourCost: autoCost, throughputUnits: 100 };
      input.alternatives[2].prediction = { labourCost: humanCost + autoCost, throughputUnits: 120 };
      let automatedKnownEligible = true, humanKnownEligible = true;
      if (category === 'human-absence') { humanKnownEligible = false; input.humanFeasibility.forEach(x => { x.feasible = false; }); }
      if (category === 'robot-fault') { automatedKnownEligible = false; input.resources[0].operationalState = 'FAULT'; }
      if (category === 'charging-low-energy') { input.resources[0].operationalState = 'CHARGING'; automatedKnownEligible = i % 2 === 0; input.resources[0].energy.sufficient = automatedKnownEligible; }
      if (category === 'maintenance') { automatedKnownEligible = false; input.resources[0].maintenance.windows = [{ start: NOW, end: LATER }]; }
      if (category === 'demand-spike') { input.alternatives[2].prediction.throughputUnits = 150; }
      if (category === 'material-bottleneck') { input.alternatives[0].prediction.throughputUnits = 80; }
      if (category === 'human-only-task') { automatedKnownEligible = false; input.task.taskClass = 'human-only'; }
      if (category === 'stale-telemetry') { automatedKnownEligible = false; input.resources[0].telemetry.observedAt = '2026-10-12T07:00:00.000Z'; }
      if (category === 'zone-conflict') { automatedKnownEligible = false; input.resources[0].zones.restricted = ['zone-a']; }
      if (category === 'multiple-combinations') {
        input.alternatives.push({ ...copy(input.alternatives[0]), id: 'agency', kind: 'AGENCY', prediction: { labourCost: humanCost + 50, throughputUnits: 100 } });
        input.alternatives.push({ ...copy(input.alternatives[0]), id: 'redeploy', kind: 'REDEPLOY', prediction: { labourCost: humanCost + 20, throughputUnits: 100 } });
        input.humanFeasibility.push(...['agency', 'redeploy'].map(optionId => ({ ...copy(input.humanFeasibility[0]), optionId,
          alternativeKind: optionId === 'agency' ? 'AGENCY' : 'REDEPLOY' })));
      }
      if (category === 'no-automated-option') { automatedKnownEligible = false; input.mappings = []; humanKnownEligible = i % 2 === 0; input.humanFeasibility.forEach(x => { x.feasible = humanKnownEligible; });
        input.alternatives.push({ ...copy(input.alternatives[0]), id: 'defer', kind: 'DEFER', resourceIds: [], prediction: { labourCost: 20, throughputUnits: 40, delayMinutes: 60 } }); }
      for (const candidate of input.alternatives.filter(x => ['AUTOMATED', 'MIXED'].includes(x.kind)))
        candidate.capacityEvidence = capacityFor(input, candidate.resourceIds);
      input.humanFeasibility.forEach(x => { x.resourceContextDigest = evaluate(input).resourceContextDigest; });
      const knownExists = humanKnownEligible || automatedKnownEligible;
      const output = build(input), options = output.episode.options;
      savedScenarios.push({ category, split: i >= 70 ? 'held-out' : 'development', input,
        knownExists, automatedKnownEligible, humanKnownEligible, episodeId: output.episode.episodeId,
        recommendation: output.episode.recommendation.optionId });
      const usable = options.filter(x => x.feasible && x.policyAllowed && x.hardConstraintsPassed && x.id !== 'do-nothing' && x.id !== 'defer');
      if (knownExists) { report.knownFeasible++; counts.knownFeasible++; if (usable.length) { report.discovered++; counts.discovered++; } }
      report.automatedConstraintViolations += options.filter(x => ['automated', 'mixed'].includes(x.id) && x.feasible && !automatedKnownEligible).length;
      report.humanConstraintViolations += options.filter(x => ['overtime', 'mixed', 'agency', 'redeploy'].includes(x.id) && x.feasible && !humanKnownEligible).length;
      if (output.commands.length || output.executionPermitted || output.authenticatedAuthority || output.episode.recommendation.executionPermitted || output.episode.mode !== 'SHADOW') report.commandOrAuthorityOutputs++;
      if (JSON.stringify(output) !== JSON.stringify(build(copy(input)))) report.reproducibilityMismatches++;
      if (i >= 70) {
        const human = options.find(x => x.id === 'overtime');
        // Missing human feasibility has no numeric Pareto baseline; count as no improvement, not an automatic win.
        const dominates = x => human.feasible && x.feasible && x.policyAllowed && x.hardConstraintsPassed && x.prediction.labourCost <= human.prediction.labourCost && x.prediction.throughputUnits >= human.prediction.throughputUnits && (x.prediction.labourCost < human.prediction.labourCost || x.prediction.throughputUnits > human.prediction.throughputUnits);
        const better = options.filter(x => ['automated', 'mixed'].includes(x.id)).some(dominates);
        if (better) { report.heldOutParetoBetter++; counts.paretoBetter++; }
        const recommended = options.find(x => x.id === output.episode.recommendation.optionId);
        if (recommended && ['automated', 'mixed'].includes(recommended.id) && dominates(recommended)) report.heldOutRecommendedParetoBetter++;
      }
    }
  }
  report.feasibleDiscoveryPct = 100 * report.discovered / report.knownFeasible;
  report.heldOutParetoPct = 100 * report.heldOutParetoBetter / report.heldOut;
  report.heldOutRecommendedParetoPct = 100 * report.heldOutRecommendedParetoBetter / report.heldOut;
  report.claimBoundary = 'Synthetic supplied alternatives only; manual-coordination baseline equals human-only enumeration; no customer ROI, live safety, readiness, conformity or authenticated provider evidence.';
  if (process.env.HYBRID_BENCHMARK_DIR) {
    const directory = path.resolve(process.env.HYBRID_BENCHMARK_DIR);
    const repoRoot = path.resolve(__dirname, '../..');
    assert.ok(directory !== repoRoot && !directory.startsWith(repoRoot + path.sep), 'benchmark evidence must stay outside the reserved repository');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'scenarios.jsonl'), savedScenarios.map(x => JSON.stringify(x)).join('\n') + '\n');
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  t.diagnostic('HYBRID_BENCHMARK=' + JSON.stringify(report));
  assert.equal(report.automatedConstraintViolations, 0); assert.equal(report.humanConstraintViolations, 0);
  assert.equal(report.commandOrAuthorityOutputs, 0); assert.equal(report.reproducibilityMismatches, 0);
  assert.ok(report.feasibleDiscoveryPct >= 95);
  // Pareto threshold is deliberately reported, not made true by an assertion or changing constraints.
});

