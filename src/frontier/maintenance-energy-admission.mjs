import { evaluateEnergyFlexibility } from './energy-flexibility.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const positive = value => Number.isSafeInteger(value) && value > 0;
const confidence = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

// Admission wrapper around the existing energy engine. Source authenticity and
// approval stay with the canonical integration owner and workflow controller.
export function assessMaintenanceEnergySwap(input) {
  const blocked = reason => Object.freeze({ status: 'BLOCKED', reasons: Object.freeze([reason]),
    sourceAuthenticated: false, actionAuthority: false });
  if (!input || !text(input.tenantId) || !text(input.siteId)) return blocked('invalid_scope');
  const now = instant(input.now);
  if (now === null) return blocked('invalid_as_of');
  const wo = input.workOrder, signal = input.energySignal, option = input.option, process = input.process;
  if (!wo || !signal || !option || !process ||
      wo.tenantId !== input.tenantId || wo.siteId !== input.siteId ||
      signal.tenantId !== input.tenantId || signal.siteId !== input.siteId ||
      process.tenantId !== input.tenantId || process.siteId !== input.siteId ||
      option.tenantId !== input.tenantId || option.siteId !== input.siteId) return blocked('source_scope_mismatch');
  if (!text(wo.id) || !text(wo.assetId) || !text(wo.sourceName) || !text(wo.sourceDigest) ||
      !positive(wo.revision) || wo.status !== 'OPEN') return blocked('work_order_not_current');
  if (process.assetId !== wo.assetId || process.workOrderId !== wo.id ||
      process.workOrderRevision !== wo.revision) return blocked('process_binding_mismatch');
  const processObserved = instant(process.observedAt);
  if (!text(process.sourceName) || !text(process.sourceDigest) || !positive(process.revision) ||
      processObserved === null || processObserved > now || now - processObserved > 15 * 60000) {
    return blocked('process_evidence_not_current');
  }
  if (option.kind !== 'maintenance_swap' || !text(option.id) || option.approvalRequired !== true ||
      option.workOrderId !== wo.id || option.workOrderRevision !== wo.revision || option.assetId !== wo.assetId) {
    return blocked('work_order_binding_mismatch');
  }
  const workforce = option.workforce;
  if (!workforce || workforce.restCompliant !== true || workforce.qualificationsValid !== true ||
      !Number.isSafeInteger(workforce.staffingCount) || !Number.isSafeInteger(workforce.minimumStaffing) ||
      workforce.staffingCount < 0 || workforce.minimumStaffing < 0) return blocked('workforce_evidence_incomplete');
  if (!confidence(signal.confidence) || !confidence(process.confidence) ||
      !confidence(workforce.confidence)) return blocked('confidence_evidence_invalid');
  const observed = instant(wo.observedAt), allowedStart = instant(wo.allowedStart), allowedEnd = instant(wo.allowedEnd);
  const proposedStart = instant(option.proposedStart), proposedEnd = instant(option.proposedEnd);
  const published = instant(signal.publishedAt), freshUntil = instant(signal.freshUntil);
  const energyStart = instant(signal.windowStart), energyEnd = instant(signal.windowEnd);
  if ([observed, allowedStart, allowedEnd, proposedStart, proposedEnd, published, freshUntil, energyStart, energyEnd].some(x => x === null) ||
      observed > now || now - observed > 15 * 60000 || published > now || freshUntil < proposedEnd ||
      !(allowedStart < allowedEnd && proposedStart < proposedEnd && energyStart < energyEnd) ||
      proposedStart < now ||
      proposedStart < allowedStart || proposedEnd > allowedEnd ||
      proposedStart < energyStart || proposedEnd > energyEnd) return blocked('invalid_or_out_of_window_evidence');
  if (signal.status !== 'active' || !positive(signal.revision)) return blocked('energy_signal_not_active');
  const decision = evaluateEnergyFlexibility({
    now: input.now, tenantId: input.tenantId, siteId: input.siteId,
    energySignal: signal, latestKnownSignalRevision: signal.revision,
    process, options: [option]
  });
  const ranked = decision.rankedOptions.find(row => row.id === option.id);
  if (!ranked) {
    const rejected = decision.rejectedOptions.find(row => row.id === option.id);
    return Object.freeze({ status: 'BLOCKED', reasons: Object.freeze(rejected?.hardConstraintFailures?.length
      ? [...rejected.hardConstraintFailures] : ['no_safe_valuable_maintenance_swap']),
    sourceAuthenticated: false, actionAuthority: false });
  }
  return Object.freeze({ status: 'ADVISORY', workOrderId: wo.id, workOrderRevision: wo.revision,
    assetId: wo.assetId, optionId: option.id, energySignalRevision: signal.revision,
    sourceName: wo.sourceName, sourceDigest: wo.sourceDigest,
    energyDecisionHash: decision.reproducibilityHash,
    sourceAuthenticated: false, actionAuthority: false });
}
