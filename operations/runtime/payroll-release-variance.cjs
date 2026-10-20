'use strict';

const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const id = value => typeof value === 'string' && ID.test(value);
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
};
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && Object.keys(value).every(key => names.includes(key));
const common = ['tenantId','siteId','periodId','batchId','currency','sourceKind','sourceId','sourceRevision',
  'evidenceRef','eventAt','observedAt','final','rowCount','grossPence','oncostPence','totalPence'];
const rootFields = ['tenantId','siteId','periodId','batchId','currency','asOf','approved','released'];
const money = value => Number.isSafeInteger(value) && value >= 0;

// Compare independently supplied aggregate receipts. This does not calculate pay,
// authorise a release, verify source identity, or assert realised savings.
module.exports = function comparePayrollReleaseVariance(input) {
  const blocked = reason => ({ status: 'BLOCKED', reason, sourceAuthenticated: false, executionAuthority: false });
  if (!exact(input, rootFields) || !['tenantId','siteId','periodId','batchId'].every(key => id(input[key])) ||
      !/^[A-Z]{3}$/.test(input.currency || '') || time(input.asOf) === null) return blocked('SCOPE_INVALID');
  const { approved, released } = input;
  if (!exact(approved, common) || !exact(released, [...common,'exportSha256'])) return blocked('RECEIPT_SHAPE_INVALID');
  for (const [receipt, kind] of [[approved,'APPROVAL_LEDGER'],[released,'PAYROLL_EXPORT']]) {
    if (receipt.sourceKind !== kind || !id(receipt.sourceId) || !id(receipt.sourceRevision) ||
        !id(receipt.evidenceRef) || receipt.final !== true ||
        !['tenantId','siteId','periodId','batchId','currency'].every(key => receipt[key] === input[key])) return blocked('RECEIPT_SCOPE_INVALID');
    if (!Number.isSafeInteger(receipt.rowCount) || receipt.rowCount < 0 || receipt.rowCount > 1000000 ||
        !money(receipt.grossPence) || !money(receipt.oncostPence) || !money(receipt.totalPence) ||
        !Number.isSafeInteger(receipt.grossPence + receipt.oncostPence) ||
        receipt.grossPence + receipt.oncostPence !== receipt.totalPence) return blocked('RECEIPT_TOTAL_INVALID');
  }
  if (approved.sourceId === released.sourceId || approved.evidenceRef === released.evidenceRef) return blocked('SOURCES_NOT_DISTINCT');
  const approvalTime = time(approved.eventAt), releaseTime = time(released.eventAt);
  const approvalObserved = time(approved.observedAt), releaseObserved = time(released.observedAt);
  if (approvalTime === null || releaseTime === null || approvalObserved === null || releaseObserved === null ||
      !(approvalTime <= approvalObserved && approvalObserved <= time(input.asOf) &&
        releaseTime <= releaseObserved && releaseObserved <= time(input.asOf) && approvalTime <= releaseTime))
    return blocked('RECEIPT_TIME_INVALID');
  if (!/^[a-f0-9]{64}$/.test(released.exportSha256 || '')) return blocked('EXPORT_HASH_INVALID');
  const variancePence = { gross: released.grossPence - approved.grossPence,
    oncost: released.oncostPence - approved.oncostPence,
    total: released.totalPence - approved.totalPence };
  const rowCountDifference = released.rowCount - approved.rowCount;
  return { status: rowCountDifference === 0 && variancePence.total === 0 && variancePence.gross === 0 &&
    variancePence.oncost === 0 ? 'MATCHED' : 'REVIEW_REQUIRED',
    tenantId: input.tenantId, siteId: input.siteId, periodId: input.periodId, batchId: input.batchId,
    currency: input.currency, variancePence, rowCountDifference, claimedSavingsPence: null,
    evidenceRefs: [approved.evidenceRef, released.evidenceRef], exportSha256: released.exportSha256,
    claimBoundary: 'AGGREGATE_VARIANCE_ONLY_NOT_PAYROLL_ACCURACY',
    employeeDataIncluded: false, sourceAuthenticated: false, executionAuthority: false };
};
