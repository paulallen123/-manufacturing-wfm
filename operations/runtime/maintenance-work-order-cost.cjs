'use strict';

const money = require('./payroll-money.cjs')();
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(value);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
const safe = value => Number.isSafeInteger(value) && value >= 0;

// Advisory planned cost only. The caller must supply source-owned CMMS and rate evidence;
// this function neither authenticates a source nor authorises execution or payment.
module.exports = function estimateMaintenanceWorkOrderCost(input) {
  const blocked = reason => ({ status: 'BLOCKED', reason, sourceAuthenticated: false, executionAuthority: false });
  if (!input || typeof input !== 'object') return blocked('INPUT_INVALID');
  const { scope, workOrder: order, segments } = input;
  if (!scope || !order || !Array.isArray(segments) || !segments.length || segments.length > 128) return blocked('INPUT_INVALID');
  if (!['tenantId', 'siteId', 'assetId', 'workOrderId'].every(key => id(scope[key])) ||
      !/^[A-Z]{3}$/.test(scope.currency || '') || !Number.isFinite(time(scope.asOf))) return blocked('SCOPE_INVALID');
  if (order.tenantId !== scope.tenantId || order.siteId !== scope.siteId || order.assetId !== scope.assetId || order.id !== scope.workOrderId) return blocked('SCOPE_MISMATCH');
  if (order.status !== 'OPEN' || !id(order.revision) || !id(order.evidenceRef) ||
      !(time(order.observedAt) <= time(scope.asOf) && time(scope.asOf) < time(order.validUntil)) ||
      !(time(order.start) < time(order.end))) return blocked('WORK_ORDER_UNPROVEN');

  const totals = { internal: 0, contractor: 0 };
  const refs = [order.evidenceRef];
  const seen = new Set();
  for (const segment of segments) {
    if (!segment || !id(segment.id) || seen.has(segment.id) ||
        !['INTERNAL', 'CONTRACTOR'].includes(segment.kind) || !id(segment.roleId) ||
        ['employeeId', 'workerId', 'personId', 'name', 'email'].some(key => key in segment)) return blocked('SEGMENT_INVALID');
    seen.add(segment.id);
    const start = time(segment.start), end = time(segment.end);
    if (!(start >= time(order.start) && start < end && end <= time(order.end))) return blocked('SEGMENT_WINDOW_INVALID');
    const rate = segment.rate;
    if (!rate || rate.tenantId !== scope.tenantId || rate.siteId !== scope.siteId ||
        rate.roleId !== segment.roleId ||
        rate.sourceKind !== (segment.kind === 'INTERNAL' ? 'INTERNAL_RATE_CARD' : 'CONTRACTOR_RATE_CARD') ||
        rate.currency !== scope.currency || !id(rate.revision) || !id(rate.evidenceRef) ||
        !(time(rate.observedAt) <= time(scope.asOf) && time(rate.validFrom) <= start && end <= time(rate.validUntil)) ||
        typeof rate.hourly !== 'number' || !Number.isFinite(rate.hourly) || rate.hourly < 0 ||
        ['employeeId', 'workerId', 'personId', 'name', 'email'].some(key => key in rate)) return blocked('RATE_UNPROVEN');
    let amount;
    try { amount = money.components({ durationMs: end - start, rate: rate.hourly }).totalPence; }
    catch { return blocked('COST_INVALID'); }
    const key = segment.kind === 'INTERNAL' ? 'internal' : 'contractor';
    totals[key] += amount;
    if (!safe(totals[key])) return blocked('COST_INVALID');
    refs.push(rate.evidenceRef);
  }
  const total = totals.internal + totals.contractor;
  if (!safe(total)) return blocked('COST_INVALID');
  return { status: 'ESTIMATED', tenantId: scope.tenantId, siteId: scope.siteId, assetId: scope.assetId,
    workOrderId: scope.workOrderId, workOrderRevision: order.revision, currency: scope.currency,
    costPence: { ...totals, total }, evidenceRefs: [...new Set(refs)],
    sourceAuthenticated: false, executionAuthority: false };
};
