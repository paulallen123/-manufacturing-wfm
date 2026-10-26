'use strict';

// Declared estimate only. Upstream must authenticate CMMS and price-list receipts.
const SHA = /^[0-9a-f]{64}$/;
function fail(code) { throw new Error(code); }
function id(x) { return typeof x === 'string' && x.length > 0 && x.length <= 160 && x.trim() === x; }
function time(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)) fail('INVALID_TIME');
  const n = Date.parse(x);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== x) fail('INVALID_TIME');
  return n;
}
function source(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || !id(x.source) ||
    !id(x.recordId) || !id(x.revision) || typeof x.recordSha256 !== 'string' ||
    !SHA.test(x.recordSha256)) fail('INVALID_SOURCE');
}
function scoped(x, input) {
  if (x.tenantId !== input.tenantId || x.siteId !== input.siteId) fail('SCOPE_MISMATCH');
}
function estimateMaintenancePartsCost(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !id(input.tenantId) || !id(input.siteId) || !id(input.workOrderId) ||
    typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) fail('INVALID_SCOPE');
  const asOf = time(input.asOf), order = input.workOrder;
  source(order); scoped(order, input);
  if (order.workOrderId !== input.workOrderId || order.state !== 'OPEN' ||
    !Array.isArray(order.requiredParts) || order.requiredParts.length < 1 ||
    order.requiredParts.length > 1000) fail('INVALID_WORK_ORDER');
  const eventAt = time(order.eventAt), observedAt = time(order.observedAt);
  if (eventAt > observedAt || observedAt > asOf) fail('WORK_ORDER_CHRONOLOGY');
  if (!Array.isArray(input.prices) || input.prices.length !== order.requiredParts.length) fail('PRICE_SET_MISMATCH');
  const quantities = new Map(), priceByPart = new Map(), sourceKeys = new Set();
  const sourceHashes = new Set([order.recordSha256]);
  for (const part of order.requiredParts) {
    if (!part || !id(part.partId) || !Number.isSafeInteger(part.quantity) ||
      part.quantity < 1 || part.quantity > 1000000 || quantities.has(part.partId)) fail('INVALID_REQUIRED_PART');
    quantities.set(part.partId, part.quantity);
  }
  for (const price of input.prices) {
    source(price); scoped(price, input);
    const sourceKey = price.source + '\u0000' + price.recordId + '\u0000' + price.revision;
    if (!id(price.partId) || !quantities.has(price.partId) || priceByPart.has(price.partId) ||
      sourceKeys.has(sourceKey) || sourceHashes.has(price.recordSha256) || price.currency !== input.currency ||
      !Number.isSafeInteger(price.unitCostPence) || price.unitCostPence < 0) fail('INVALID_PRICE');
    const from = time(price.effectiveFrom), to = time(price.effectiveTo), seen = time(price.observedAt);
    if (from >= to || from > asOf || to <= asOf || seen > asOf) fail('PRICE_NOT_CURRENT');
    sourceKeys.add(sourceKey);
    sourceHashes.add(price.recordSha256);
    priceByPart.set(price.partId, { unitCostPence: price.unitCostPence, hash: price.recordSha256 });
  }
  let total = 0n;
  const priceRecordSha256 = [];
  for (const [partId, quantity] of quantities) {
    const price = priceByPart.get(partId);
    if (!price) fail('PRICE_SET_MISMATCH');
    total += BigInt(quantity) * BigInt(price.unitCostPence);
    priceRecordSha256.push(price.hash);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail('COST_OVERFLOW');
  return Object.freeze({
    tenantId: input.tenantId, siteId: input.siteId, workOrderId: input.workOrderId,
    currency: input.currency, declaredPlannedPartsCostPence: Number(total),
    partLineCount: quantities.size, workOrderRecordSha256: order.recordSha256,
    priceRecordSha256: Object.freeze(priceRecordSha256),
    claimBoundary: 'DECLARED_PLANNED_PARTS_COST_NOT_INVOICE_OR_SAVINGS',
    sourceAuthenticated: false, inventoryReserved: false, invoiceAuthority: false,
    payrollAuthority: false, executionAuthority: false
  });
}
module.exports = { estimateMaintenancePartsCost };
