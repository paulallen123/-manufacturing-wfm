import crypto from 'node:crypto';
import {
  AGENCY_SCHEDULE_COMMAND_PERMIT_VERSION,
  consumeAgencyScheduleCommandPermitAtIngress,
} from './agency-schedule-command-permit.mjs';

export const AGENCY_SCHEDULE_INGRESS_SHADOW_VERSION='agency-schedule-ingress-shadow-v0.1.0';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=(value,length=32)=>crypto.createHash('sha256').update(String(value??'')).digest('hex').slice(0,length);
function makeError(code){const error=new Error(code);error.code=code;return error;}

function validatePermitEnvelope(envelope){
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))throw makeError('schedule_ingress_envelope_invalid');
  if(envelope.version!==AGENCY_SCHEDULE_COMMAND_PERMIT_VERSION)throw makeError('schedule_ingress_permit_version_mismatch');
  if(envelope.acceptedForShadow!==true||envelope.scheduleWriteAuthorized!==false)throw makeError('schedule_ingress_authority_invalid');
  if(typeof envelope.requestId!=='string'||!envelope.requestId||typeof envelope.siteId!=='string'||!envelope.siteId||typeof envelope.agencyId!=='string'||!envelope.agencyId)throw makeError('schedule_ingress_scope_invalid');
  if(!/^[0-9a-f]{24}$/.test(envelope.assignmentFingerprint??''))throw makeError('schedule_ingress_assignment_fingerprint_invalid');
  if(!/^[0-9a-f]{32}$/.test(envelope.scheduleHandoffFingerprint??'')||!/^[0-9a-f]{32}$/.test(envelope.shadowCommandFingerprint??''))throw makeError('schedule_ingress_handoff_fingerprint_invalid');
  if(!Array.isArray(envelope.workerAssuranceBindings)||envelope.workerAssuranceBindings.length===0)throw makeError('schedule_ingress_worker_bindings_invalid');
  return envelope;
}

// Shadow-only scheduling ingress. It accepts an unforgeable permit capability, never a raw
// envelope, and has no schedule repository/client dependency. A future live adapter must keep
// this capability check inside the same locked transaction before any write is introduced.
export function acceptAgencyScheduleCommandAtShadowIngress({permit,command}={}){
  const envelope=validatePermitEnvelope(consumeAgencyScheduleCommandPermitAtIngress(permit,command));
  const evidence=Object.freeze({
    permitVersion:envelope.version,
    requestId:envelope.requestId,
    siteId:envelope.siteId,
    agencyId:envelope.agencyId,
    assignmentFingerprint:envelope.assignmentFingerprint,
    scheduleHandoffFingerprint:envelope.scheduleHandoffFingerprint,
    shadowCommandFingerprint:envelope.shadowCommandFingerprint,
    workerAssuranceBindings:envelope.workerAssuranceBindings,
  });
  const ingressFingerprint=digest(JSON.stringify(stable(evidence)),32);
  return Object.freeze({
    version:AGENCY_SCHEDULE_INGRESS_SHADOW_VERSION,
    acceptedForShadowIngress:true,
    reason:null,
    requestId:evidence.requestId,
    siteId:evidence.siteId,
    agencyId:evidence.agencyId,
    assignmentFingerprint:evidence.assignmentFingerprint,
    scheduleHandoffFingerprint:evidence.scheduleHandoffFingerprint,
    workerAssuranceBindings:evidence.workerAssuranceBindings,
    shadowCommandFingerprint:evidence.shadowCommandFingerprint,
    ingressFingerprint,
    scheduleWriteAuthorized:false,
    authorityBoundary:'shadow_schedule_ingress_requires_live_transaction_scoped_permit_and_has_no_schedule_write_dependency',
    privacyBoundary:'no_portal_token_share_code_date_of_birth_document_number_destination_or_raw_right_to_work_evidence_in_ingress_output',
    bypassRule:'raw_or_fabricated_permits_and_replayed_or_expired_capabilities_fail_closed_before_shadow_ingress_acceptance',
  });
}
