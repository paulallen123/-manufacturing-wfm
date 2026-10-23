'use strict';
const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const id = value => typeof value === 'string' && ID.test(value);
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
};
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key));
const scope = ['tenantId', 'siteId', 'shiftId', 'slotId'];
const rootFields = [...scope, 'windowStart', 'windowEnd', 'asOf', 'planned', 'absence', 'cover'];
const common = [...scope, 'windowStart', 'windowEnd', 'sourceKind', 'sourceId', 'sourceRevision', 'recordSha256',
  'occurredAt', 'observedAt', 'minutes', 'status'];
const safeMoney = value => Number.isSafeInteger(value) && value >= 0;

// Read-only comparison of three independently supplied scoped receipts. The
// declared difference excludes retained absent-worker pay and is not savings.
module.exports = function assessAbsenceCoverVariance(input) {
  const blocked = reason => ({ status: 'BLOCKED', reason, sourceAuthenticated: false,
    payrollAuthority: false, executionAuthority: false, claimedSavingsPence: null });
  if (!exact(input, rootFields) || !scope.every(key => id(input[key]))) return blocked('SCOPE_INVALID');
  const start = time(input.windowStart), end = time(input.windowEnd), asOf = time(input.asOf);
  if (start === null || end === null || asOf === null || !(start < end && start <= asOf))
    return blocked('WINDOW_INVALID');
  const { planned, absence, cover } = input;
  if (!exact(planned, [...common, 'costPence']) ||
      !exact(absence, [...common, 'plannedRecordSha256']) ||
      !exact(cover, [...common, 'coverType', 'costPence', 'plannedRecordSha256',
        'absenceRecordSha256'])) return blocked('RECEIPT_SHAPE_INVALID');
  const receipts = [planned, absence, cover];
  const expected = [['PUBLISHED_SCHEDULE','PUBLISHED'],['ABSENCE_APPROVAL','APPROVED'],
    ['COVER_ASSIGNMENT','APPROVED']];
  const occurred = [];
  for (let i = 0; i < receipts.length; i++) {
    const row = receipts[i];
    if (![...scope, 'windowStart', 'windowEnd'].every(key => row[key] === input[key]) ||
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
  return { status: 'REVIEW_DECLARED_COVER_VARIANCE', ...Object.fromEntries(scope.map(key => [key, input[key]])),
    windowStart: input.windowStart, windowEnd: input.windowEnd, asOf: input.asOf,
    minutes: shiftMinutes, coverType: cover.coverType,
    declaredPlannedCostPence: planned.costPence, declaredCoverCostPence: cover.costPence,
    declaredCoverLessPlannedPence: difference,
    recordSha256: receipts.map(row => row.recordSha256),
    claimBoundary: 'DECLARED_COVER_LESS_PLANNED_NOT_INCREMENTAL_PAYROLL',
    sourceAuthenticated: false, payrollAuthority: false, executionAuthority: false,
    claimedSavingsPence: null };
};
