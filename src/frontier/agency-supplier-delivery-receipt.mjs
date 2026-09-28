import crypto from 'node:crypto';

export const AGENCY_SUPPLIER_DELIVERY_RECEIPT_VERSION = 'agency-supplier-delivery-receipt-v0.1.1';

export const AGENCY_SUPPLIER_DELIVERY_RECEIPT_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS ux_wfm_agency_supplier_deliveries_tenant_delivery
  ON wfm_agency_supplier_deliveries (tenant_id, delivery_id);

CREATE TABLE IF NOT EXISTS wfm_agency_supplier_delivery_receipts (
  tenant_id text NOT NULL,
  provider_key text NOT NULL,
  provider_event_id varchar(200) NOT NULL,
  delivery_id varchar(64) NOT NULL,
  provider_message_ref text,
  attempt_number integer CHECK (attempt_number IS NULL OR attempt_number >= 1),
  channel text NOT NULL CHECK (channel IN ('email','sms','api')),
  normalized_outcome text NOT NULL CHECK (normalized_outcome IN ('confirmed_sent','definitively_not_sent','delivery_failed','informational')),
  event_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  event_fingerprint varchar(16) NOT NULL,
  PRIMARY KEY (tenant_id, provider_key, provider_event_id),
  FOREIGN KEY (tenant_id, delivery_id)
    REFERENCES wfm_agency_supplier_deliveries (tenant_id, delivery_id)
);
`;

const RECONCILE_SQL = `
WITH target AS (
  SELECT tenant_id, delivery_id, site_id, request_id, agency_id, channel, status,
         attempt_count, provider_message_ref, created_at
  FROM wfm_agency_supplier_deliveries
  WHERE tenant_id=$1 AND delivery_id=$4
  FOR UPDATE
), checked AS (
  SELECT *,
    (channel=$7) AS channel_ok,
    (provider_message_ref IS NULL OR ($5::text IS NOT NULL AND provider_message_ref=$5)) AS message_ref_ok,
    ($6 <> 'definitively_not_sent' OR ($11::integer IS NOT NULL AND $11::integer = attempt_count)) AS attempt_ok,
    ($8::timestamptz >= created_at - interval '5 minutes') AS event_time_ok
  FROM target
), inserted AS (
  INSERT INTO wfm_agency_supplier_delivery_receipts
    (tenant_id, provider_key, provider_event_id, delivery_id, provider_message_ref,
     attempt_number, channel, normalized_outcome, event_at, received_at, event_fingerprint)
  SELECT $1,$2,$3,$4,$5,$11,$7,$6,$8,$9,$10
  FROM checked
  WHERE channel_ok AND message_ref_ok AND attempt_ok AND event_time_ok
  ON CONFLICT (tenant_id, provider_key, provider_event_id) DO NOTHING
  RETURNING true AS recorded
), updated AS (
  UPDATE wfm_agency_supplier_deliveries d
  SET status = CASE
        WHEN $6='confirmed_sent' AND d.status IN ('dispatching','unknown','not_sent') THEN 'sent'
        WHEN $6='definitively_not_sent' AND d.status='unknown' THEN 'not_sent'
        ELSE d.status
      END,
      provider_message_ref = COALESCE(d.provider_message_ref,$5),
      updated_at = GREATEST(d.updated_at, $9::timestamptz)
  WHERE d.tenant_id=$1 AND d.delivery_id=$4
    AND EXISTS (SELECT 1 FROM inserted)
  RETURNING d.status, d.attempt_count, d.provider_message_ref,
            d.site_id, d.request_id, d.agency_id, d.channel
)
SELECT
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'delivery_not_found'
    WHEN EXISTS (SELECT 1 FROM checked WHERE NOT channel_ok) THEN 'channel_mismatch'
    WHEN EXISTS (SELECT 1 FROM checked WHERE NOT message_ref_ok) THEN 'provider_message_ref_mismatch'
    WHEN EXISTS (SELECT 1 FROM checked WHERE NOT attempt_ok) THEN 'attempt_mismatch'
    WHEN EXISTS (SELECT 1 FROM checked WHERE NOT event_time_ok) THEN 'event_before_delivery'
    WHEN NOT EXISTS (SELECT 1 FROM inserted) THEN 'duplicate_event'
    ELSE 'recorded'
  END AS result,
  (SELECT status FROM target) AS prior_status,
  COALESCE((SELECT status FROM updated),(SELECT status FROM target)) AS status,
  COALESCE((SELECT attempt_count FROM updated),(SELECT attempt_count FROM target)) AS attempt_count,
  COALESCE((SELECT provider_message_ref FROM updated),(SELECT provider_message_ref FROM target)) AS provider_message_ref,
  COALESCE((SELECT site_id FROM updated),(SELECT site_id FROM target)) AS site_id,
  COALESCE((SELECT request_id FROM updated),(SELECT request_id FROM target)) AS request_id,
  COALESCE((SELECT agency_id FROM updated),(SELECT agency_id FROM target)) AS agency_id,
  COALESCE((SELECT channel FROM updated),(SELECT channel FROM target)) AS channel;
`;

const text = (value, max = 200) => typeof value === 'string'
  ? value.trim().replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').slice(0, max)
  : '';
const hasControl = value => typeof value === 'string' && /[\u0000-\u001F\u007F]/.test(value);
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : (value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
      : value);

function requiredString(value, name, max = 200) {
  if (hasControl(value)) throw new TypeError(`${name} contains control characters`);
  const clean = text(value, max + 1);
  if (!clean) throw new TypeError(`${name} is required`);
  if (clean.length > max) throw new TypeError(`${name} is too long`);
  return clean;
}

function optionalString(value, name, max = 200) {
  if (value === null || value === undefined || value === '') return null;
  return requiredString(value, name, max);
}

function requiredIso(value, name) {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be a valid timestamp`);
  return new Date(parsed).toISOString();
}

function rawReceiptBytes(rawBody) {
  let bytes;
  if (Buffer.isBuffer(rawBody)) bytes = rawBody;
  else if (rawBody instanceof Uint8Array) bytes = Buffer.from(rawBody);
  else if (typeof rawBody === 'string') bytes = Buffer.from(rawBody, 'utf8');
  else if (rawBody && typeof rawBody === 'object') bytes = Buffer.from(JSON.stringify(stable(rawBody)), 'utf8');
  else throw new TypeError('rawBody is required');
  if (bytes.length === 0) throw new TypeError('rawBody is required');
  if (bytes.length > 262144) throw new TypeError('rawBody exceeds 256 KiB');
  return bytes;
}

function eventFingerprint(rawBody) {
  return crypto.createHash('sha256').update(rawReceiptBytes(rawBody)).digest('hex').slice(0, 16);
}

function normalizeHeaders(headers = {}) {
  const out = new Map();
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    for (const [key, value] of headers.entries()) out.set(key.toLowerCase(), String(value));
    return out;
  }
  for (const [key, value] of Object.entries(headers || {})) {
    if (Array.isArray(value)) out.set(String(key).toLowerCase(), value.join(','));
    else if (value !== undefined && value !== null) out.set(String(key).toLowerCase(), String(value));
  }
  return out;
}

function normalizeVerifiedEvent(event = {}, receivedAt) {
  const providerKey = requiredString(event.providerKey, 'providerKey', 80).toLowerCase();
  const providerEventId = requiredString(event.providerEventId, 'providerEventId', 200);
  const deliveryId = requiredString(event.deliveryId, 'deliveryId', 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(deliveryId)) throw new TypeError('deliveryId must be a 64 character hex digest');
  const channel = requiredString(event.channel, 'channel', 20).toLowerCase();
  if (!['email','sms','api'].includes(channel)) throw new TypeError('channel must be email, sms or api');
  const normalizedOutcome = requiredString(event.normalizedOutcome, 'normalizedOutcome', 40).toLowerCase();
  if (!['confirmed_sent','definitively_not_sent','delivery_failed','informational'].includes(normalizedOutcome)) {
    throw new TypeError('normalizedOutcome is not supported');
  }
  const providerMessageRef = optionalString(event.providerMessageRef, 'providerMessageRef', 200);
  const attemptNumber = event.attemptNumber === null || event.attemptNumber === undefined ? null : Number(event.attemptNumber);
  if (attemptNumber !== null && (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 1000)) throw new TypeError('attemptNumber must be a positive integer');
  if (normalizedOutcome === 'definitively_not_sent' && attemptNumber === null) throw new TypeError('attemptNumber is required for definitively_not_sent');
  const eventAt = requiredIso(event.eventAt, 'eventAt');
  if (Date.parse(eventAt) > Date.parse(receivedAt) + 5 * 60 * 1000) throw new TypeError('eventAt is too far in the future');
  return {providerKey, providerEventId, deliveryId, providerMessageRef, attemptNumber, channel, normalizedOutcome, eventAt};
}

function auditResult({tenantId, event = null, fingerprint = null, storeResult = null, reconciled = false, reason = null, receivedAt = null} = {}) {
  return {
    version: AGENCY_SUPPLIER_DELIVERY_RECEIPT_VERSION,
    reconciled,
    reason,
    duplicate: storeResult?.result === 'duplicate_event',
    transitionApplied: storeResult?.priorStatus != null && storeResult?.status != null && storeResult.priorStatus !== storeResult.status,
    tenantId: tenantId ?? null,
    siteId: storeResult?.siteId ?? null,
    requestId: storeResult?.requestId ?? null,
    agencyId: storeResult?.agencyId ?? null,
    deliveryId: event?.deliveryId ?? null,
    channel: storeResult?.channel ?? event?.channel ?? null,
    providerKey: event?.providerKey ?? null,
    providerEventId: event?.providerEventId ?? null,
    attemptNumber:event?.attemptNumber ?? null,
    providerMessageRefFingerprint: event?.providerMessageRef
      ? crypto.createHash('sha256').update(event.providerMessageRef).digest('hex').slice(0,16)
      : null,
    eventFingerprint: fingerprint,
    normalizedOutcome: event?.normalizedOutcome ?? null,
    priorStatus: storeResult?.priorStatus ?? null,
    status: storeResult?.status ?? null,
    attemptCount: storeResult?.attemptCount ?? null,
    eventAt: event?.eventAt ?? null,
    receivedAt,
    containsRawReceipt:false,
    containsRawDestination:false,
    containsRawPortalUrl:false,
    containsWorkerPersonalData:false,
    authorityBoundary:'supplier_delivery_receipt_reconciliation_only_no_send_schedule_payroll_or_invoice_mutation',
  };
}

export function createHmacSha256ReceiptVerifier({providerKey, secret, parseEvent, signatureHeader='x-wfm-signature-sha256'} = {}) {
  const key = requiredString(providerKey, 'providerKey', 80).toLowerCase();
  if (typeof parseEvent !== 'function') throw new TypeError('parseEvent function is required');
  const secretBytes = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret ?? ''), 'utf8');
  if (secretBytes.length < 32) throw new TypeError('receipt HMAC secret must be at least 32 bytes');
  const headerName = requiredString(signatureHeader, 'signatureHeader', 100).toLowerCase();

  return Object.freeze({
    providerKey:key,
    async verify({rawBody, headers} = {}) {
      if (!(typeof rawBody === 'string' || Buffer.isBuffer(rawBody) || rawBody instanceof Uint8Array)) return {verified:false, event:null};
      const bytes = rawReceiptBytes(rawBody);
      const suppliedRaw = normalizeHeaders(headers).get(headerName) ?? '';
      const supplied = suppliedRaw.toLowerCase().startsWith('sha256=') ? suppliedRaw.slice(7) : suppliedRaw;
      if (!/^[a-fA-F0-9]{64}$/.test(supplied)) return {verified:false, event:null};
      const expected = crypto.createHmac('sha256', secretBytes).update(bytes).digest();
      const actual = Buffer.from(supplied, 'hex');
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return {verified:false, event:null};
      const parsed = await parseEvent({rawBody, headers});
      if (!parsed || typeof parsed !== 'object') throw new TypeError('parseEvent must return an event object');
      return {verified:true, event:{...parsed, providerKey:key}};
    },
  });
}

export function createPostgresAgencySupplierDeliveryReceiptStore({query} = {}) {
  if (typeof query !== 'function') throw new TypeError('query function is required');
  return Object.freeze({
    version:AGENCY_SUPPLIER_DELIVERY_RECEIPT_VERSION,
    async reconcileOnce(record = {}) {
      const values = [
        requiredString(record.tenantId, 'tenantId', 100),
        requiredString(record.providerKey, 'providerKey', 80).toLowerCase(),
        requiredString(record.providerEventId, 'providerEventId', 200),
        requiredString(record.deliveryId, 'deliveryId', 64).toLowerCase(),
        optionalString(record.providerMessageRef, 'providerMessageRef', 200),
        requiredString(record.normalizedOutcome, 'normalizedOutcome', 40).toLowerCase(),
        requiredString(record.channel, 'channel', 20).toLowerCase(),
        requiredIso(record.eventAt, 'eventAt'),
        requiredIso(record.receivedAt, 'receivedAt'),
        requiredString(record.eventFingerprint, 'eventFingerprint', 16).toLowerCase(),
        record.attemptNumber === null || record.attemptNumber === undefined ? null : Number(record.attemptNumber),
      ];
      if (values[10] !== null && (!Number.isInteger(values[10]) || values[10] < 1 || values[10] > 1000)) throw new TypeError('attemptNumber must be a positive integer');
      if (values[5] === 'definitively_not_sent' && values[10] === null) throw new TypeError('attemptNumber is required for definitively_not_sent');
      const result = await query(RECONCILE_SQL, values);
      const row = result?.rows?.[0];
      if (!row) throw new Error('unexpected_receipt_store_result');
      return {
        result:row.result,
        priorStatus:row.prior_status ?? row.priorStatus ?? null,
        status:row.status ?? null,
        attemptCount:row.attempt_count == null && row.attemptCount == null ? null : Number(row.attempt_count ?? row.attemptCount),
        providerMessageRef:row.provider_message_ref ?? row.providerMessageRef ?? null,
        siteId:row.site_id ?? row.siteId ?? null,
        requestId:row.request_id ?? row.requestId ?? null,
        agencyId:row.agency_id ?? row.agencyId ?? null,
        channel:row.channel ?? null,
      };
    },
  });
}

export async function reconcileAgencySupplierDeliveryReceipt({tenantId, rawBody, headers = {}, verifier, receiptStore, receivedAt} = {}) {
  let tenant;
  let at;
  let fingerprint;
  try {
    tenant = requiredString(tenantId, 'tenantId', 100);
    at = requiredIso(receivedAt, 'receivedAt');
    fingerprint = eventFingerprint(rawBody);
  } catch (error) {
    return auditResult({tenantId:text(tenantId,100)||null, reconciled:false, reason:error.message, receivedAt:null});
  }

  const reject = (reason, event = null, storeResult = null) => auditResult({
    tenantId:tenant,
    event,
    fingerprint,
    storeResult,
    reconciled:false,
    reason,
    receivedAt:at,
  });

  if (!verifier || typeof verifier.verify !== 'function') return reject('receipt_verifier_unavailable');
  if (!receiptStore || typeof receiptStore.reconcileOnce !== 'function') return reject('receipt_store_unavailable');

  let verified;
  try {
    verified = await verifier.verify({tenantId:tenant, rawBody, headers, receivedAt:at});
  } catch {
    return reject('receipt_verification_failed');
  }
  if (verified?.verified !== true || !verified.event) return reject('receipt_authentication_failed');

  let event;
  try {
    event = normalizeVerifiedEvent(verified.event, at);
    if (verifier.providerKey && event.providerKey !== String(verifier.providerKey).toLowerCase()) {
      return reject('receipt_provider_scope_mismatch', event);
    }
  } catch (error) {
    return reject(error.message);
  }

  let storeResult;
  try {
    storeResult = await receiptStore.reconcileOnce({tenantId:tenant, ...event, receivedAt:at, eventFingerprint:fingerprint});
  } catch {
    return reject('receipt_store_unavailable', event);
  }

  const rejectedByStore = {
    delivery_not_found:'receipt_delivery_not_found',
    channel_mismatch:'receipt_channel_mismatch',
    provider_message_ref_mismatch:'receipt_provider_message_ref_mismatch',
    attempt_mismatch:'receipt_attempt_mismatch',
    event_before_delivery:'receipt_event_before_delivery',
  };
  if (rejectedByStore[storeResult?.result]) return reject(rejectedByStore[storeResult.result], event, storeResult);
  if (!['recorded','duplicate_event'].includes(storeResult?.result)) return reject('receipt_store_rejected', event, storeResult);

  return auditResult({
    tenantId:tenant,
    event,
    fingerprint,
    storeResult,
    reconciled:true,
    reason:storeResult.result === 'duplicate_event' ? 'duplicate_event' : null,
    receivedAt:at,
  });
}
