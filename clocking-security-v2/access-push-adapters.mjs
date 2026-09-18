import crypto from 'node:crypto';
import {normalizeAccessDecision} from './access-control-evidence.mjs';

function timingEqualHex(a,b){
  const aa=Buffer.from(String(a||''),'utf8');
  const bb=Buffer.from(String(b||''),'utf8');
  if(aa.length!==bb.length) return false;
  return crypto.timingSafeEqual(aa,bb);
}

/**
 * Kisi documents X-Signature as the HMAC-SHA256 of the raw HTTPS request body
 * when a webhook signature key is configured. This verifier deliberately works
 * on the untouched raw body so JSON parsing/re-serialization cannot alter the
 * authenticated bytes.
 */
export function verifyKisiWebhook({rawBody,signature,secret}={}){
  if(typeof rawBody!=='string' || !secret) return {ok:false,reason:'MISSING_WEBHOOK_MATERIAL'};
  const expected=crypto.createHmac('sha256',secret).update(rawBody).digest('hex');
  if(!timingEqualHex(expected,signature)) return {ok:false,reason:'INVALID_SIGNATURE'};
  return {ok:true};
}

/**
 * Verkada signs raw JSON plus its delivery timestamp. We enforce freshness as
 * well as HMAC validity because accepting a valid old delivery would permit a
 * replay even though the signature is authentic.
 */
export function verifyVerkadaWebhook({rawBody,signatureHeader,secret,nowMs=Date.now(),toleranceMs=60_000}={}){
  if(typeof rawBody!=='string' || !secret || typeof signatureHeader!=='string') return {ok:false,reason:'MISSING_WEBHOOK_MATERIAL'};
  const split=signatureHeader.split('|');
  if(split.length!==2) return {ok:false,reason:'INVALID_SIGNATURE_FORMAT'};
  const [timestamp,signature]=split;
  if(!/^\d{9,13}$/.test(timestamp)) return {ok:false,reason:'INVALID_SIGNATURE_TIMESTAMP'};
  const numeric=Number(timestamp);
  const timestampMs=numeric<10_000_000_000 ? numeric*1000 : numeric;
  if(!Number.isFinite(timestampMs) || Math.abs(nowMs-timestampMs)>toleranceMs) return {ok:false,reason:'STALE_OR_FUTURE_DELIVERY'};
  const expected=crypto.createHmac('sha256',secret).update(`${rawBody}|${timestamp}`).digest('hex');
  if(!timingEqualHex(expected,signature)) return {ok:false,reason:'INVALID_SIGNATURE'};
  return {ok:true,timestampMs};
}

const PERSONAL_ACCEPTED=new Set([
  'door_keycard_entered_accepted',
  'door_mobile_nfc_scan_accepted',
  'door_ble_unlock_attempt_accepted',
]);
const PERSONAL_REJECTED=new Set([
  'door_keycard_entered_rejected',
  'door_mobile_nfc_scan_rejected',
  'door_ble_unlock_attempt_rejected',
]);
const PRIVACY_EXCLUDED=new Set([
  'door_face_presented_accepted','door_face_presented_rejected',
  'door_lp_presented_accepted','door_lp_presented_rejected',
]);
const UNPROVEN_SHARED=new Set(['door_code_entered_accepted','door_code_entered_rejected']);
const OPERATIONAL=new Set([
  'door_forced_open','door_held_open','door_tailgating','door_tamper','door_acu_tamper','door_lockdown',
  'door_acu_offline','door_fire_alarm_triggered','door_fire_alarm_released','door_acu_fire_alarm_triggered','door_acu_fire_alarm_released',
  'door_apb_double_entry','door_apb_double_exit'
]);

function asWebhookObject(payload){
  if(payload && typeof payload==='object' && payload.body && typeof payload.body==='object') return payload.body;
  return payload;
}
function epochSecondsToIso(v,receivedAtMs){
  return Number.isFinite(Number(v)) ? new Date(Number(v)*1000).toISOString() : new Date(receivedAtMs).toISOString();
}

/**
 * Converts Verkada access webhooks into the existing provider-neutral safety
 * boundary. Raw credential values, names, email, phone, face/plate data and
 * images are deliberately never copied into the attendance evidence model.
 */
export function normalizeVerkadaAccessWebhook({sourceId,employee,expectedProviderUserId,payload,accessPoint,receivedAtMs=Date.now(),identityBinding}={}){
  const root=asWebhookObject(payload);
  const data=root?.data;
  if(root?.webhook_type!=='notification' || !data || data.device_type!=='access_control') return {status:'ignored',reason:'NOT_VERKADA_ACCESS_NOTIFICATION'};
  const type=String(data.notification_type||'').toLowerCase();
  const providerEventId=String(data.event_id||'');
  const doorId=String(data.door_id||data.door_info?.door_id||'');
  const providerUserId=data.user_info?.user_id ? String(data.user_info.user_id) : null;
  const observedAt=epochSecondsToIso(data.created,receivedAtMs);

  // Face and licence-plate credentials are deliberately excluded from the
  // attendance path. We do not need biometric/vehicle identity data to prove
  // ordinary workforce attendance.
  if(PRIVACY_EXCLUDED.has(type)) return {status:'ignored',reason:'PRIVACY_SENSITIVE_CREDENTIAL_NOT_USED_FOR_ATTENDANCE'};

  // Entry codes can be shared. A rejected code is useful access friction
  // telemetry; an accepted code is never enough to identify a worker.
  if(UNPROVEN_SHARED.has(type)) return type.endsWith('_rejected')
    ? {status:'operational_event',event:{type:'access_denied',provider:'verkada',providerEventId,sourceId,accessPointId:doorId,observedAt}}
    : {status:'review_required',reason:'SHARED_OR_UNPROVEN_CREDENTIAL'};

  // Remote unlocks and raw door-state transitions are actions/states, not proof
  // that the mapped employee crossed the threshold.
  if(type==='door_remote_unlock_accepted' || type==='door_aux_unlock' || type==='door_unlocked' || type==='door_opened') return {status:'ignored',reason:'DOOR_STATE_OR_REMOTE_ACTION_NOT_PERSON_CROSSING'};

  if(OPERATIONAL.has(type)) return {status:'operational_event',event:{type,provider:'verkada',providerEventId,sourceId,accessPointId:doorId,observedAt}};
  if(PERSONAL_REJECTED.has(type)) return {status:'operational_event',event:{type:'access_denied',provider:'verkada',providerEventId,sourceId,accessPointId:doorId,observedAt}};
  if(!PERSONAL_ACCEPTED.has(type)) return {status:'ignored',reason:'UNSUPPORTED_VERKADA_ACCESS_EVENT'};

  if(!providerUserId) return {status:'review_required',reason:'MISSING_PROVIDER_USER_ID'};
  if(!expectedProviderUserId || providerUserId!==String(expectedProviderUserId)) return {status:'review_required',reason:'PROVIDER_USER_ID_MISMATCH'};

  const rawDirection=String(data.direction||'').toLowerCase();
  const direction=rawDirection==='inbound'?'entry':rawDirection==='outbound'?'exit':undefined;
  return normalizeAccessDecision({
    sourceId,employee,provider:'verkada',receivedAtMs,identityBinding,accessPoint,
    event:{providerEventId,doorId,direction,decision:'granted',occurredAt:observedAt,controllerId:data.door_info?.acu_id}
  });
}
