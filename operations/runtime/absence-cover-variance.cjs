'use strict';
const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const id = value => typeof value === 'string' && ID.test(value);
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
};
const scope = ['tenantId', 'siteId', 'shiftId', 'slotId'];
const rootFields = [...scope, 'windowStart', 'windowEnd', 'asOf', 'planned', 'absence', 'cover'];
const common = [...scope, 'windowStart', 'windowEnd', 'sourceKind', 'sourceId', 'sourceRevision', 'recordSha256',
  'occurredAt', 'observedAt', 'minutes', 'status'];
const safeMoney = value => Number.isSafeInteger(value) && value >= 0;

function inertRecord(value, fields, nestedFields = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let keys;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== fields.length ||
      keys.some(key => typeof key !== 'string' || !fields.includes(key))) return null;
  const snapshot = Object.create(null);
  for (const field of fields) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, field);
    } catch {
      return null;
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    if (!nestedFields.has(field) && descriptor.value !== null && typeof descriptor.value === 'object') return null;
    snapshot[field] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

// Read-only comparison of three independently supplied scoped receipts. The
// declared difference excludes retained absent-worker pay and is not savings.
module.exports = function assessAbsenceCoverVariance(input) {
  const blocked = reason => Object.freeze({ status: 'BLOCKED', reason, sourceAuthenticated: false,
    payrollAuthority: false, executionAuthority: false, claimedSavingsPence: null });
  const root = inertRecord(input, rootFields, new Set(['planned', 'absence', 'cover']));
  if (!root || !scope.every(key => id(root[key]))) return blocked('SCOPE_INVALID');
  const start = time(root.windowStart), end = time(root.windowEnd), asOf = time(root.asOf);
  if (start === null || end === null || asOf === null || !(start < end && start <= asOf))
    return blocked('WINDOW_INVALID');
  const planned = inertRecord(root.planned, [...common, 'costPence']);
  const absence = inertRecord(root.absence, [...common, 'plannedRecordSha256']);
  const cover = inertRecord(root.cover, [...common, 'coverType', 'costPence', 'plannedRecordSha256',
    'absenceRecordSha256']);
  if (!planned || !absence || !cover) return blocked('RECEIPT_SHAPE_INVALID');
  const receipts = [planned, absence, cover];
  const expected = [['PUBLISHED_SCHEDULE','PUBLISHED'],['ABSENCE_APPROVAL','APPROVED'],
    ['COVER_ASSIGNMENT','APPROVED']];
  const occurred = [];
  for (let i = 0; i < receipts.length; i++) {
    const row = receipts[i];
    if (![...scope, 'windowStart', 'windowEnd'].every(key => row[key] === root[key]) ||
        row.sourceKind !== expected[i][0] ||
        row.status !== expected[i][1] || !id(row.sourceId) || !id(row.sourceRevision) ||
        typeof row.recordSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.recordSha256) ||
        !Number.isSafeInteger(row.minutes) || row.minutes <= 0 || row.minutes > 24 * 60)
      return blocked('RECEIPT_INVALID');
    const event = time(row.occurredAt), observed = time(row.observedAt);
    if (event === null || observed === null || !(event <= start && event <= observed && observed <= asOf))
      return blocked('RECEIPT_TIME_INVALID');
    occurred.push(event);
  }
  if (!(occurred[0] <= occurred[1] && occurred[1] <= occurred[2])) return blocked('EVENT_ORDER_INVALID');
  if (new Set(receipts.map(row => row.sourceId)).size !== 3 ||
      new Set(receipts.map(row => row.recordSha256)).size !== 3) return blocked('SOURCES_NOT_DISTINCT');
  if (absence.plannedRecordSha256 !== planned.recordSha256 ||
      cover.plannedRecordSha256 !== planned.recordSha256 ||
      cover.absenceRecordSha256 !== absence.recordSha256) return blocked('RECEIPT_LINK_INVALID');
  const shiftMinutes = (end - start) / 60000;
  if (!Number.isSafeInteger(shiftMinutes) || receipts.some(row => row.minutes !== shiftMinutes))
    return blocked('MINUTES_MISMATCH');
  if (!safeMoney(planned.costPence) || !safeMoney(cover.costPence) ||
      !['INTERNAL','OVERTIME','AGENCY'].includes(cover.coverType)) return blocked('COST_OR_COVER_INVALID');
  const difference = cover.costPence - planned.costPence;
  if (!Number.isSafeInteger(difference)) return blocked('COST_OVERFLOW');
  const hashes = Object.freeze(receipts.map(row => row.recordSha256));
  return Object.freeze({ status: 'REVIEW_DECLARED_COVER_VARIANCE',
    ...Object.fromEntries(scope.map(key => [key, root[key]])),
    windowStart: root.windowStart, windowEnd: root.windowEnd, asOf: root.asOf,
    minutes: shiftMinutes, coverType: cover.coverType,
    declaredPlannedCostPence: planned.costPence, declaredCoverCostPence: cover.costPence,
    declaredCoverLessPlannedPence: difference,
    recordSha256: hashes,
    claimBoundary: 'DECLARED_COVER_LESS_PLANNED_NOT_INCREMENTAL_PAYROLL',
    sourceAuthenticated: false, payrollAuthority: false, executionAuthority: false,
    claimedSavingsPence: null });
};
