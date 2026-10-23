'use strict';

const { types } = require('node:util');

const CONTRACT_VERSION = 'VECTOR_PRODUCTION_OUTPUT_GAP_V1';
const SCOPE = Object.freeze(['tenantId', 'siteId', 'lineId', 'productId', 'orderId']);
const WINDOW_FIELDS = Object.freeze(['start', 'end']);
const ROOT_FIELDS = Object.freeze([...SCOPE, 'window', 'asOf', 'plan', 'production']);

function snapshotObject(input, fields, field) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || types.isProxy(input)) {
    throw Error(`${field} requires an ordinary evidence object.`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw Error(`${field} requires plain data.`);
  const keys = Reflect.ownKeys(input);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) {
    throw Error(`${field} contains missing, inherited or unsupported fields.`);
  }
  const snapshot = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      throw Error(`${field}.${key} requires an enumerable own data value.`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

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
  const unitField = kind === 'plan' ? 'targetUnits' : 'acceptedUnits';
  const snapshot = snapshotObject(row,
    [...SCOPE, 'window', 'sourceName', 'revision', 'digest', 'observedAt', 'complete', 'evidenceRef', unitField], kind);
  const sourceWindow = snapshotObject(snapshot.window, WINDOW_FIELDS, `${kind}.window`);
  if (snapshot.complete !== true) throw Error(`${kind} requires a complete source observation.`);
  for (const key of SCOPE) {
    if (snapshot[key] !== scope[key]) throw Error(`${kind} ${key} differs from the requested scope.`);
  }
  if (sourceWindow.start !== window.start || sourceWindow.end !== window.end) {
    throw Error(`${kind} period differs from the requested period.`);
  }
  const observed = instant(snapshot.observedAt, `${kind}.observedAt`);
  if (observed < end || observed > asOf) throw Error(`${kind} observation must cover the period and precede asOf.`);
  return Object.freeze({
    name: value(snapshot.sourceName, `${kind}.sourceName`),
    revision: value(snapshot.revision, `${kind}.revision`),
    digest: value(snapshot.digest, `${kind}.digest`),
    observedAt: snapshot.observedAt,
    evidenceRef: value(snapshot.evidenceRef, `${kind}.evidenceRef`),
    [unitField]: units(snapshot[unitField], `${kind}.${unitField}`)
  });
}

function assessProductionOutputGap(input) {
  const snapshot = snapshotObject(input, ROOT_FIELDS, 'output');
  const window = snapshotObject(snapshot.window, WINDOW_FIELDS, 'window');
  const scope = Object.freeze(Object.fromEntries(SCOPE.map(key => [key, value(snapshot[key], key)])));
  const start = instant(window.start, 'window.start');
  const end = instant(window.end, 'window.end');
  const asOf = instant(snapshot.asOf, 'asOf');
  if (end <= start || end - start > 31 * 86400000 || end > asOf) throw Error('Period must be positive, bounded and complete by asOf.');
  const plan = source(snapshot.plan, 'plan', scope, window, end, asOf);
  const production = source(snapshot.production, 'production', scope, window, end, asOf);
  if (plan.evidenceRef === production.evidenceRef ||
      (plan.name === production.name && plan.revision === production.revision && plan.digest === production.digest)) {
    throw Error('Plan and production evidence must be distinct.');
  }
  const target = plan.targetUnits;
  const accepted = production.acceptedUnits;
  const sourceOutput = sourceSnapshot => Object.freeze({
    name: sourceSnapshot.name, revision: sourceSnapshot.revision, digest: sourceSnapshot.digest,
    observedAt: sourceSnapshot.observedAt, evidenceRef: sourceSnapshot.evidenceRef
  });
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    status: accepted < target ? 'PLANNED_OUTPUT_GAP' : 'TARGET_MET',
    ...scope, window: Object.freeze({ start: window.start, end: window.end }), asOf: snapshot.asOf,
    targetUnits: target, acceptedUnits: accepted,
    gapUnits: Math.max(0, target - accepted), overPlanUnits: Math.max(0, accepted - target),
    sources: Object.freeze({ plan: sourceOutput(plan), production: sourceOutput(production) }),
    evidenceRefs: Object.freeze([plan.evidenceRef, production.evidenceRef]),
    cause: null, claimedSavingsPence: null, sourceAuthenticated: false, actionAuthority: false
  });
}

module.exports = { assessProductionOutputGap, CONTRACT_VERSION };
