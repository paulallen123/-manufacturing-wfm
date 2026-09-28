import crypto from 'node:crypto';

export const AGENCY_SUPPLIER_DELIVERY_RECONCILIATION_VERSION = 'agency-supplier-delivery-reconciliation-v0.1.0';

export const AGENCY_SUPPLIER_DELIVERY_RECONCILIATION_DDL = `
CREATE TABLE IF NOT EXISTS wfm_agency_supplier_delivery_receipts (
  tenant_id text NOT NULL,
  idempotency_key varchar(64) NOT NULL,
  receipt_fingerprint varchar(64) NOT NULL,
  verification_source text NOT NULL CHECK (verification_source IN ('provider_callback','provider_lookup')),
  resolved_status text NOT NULL CHECK (resolved_status IN ('sent','not_sent')),
  provider_message_ref text,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key, receipt_fingerprint)
);
CREATE OR REPLACE FUNCTION wfm_agency_supplier_delivery_receipts_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agency supplier delivery receipt evidence is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS wfm_agency_supplier_delivery_receipts_no_update ON wfm_agency_supplier_delivery_receipts;
CREATE TRIGGER wfm_agency_supplier_delivery_receipts_no_update
BEFORE UPDATE OR DELETE ON wfm_agency_supplier_delivery_receipts
FOR EACH ROW EXECUTE FUNCTION wfm_agency_supplier_delivery_receipts_immutable();
`;

const SELECT_DELIVERY_SQL = `
SELECT tenant_id, idempotency_key, delivery_id, site_id, request_id, agency_id, channel,
       delivery_revision, status, attempt_count, provider_message_ref, created_at, updated_at
FROM wfm_agency_supplier_deliveries
WHERE tenant_id=$1 AND idempotency_key=$2
LIMIT 1;
`;

const APPLY_RECEIPT_SQL = `
WITH updated AS (
  UPDATE wfm_agency_supplier_deliveries
  SET status=$3,
      provider_message_ref=COALESCE(provider_message_ref,$4),
      updated_at=$5
  WHERE tenant_id=$1
    AND idempotency_key=$2
    AND status IN ('unknown','dispatching')
    AND (provider_message_ref IS NULL OR $4 IS NULL OR provider_message_ref=$4)
  RETURNING tenant_id,idempotency_key,delivery_id,site_id,request_id,agency_id,channel,
            delivery_revision,status,attempt_count,provider_message_ref,created_at,updated_at
), receipt AS (
  INSERT INTO wfm_agency_supplier_delivery_receipts(
    tenant_id,idempotency_key,receipt_fingerprint,verification_source,resolved_status,
    provider_message_ref,observed_at,recorded_at
  )
  SELECT tenant_id,idempotency_key,$6,$7,$3,$4,$8,$5 FROM updated
  ON CONFLICT (tenant_id,idempotency_key,receipt_fingerprint) DO NOTHING
  RETURNING receipt_fingerprint
)
SELECT * FROM updated;
`;

const trustedEvidence = new WeakSet();
const trustOwners = new WeakMap();

const text = (value, max = 200) => typeof value === 'string'
  ? value.trim().replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').slice(0, max)
  : '';
const hasControl = value => typeof value === 'string' && /[\u0000-\u001F\u007F]/.test(value);
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : (value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
      : value);
const digest = value => crypto.createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(stable(value)))
  .digest('hex');
const millis = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function required(value, name, max = 200) {
  if (hasControl(value)) throw new TypeError(`${name} contains control characters`);
  const clean = text(value, max + 1);
  if (!clean) throw new TypeError(`${name} is required`);
  if (clean.length > max) throw new TypeError(`${name} is too long`);
  return clean;
}

function normaliseVerifiedEvidence(raw = {}, source) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('verified receipt evidence must be an object');
  const status = text(raw.status, 40).toLowerCase();
  if (!['sent','not_sent'].includes(status)) throw new TypeError('verified receipt status must be sent or not_sent');
  const observedAtMs = millis(raw.observedAt);
  if (observedAtMs === null) throw new TypeError('verified receipt observedAt must be a valid timestamp');
  const out = Object.freeze({
    source,
    tenantId: required(raw.tenantId, 'tenantId', 100),
    siteId: required(raw.siteId, 'siteId', 100),
    requestId: required(raw.requestId, 'requestId', 100),
    agencyId: required(raw.agencyId, 'agencyId', 100),
    channel: required(raw.channel, 'channel', 20).toLowerCase(),
    deliveryId: required(raw.deliveryId, 'deliveryId', 64),
    idempotencyKey: required(raw.idempotencyKey, 'idempotencyKey', 64),
    status,
    providerMessageRef: text(raw.providerMessageRef, 200) || null,
    observedAt: new Date(observedAtMs).toISOString(),
    verificationDigest: required(raw.verificationDigest, 'verificationDigest', 64),
  });
  if (!/^[a-f0-9]{64}$/i.test(out.verificationDigest)) throw new TypeError('verificationDigest must be sha256');
  return out;
}

export function createAgencySupplierDeliveryReceiptTrust({ verifyCallback, verifyLookup } = {}) {
  if (typeof verifyCallback !== 'function' || typeof verifyLookup !== 'function') {
    throw new TypeError('callback and lookup verifiers are required');
  }
  const owner = Object.freeze({ id: crypto.randomUUID() });
  async function verify(raw, source, verifier) {
    const verified = await verifier(raw);
    if (!verified || verified.verified !== true || !verified.evidence) {
      throw new Error('receipt_verification_failed');
    }
    const evidence = normaliseVerifiedEvidence(verified.evidence, source);
    trustedEvidence.add(evidence);
    trustOwners.set(evidence, owner);
    return evidence;
  }
  return Object.freeze({
    verifyCallback: raw => verify(raw, 'provider_callback', verifyCallback),
    verifyLookup: raw => verify(raw, 'provider_lookup', verifyLookup),
    owns(evidence) { return trustedEvidence.has(evidence) && trustOwners.get(evidence) === owner; },
  });
}

function deliveryView(row = {}) {
  return {
    tenantId: text(row.tenantId ?? row.tenant_id, 100),
    idempotencyKey: text(row.idempotencyKey ?? row.idempotency_key, 64),
    deliveryId: text(row.deliveryId ?? row.delivery_id, 64),
    siteId: text(row.siteId ?? row.site_id, 100),
    requestId: text(row.requestId ?? row.request_id, 100),
    agencyId: text(row.agencyId ?? row.agency_id, 100),
    channel: text(row.channel, 20).toLowerCase(),
    status: text(row.status, 40).toLowerCase(),
    attemptCount: Number(row.attemptCount ?? row.attempt_count ?? 0),
    providerMessageRef: text(row.providerMessageRef ?? row.provider_message_ref, 200) || null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  };
}

export function decideAgencySupplierDeliveryReceipt({ delivery, evidence, trust, now, maxReceiptAgeMs = 7 * 24 * 60 * 60 * 1000, futureSkewMs = 5 * 60 * 1000 } = {}) {
  const current = deliveryView(delivery);
  const nowMs = millis(now);
  if (nowMs === null) return { action:'reject', reason:'invalid_now' };
  if (!trust || typeof trust.owns !== 'function' || !trust.owns(evidence)) return { action:'reject', reason:'untrusted_receipt_evidence' };
  if (!evidence || typeof evidence !== 'object') return { action:'reject', reason:'receipt_evidence_missing' };

  const bindings = ['tenantId','siteId','requestId','agencyId','channel','deliveryId','idempotencyKey'];
  for (const key of bindings) {
    if (!current[key] || current[key] !== evidence[key]) return { action:'reject', reason:`receipt_${key}_mismatch` };
  }
  if (current.providerMessageRef && evidence.providerMessageRef && current.providerMessageRef !== evidence.providerMessageRef) {
    return { action:'reject', reason:'receipt_provider_message_ref_mismatch' };
  }

  const observedMs = millis(evidence.observedAt);
  const createdMs = millis(current.createdAt);
  if (observedMs === null) return { action:'reject', reason:'receipt_timestamp_invalid' };
  if (observedMs > nowMs + futureSkewMs) return { action:'reject', reason:'receipt_from_future' };
  if (nowMs - observedMs > maxReceiptAgeMs) return { action:'reject', reason:'receipt_too_old' };
  if (createdMs !== null && observedMs + futureSkewMs < createdMs) return { action:'reject', reason:'receipt_predates_delivery' };

  const receiptFingerprint = digest({
    source:evidence.source,
    tenantId:evidence.tenantId,
    idempotencyKey:evidence.idempotencyKey,
    deliveryId:evidence.deliveryId,
    status:evidence.status,
    providerMessageRef:evidence.providerMessageRef,
    observedAt:evidence.observedAt,
    verificationDigest:evidence.verificationDigest,
  });

  if (current.status === evidence.status) {
    return { action:'no_change', reason:'already_resolved', status:current.status, receiptFingerprint };
  }
  if (['sent','not_sent'].includes(current.status)) {
    return { action:'review', reason:'conflicting_terminal_receipt', currentStatus:current.status, evidenceStatus:evidence.status, receiptFingerprint };
  }
  if (!['unknown','dispatching'].includes(current.status)) {
    return { action:'reject', reason:'delivery_status_not_reconcilable', currentStatus:current.status, receiptFingerprint };
  }

  return {
    action:'apply',
    reason:'verified_provider_receipt',
    status:evidence.status,
    providerMessageRef:current.providerMessageRef || evidence.providerMessageRef || null,
    receiptFingerprint,
    verificationSource:evidence.source,
    observedAt:evidence.observedAt,
    authorityBoundary:'delivery_receipt_reconciliation_only_no_supplier_resend_schedule_payroll_or_invoice_mutation',
  };
}

export function createPostgresAgencySupplierDeliveryReconciliationStore({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query function is required');
  return Object.freeze({
    async getDelivery({ tenantId, idempotencyKey } = {}) {
      const result = await query(SELECT_DELIVERY_SQL, [required(tenantId,'tenantId',100), required(idempotencyKey,'idempotencyKey',64)]);
      return result?.rows?.[0] ?? null;
    },
    async applyReceipt({ tenantId, idempotencyKey, decision, recordedAt } = {}) {
      if (!decision || decision.action !== 'apply' || !['sent','not_sent'].includes(decision.status)) {
        throw new TypeError('apply decision is required');
      }
      const result = await query(APPLY_RECEIPT_SQL, [
        required(tenantId,'tenantId',100),
        required(idempotencyKey,'idempotencyKey',64),
        decision.status,
        text(decision.providerMessageRef,200) || null,
        new Date(millis(recordedAt)).toISOString(),
        required(decision.receiptFingerprint,'receiptFingerprint',64),
        required(decision.verificationSource,'verificationSource',40),
        new Date(millis(decision.observedAt)).toISOString(),
      ]);
      return result?.rows?.[0] ?? null;
    },
  });
}

export async function reconcileAgencySupplierDeliveryReceipt({ tenantId, idempotencyKey, store, trust, evidence, now } = {}) {
  if (!store || typeof store.getDelivery !== 'function' || typeof store.applyReceipt !== 'function') {
    return { reconciled:false, reason:'reconciliation_store_unavailable' };
  }
  let current;
  try {
    current = await store.getDelivery({ tenantId, idempotencyKey });
  } catch {
    return { reconciled:false, reason:'reconciliation_store_unavailable' };
  }
  if (!current) return { reconciled:false, reason:'delivery_not_found' };

  let decision = decideAgencySupplierDeliveryReceipt({ delivery:current, evidence, trust, now });
  if (decision.action === 'reject' || decision.action === 'review') {
    return { reconciled:false, reviewRequired:decision.action === 'review', reason:decision.reason, decision };
  }
  if (decision.action === 'no_change') {
    return { reconciled:true, duplicateSuppressed:true, reason:decision.reason, status:decision.status, decision };
  }

  let updated;
  try {
    updated = await store.applyReceipt({ tenantId, idempotencyKey, decision, recordedAt:now });
  } catch {
    return { reconciled:false, reason:'reconciliation_write_failed', decision };
  }
  if (updated) {
    const view = deliveryView(updated);
    return {
      reconciled:true,
      duplicateSuppressed:false,
      reason:null,
      status:view.status,
      retrySafe:view.status === 'not_sent',
      resendTriggered:false,
      decision,
    };
  }

  try {
    current = await store.getDelivery({ tenantId, idempotencyKey });
  } catch {
    return { reconciled:false, reason:'reconciliation_store_unavailable_after_race', decision };
  }
  decision = decideAgencySupplierDeliveryReceipt({ delivery:current, evidence, trust, now });
  if (decision.action === 'no_change') {
    return { reconciled:true, duplicateSuppressed:true, reason:'concurrent_identical_receipt', status:decision.status, decision };
  }
  return { reconciled:false, reviewRequired:true, reason:'concurrent_receipt_conflict', decision };
}
