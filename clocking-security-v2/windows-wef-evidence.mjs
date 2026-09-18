import crypto from 'node:crypto';

const SAFE_ID=/^[A-Za-z0-9_.:-]{1,180}$/;
const LOCAL_LOGON_TYPES=new Set([2,7,11,13]);
const REMOTE_OR_NONINTERACTIVE=new Set([3,4,5,8,9,10,12]);

function safe(v){ return SAFE_ID.test(String(v??'')) ? String(v) : null; }
function stableId(prefix,parts){
  const h=crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
  return `${prefix}-${h}`;
}
function sourceTime(system,receivedAtMs){
  const raw=system?.timeCreated ?? system?.systemTime ?? system?.TimeCreated?.SystemTime;
  const ms=Date.parse(String(raw??''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date(receivedAtMs).toISOString();
}
function eventNumber(system){
  const n=Number(system?.eventId ?? system?.EventID);
  return Number.isInteger(n) ? n : null;
}
function dataValue(data,name){
  if(!data || typeof data!=='object') return undefined;
  if(Object.prototype.hasOwnProperty.call(data,name)) return data[name];
  const alt=name[0].toLowerCase()+name.slice(1);
  if(Object.prototype.hasOwnProperty.call(data,alt)) return data[alt];
  return undefined;
}

/**
 * Normalise Windows Security events delivered through Windows Event Forwarding.
 *
 * Trust model:
 * - employee mapping must be based on an exact SID (or equivalently strong
 *   directory binding resolved before this adapter is called);
 * - the source computer must be a registered fixed-site asset;
 * - only local interactive/unlock logons can become positive presence evidence;
 * - network, batch, service and Remote Desktop logons are never attendance;
 * - lock/logoff/session termination are weak negative evidence only. The core
 *   engine deliberately cannot use them as an OUT anchor.
 *
 * WEF/WEC is transport. Collector receipt time is never silently substituted
 * for the Security event's original TimeCreated timestamp.
 */
export function normalizeWefSecurityEvent({
  sourceId,
  employee,
  event,
  receivedAtMs=Date.now(),
  identityBinding,
  workstationBinding
}){
  if(!sourceId || !employee || !event || !Number.isSafeInteger(receivedAtMs)){
    throw new Error('Valid WEF adapter input required.');
  }
  if(identityBinding!=='exact_sid'){
    return {status:'review_required',reason:'WEAK_WINDOWS_IDENTITY_BINDING'};
  }
  if(workstationBinding!=='fixed_site_asset'){
    return {status:'review_required',reason:'WINDOWS_ASSET_NOT_FIXED_TO_SITE'};
  }

  const system=event.system ?? event.System ?? {};
  const data=event.data ?? event.EventData ?? {};
  const eventId=eventNumber(system);
  const computer=safe(system.computer ?? system.Computer);
  if(!computer) return {status:'review_required',reason:'WINDOWS_SOURCE_COMPUTER_MISSING'};

  const occurredAt=sourceTime(system,receivedAtMs);
  const recordId=safe(system.eventRecordId ?? system.EventRecordID) ?? 'record-unknown';
  const channel=safe(system.channel ?? system.Channel) ?? 'Security';
  const logonId=safe(dataValue(data,'TargetLogonId')) ?? safe(dataValue(data,'SubjectLogonId')) ?? null;
  const providerEventId=safe(event.providerEventId) || stableId('wef',[
    sourceId,computer,channel,eventId,recordId,occurredAt,logonId
  ]);

  let kind;
  if(eventId===4624){
    const logonType=Number(dataValue(data,'LogonType'));
    if(LOCAL_LOGON_TYPES.has(logonType)){
      kind='workstation_login';
    } else if(REMOTE_OR_NONINTERACTIVE.has(logonType)){
      return {status:'ignored',reason:'NON_LOCAL_INTERACTIVE_WINDOWS_LOGON',detail:{eventId,logonType}};
    } else {
      return {status:'ignored',reason:'UNSUPPORTED_WINDOWS_LOGON_TYPE',detail:{eventId,logonType:Number.isFinite(logonType)?logonType:null}};
    }
  } else if(eventId===4801){
    kind='workstation_login';
  } else if([4634,4647,4800].includes(eventId)){
    kind='workstation_logout';
  } else {
    return {status:'ignored',reason:'UNSUPPORTED_WINDOWS_SECURITY_EVENT',detail:{eventId}};
  }

  return {
    status:'evidence',
    event:{
      sourceId,
      eventId:providerEventId,
      employee,
      kind,
      observedAt:occurredAt,
      metadata:{
        providerEventId,
        workstationId:computer,
        sourceRevision:recordId
      }
    }
  };
}
