'use strict';

const CONTRACT_VERSION = 'VECTOR_PRODUCTION_OUTPUT_GAP_V1';
const SCOPE = Object.freeze(['tenantId', 'siteId', 'lineId', 'productId', 'orderId']);

function value(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error(`${field} requires bounded text.`);
  return value.trim();
}
function instant(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/.test(value)) {
    throw Error(`${field} requires a UTC ISO second.`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace('.000Z', 'Z') !== value) {
    throw Error(`${field} is not a real UTC instant.`);
  }
  return time;
}
function units(value, field) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error(`${field} requires nonnegative safe units.`);
  return value;
}
function source(row, kind, scope, window, end, asOf) {
  if (!row || typeof row !== 'object' || Array.isArray(row) ||
      ['window', 'sourceName', 'revision', 'digest', 'observedAt', 'complete', 'evidenceRef',
        kind === 'plan' ? 'targetUnits' : 'acceptedUnits'].some(key => !Object.hasOwn(row, key)) ||
      row.complete !== true) throw Error(`${kind} requires a complete source observation.`);
  for (const key of SCOPE) {
    if (!Object.hasOwn(row, key) || row[key] !== scope[key]) throw Error(`${kind} ${key} differs from the requested scope.`);
  }
  if (!row.window || !Object.hasOwn(row.window, 'start') || !Object.hasOwn(row.window, 'end') ||
      row.window.start !== window.start || row.window.end !== window.end) {
    throw Error(`${kind} period differs from the requested period.`);
  }
  const observed = instant(row.observedAt, `${kind}.observedAt`);
  if (observed < end || observed > asOf) throw Error(`${kind} observation must cover the period and precede asOf.`);
  return Object.freeze({
    name: value(row.sourceName, `${kind}.sourceName`),
    revision: value(row.revision, `${kind}.revision`),
    digest: value(row.digest, `${kind}.digest`),
    observedAt: row.observedAt,
    evidenceRef: value(row.evidenceRef, `${kind}.evidenceRef`)
  });
}

function assessProductionOutputGap(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('An output snapshot is required.');
  const scope = Object.fromEntries(SCOPE.map(key => [key, value(input[key], key)]));
  const start = instant(input.window?.start, 'window.start');
  const end = instant(input.window?.end, 'window.end');
  const asOf = instant(input.asOf, 'asOf');
  if (end <= start || end - start > 31 * 86400000 || end > asOf) throw Error('Period must be positive, bounded and complete by asOf.');
  const plan = source(input.plan, 'plan', scope, input.window, end, asOf);
  const production = source(input.production, 'production', scope, input.window, end, asOf);
  if (plan.evidenceRef === production.evidenceRef) throw Error('Plan and production evidence must be distinct.');
  const target = units(input.plan.targetUnits, 'plan.targetUnits');
  const accepted = units(input.production.acceptedUnits, 'production.acceptedUnits');
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    status: accepted < target ? 'PLANNED_OUTPUT_GAP' : 'TARGET_MET',
    ...scope, window: Object.freeze({ start: input.window.start, end: input.window.end }), asOf: input.asOf,
    targetUnits: target, acceptedUnits: accepted,
    gapUnits: Math.max(0, target - accepted), overPlanUnits: Math.max(0, accepted - target),
    sources: Object.freeze({ plan, production }),
    evidenceRefs: Object.freeze([plan.evidenceRef, production.evidenceRef]),
    cause: null, claimedSavingsPence: null, sourceAuthenticated: false, actionAuthority: false
  });
}

module.exports = { assessProductionOutputGap, CONTRACT_VERSION };
