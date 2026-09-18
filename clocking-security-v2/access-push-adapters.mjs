import crypto from 'node:crypto';
import {normalizeAccessDecision} from './access-control-evidence.mjs';

function timingEqualHex(a,b){
  const aa=Buffer.from(String(a||''),'utf8');
  const bb=Buffer.from(String(b||''),'utf8');
  if(aa.length!==bb.length) return false;
  return crypto.timingSafeEqual(aa,bb);
}
function stableProviderEventId(prefix,parts){
  return `${prefix}-${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32)}`;
}
function resourceTail(value){
  const tail=String(value||'').split('/').filter(Boolean).at(-1)||'';
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(tail)?tail:null;
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

  if(PRIVACY_EXCLUDED.has(type)) return {status:'ignored',reason:'PRIVACY_SENSITIVE_CREDENTIAL_NOT_USED_FOR_ATTENDANCE'};
  if(UNPROVEN_SHARED.has(type)) return type.endsWith('_rejected')
    ? {status:'operational_event',event:{type:'access_denied',provider:'verkada',providerEventId,sourceId,accessPointId:doorId,observedAt}}
    : {status:'review_required',reason:'SHARED_OR_UNPROVEN_CREDENTIAL'};
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

const SALTO_UNLOCK='com.saltosystems.nebula.event.v1.accesspointunlocked';
const SALTO_DENIED='com.saltosystems.nebula.event.v1.accessdenied';
const SALTO_OPERATIONAL=new Set([
  'com.saltosystems.nebula.event.v1.accesspointforcedopen',
  'com.saltosystems.nebula.event.v1.accesspointleftopen',
]);
const SALTO_PERSONAL_KEYS=new Set([
  'salto.nebula.user.v1.CardKey',
  'salto.nebula.user.v1.AppKey',
  'salto.nebula.user.v1.WalletKey',
]);

/**
 * Converts SALTO Nebula events into the provider-neutral access evidence model.
 * Nebula distinguishes occurrence time from creation time; attendance uses
 * occur_time because delayed/offline delivery must not move the physical event
 * to the later cloud receipt time. Remote unlocks have DIRECTION_UNSPECIFIED and
 * are never attendance. Passcodes/emergency keys are not accepted as automatic
 * personal identity evidence. Raw key UIDs, names, photos and passcodes are not
 * copied into our model.
 */
export function normalizeSaltoNebulaEvent({sourceId,employee,expectedProviderUserResource,event,accessPoint,receivedAtMs=Date.now(),identityBinding}={}){
  if(!event || typeof event!=='object') return {status:'ignored',reason:'INVALID_SALTO_EVENT'};
  const type=String(event.type||'');
  const data=event.data&&typeof event.data==='object'?event.data:{};
  const providerEventId=resourceTail(event.name)||stableProviderEventId('salto',[event.name,type,event.occur_time,event.occurTime,data.access_point,data.accessPoint,data.user]);
  const observedAt=String(event.occur_time||event.occurTime||event.create_time||event.createTime||new Date(receivedAtMs).toISOString());
  const userResource=String(data.user||'');
  const accessPointResource=String(data.access_point||data.accessPoint||'');

  if(SALTO_OPERATIONAL.has(type)){
    return {status:'operational_event',event:{type:type.split('.').at(-1),provider:'salto_nebula',providerEventId,sourceId,accessPointId:accessPoint.id,observedAt}};
  }
  if(type===SALTO_DENIED){
    return {status:'operational_event',event:{type:'access_denied',provider:'salto_nebula',providerEventId,sourceId,accessPointId:accessPoint.id,observedAt}};
  }
  if(type==='com.saltosystems.nebula.event.v1.accessgranted') return {status:'ignored',reason:'ACCESS_GRANT_HAS_NO_PROVEN_SINGLE_PASSAGE'};
  if(type!==SALTO_UNLOCK) return {status:'ignored',reason:'UNSUPPORTED_SALTO_ATTENDANCE_EVENT'};

  if(!userResource) return {status:'review_required',reason:'MISSING_PROVIDER_USER_ID'};
  if(!expectedProviderUserResource || userResource!==String(expectedProviderUserResource)) return {status:'review_required',reason:'PROVIDER_USER_ID_MISMATCH'};
  if(!accessPointResource) return {status:'review_required',reason:'MISSING_ACCESS_POINT_ID'};

  const credentialType=String(data.credential_type||data.credentialType||'');
  if(credentialType==='salto.nebula.user.v1.Passcode' || credentialType==='salto.nebula.emergencykey.v1.EmergencyKey'){
    return {status:'review_required',reason:'SHARED_OR_UNPROVEN_CREDENTIAL'};
  }
  if(!SALTO_PERSONAL_KEYS.has(credentialType)) return {status:'review_required',reason:'UNSUPPORTED_OR_MISSING_PERSONAL_CREDENTIAL'};

  const rawDirection=String(data.direction||'').toUpperCase();
  if(rawDirection==='DIRECTION_UNSPECIFIED' || !rawDirection) return {status:'ignored',reason:'REMOTE_OR_DIRECTION_UNSPECIFIED'};
  const direction=rawDirection==='ENTRY'?'entry':rawDirection==='EXIT'?'exit':undefined;
  if(!direction) return {status:'review_required',reason:'UNKNOWN_ACCESS_DIRECTION'};

  return normalizeAccessDecision({
    sourceId,employee,provider:'salto_nebula',receivedAtMs,identityBinding,accessPoint,
    event:{providerEventId,direction,decision:'granted',occurredAt:observedAt,accessPointId:accessPoint.id}
  });
}

/**
 * Webhook endpoints must not acknowledge a delivery until the normalized
 * delivery has crossed a durable boundary. The caller supplies the product's
 * durable inbox/journal append. A failed append returns 500 so the provider can
 * retry rather than letting an acknowledged event disappear in a process crash.
 */
export async function acknowledgeAfterDurableCommit({verification,delivery,persist}={}){
  if(!verification?.ok) return {status:'rejected',httpStatus:401,reason:verification?.reason||'UNVERIFIED_DELIVERY'};
  if(typeof persist!=='function') throw new Error('Durable persist callback required.');
  try{
    const receipt=await persist(delivery);
    return {status:'accepted',httpStatus:200,receipt};
  }catch{
    return {status:'retry',httpStatus:500,reason:'DURABLE_COMMIT_FAILED'};
  }
}
