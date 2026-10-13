'use strict';

const { createDecisionEpisode, digest, stable } = require('./decision-episode.cjs');
const { types } = require('node:util');

/**
 * Provider-neutral, pure issue-60 shadow adapter. All inputs are supplied JSON,
 * never authenticated provider/asset authority. `approved`, evidence references,
 * digests and feasibility flags are declarations for simulation only.
 *
 * @typedef {{tenant:string, site:string, workCentre:string}} ResourceScope
 * @typedef {{id:string, revision:string}} Capability
 * @typedef {{scope:ResourceScope, resourceId:string, provider:string,
 * sourceAssetId:string, sourceRevision:string, controllerRef:string,
 * evidenceRef:string}} EvidenceBinding
 * @typedef {EvidenceBinding & {revoked:false, observedAt:string, validUntil:string}} Telemetry
 * @typedef {EvidenceBinding & {revoked:false, state:'AVAILABLE', start:string, end:string, observedAt:string}} Availability
 * @typedef {Telemetry & {complete:true, windows:Array<{start:string,end:string}>}} Maintenance
 * @typedef {EvidenceBinding & {status:'VALID', revoked:false, validFrom:string, expiresAt:string}} Inspection
 * @typedef {Telemetry & {known:true, permitted:string[], restricted:string[]}} Zones
 * @typedef {{kind:'AutomatedResource', id:string, resourceType:'AMR'|'AGV'|'COBOT'|'HUMANOID'|'FIXED_CELL'|'OTHER',
 * scope:ResourceScope, provider:string, sourceAssetId:string, sourceRevision:string, controllerRef:string,
 * capabilities:Capability[], operationalState:string, telemetry:Telemetry, availability:Availability,
 * maintenance:Maintenance, inspection:Inspection, zones:Zones,
 * energy?:EvidenceBinding & {sufficient:true, revoked:false, observedAt:string, validUntil:string}, cycleTimeSeconds:{min:number,max:number},
 * payloadKg?:number, reachMm?:number, toolClass?:string}} AutomatedResource
 *
 * Required task: id/revision/taskClass, exact capabilities, explicit zoneIds,
 * UTC start/end and optional physical requirements. Half-open task/maintenance
 * intervals are used; every validity/availability window must cover the task.
 * Mappings bind scope/resource/provider/source revision/controller/task/capability,
 * approved:true, revoked:false, validFrom/expiresAt and an evidenceRef.
 *
 * Human feasibility comes from the adopted scheduler, bound to optionId, scope,
 * taskId/taskRevision/start/end/zoneIds/contextRevision/alternativeKind/resourceIds
 * with its three literal
 * feasibility/policy/hard-constraint flags and evidenceRef. This module never
 * evaluates employees, qualifications, rest, scheduling or staffing changes.
 * Every human result must bind resourceContextDigest from the eligibility API
 * to the exact supplied task and resource snapshot. A digest binds content only and
 * never authenticates its origin or grants assignment authority.
 * Automated and mixed alternatives require a current, scoped, full-window
 * supplied capacity declaration bounding predicted throughput. Resource
 * eligibility alone does not prove plan throughput. A minimum cycle longer
 * than the task window makes a resource structurally ineligible.
 *
 * Owner requirements before operational adoption: trusted authenticated asset
 * admission and source revocation/freshness, real controller/zone evidence,
 * scheduler integration and independent whole-runtime/customer proof. There is
 * no VDA5050/OPC-UA conformity claim, execution endpoint, robot command, fleet
 * control, solver, outcome store or learning engine here.
 */
const RESOURCE_TYPES = new Set(['AMR', 'AGV', 'COBOT', 'HUMANOID', 'FIXED_CELL', 'OTHER']);
const HUMAN_KINDS = new Set(['OVERTIME', 'AGENCY', 'REDEPLOY', 'MIXED']);
const KINDS = new Set([...HUMAN_KINDS, 'AUTOMATED', 'DEFER']);
const METRICS = new Set(['throughputUnits', 'planAttainmentPct', 'labourCost', 'delayMinutes', 'riskScore', 'energyCost', 'qualityRisk']);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const scopeOK = value => value && ['tenant', 'site', 'workCentre'].every(key => id(value[key]));
const sameScope = (a, b) => scopeOK(a) && scopeOK(b) && ['tenant', 'site', 'workCentre'].every(key => a[key] === b[key]);
const evidence = (value, resource) => value && sameScope(value.scope, resource.scope) &&
  value.resourceId === resource.id && value.provider === resource.provider &&
  value.sourceAssetId === resource.sourceAssetId && value.sourceRevision === resource.sourceRevision &&
  value.controllerRef === resource.controllerRef && id(value.evidenceRef);

// Reject accessors, executable objects, cycles and lossy values before reading
// input properties. Limits apply before sorting/hashing or evaluating mappings.
function snapshot(value, depth = 0, seen = new Set(), budget = { nodes: 0 }) {
  if (++budget.nodes > 100000 || depth > 24) throw new Error('Bounded plain JSON input required.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && value.length > 4096) throw new Error('Bounded plain JSON strings required.');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('Finite plain JSON input required.');
  if (types.isProxy(value)) throw new Error('Inert plain JSON input required; proxies are unsupported.');
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype) && Object.getPrototypeOf(value) !== null)
    throw new Error('Inert plain JSON objects required.');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 4096 || (array && (value.length > 2048 || keys.length !== value.length + 1)))
    throw new Error('Bounded dense plain JSON input required.');
  seen.add(value);
  const result = array ? [] : Object.create(null);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor) ||
        (array && !/^(0|[1-9][0-9]*)$/.test(key))) throw new Error('Inert plain JSON properties required.');
    result[key] = snapshot(descriptor.value, depth + 1, seen, budget);
  }
  seen.delete(value);
  return result;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
// Collection order has no semantic meaning in this contract. Keep duplicates
// for explicit identity rejection, rather than collapsing authority conflicts.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => stable(a).localeCompare(stable(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function array(value, max, name) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Bounded ${name} array required (max ${max}).`);
  return value;
}
function ids(value, max, name, nonempty = false) {
  array(value, max, name);
  if ((nonempty && !value.length) || !value.every(id) || new Set(value).size !== value.length)
    throw new Error(`Exact unique ${name} identifiers required.`);
  return [...value].sort();
}
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) && new Date(n).toISOString() === value ? n : null;
}
function windowCovers(from, until, start, end) {
  const a = time(from), b = time(until);
  return a !== null && b !== null && a <= start && b >= end && a < b;
}
function capabilities(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 32 &&
    value.every(x => x && id(x.id) && id(x.revision)) && new Set(value.map(x => x.id)).size === value.length;
}
function context(input) {
  if (!scopeOK(input.scope)) throw new Error('Exact tenant/site/work-centre scope required.');
  const task = input.task;
  if (!task || !id(task.id) || !id(task.revision) || !id(task.taskClass) || !capabilities(task.capabilities))
    throw new Error('Exact task and capability contract required.');
  ids(task.zoneIds, 32, 'task zoneIds', true); ids(input.knownZoneIds, 128, 'knownZoneIds');
  const now = time(input.now), start = time(task.start), end = time(task.end);
  if (now === null || start === null || end === null || now > start || start >= end || end - start > 86400000)
    throw new Error('Valid future task window of at most 24 hours required.');
  const age = input.maxTelemetryAgeMs ?? 300000;
  if (!Number.isSafeInteger(age) || age < 1 || age > 3600000) throw new Error('Telemetry age must be 1..3600000 milliseconds.');
  const req = Object.hasOwn(task, 'requirements') ? task.requirements : {};
  if (!req || typeof req !== 'object' || Array.isArray(req) ||
      Object.keys(req).some(key => !['minimumPayloadKg', 'minimumReachMm', 'toolClass', 'requiresEnergyEvidence'].includes(key)))
    throw new Error('Task requirements must be an object with supported constraint keys only.');
  for (const key of ['minimumPayloadKg', 'minimumReachMm'])
    if (req[key] !== undefined && !finite(req[key])) throw new Error('Non-negative task physical requirement required.');
  if (req.toolClass !== undefined && !id(req.toolClass)) throw new Error('Exact task tool class required.');
  if (req.requiresEnergyEvidence !== undefined && typeof req.requiresEnergyEvidence !== 'boolean') throw new Error('Literal task energy requirement required.');
  array(input.resources, 128, 'resources'); array(input.mappings, 512, 'mappings');
  return { now, start, end, age, req };
}
function fresh(observedAt, ctx) {
  const observed = time(observedAt);
  return observed !== null && observed <= ctx.now && ctx.now - observed <= ctx.age;
}
function counts(values) { const result = new Map(); for (const value of values) result.set(value, (result.get(value) || 0) + 1); return result; }

/** @returns deeply immutable supplied-evidence eligibility; never executable capacity. */
function evaluateAutomatedResources(raw) {
  const input = snapshot(raw), ctx = context(input), task = input.task;
  const internalCounts = counts(input.resources.map(x => x?.id));
  const sourceKey = resource => stable([resource?.provider, resource?.sourceAssetId]);
  const sourceCounts = counts(input.resources.map(sourceKey));
  const mappingCounts = counts(input.mappings.map(x => x?.id));
  const results = input.resources.map((resource, index) => {
    const r = resource || {}, reasons = new Set(), refs = new Set();
    const deny = reason => reasons.add(reason);
    const contractValid = r.kind === 'AutomatedResource' && id(r.id) && RESOURCE_TYPES.has(r.resourceType) &&
      id(r.provider) && id(r.sourceAssetId) && id(r.sourceRevision) && id(r.controllerRef) && capabilities(r.capabilities) &&
      (r.payloadKg === undefined || (finite(r.payloadKg) && r.payloadKg >= 0)) &&
      (r.reachMm === undefined || (finite(r.reachMm) && r.reachMm >= 0)) &&
      (r.toolClass === undefined || id(r.toolClass)) &&
      r.cycleTimeSeconds && finite(r.cycleTimeSeconds.min) && r.cycleTimeSeconds.min > 0 &&
      finite(r.cycleTimeSeconds.max) && r.cycleTimeSeconds.max >= r.cycleTimeSeconds.min;
    if (!contractValid) deny('RESOURCE_CONTRACT_INVALID');
    if (r.cycleTimeSeconds && finite(r.cycleTimeSeconds.min) && r.cycleTimeSeconds.min * 1000 > ctx.end - ctx.start)
      deny('CYCLE_EXCEEDS_TASK_WINDOW');
    if (!sameScope(r.scope, input.scope)) deny('RESOURCE_SCOPE_MISMATCH');
    if (internalCounts.get(r.id) > 1 || sourceCounts.get(sourceKey(r)) > 1) deny('DUPLICATE_RESOURCE_IDENTITY');
    if (!['AVAILABLE', 'BUSY', 'CHARGING'].includes(r.operationalState)) deny('RESOURCE_STATE_UNAVAILABLE');
    if (!evidence(r.telemetry, r) || r.telemetry.revoked !== false || !fresh(r.telemetry?.observedAt, ctx) ||
        !windowCovers(r.telemetry?.observedAt, r.telemetry?.validUntil, ctx.start, ctx.end)) deny('TELEMETRY_UNPROVEN');
    if (!evidence(r.availability, r) || r.availability.revoked !== false || r.availability?.state !== 'AVAILABLE' ||
        !fresh(r.availability?.observedAt, ctx) || !windowCovers(r.availability?.start, r.availability?.end, ctx.start, ctx.end)) deny('AVAILABILITY_UNPROVEN');
    const maintenance = r.maintenance;
    if (!evidence(maintenance, r) || maintenance.revoked !== false || !fresh(maintenance.observedAt, ctx) ||
        !windowCovers(maintenance.observedAt, maintenance.validUntil, ctx.start, ctx.end) || maintenance.complete !== true || !Array.isArray(maintenance.windows) ||
        maintenance.windows.length > 64 || !maintenance.windows.every(w => w && time(w.start) !== null && time(w.end) !== null && time(w.start) < time(w.end))) deny('MAINTENANCE_UNPROVEN');
    else if (maintenance.windows.some(w => time(w.start) < ctx.end && time(w.end) > ctx.start)) deny('MAINTENANCE_OVERLAP');
    if (!evidence(r.inspection, r) || r.inspection.status !== 'VALID' || r.inspection.revoked !== false ||
        !windowCovers(r.inspection.validFrom, r.inspection.expiresAt, Math.min(ctx.now, ctx.start), ctx.end)) deny('INSPECTION_UNPROVEN');
    const zones = r.zones, validZones = list => Array.isArray(list) && list.length <= 128 && list.every(z => id(z) && input.knownZoneIds.includes(z)) && new Set(list).size === list.length;
    if (!evidence(zones, r) || zones.revoked !== false || !fresh(zones.observedAt, ctx) ||
        !windowCovers(zones.observedAt, zones.validUntil, ctx.start, ctx.end) || zones.known !== true || !validZones(zones.permitted) || !validZones(zones.restricted) ||
        !task.zoneIds.every(z => input.knownZoneIds.includes(z) && zones.permitted.includes(z) && !zones.restricted.includes(z))) deny('ZONE_UNPROVEN_OR_RESTRICTED');
    if ((['AMR', 'AGV', 'HUMANOID'].includes(r.resourceType) || r.operationalState === 'CHARGING' || ctx.req.requiresEnergyEvidence === true || r.energy !== undefined) &&
        (!evidence(r.energy, r) || r.energy.sufficient !== true || r.energy.revoked !== false ||
         !fresh(r.energy.observedAt, ctx) || !windowCovers(r.energy.observedAt, r.energy.validUntil, ctx.start, ctx.end))) deny('ENERGY_UNPROVEN');
    if ((ctx.req.minimumPayloadKg !== undefined && (!finite(r.payloadKg) || r.payloadKg < ctx.req.minimumPayloadKg)) ||
        (ctx.req.minimumReachMm !== undefined && (!finite(r.reachMm) || r.reachMm < ctx.req.minimumReachMm)) ||
        (ctx.req.toolClass !== undefined && r.toolClass !== ctx.req.toolClass)) deny('TASK_PHYSICAL_REQUIREMENTS_UNPROVEN');
    for (const cap of task.capabilities) {
      if (!Array.isArray(r.capabilities) || !r.capabilities.some(x => x?.id === cap.id && x.revision === cap.revision)) deny('CAPABILITY_MISMATCH');
      const exact = input.mappings.filter(m => m && sameScope(m.scope, input.scope) && m.resourceId === r.id &&
        m.provider === r.provider && m.sourceAssetId === r.sourceAssetId && m.sourceRevision === r.sourceRevision &&
        m.controllerRef === r.controllerRef && m.taskId === task.id && m.taskRevision === task.revision && m.taskClass === task.taskClass &&
        m.capabilityId === cap.id && m.capabilityRevision === cap.revision);
      if (exact.length !== 1 || !id(exact[0]?.id) || mappingCounts.get(exact[0]?.id) !== 1) deny('CAPABILITY_MAPPING_MISSING_OR_AMBIGUOUS');
      else {
        const mapping = exact[0];
        if (mapping.approved !== true || mapping.revoked !== false || !id(mapping.evidenceRef) ||
            !windowCovers(mapping.validFrom, mapping.expiresAt, ctx.now, ctx.end)) deny('MAPPING_NOT_SUPPLIED_APPROVED');
        else refs.add(mapping.evidenceRef);
      }
    }
    for (const name of ['telemetry', 'availability', 'maintenance', 'inspection', 'zones', 'energy']) if (id(r[name]?.evidenceRef)) refs.add(r[name].evidenceRef);
    return { id: id(r.id) ? r.id : `invalid-resource-${index}`, kind: 'AutomatedResource',
      shadowEligible: reasons.size === 0, reasonCodes: [...reasons].sort(), evidenceRefs: [...refs].sort() };
  }).sort((a, b) => stable(a).localeCompare(stable(b)));
  const resourceContextDigest = digest(canonical({ scope: input.scope, task, resources: input.resources, mappings: input.mappings,
    now: input.now, knownZoneIds: input.knownZoneIds, maxTelemetryAgeMs: ctx.age }));
  return freeze({ contractVersion: 'VECTOR_HYBRID_RESOURCE_SHADOW_V1', evidenceTrust: 'SUPPLIED_UNAUTHENTICATED',
    authenticatedAuthority: false, trustedAssetAdmissionRequired: true, executionPermitted: false,
    shadowOnly: true, inputDigest: digest(canonical(input)), resourceContextDigest,
    shadowUsableResourceCount: results.filter(r => r.shadowEligible).length, resources: results });
}

function humanPassed(candidate, input, eligibility) {
  const matching = input.humanFeasibility.filter(h => h?.optionId === candidate.id);
  if (matching.length !== 1) return false;
  const h = matching[0], task = input.task;
  return h.alternativeKind === candidate.kind && Array.isArray(h.resourceIds) && h.resourceIds.length === candidate.resourceIds.length &&
    new Set(h.resourceIds).size === h.resourceIds.length && h.resourceIds.every(r => candidate.resourceIds.includes(r)) &&
    h.resourceContextDigest === eligibility.resourceContextDigest &&
    sameScope(h.scope, input.scope) && h.taskId === task.id && h.taskRevision === task.revision &&
    h.start === task.start && h.end === task.end && h.contextRevision === input.contextRevision &&
    Array.isArray(h.zoneIds) && h.zoneIds.length === task.zoneIds.length && new Set(h.zoneIds).size === h.zoneIds.length &&
    h.zoneIds.every(z => task.zoneIds.includes(z) && input.knownZoneIds.includes(z)) && id(h.evidenceRef) &&
    h.feasible === true && h.policyAllowed === true && h.hardConstraintsPassed === true;
}

function validateObjective(objective) {
  if (!objective || typeof objective !== 'object' || Array.isArray(objective)) throw new Error('Supplied objective required.');
  if (Object.keys(objective).some(key => !METRICS.has(key) && key !== 'uncertaintyPenalty')) throw new Error('Unknown objective metric.');
  let total = 0;
  for (const key of METRICS) {
    const weight = objective[key] ?? 0;
    if (!finite(weight)) throw new Error('Finite non-negative objective weights required.');
    total += weight;
  }
  if (!Number.isFinite(total) || total <= 0) throw new Error('Finite positive objective weight total required.');
  const penalty = objective.uncertaintyPenalty ?? 0.15;
  if (!finite(penalty) || penalty > 1) throw new Error('Objective uncertainty penalty must be 0..1.');
}
function capacityPassed(candidate, input, eligibility, ctx) {
  const value = candidate.capacityEvidence, task = input.task;
  const predicted = candidate.prediction?.throughputUnits;
  return value?.kind === 'RESOURCE_PLAN_CAPACITY' && sameScope(value.scope, input.scope) &&
    value.taskId === task.id && value.taskRevision === task.revision && value.taskClass === task.taskClass &&
    Array.isArray(value.resourceIds) && value.resourceIds.length === candidate.resourceIds.length &&
    new Set(value.resourceIds).size === value.resourceIds.length &&
    value.resourceIds.every(resourceId => candidate.resourceIds.includes(resourceId)) &&
    value.resourceContextDigest === eligibility.resourceContextDigest && value.revoked === false &&
    id(value.evidenceRef) && fresh(value.observedAt, ctx) &&
    windowCovers(value.observedAt, value.validUntil, ctx.start, ctx.end) &&
    finite(predicted) && finite(value.declaredUpperBoundUnits) && predicted <= value.declaredUpperBoundUnits;
}
function option(candidate, extraReasons) {
  if (!id(candidate.id)) throw new Error('Exact option id required.');
  const prediction = candidate.prediction;
  if (!prediction || typeof prediction !== 'object' || Array.isArray(prediction)) throw new Error('Supplied prediction required.');
  for (const [key, value] of Object.entries(prediction)) {
    if (!METRICS.has(key) || (value !== null && (!finite(value) || (key === 'planAttainmentPct' && value > 100))))
      throw new Error('Finite non-negative declared prediction metrics required.');
  }
  if (typeof candidate.uncertainty !== 'number' || !Number.isFinite(candidate.uncertainty) || candidate.uncertainty < 0 || candidate.uncertainty > 1)
    throw new Error('Supplied uncertainty must be 0..1.');
  const refs = ids(candidate.evidenceRefs, 20, 'candidate evidenceRefs');
  const reasons = new Set(extraReasons);
  if (!refs.length) reasons.add('CANDIDATE_EVIDENCE_UNPROVEN');
  if (candidate.feasible !== true || candidate.policyAllowed !== true || candidate.hardConstraintsPassed !== true) reasons.add('SUPPLIED_CANDIDATE_CONSTRAINT_FAILED');
  return { id: candidate.id, label: candidate.id, feasible: reasons.size === 0,
    policyAllowed: candidate.policyAllowed === true, hardConstraintsPassed: candidate.hardConstraintsPassed === true && reasons.size === 0,
    uncertainty: candidate.uncertainty, prediction, evidenceRefs: refs, reasonCodes: [...reasons].sort() };
}

/** Compare bounded supplied alternatives only. Never allocate, select for execution or record an outcome. */
function buildHybridResourceShadow(raw) {
  const input = snapshot(raw);
  if (input.mode !== undefined && input.mode !== 'SHADOW') throw new Error('Only SHADOW mode is supported.');
  if (!id(input.contextRevision) || !id(input.triggerId)) throw new Error('Exact contextRevision and triggerId required.');
  validateObjective(input.objective);
  const eligibility = evaluateAutomatedResources(input), ctx = context(input);
  const sourceEvidence = ids(input.sourceEvidence, 40, 'sourceEvidence', true);
  array(input.alternatives, 32, 'alternatives'); array(input.humanFeasibility, 32, 'humanFeasibility');
  if (!input.alternatives.length) throw new Error('At least one bounded alternative required.');
  if (!input.doNothing || (input.doNothing.id !== undefined && input.doNothing.id !== 'do-nothing') ||
      (input.doNothing.resourceIds !== undefined && (!Array.isArray(input.doNothing.resourceIds) || input.doNothing.resourceIds.length)))
    throw new Error('Genuine supplied do-nothing option without resource allocation required.');
  if (new Set(input.alternatives.map(c => c?.id)).size !== input.alternatives.length) throw new Error('Unique alternative ids required.');
  const options = [option({ ...input.doNothing, id: 'do-nothing' }, [])];
  for (const candidate of input.alternatives) {
    if (!candidate || candidate.id === 'do-nothing') throw new Error('do-nothing is reserved.');
    if (!KINDS.has(candidate.kind)) throw new Error('Explicit alternative kind required.');
    const resourceIds = ids(candidate.resourceIds, 128, 'resourceIds');
    const needsResource = ['AUTOMATED', 'MIXED'].includes(candidate.kind);
    if ((!needsResource && resourceIds.length) || (needsResource && !resourceIds.length)) throw new Error('Alternative resource declaration does not match its kind.');
    const reasons = [];
    if (HUMAN_KINDS.has(candidate.kind) && !humanPassed(candidate, input, eligibility)) reasons.push('SUPPLIED_HUMAN_FEASIBILITY_UNPROVEN');
    if (needsResource && resourceIds.some(resourceId => {
      const matches = eligibility.resources.filter(r => r.id === resourceId);
      return matches.length !== 1 || !matches[0].shadowEligible;
    })) reasons.push('AUTOMATED_RESOURCE_UNPROVEN');
    if (needsResource && !capacityPassed(candidate, input, eligibility, ctx)) reasons.push('AUTOMATED_CAPACITY_UNPROVEN');
    options.push(option(candidate, reasons));
  }
  // Reuse the sole existing ranker; bind all supplied context/evidence into its
  // episode identity, including revocations and consumed human feasibility.
  const episode = createDecisionEpisode({ tenant: input.scope.tenant, site: input.scope.site,
    decisionType: 'hybrid-resource-shadow', triggerId: input.triggerId, triggeredAt: input.now,
    contextRevision: eligibility.inputDigest, mode: 'SHADOW',
    sourceEvidence: [...sourceEvidence, `supplied-context:${eligibility.inputDigest}`].sort(),
    objective: input.objective, options: options.sort((a, b) => a.id.localeCompare(b.id)) });
  const candidateById = new Map(input.alternatives.map(candidate => [candidate.id, candidate]));
  const optionContexts = episode.options.map(screened => {
    const candidate = candidateById.get(screened.id), resourceIds = candidate ? [...candidate.resourceIds].sort() : [];
    const resourceEvidence = resourceIds.map(resourceId => {
      const matches = input.resources.filter(resource => resource?.id === resourceId);
      const resource = matches.length === 1 ? matches[0] : null;
      const screenedResource = eligibility.resources.find(entry => entry.id === resourceId);
      return resource ? {
        resourceId, scope: resource.scope, provider: resource.provider, sourceAssetId: resource.sourceAssetId,
        sourceRevision: resource.sourceRevision, controllerRef: resource.controllerRef,
        sourceRecordDigest: digest(canonical(resource)), shadowEligible: screenedResource?.shadowEligible === true,
        evidenceRefs: screenedResource?.evidenceRefs || [],
        validityEndsAt: [resource.telemetry?.validUntil, resource.availability?.end, resource.maintenance?.validUntil,
          resource.inspection?.expiresAt, resource.zones?.validUntil, resource.energy?.validUntil,
          ...input.mappings.filter(mapping => mapping?.resourceId === resourceId).map(mapping => mapping.expiresAt)]
          .filter(value => time(value) !== null).sort()[0] || null
      } : { resourceId, shadowEligible: false, evidenceRefs: [], validityEndsAt: null };
    });
    const matchingHuman = input.humanFeasibility.filter(human => human?.optionId === screened.id);
    return { episodeId: episode.episodeId, optionId: screened.id, kind: candidate?.kind || 'DO_NOTHING',
      scope: input.scope, task: canonical({ id: input.task.id, revision: input.task.revision,
        taskClass: input.task.taskClass, capabilities: input.task.capabilities, zoneIds: input.task.zoneIds,
        requirements: input.task.requirements || {} }),
      window: { start: input.task.start, end: input.task.end }, evaluatedAt: input.now,
      resourceContextDigest: eligibility.resourceContextDigest, resourceIds, resourceEvidence,
      candidateEvidenceRefs: screened.evidenceRefs,
      humanEvidenceRef: candidate && HUMAN_KINDS.has(candidate.kind) && matchingHuman.length === 1 &&
        humanPassed(candidate, input, eligibility) ? matchingHuman[0].evidenceRef : null,
      capacityEvidenceRef: candidate && ['AUTOMATED', 'MIXED'].includes(candidate.kind) &&
        capacityPassed(candidate, input, eligibility, ctx) ? candidate.capacityEvidence.evidenceRef : null,
      shadowFeasible: screened.feasible, executionPermitted: false,
      evidenceTrust: 'SUPPLIED_UNAUTHENTICATED' };
  });
  return freeze({ contractVersion: 'VECTOR_HYBRID_RESOURCE_SHADOW_V1', shadowOnly: true,
    executionPermitted: false, authenticatedAuthority: false, trustedAssetAdmissionRequired: true,
    evidenceTrust: 'SUPPLIED_UNAUTHENTICATED', commands: [], eligibility, episode, optionContexts });
}

module.exports = Object.freeze({ evaluateAutomatedResources, buildHybridResourceShadow });

