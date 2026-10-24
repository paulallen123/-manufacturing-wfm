'use strict';

const { types: { isProxy } } = require('node:util');

const arrayIncludes = Function.call.bind(Array.prototype.includes);
const arrayIsArray = Array.isArray;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);
const objectCreate = Object.create;
const ownKeys = Reflect.ownKeys;
const ordinaryPrototype = Object.prototype;

const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const id = value => typeof value === 'string' && ID.test(value);
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
};
const common = ['tenantId','siteId','periodId','batchId','currency','sourceKind','sourceId','sourceRevision',
  'evidenceRef','eventAt','observedAt','final','rowCount','grossPence','oncostPence','totalPence'];
const rootFields = ['tenantId','siteId','periodId','batchId','currency','asOf','approved','released'];
const money = value => Number.isSafeInteger(value) && value >= 0;

function inertRecord(value, names, objectField) {
  if (value === null || typeof value !== 'object' || isProxy(value)) return null;
  try {
    // isProxy must precede Array.isArray because IsArray throws for a revoked Proxy.
    if (arrayIsArray(value)) return null;
    const prototype = getPrototypeOf(value);
    if (prototype !== ordinaryPrototype && prototype !== null) return null;
    const keys = ownKeys(value);
    if (keys.length !== names.length) return null;
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (typeof key !== 'string' || !arrayIncludes(names, key)) return null;
      const descriptor = getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !hasOwn(descriptor, 'value')) return null;
    }
    const snapshot = objectCreate(null);
    for (let index = 0; index < names.length; index++) {
      const key = names[index];
      const descriptor = getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !hasOwn(descriptor, 'value')) return null;
      const field = descriptor.value;
      const fieldType = typeof field;
      if (field === null || fieldType === 'function' || fieldType === 'symbol' || fieldType === 'bigint' ||
          (fieldType === 'object' && (!objectField || !objectField(key)))) return null;
      snapshot[key] = field;
    }
    return freeze(snapshot);
  } catch {
    return null;
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  const keys = ownKeys(value);
  for (let index = 0; index < keys.length; index++) {
    const descriptor = getOwnPropertyDescriptor(value, keys[index]);
    if (descriptor && hasOwn(descriptor, 'value')) deepFreeze(descriptor.value);
  }
  return freeze(value);
}

// Compare independently supplied aggregate receipts. This does not calculate pay,
// authorise a release, verify source identity, or assert realised savings.
module.exports = function comparePayrollReleaseVariance(input) {
  const blocked = reason => deepFreeze({ status: 'BLOCKED', reason, sourceAuthenticated: false, executionAuthority: false });
  const root = inertRecord(input, rootFields, key => key === 'approved' || key === 'released');
  if (!root || !id(root.tenantId) || !id(root.siteId) || !id(root.periodId) || !id(root.batchId) ||
      typeof root.currency !== 'string' || !/^[A-Z]{3}$/.test(root.currency) || time(root.asOf) === null)
    return blocked('SCOPE_INVALID');
  const approved = inertRecord(root.approved, common);
  const released = inertRecord(root.released, [...common,'exportSha256']);
  if (!approved || !released) return blocked('RECEIPT_SHAPE_INVALID');
  for (const [receipt, kind] of [[approved,'APPROVAL_LEDGER'],[released,'PAYROLL_EXPORT']]) {
    if (receipt.sourceKind !== kind || !id(receipt.sourceId) || !id(receipt.sourceRevision) ||
        !id(receipt.evidenceRef) || receipt.final !== true ||
        receipt.tenantId !== root.tenantId || receipt.siteId !== root.siteId || receipt.periodId !== root.periodId ||
        receipt.batchId !== root.batchId || receipt.currency !== root.currency) return blocked('RECEIPT_SCOPE_INVALID');
    if (!Number.isSafeInteger(receipt.rowCount) || receipt.rowCount < 0 || receipt.rowCount > 1000000 ||
        !money(receipt.grossPence) || !money(receipt.oncostPence) || !money(receipt.totalPence) ||
        !Number.isSafeInteger(receipt.grossPence + receipt.oncostPence) ||
        receipt.grossPence + receipt.oncostPence !== receipt.totalPence) return blocked('RECEIPT_TOTAL_INVALID');
  }
  if (approved.sourceId === released.sourceId || approved.evidenceRef === released.evidenceRef) return blocked('SOURCES_NOT_DISTINCT');
  const approvalTime = time(approved.eventAt), releaseTime = time(released.eventAt);
  const approvalObserved = time(approved.observedAt), releaseObserved = time(released.observedAt);
  if (approvalTime === null || releaseTime === null || approvalObserved === null || releaseObserved === null ||
      !(approvalTime <= approvalObserved && approvalObserved <= time(root.asOf) &&
        releaseTime <= releaseObserved && releaseObserved <= time(root.asOf) && approvalTime <= releaseTime))
    return blocked('RECEIPT_TIME_INVALID');
  if (typeof released.exportSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(released.exportSha256))
    return blocked('EXPORT_HASH_INVALID');
  const variancePence = { gross: released.grossPence - approved.grossPence,
    oncost: released.oncostPence - approved.oncostPence,
    total: released.totalPence - approved.totalPence };
  const rowCountDifference = released.rowCount - approved.rowCount;
  return deepFreeze({ status: rowCountDifference === 0 && variancePence.total === 0 && variancePence.gross === 0 &&
    variancePence.oncost === 0 ? 'MATCHED' : 'REVIEW_REQUIRED',
    tenantId: root.tenantId, siteId: root.siteId, periodId: root.periodId, batchId: root.batchId,
    currency: root.currency, variancePence, rowCountDifference, claimedSavingsPence: null,
    evidenceRefs: [approved.evidenceRef, released.evidenceRef], exportSha256: released.exportSha256,
    claimBoundary: 'AGGREGATE_VARIANCE_ONLY_NOT_PAYROLL_ACCURACY',
    employeeDataIncluded: false, sourceAuthenticated: false, executionAuthority: false });
};
