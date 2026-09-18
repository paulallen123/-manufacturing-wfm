import crypto from 'node:crypto';

const SAFE_ID=/^[A-Za-z0-9_.:-]{1,160}$/;
const IDENTITY_BINDINGS=new Set(['assigned_badge','managed_mobile_credential','verified_personal_credential']);
const DIRECTIONS=new Set(['entry','exit']);

function safe(v){ return SAFE_ID.test(String(v||'')) ? String(v) : null; }
function stableId(parts){
  return `access-${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32)}`;
}
function occurred(value, receivedAtMs){
  const ms=Date.parse(String(value||''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date(receivedAtMs).toISOString();
}

/**
 * Provider-neutral safety boundary between a physical access connector and the
 * attendance engine. It intentionally does not infer that "door unlocked"
 * means a person crossed the door. Only a person-bound, granted credential
 * event at a configured directional access point becomes attendance evidence.
 */
export function normalizeAccessDecision({
  sourceId,
  employee,
  provider,
  event,
  accessPoint,
  receivedAtMs=Date.now(),
  identityBinding,
}={}){
  if(!safe(sourceId) || !safe(employee) || !safe(provider) || !event || !accessPoint || !Number.isSafeInteger(receivedAtMs)){
    throw new Error('Valid access-control adapter input required.');
  }
  if(!IDENTITY_BINDINGS.has(identityBinding)){
    return {status:'review_required',reason:'WEAK_ACCESS_IDENTITY_BINDING'};
  }

  const eventType=String(event.type||event.eventType||'').toLowerCase().replace(/[^a-z0-9]+/g,'_');
  const decision=String(event.decision||event.result||event.status||'').toLowerCase().replace(/[^a-z0-9]+/g,'_');
  const granted=event.granted===true || ['granted','access_granted','success','allowed','valid'].includes(decision) || /(^|_)access_granted($|_)/.test(eventType);
  const denied=event.granted===false || ['denied','access_denied','rejected','invalid'].includes(decision) || /(^|_)access_denied($|_)/.test(eventType);

  const accessPointId=safe(event.accessPointId)||safe(event.doorId)||safe(event.readerId)||safe(accessPoint.id);
  if(!accessPointId) return {status:'review_required',reason:'MISSING_ACCESS_POINT_ID'};

  const providerEventId=safe(event.providerEventId)||safe(event.id)||stableId([
    provider,sourceId,employee,eventType,decision,accessPointId,event.occurredAt,event.timestamp,event.sequence
  ]);

  if(denied){
    return {
      status:'operational_event',
      event:{
        type:'access_denied',provider,providerEventId,employee,sourceId,accessPointId,
        observedAt:occurred(event.occurredAt||event.timestamp,receivedAtMs)
      }
    };
  }

  if(['door_forced','forced_open','door_held','held_open','tamper','controller_offline','door_tailgating','door_tamper','door_acu_tamper','door_lockdown'].includes(eventType)){
    return {
      status:'operational_event',
      event:{type:eventType,provider,providerEventId,employee,sourceId,accessPointId,observedAt:occurred(event.occurredAt||event.timestamp,receivedAtMs)}
    };
  }

  // A remote unlock, request-to-exit relay, or door-status transition is not
  // person-presence evidence unless the provider explicitly reports a granted
  // credential decision tied to the mapped employee.
  if(!granted) return {status:'ignored',reason:'NOT_A_GRANTED_PERSON_ACCESS_EVENT'};

  const eventDirection=String(event.direction||'').toLowerCase();
  const configuredDirection=String(accessPoint.direction||'').toLowerCase();
  const direction=DIRECTIONS.has(eventDirection)?eventDirection:(DIRECTIONS.has(configuredDirection)?configuredDirection:null);
  if(!direction) return {status:'review_required',reason:'UNKNOWN_ACCESS_DIRECTION'};
  if(accessPoint.attendanceEligible===false) return {status:'ignored',reason:'ACCESS_POINT_NOT_ATTENDANCE_ELIGIBLE'};

  const zoneId=safe(accessPoint.zoneId)||safe(event.zoneId)||undefined;
  const controllerId=safe(event.controllerId)||undefined;
  const sourceRevision=safe(event.sourceRevision)||undefined;
  const sequence=Number.isSafeInteger(event.sequence)?event.sequence:undefined;

  return {
    status:'evidence',
    event:{
      sourceId,
      eventId:providerEventId,
      employee,
      kind:direction==='entry'?'access_entry':'access_exit',
      observedAt:occurred(event.occurredAt||event.timestamp,receivedAtMs),
      metadata:{providerEventId,accessPointId,controllerId,zoneId,sourceRevision,sequence}
    }
  };
}

export const ACCESS_PROVIDER_CAPABILITIES=Object.freeze({
  kisi:{realtime:'webhook',reconciliation:'events_api',deployment:'cloud',customerNetworkChange:false},
  verkada:{realtime:'webhook',reconciliation:'events_api',deployment:'cloud',customerNetworkChange:false},
  gallagher:{realtime:'live_events_api',reconciliation:'historical_events_api',deployment:'hybrid',customerNetworkChange:'gateway_or_edge'},
  genetec:{realtime:'web_sdk_event_listener',reconciliation:'access_event_query',deployment:'hybrid',customerNetworkChange:'usually_edge_or_reachable_websdk'},
  hid_origo:{realtime:'callback',reconciliation:'event_management_api',deployment:'cloud',customerNetworkChange:false},
  onvif:{realtime:'standard_event_interface',reconciliation:'implementation_dependent',deployment:'edge',customerNetworkChange:'local_edge'},
  generic:{realtime:'adapter_dependent',reconciliation:'adapter_dependent',deployment:'unknown',customerNetworkChange:'unknown'},
});

/**
 * Produces the lowest-friction supported connection strategy. It is deliberately
 * declarative: secret collection/OAuth remains in the product's secure connector
 * layer, while this function decides which integration lane to offer the user.
 */
export function planAccessConnection({provider,hasCloudGateway=false,onvifProfileA=false,webhookAvailable=false,webSdkReachable=false}={}){
  const p=String(provider||'').toLowerCase();
  if(p==='kisi') return {strategy:'cloud_webhook',realtime:true,backfill:true,customerSteps:['authorize','confirm_door_directions']};
  if(p==='verkada') return {strategy:'cloud_signed_webhook',realtime:true,backfill:true,customerSteps:['authorize','configure_webhook_secret','confirm_door_directions']};
  if(p==='hid_origo') return {strategy:'cloud_callback',realtime:true,backfill:true,customerSteps:['authorize','confirm_door_directions']};
  if(p==='gallagher'){
    if(hasCloudGateway) return {strategy:'cloud_gateway_live_events',realtime:true,backfill:true,customerSteps:['authorize','confirm_door_directions']};
    return {strategy:'edge_live_events',realtime:true,backfill:true,customerSteps:['install_or_enable_edge_connector','authorize','confirm_door_directions']};
  }
  if(p==='genetec'){
    if(webSdkReachable) return {strategy:'websdk_event_listener',realtime:true,backfill:true,customerSteps:['authorize','confirm_door_directions']};
    return {strategy:'edge_websdk_event_listener',realtime:true,backfill:true,customerSteps:['install_or_enable_edge_connector','authorize','confirm_door_directions']};
  }
  if(onvifProfileA) return {strategy:'edge_onvif_events',realtime:true,backfill:false,customerSteps:['install_or_enable_edge_connector','authorize','confirm_door_directions']};
  if(webhookAvailable) return {strategy:'generic_webhook',realtime:true,backfill:false,customerSteps:['authorize','confirm_door_directions']};
  return {strategy:'connector_assessment',realtime:false,backfill:false,customerSteps:['identify_access_platform']};
}
