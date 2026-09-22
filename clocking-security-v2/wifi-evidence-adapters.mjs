import crypto from 'node:crypto';

const SAFE_ID=/^[A-Za-z0-9_.:-]{1,160}$/;
const BINDINGS=new Set(['user_8021x','managed_device_certificate']);

function stableId(prefix,parts){
  const h=crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
  return `${prefix}-${h}`;
}
function iso(value,receivedAtMs){
  const ms=Date.parse(String(value||''));
  return Number.isFinite(ms)?new Date(ms).toISOString():new Date(receivedAtMs).toISOString();
}
function safe(v){ return SAFE_ID.test(String(v||''))?String(v):null; }

/**
 * Normalise Microsoft NPS / RFC2866-style accounting into provider-neutral
 * attendance evidence. This adapter is intentionally conservative:
 * Accounting-Stop is disappearance evidence only and can never be a pay-stop
 * anchor in the core engine. Accounting-On/Off describe NAS state and are ignored.
 *
 * identityBinding must be established during onboarding. Shared PSKs are not
 * accepted as employee identity evidence.
 */
export function normalizeNpsAccounting({sourceId,employee,packet,receivedAtMs=Date.now(),identityBinding}){
  if(!sourceId || !employee || !packet || !Number.isSafeInteger(receivedAtMs)) throw new Error('Valid NPS adapter input required.');
  if(!BINDINGS.has(identityBinding)) return {status:'review_required',reason:'WEAK_WIFI_IDENTITY_BINDING'};
  const status=String(packet.statusType||packet.acctStatusType||'').toLowerCase().replace(/[^a-z]/g,'');
  if(['accountingon','on','accountingoff','off'].includes(status)) return {status:'ignored',reason:'NETWORK_DEVICE_STATE_NOT_EMPLOYEE_PRESENCE'};

  let kind;
  if(['accountingstart','start','accountinginterim','interim','interimupdate'].includes(status)) kind='wifi_authenticated';
  else if(['accountingstop','stop'].includes(status)) kind='wifi_disconnected';
  else return {status:'ignored',reason:'UNSUPPORTED_NPS_ACCOUNTING_TYPE'};

  const occurredAt=iso(packet.eventTimestamp||packet.occurredAt,receivedAtMs);
  const session=safe(packet.acctSessionId)||safe(packet.sessionId)||'session-unknown';
  const multi=safe(packet.acctMultiSessionId)||safe(packet.multiSessionId)||null;
  const nas=safe(packet.nasIdentifier)||safe(packet.nasIpAddress)||null;
  const providerEventId=safe(packet.providerEventId)||stableId('nps',[sourceId,employee,status,session,multi,nas,occurredAt]);
  return {
    status:'evidence',
    event:{sourceId,eventId:providerEventId,employee,kind,observedAt:occurredAt,metadata:{providerEventId,controllerId:nas||undefined,sourceRevision:session,sequence:packet.sequence}}
  };
}

/**
 * Normalise Cisco Meraki wireless connectivity telemetry. Only successful auth
 * and association events become positive presence evidence. Roam is deliberately
 * ignored as an attendance transition; disassoc/deauth are weak negative evidence.
 * Employee mapping must already be backed by enterprise 802.1X or managed-device
 * certificate identity; a MAC address/clientId by itself is not person identity.
 */
export function normalizeMerakiConnectivity({sourceId,employee,event,clientId,receivedAtMs=Date.now(),identityBinding}){
  if(!sourceId || !employee || !event || !Number.isSafeInteger(receivedAtMs)) throw new Error('Valid Meraki adapter input required.');
  if(!BINDINGS.has(identityBinding)) return {status:'review_required',reason:'WEAK_WIFI_IDENTITY_BINDING'};
  const type=String(event.type||'').toLowerCase();
  const subtype=String(event.subtype||'').toLowerCase();
  if(type==='roam') return {status:'ignored',reason:'ROAM_IS_CONTINUOUS_PRESENCE'};
  if(['dns','dhcp','sticky','connection'].includes(type)) return {status:'ignored',reason:'NON_IDENTITY_CONNECTIVITY_EVENT'};

  let kind;
  if(type==='auth'){
    if(subtype && subtype!=='success') return {status:'ignored',reason:'FAILED_AUTH_IS_NOT_PRESENCE'};
    kind='wifi_authenticated';
  } else if(type==='assoc') kind='wifi_authenticated';
  else if(['disassoc','deauth'].includes(type)) kind='wifi_disconnected';
  else return {status:'ignored',reason:'UNSUPPORTED_MERAKI_EVENT'};

  const occurredAt=iso(event.occurredAt,receivedAtMs);
  const serial=safe(event.deviceSerial);
  const client=safe(clientId)||'client-unknown';
  const providerEventId=safe(event.providerEventId)||stableId('meraki',[sourceId,client,type,subtype,serial,event.ssidNumber,event.band,occurredAt]);
  return {
    status:'evidence',
    event:{sourceId,eventId:providerEventId,employee,kind,observedAt:occurredAt,metadata:{providerEventId,accessPointId:serial||undefined,zoneId:safe(event.zoneId)||undefined}}
  };
}
