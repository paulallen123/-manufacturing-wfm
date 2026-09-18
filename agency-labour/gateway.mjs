import { createHash } from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stable(value[key]);
      return out;
    }, {});
  }
  return value;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function positiveInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Creates the smallest useful supplier demand message. The agency receives a reference to
 * the approved assignment pack instead of a new copy of all site/role/safety data each time.
 */
export function buildAgencyDemandEnvelope({ requirement, pack, supplier, responseDeadlineAt, issuedAt = new Date().toISOString() }) {
  if (!requirement?.id || !requirement?.role || !positiveInt(requirement?.headcount)) {
    throw new Error('requirement.id, requirement.role and positive requirement.headcount are required');
  }
  if (!pack?.complete || !pack?.versionHash || !pack?.packId) throw new Error('complete assignment pack is required');
  if (!supplier?.id) throw new Error('supplier.id is required');

  const demand = {
    schema: 'agency-demand.v1',
    demandId: requirement.id,
    supplierId: supplier.id,
    packRef: { packId: pack.packId, versionHash: pack.versionHash },
    role: requirement.role,
    headcount: requirement.headcount,
    shiftStart: requirement.shiftStart,
    shiftEnd: requirement.shiftEnd,
    siteId: requirement.siteId ?? pack.canonical?.site?.id ?? null,
    billRate: supplier.billRate ?? null,
    responseDeadlineAt: responseDeadlineAt ?? null,
    issuedAt
  };

  return {
    ...demand,
    idempotencyKey: `demand:${supplier.id}:${requirement.id}:${pack.versionHash}`,
    payloadHash: hash(demand),
    workerDataIncluded: false,
    principle: 'Send the requirement plus assignment-pack reference; transmit unchanged site/role/safety data only once.'
  };
}

/**
 * Normalises API, portal or CSV supplier replies into one idempotent response contract.
 */
export function normaliseCapacityResponse({ demand, response }) {
  if (!demand?.demandId || !demand?.supplierId) throw new Error('valid demand is required');
  const status = cleanString(response?.status).toUpperCase();
  if (!['ACCEPTED', 'PARTIAL', 'DECLINED'].includes(status)) throw new Error('response.status must be ACCEPTED, PARTIAL or DECLINED');

  const requested = positiveInt(demand.headcount);
  let acceptedHeadcount = status === 'DECLINED' ? 0 : positiveInt(response?.acceptedHeadcount, status === 'ACCEPTED' ? requested : 0);
  acceptedHeadcount = Math.min(requested, acceptedHeadcount);
  if (status === 'ACCEPTED' && acceptedHeadcount !== requested) throw new Error('ACCEPTED must cover the full requested headcount');
  if (status === 'PARTIAL' && (acceptedHeadcount <= 0 || acceptedHeadcount >= requested)) throw new Error('PARTIAL must accept between 1 and requestedHeadcount-1');

  const externalResponseId = cleanString(response?.externalResponseId) || hash({
    supplierId: demand.supplierId,
    demandId: demand.demandId,
    status,
    acceptedHeadcount,
    respondedAt: response?.respondedAt ?? null
  }).slice(0, 24);

  const event = {
    schema: 'agency-capacity-response.v1',
    supplierId: demand.supplierId,
    demandId: demand.demandId,
    status,
    acceptedHeadcount,
    reasonCode: cleanString(response?.reasonCode) || null,
    respondedAt: response?.respondedAt ?? new Date().toISOString(),
    externalResponseId,
    source: cleanString(response?.source).toUpperCase() || 'API'
  };

  return {
    ...event,
    idempotencyKey: `capacity:${demand.supplierId}:${externalResponseId}`,
    payloadHash: hash(event),
    remainingHeadcount: Math.max(0, requested - acceptedHeadcount)
  };
}

/**
 * Accepts the minimum worker-level data needed to nominate a person for an allocated vacancy.
 * Identity documents and unnecessary special-category data are explicitly excluded from the envelope.
 */
export function normaliseWorkerNominations({ demand, nominations = [], packVersionHash, source = 'API' }) {
  if (!demand?.demandId || !demand?.supplierId) throw new Error('valid demand is required');
  if (!packVersionHash || packVersionHash !== demand.packRef?.versionHash) throw new Error('current assignment pack version is required');

  const seen = new Set();
  const accepted = [];
  const rejected = [];

  nominations.forEach((n, index) => {
    const supplierWorkerId = cleanString(n?.supplierWorkerId);
    const rowRef = n?.externalNominationId ?? `row-${index + 1}`;
    const gaps = [];
    if (!supplierWorkerId) gaps.push('SUPPLIER_WORKER_ID_MISSING');
    if (seen.has(supplierWorkerId)) gaps.push('DUPLICATE_WORKER_IN_BATCH');
    if (n?.sharingAuthorityConfirmed !== true) gaps.push('SHARING_AUTHORITY_NOT_CONFIRMED');
    if (n?.availabilityConfirmed !== true) gaps.push('WORKER_AVAILABILITY_NOT_CONFIRMED');
    if (n?.mandatoryCompliancePassed !== true) gaps.push('MANDATORY_COMPLIANCE_NOT_PASSED');
    if (n?.rawIdentityDocument || n?.healthData || n?.protectedCharacteristicData) gaps.push('PROHIBITED_EXCESS_DATA_INCLUDED');

    if (gaps.length) {
      rejected.push({ rowRef, supplierWorkerId: supplierWorkerId || null, gaps });
      return;
    }

    seen.add(supplierWorkerId);
    const event = {
      schema: 'agency-worker-nomination.v1',
      demandId: demand.demandId,
      supplierId: demand.supplierId,
      supplierWorkerId,
      displayName: cleanString(n?.displayName) || null,
      externalNominationId: cleanString(n?.externalNominationId) || `${demand.demandId}:${supplierWorkerId}`,
      packVersionHash,
      roleSkills: Array.isArray(n?.roleSkills) ? n.roleSkills.filter(Boolean) : [],
      certificationStatus: Array.isArray(n?.certificationStatus) ? n.certificationStatus : [],
      availabilityConfirmed: true,
      mandatoryCompliancePassed: true,
      sharingAuthorityConfirmed: true,
      source: cleanString(source).toUpperCase() || 'API',
      nominatedAt: n?.nominatedAt ?? new Date().toISOString()
    };
    accepted.push({
      ...event,
      idempotencyKey: `nomination:${demand.supplierId}:${event.externalNominationId}`,
      payloadHash: hash(event)
    });
  });

  return {
    demandId: demand.demandId,
    accepted,
    rejected,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    principle: 'Store supplier worker references and job-relevant status; keep raw identity/compliance documents in the responsible source system unless specifically required.'
  };
}

/**
 * Portal/CSV fallback uses the exact same contract as API integrations, so customers can start
 * without an integration project and migrate to ATS connectivity later without changing workflow.
 */
export function ingestNominationRows({ demand, rows = [], packVersionHash }) {
  const mapped = rows.map((row, index) => ({
    externalNominationId: row.externalNominationId ?? row.nomination_id ?? `csv-${index + 1}`,
    supplierWorkerId: row.supplierWorkerId ?? row.worker_id,
    displayName: row.displayName ?? row.worker_name ?? null,
    sharingAuthorityConfirmed: row.sharingAuthorityConfirmed === true || String(row.sharing_authority ?? '').toLowerCase() === 'yes',
    availabilityConfirmed: row.availabilityConfirmed === true || String(row.available ?? '').toLowerCase() === 'yes',
    mandatoryCompliancePassed: row.mandatoryCompliancePassed === true || String(row.compliance_passed ?? '').toLowerCase() === 'yes',
    roleSkills: Array.isArray(row.roleSkills) ? row.roleSkills : cleanString(row.skills).split('|').map(x => x.trim()).filter(Boolean),
    certificationStatus: Array.isArray(row.certificationStatus) ? row.certificationStatus : [],
    nominatedAt: row.nominatedAt ?? null
  }));
  return normaliseWorkerNominations({ demand, nominations: mapped, packVersionHash, source: 'CSV' });
}

/**
 * De-duplicates retries across webhooks, API calls and portal submissions. Replays with the same
 * key and same payload are safe; the same key with different data is surfaced as a conflict.
 */
export function deduplicateGatewayEvents(events = []) {
  const firstByKey = new Map();
  const accepted = [];
  const duplicates = [];
  const conflicts = [];

  for (const event of events) {
    if (!event?.idempotencyKey || !event?.payloadHash) {
      conflicts.push({ idempotencyKey: event?.idempotencyKey ?? null, reason: 'IDEMPOTENCY_METADATA_MISSING' });
      continue;
    }
    const prior = firstByKey.get(event.idempotencyKey);
    if (!prior) {
      firstByKey.set(event.idempotencyKey, event);
      accepted.push(event);
    } else if (prior.payloadHash === event.payloadHash) {
      duplicates.push({ idempotencyKey: event.idempotencyKey, action: 'ACKNOWLEDGE_RETRY_WITHOUT_REPROCESSING' });
    } else {
      conflicts.push({ idempotencyKey: event.idempotencyKey, reason: 'SAME_IDEMPOTENCY_KEY_DIFFERENT_PAYLOAD', action: 'REJECT_AND_AUDIT' });
    }
  }

  return { accepted, duplicates, conflicts, safeToProcess: conflicts.length === 0 };
}

export function assessAgencyGatewayReadiness(supplier = {}) {
  const modes = [];
  if (supplier.apiEnabled) modes.push('API');
  if (supplier.webhookEnabled) modes.push('WEBHOOK');
  if (supplier.portalEnabled !== false) modes.push('PORTAL');
  if (supplier.csvEnabled !== false) modes.push('CSV');

  const blockers = [];
  if (!supplier.id) blockers.push('SUPPLIER_ID_MISSING');
  if (!modes.length) blockers.push('NO_FULFILMENT_CHANNEL_ENABLED');
  if (supplier.apiEnabled && !supplier.externalSystemName) blockers.push('ATS_SYSTEM_NOT_IDENTIFIED');
  if (supplier.apiEnabled && supplier.credentialsConfigured !== true) blockers.push('API_CREDENTIALS_NOT_CONFIGURED');

  return {
    supplierId: supplier.id ?? null,
    modes,
    touchlessChannelAvailable: blockers.length === 0 && (modes.includes('API') || modes.includes('WEBHOOK')),
    fallbackChannelAvailable: modes.includes('PORTAL') || modes.includes('CSV'),
    blockers,
    action: blockers.length ? 'COMPLETE_SUPPLIER_ONBOARDING' : 'READY_FOR_DEMAND'
  };
}
