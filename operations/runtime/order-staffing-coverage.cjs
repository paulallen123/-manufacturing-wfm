'use strict';

const { CONTRACT_VERSION: SCHEDULER_VERSION, digest } = require('./manufacturing-scheduling-engine.cjs');
const CONTRACT_VERSION = 'VECTOR_ORDER_STAFFING_COVERAGE_V1';

function own(object, field) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw Error(`${field} needs an evidence object.`);
  const descriptor = Object.getOwnPropertyDescriptor(object, field);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error(`${field} must be an own data field.`);
  return descriptor.value;
}
function label(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error(`${field} needs bounded text.`);
  return value.trim();
}
function instant(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.000)?Z$/.test(value)) throw Error(`${field} needs a UTC ISO second.`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || (value.endsWith('.000Z') ? new Date(ms).toISOString() : new Date(ms).toISOString().replace('.000Z', 'Z')) !== value) throw Error(`${field} is not a real UTC instant.`);
  return ms;
}

function assessOrderStaffingCoverage(input) {
  const tenantId = label(own(input, 'tenantId'), 'tenantId');
  const siteId = label(own(input, 'siteId'), 'siteId');
  const lineId = label(own(input, 'lineId'), 'lineId');
  const orderId = label(own(input, 'orderId'), 'orderId');
  const asOf = instant(own(input, 'asOf'), 'asOf');
  const orderSource = own(input, 'orderSource');
  const window = own(orderSource, 'window');
  const start = instant(own(window, 'start'), 'window.start');
  const end = instant(own(window, 'end'), 'window.end');
  if (end <= start || end - start > 7 * 86400000 || start < asOf || start - asOf > 7 * 86400000) throw Error('Order staffing window must be future, positive and bounded.');

  if (own(orderSource, 'tenantId') !== tenantId || own(orderSource, 'siteId') !== siteId ||
      own(orderSource, 'lineId') !== lineId || own(orderSource, 'orderId') !== orderId ||
      own(orderSource, 'complete') !== true) throw Error('Complete exact-order source scope required.');
  const sourceName = label(own(orderSource, 'name'), 'orderSource.name');
  const sourceRevision = label(own(orderSource, 'revision'), 'orderSource.revision');
  const sourceDigest = label(own(orderSource, 'digest'), 'orderSource.digest');
  const observedAt = instant(own(orderSource, 'observedAt'), 'orderSource.observedAt');
  if (observedAt > asOf) throw Error('Order source cannot be observed after asOf.');

  const plan = own(input, 'plan');
  const planId = label(own(plan, 'planId'), 'plan.planId');
  if (!/^[a-f0-9]{64}$/.test(planId) || own(plan, 'contractVersion') !== SCHEDULER_VERSION ||
      own(plan, 'tenant') !== tenantId || own(plan, 'mode') !== 'SHADOW' ||
      own(plan, 'executionPermitted') !== false || own(own(plan, 'validation'), 'valid') !== true) {
    throw Error('An exact valid tenant-scoped shadow scheduling plan is required.');
  }
  const planCreatedAt = instant(own(plan, 'createdAt'), 'plan.createdAt');
  if (planCreatedAt < observedAt || planCreatedAt > asOf) throw Error('Plan must follow source observation and precede asOf.');
  const { planId: _id, createdAt: _createdAt, ...identity } = plan;
  if (digest(identity) !== planId) throw Error('Scheduling plan identity differs from its contents.');

  const requirementIds = own(orderSource, 'requirementIds');
  if (!Array.isArray(requirementIds) || requirementIds.length < 1 || requirementIds.length > 100) throw Error('Bounded order requirement IDs required.');
  const requested = new Set();
  for (let i = 0; i < requirementIds.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(requirementIds, i);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('Requirement IDs must be explicit data entries.');
    const id = label(descriptor.value, 'requirementId');
    if (requested.has(id)) throw Error('Duplicate order requirement ID.');
    requested.add(id);
  }
  const requirements = own(plan, 'requirements');
  const assignments = own(plan, 'assignments');
  if (!Array.isArray(requirements) || !Array.isArray(assignments) || assignments.length > 10000) throw Error('Bounded plan requirements and assignments required.');
  const selected = new Map();
  for (const requirement of requirements) {
    const id = own(requirement, 'id');
    if (!requested.has(id)) continue;
    if (selected.has(id) || own(requirement, 'site') !== siteId || own(requirement, 'line') !== lineId) throw Error('Order requirement scope differs from selected site/line.');
    const requirementStart = instant(own(requirement, 'start'), 'requirement.start');
    const requirementEnd = instant(own(requirement, 'end'), 'requirement.end');
    if (requirementStart < start || requirementEnd > end || requirementEnd <= requirementStart) throw Error('Order requirement must fit the declared order window.');
    const headcount = own(requirement, 'headcount');
    if (!Number.isSafeInteger(headcount) || headcount < 1 || headcount > 1000) throw Error('Positive bounded order headcount required.');
    selected.set(id, { headcount, start: requirement.start, end: requirement.end });
  }
  if (selected.size !== requested.size) throw Error('Every selected order requirement must exist in the plan.');

  const seenSlots = new Set();
  let filledSlots = 0, gapSlots = 0;
  const gapRequirementIds = new Set();
  for (const assignment of assignments) {
    const requirementId = own(assignment, 'requirementId');
    if (!selected.has(requirementId)) continue;
    const requirement = selected.get(requirementId);
    const slotId = label(own(assignment, 'slotId'), 'assignment.slotId');
    const prefix = `${requirementId}#`;
    const index = slotId.startsWith(prefix) ? Number(slotId.slice(prefix.length)) : NaN;
    if (!Number.isSafeInteger(index) || index < 1 || index > requirement.headcount ||
        slotId !== `${requirementId}#${index}` || seenSlots.has(slotId)) throw Error('Order assignment slot is missing or repeated.');
    seenSlots.add(slotId);
    if (own(assignment, 'site') !== siteId || own(assignment, 'line') !== lineId ||
        own(assignment, 'start') !== requirement.start || own(assignment, 'end') !== requirement.end) throw Error('Order assignment scope or window differs.');
    const workerId = own(assignment, 'workerId');
    if (workerId === null && own(assignment, 'shortfall') === true) {
      gapSlots++;
      gapRequirementIds.add(requirementId);
    } else if (typeof workerId === 'string' && workerId.trim()) {
      filledSlots++;
    } else throw Error('Order assignment must be filled or an explicit shortfall.');
  }
  const requiredSlots = [...selected.values()].reduce((sum, x) => sum + x.headcount, 0);
  if (seenSlots.size !== requiredSlots) throw Error('Scheduling plan omits an order staffing slot.');
  return Object.freeze({
    contractVersion: CONTRACT_VERSION, status: gapSlots ? 'SHADOW_PLAN_REPORTED_GAP' : 'SHADOW_PLAN_REPORTED_COVERED',
    tenantId, siteId, lineId, orderId, asOf: input.asOf,
    window: Object.freeze({ start: window.start, end: window.end }),
    orderSource: Object.freeze({ name: sourceName, revision: sourceRevision, digest: sourceDigest, observedAt: orderSource.observedAt }),
    planId, planCreatedAt: plan.createdAt, requirementIds: Object.freeze([...requested]),
    requiredSlots, filledSlots, gapSlots, gapRequirementIds: Object.freeze([...gapRequirementIds]),
    sourceAuthenticated: false, actionAuthority: false, executionPermitted: false
  });
}

module.exports = { assessOrderStaffingCoverage, CONTRACT_VERSION };
