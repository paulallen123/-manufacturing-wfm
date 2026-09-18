import crypto from 'node:crypto';

export const AGENCY_SUPPLIER_DELIVERY_VERSION = 'agency-supplier-delivery-v0.1.1';

export const AGENCY_SUPPLIER_DELIVERY_DDL = `
CREATE TABLE IF NOT EXISTS wfm_agency_supplier_deliveries (
  tenant_id text NOT NULL,
  idempotency_key varchar(64) NOT NULL,
  delivery_id varchar(64) NOT NULL,
  site_id text NOT NULL,
  request_id text NOT NULL,
  agency_id text NOT NULL,
  channel text NOT NULL,
  delivery_revision integer NOT NULL,
  destination_fingerprint varchar(16) NOT NULL,
  portal_fingerprint varchar(16) NOT NULL,
  status text NOT NULL CHECK (status IN ('dispatching','sent','not_sent','unknown')),
  attempt_count integer NOT NULL CHECK (attempt_count >= 1),
  provider_message_ref text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key)
);
`;

const CLAIM_SQL = `
WITH inserted AS (
  INSERT INTO wfm_agency_supplier_deliveries
    (tenant_id, idempotency_key, delivery_id, site_id, request_id, agency_id, channel,
     delivery_revision, destination_fingerprint, portal_fingerprint, status, attempt_count,
     provider_message_ref, created_at, updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dispatching',1,NULL,$11,$11)
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  RETURNING status, attempt_count, true AS claimed
)
SELECT status, attempt_count, claimed FROM inserted
UNION ALL
SELECT status, attempt_count, false AS claimed
FROM wfm_agency_supplier_deliveries
WHERE tenant_id=$1 AND idempotency_key=$2 AND NOT EXISTS (SELECT 1 FROM inserted)
LIMIT 1;
`;

const RETRY_SQL = `
UPDATE wfm_agency_supplier_deliveries
SET status='dispatching', attempt_count=attempt_count+1, updated_at=$3
WHERE tenant_id=$1 AND idempotency_key=$2 AND status='not_sent' AND attempt_count < $4
RETURNING status, attempt_count;
`;

const OUTCOME_SQL = `
WITH target AS (
  SELECT status, attempt_count, provider_message_ref
  FROM wfm_agency_supplier_deliveries
  WHERE tenant_id=$1 AND idempotency_key=$2
  FOR UPDATE
), updated AS (
  UPDATE wfm_agency_supplier_deliveries d
  SET status=$3,
      provider_message_ref=COALESCE(d.provider_message_ref,$4),
      updated_at=GREATEST(d.updated_at,$5::timestamptz)
  WHERE d.tenant_id=$1 AND d.idempotency_key=$2
    AND d.status='dispatching'
    AND ($6::integer IS NULL OR d.attempt_count=$6)
  RETURNING d.status, d.attempt_count, d.provider_message_ref
)
SELECT
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'delivery_not_found'
    WHEN $6::integer IS NOT NULL AND (SELECT attempt_count FROM target) <> $6 THEN 'attempt_mismatch'
    WHEN EXISTS (SELECT 1 FROM updated) THEN 'recorded'
    WHEN (SELECT status FROM target)='sent'
      AND ((SELECT provider_message_ref FROM target) IS NULL OR $4::text IS NULL OR (SELECT provider_message_ref FROM target)=$4)
      THEN 'already_sent'
    ELSE 'state_conflict'
  END AS result,
  COALESCE((SELECT status FROM updated),(SELECT status FROM target)) AS status,
  COALESCE((SELECT attempt_count FROM updated),(SELECT attempt_count FROM target)) AS attempt_count,
  COALESCE((SELECT provider_message_ref FROM updated),(SELECT provider_message_ref FROM target)) AS provider_message_ref;
`;

const text = (value, max = 200) => typeof value === 'string' ? value.trim().replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').slice(0, max) : '';
const hasControl = value => typeof value === 'string' && /[\u0000-\u001F\u007F]/.test(value);
const ms = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : (value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
      : value);
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
const fingerprint = value => digest(String(value ?? '')).slice(0, 16);

function requiredString(value, name, max = 200) {
  if (hasControl(value)) throw new TypeError(`${name} contains control characters`);
  const clean = text(value, max + 1);
  if (!clean) throw new TypeError(`${name} is required`);
  if (clean.length > max) throw new TypeError(`${name} is too long`);
  return clean;
}

function requiredIso(value, name) {
  const parsed = ms(value);
  if (parsed === null) throw new TypeError(`${name} must be a valid timestamp`);
  return new Date(parsed).toISOString();
}

function assertHttps(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new TypeError('portalUrl must be a valid URL'); }
  if (parsed.protocol !== 'https:') throw new TypeError('portalUrl must use https');
  if (parsed.username || parsed.password) throw new TypeError('portalUrl must not contain userinfo');
  return parsed.toString();
}

function safeAssignmentSummary(requestPack = {}) {
  const assignment = requestPack.assignment || {};
  const hirer = requestPack.hirer || {};
  return {
    hirerName: text(hirer.name, 160) || null,
    businessNature: text(hirer.businessNature, 240) || null,
    roleName: text(assignment.roleName, 160) || null,
    location: text(assignment.location, 240) || null,
    startAt: assignment.startAt ?? null,
    endAt: assignment.endAt ?? null,
    expectedDuration: text(assignment.expectedDuration, 160) || null,
    daysAndHours: text(assignment.daysAndHours, 240) || null,
    count: Number.isFinite(Number(assignment.count)) ? Number(assignment.count) : null,
  };
}

function validateSupplierEligibility(supplierEligibility, agencyId, requestPack) {
  if (!supplierEligibility || typeof supplierEligibility !== 'object') {
    return { ok:false, reason:'supplier_eligibility_missing' };
  }
  if (supplierEligibility.agencyId !== agencyId) {
    return { ok:false, reason:'supplier_eligibility_scope_mismatch' };
  }
  if (supplierEligibility.eligible !== true || (supplierEligibility.failures || []).length) {
    return { ok:false, reason:'supplier_not_eligible' };
  }
  if (!text(supplierEligibility.version, 80)) return { ok:false, reason:'supplier_eligibility_version_missing' };
  if (!supplierEligibility.evidence || typeof supplierEligibility.evidence !== 'object') return { ok:false, reason:'supplier_eligibility_evidence_missing' };
  const requestLicenceRequired = requestPack?.assignment?.fairWorkAgencyGangmasterLicenceRequired === true;
  if (supplierEligibility.evidence.licenceRequired !== requestLicenceRequired) {
    return { ok:false, reason:'supplier_eligibility_policy_mismatch' };
  }
  return { ok:true, reason:null };
}

export function prepareAgencySupplierDelivery(input = {}) {
  const tenantId = requiredString(input.tenantId, 'tenantId', 100);
  const siteId = requiredString(input.siteId, 'siteId', 100);
  const requestId = requiredString(input.requestId, 'requestId', 100);
  const agencyId = requiredString(input.agencyId, 'agencyId', 100);
  const channel = requiredString(input.channel, 'channel', 20).toLowerCase();
  if (!['email','sms','api'].includes(channel)) throw new TypeError('channel must be email, sms or api');
  const destination = requiredString(input.destination, 'destination', 320);
  if (channel === 'api') assertHttps(destination);
  const portalUrl = assertHttps(requiredString(input.portalUrl, 'portalUrl', 2048));
  const responseDeadline = requiredIso(input.responseDeadline, 'responseDeadline');
  const deliveryRevision = Number(input.deliveryRevision ?? 1);
  if (!Number.isInteger(deliveryRevision) || deliveryRevision < 1) throw new TypeError('deliveryRevision must be a positive integer');
  if (input.requestPack?.requestId && input.requestPack.requestId !== requestId) throw new TypeError('requestPack.requestId must match requestId');

  const supplierEligibility = validateSupplierEligibility(input.supplierEligibility, agencyId, input.requestPack);
  if (!supplierEligibility.ok) {
    return {
      ready:false,
      reason:supplierEligibility.reason,
      delivery:null,
      transient:null,
      audit:null,
    };
  }

  const summary = safeAssignmentSummary(input.requestPack);
  if (!summary.roleName || !summary.location || ms(summary.startAt) === null || ms(summary.endAt) === null || ms(summary.endAt) <= ms(summary.startAt) || !Number.isInteger(summary.count) || summary.count <= 0) {
    return { ready:false, reason:'assignment_summary_incomplete', delivery:null, transient:null, audit:null };
  }

  const identity = { tenantId, siteId, requestId, agencyId, channel, deliveryRevision };
  const idempotencyKey = digest(identity);
  const deliveryId = digest({ ...identity, purpose:'agency_request_dispatch' });
  const destinationFingerprint = fingerprint(destination);
  const portalFingerprint = fingerprint(portalUrl);
  const subject = `Agency labour request: ${summary.roleName} — ${summary.location}`.slice(0, 200);
  const message = [
    `${summary.hirerName ? summary.hirerName + ': ' : ''}${summary.count} × ${summary.roleName} required at ${summary.location}.`,
    `Start: ${summary.startAt}.`,
    `Please respond by ${responseDeadline} using the secure request link.`,
    `The secure request contains the full assignment details and response options.`,
  ].join(' ');

  const delivery = {
    version: AGENCY_SUPPLIER_DELIVERY_VERSION,
    ...identity,
    deliveryId,
    idempotencyKey,
    responseDeadline,
    assignmentSummary: summary,
    subject,
    message,
    authorityBoundary:'supplier_request_delivery_only_no_schedule_payroll_or_invoice_mutation',
  };

  const audit = {
    version: AGENCY_SUPPLIER_DELIVERY_VERSION,
    deliveryId,
    idempotencyKey,
    tenantId,
    siteId,
    requestId,
    agencyId,
    channel,
    deliveryRevision,
    destinationFingerprint,
    portalFingerprint,
    supplierEligible:true,
    supplierEligibilityVersion:text(input.supplierEligibility?.version,80) || null,
    supplierEligibilityEvidenceFingerprint:digest({version:input.supplierEligibility?.version??null,agencyId:input.supplierEligibility?.agencyId??null,eligible:input.supplierEligibility?.eligible===true,failures:input.supplierEligibility?.failures??[],evidence:input.supplierEligibility?.evidence??null}).slice(0,16),
    containsRawDestination:false,
    containsRawPortalUrl:false,
    containsWorkerPersonalData:false,
  };

  return {
    ready:true,
    reason:null,
    delivery,
    transient:{ destination, portalUrl },
    audit,
  };
}

export function deliveryAuditReceipt({prepared, status, attemptCount = null, providerMessageRef = null, at = null, reason = null} = {}) {
  const audit = prepared?.audit || {};
  return {
    version: AGENCY_SUPPLIER_DELIVERY_VERSION,
    deliveryId:audit.deliveryId ?? null,
    idempotencyKey:audit.idempotencyKey ?? null,
    tenantId:audit.tenantId ?? null,
    siteId:audit.siteId ?? null,
    requestId:audit.requestId ?? null,
    agencyId:audit.agencyId ?? null,
    channel:audit.channel ?? null,
    deliveryRevision:audit.deliveryRevision ?? null,
    destinationFingerprint:audit.destinationFingerprint ?? null,
    portalFingerprint:audit.portalFingerprint ?? null,
    status:status ?? 'rejected',
    reason,
    attemptCount,
    providerMessageRef:text(providerMessageRef, 200) || null,
    at:at ?? null,
    supplierEligible:audit.supplierEligible === true,
    supplierEligibilityVersion:audit.supplierEligibilityVersion ?? null,
    supplierEligibilityEvidenceFingerprint:audit.supplierEligibilityEvidenceFingerprint ?? null,
    containsRawDestination:false,
    containsRawPortalUrl:false,
    containsWorkerPersonalData:false,
    authorityBoundary:'supplier_request_delivery_only_no_schedule_payroll_or_invoice_mutation',
  };
}

export function createPostgresAgencySupplierDeliveryStore({query}) {
  if (typeof query !== 'function') throw new TypeError('query function is required');
  return Object.freeze({
    version:AGENCY_SUPPLIER_DELIVERY_VERSION,
    async claimOnce(record = {}) {
      const values = [
        requiredString(record.tenantId, 'tenantId', 100),
        requiredString(record.idempotencyKey, 'idempotencyKey', 64),
        requiredString(record.deliveryId, 'deliveryId', 64),
        requiredString(record.siteId, 'siteId', 100),
        requiredString(record.requestId, 'requestId', 100),
        requiredString(record.agencyId, 'agencyId', 100),
        requiredString(record.channel, 'channel', 20),
        Number(record.deliveryRevision),
        requiredString(record.destinationFingerprint, 'destinationFingerprint', 16),
        requiredString(record.portalFingerprint, 'portalFingerprint', 16),
        requiredIso(record.at, 'at'),
      ];
      if (!Number.isInteger(values[7]) || values[7] < 1) throw new TypeError('deliveryRevision must be a positive integer');
      const result=await query(CLAIM_SQL,values);
      const row=result?.rows?.[0];
      if(!row)throw new Error('unexpected_delivery_store_result');
      return {claimed:row.claimed===true,status:row.status,attemptCount:Number(row.attempt_count??row.attemptCount??1)};
    },
    async claimRetry({tenantId,idempotencyKey,at,maxAttempts=3}={}) {
      const limit=Number(maxAttempts);
      if(!Number.isInteger(limit)||limit<1||limit>10)throw new TypeError('maxAttempts must be between 1 and 10');
      const result=await query(RETRY_SQL,[
        requiredString(tenantId,'tenantId',100),
        requiredString(idempotencyKey,'idempotencyKey',64),
        requiredIso(at,'at'),
        limit,
      ]);
      const row=result?.rows?.[0];
      return row?{claimed:true,status:row.status,attemptCount:Number(row.attempt_count??row.attemptCount)}:{claimed:false,status:null,attemptCount:null};
    },
    async recordOutcome({tenantId,idempotencyKey,status,providerMessageRef,at,attemptNumber}={}) {
      if(!['sent','not_sent','unknown'].includes(status))throw new TypeError('invalid delivery outcome status');
      const attempt=attemptNumber === null || attemptNumber === undefined ? null : Number(attemptNumber);
      if(attempt !== null && (!Number.isInteger(attempt)||attempt<1||attempt>1000))throw new TypeError('attemptNumber must be a positive integer');
      const result=await query(OUTCOME_SQL,[
        requiredString(tenantId,'tenantId',100),
        requiredString(idempotencyKey,'idempotencyKey',64),
        status,
        text(providerMessageRef,200)||null,
        requiredIso(at,'at'),
        attempt,
      ]);
      const row=result?.rows?.[0];
      if(!row)throw new Error('unexpected_delivery_store_result');
      return {
        result:row.result ?? null,
        status:row.status ?? null,
        attemptCount:Number(row.attempt_count??row.attemptCount),
        providerMessageRef:row.provider_message_ref??row.providerMessageRef??null,
      };
    },
  });
}

function storeRecord(prepared,at){
  return {
    tenantId:prepared.delivery.tenantId,
    idempotencyKey:prepared.delivery.idempotencyKey,
    deliveryId:prepared.delivery.deliveryId,
    siteId:prepared.delivery.siteId,
    requestId:prepared.delivery.requestId,
    agencyId:prepared.delivery.agencyId,
    channel:prepared.delivery.channel,
    deliveryRevision:prepared.delivery.deliveryRevision,
    destinationFingerprint:prepared.audit.destinationFingerprint,
    portalFingerprint:prepared.audit.portalFingerprint,
    at,
  };
}

function existingReason(status){
  if(status==='sent')return 'already_sent';
  if(status==='dispatching'||status==='unknown')return 'delivery_outcome_unknown';
  if(status==='not_sent')return 'retry_available';
  return 'delivery_store_rejected';
}

export async function dispatchAgencySupplierRequest({prepared,deliveryStore,sender,now,maxAttempts=3}={}){
  const at=requiredIso(now,'now');
  const reject=(reason,extra={})=>({
    dispatched:false,
    reason,
    receipt:deliveryAuditReceipt({prepared,status:'rejected',at,reason,...extra}),
  });

  if(!prepared?.ready||!prepared?.delivery||!prepared?.transient||!prepared?.audit)return reject(prepared?.reason||'delivery_not_ready');
  if(ms(at)>ms(prepared.delivery.responseDeadline))return reject('response_deadline_passed');
  if(!deliveryStore||typeof deliveryStore.claimOnce!=='function'||typeof deliveryStore.recordOutcome!=='function')return reject('delivery_store_unavailable');
  if(!sender||typeof sender.send!=='function')return reject('sender_unavailable');

  let claim;
  try{
    claim=await deliveryStore.claimOnce(storeRecord(prepared,at));
  }catch{
    return reject('delivery_store_unavailable');
  }

  if(claim?.claimed!==true){
    if(claim?.status!=='not_sent')return reject(existingReason(claim?.status),{attemptCount:claim?.attemptCount??null});
    if(typeof deliveryStore.claimRetry!=='function')return reject('delivery_retry_store_unavailable',{attemptCount:claim?.attemptCount??null});
    try{
      claim=await deliveryStore.claimRetry({
        tenantId:prepared.delivery.tenantId,
        idempotencyKey:prepared.delivery.idempotencyKey,
        at,
        maxAttempts,
      });
    }catch{
      return reject('delivery_store_unavailable');
    }
    if(claim?.claimed!==true)return reject('retry_not_claimed',{attemptCount:claim?.attemptCount??null});
  }

  let outcome;
  try{
    outcome=await sender.send({
      channel:prepared.delivery.channel,
      destination:prepared.transient.destination,
      idempotencyKey:prepared.delivery.idempotencyKey,
      deliveryId:prepared.delivery.deliveryId,
      subject:prepared.delivery.subject,
      message:prepared.delivery.message,
      portalUrl:prepared.transient.portalUrl,
      responseDeadline:prepared.delivery.responseDeadline,
    });
  }catch{
    outcome={status:'unknown',providerMessageRef:null};
  }

  if(!outcome||!['sent','not_sent','unknown'].includes(outcome.status))outcome={status:'unknown',providerMessageRef:null};
  const providerMessageRef=text(outcome.providerMessageRef,200)||null;

  let recorded;
  try{
    recorded=await deliveryStore.recordOutcome({
      tenantId:prepared.delivery.tenantId,
      idempotencyKey:prepared.delivery.idempotencyKey,
      status:outcome.status,
      providerMessageRef,
      at,
      attemptNumber:claim?.attemptCount,
    });
  }catch{
    return {
      dispatched:false,
      reason:'delivery_audit_write_failed_after_send_attempt',
      receipt:deliveryAuditReceipt({prepared,status:'unknown',attemptCount:claim?.attemptCount??null,providerMessageRef:null,at,reason:'delivery_audit_write_failed_after_send_attempt'}),
    };
  }

  if(recorded?.result && !['recorded','already_sent'].includes(recorded.result)){
    return {
      dispatched:false,
      reason:'delivery_state_conflict_after_send_attempt',
      receipt:deliveryAuditReceipt({prepared,status:'unknown',attemptCount:claim?.attemptCount??null,providerMessageRef:null,at,reason:'delivery_state_conflict_after_send_attempt'}),
    };
  }

  const status=recorded?.status??outcome.status;
  const reason=status==='sent'?null:status==='not_sent'?'not_sent_retry_safe':'delivery_outcome_unknown';
  return {
    dispatched:status==='sent',
    reason,
    receipt:deliveryAuditReceipt({prepared,status,attemptCount:recorded?.attemptCount??claim?.attemptCount??null,providerMessageRef:recorded?.providerMessageRef??providerMessageRef,at,reason}),
  };
}
