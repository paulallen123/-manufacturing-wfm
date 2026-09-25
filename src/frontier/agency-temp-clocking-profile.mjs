import crypto from 'node:crypto';

export const AGENCY_TEMP_CLOCKING_PROFILE_VERSION='agency-temp-clocking-profile-v0.1.0';

const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const n=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const ms=value=>{
  const parsed=typeof value==='number'?value:Date.parse(value);
  return Number.isFinite(parsed)?parsed:null;
};
const iso=value=>{
  const parsed=ms(value);
  return parsed===null?null:new Date(parsed).toISOString();
};
const stable=value=>Array.isArray(value)
  ? value.map(stable)
  : value&&typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]))
    : value;
const digest=(value,length=32)=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex').slice(0,length);

const CONFIRMED_ACTIONS=new Set(['confirm_preferred_worker','partial_fill','confirmed_worker']);
const CREDENTIAL_MODES=new Set(['one_time_qr','temporary_pin','verified_badge']);

function fail(reason,input={}){
  return Object.freeze({
    version:AGENCY_TEMP_CLOCKING_PROFILE_VERSION,
    status:'blocked',
    reason,
    tenantId:text(input.tenantId,100)||null,
    siteId:text(input.siteId,100)||null,
    agencyId:text(input.agencyId,100)||null,
    workerId:text(input.workerId,100)||null,
    placementId:text(input.placement?.placementId,120)||null,
    clockingProfile:null,
    clockingWriteAuthorized:false,
    payrollWriteAuthorized:false,
    scheduleWriteAuthorized:false,
    workerMasterWriteAuthorized:false,
    invoiceWriteAuthorized:false,
    authorityBoundary:'confirmed_ready_placement_only_registered_kiosk_clocking_no_payroll_schedule_invoice_or_worker_master_authority',
  });
}

function scopeMatches(readiness,input){
  if(!readiness||readiness.workStartReady!==true)return false;
  return text(readiness.siteId,100)===text(input.siteId,100)
    && text(readiness.agencyId,100)===text(input.agencyId,100)
    && text(readiness.workerId,100)===text(input.workerId,100)
    && text(readiness.requestId,100)===text(input.requestId,100);
}

function confirmationMatches(confirmation,input){
  if(!confirmation||confirmation.confirmed!==true)return false;
  const action=text(confirmation.action,50)||'confirmed_worker';
  if(!CONFIRMED_ACTIONS.has(action))return false;
  return text(confirmation.workerId,100)===text(input.workerId,100)
    && text(confirmation.agencyId,100)===text(input.agencyId,100)
    && text(confirmation.requestId,100)===text(input.requestId,100);
}

function placementWindow(placement={}){
  const start=ms(placement.startAt),end=ms(placement.endAt);
  if(start===null||end===null||end<=start)return null;
  return {start,end};
}

function profileIds(input){
  const principalKey={
    tenantId:text(input.tenantId,100),
    workerId:text(input.workerId,100),
  };
  const entitlementKey={
    tenantId:text(input.tenantId,100),
    siteId:text(input.siteId,100),
    workerId:text(input.workerId,100),
    placementId:text(input.placement?.placementId,120),
  };
  return {
    principalId:'agency-temp-'+digest(principalKey,24),
    entitlementId:'agency-clock-'+digest(entitlementKey,24),
  };
}

export function provisionAgencyTempClockingProfile(input={}){
  const tenantId=text(input.tenantId,100);
  const siteId=text(input.siteId,100);
  const agencyId=text(input.agencyId,100);
  const workerId=text(input.workerId,100);
  const requestId=text(input.requestId,100);
  const placement=input.placement||{};
  const placementId=text(placement.placementId,120);

  if(!tenantId||!siteId||!agencyId||!workerId||!requestId||!placementId)return fail('temp_clocking_scope_invalid',input);
  if(placement.status&&!['confirmed','active','scheduled'].includes(text(placement.status,40)))return fail('temp_clocking_placement_not_confirmed',input);
  if(text(placement.workerId,100)!==workerId||text(placement.agencyId,100)!==agencyId||text(placement.siteId,100)!==siteId)return fail('temp_clocking_placement_scope_mismatch',input);
  if(!confirmationMatches(input.confirmation,{...input,requestId}))return fail('temp_clocking_worker_not_finally_confirmed',input);
  if(!scopeMatches(input.readiness,{...input,requestId}))return fail('temp_clocking_work_start_readiness_not_proven',input);
  if(input.policy?.siteTempClockingEnabled!==true)return fail('temp_clocking_disabled_for_site',input);

  const window=placementWindow(placement);
  if(!window)return fail('temp_clocking_placement_window_invalid',input);

  const preStart=Math.max(0,Math.min(120,Math.floor(n(input.policy?.clockInEarlyWindowMinutes,60))));
  const postEnd=Math.max(0,Math.min(240,Math.floor(n(input.policy?.clockOutGraceMinutes,120))));
  const validFrom=new Date(window.start-preStart*60_000).toISOString();
  const validUntil=new Date(window.end+postEnd*60_000).toISOString();
  const credentialMode=CREDENTIAL_MODES.has(text(input.policy?.credentialMode,40))
    ? text(input.policy.credentialMode,40)
    : 'one_time_qr';
  const ids=profileIds({...input,requestId});

  const clockingProfile={
    version:AGENCY_TEMP_CLOCKING_PROFILE_VERSION,
    profileType:'temporary_agency_worker',
    principalId:ids.principalId,
    entitlementId:ids.entitlementId,
    tenantId,
    siteId,
    agencyId,
    workerId,
    requestId,
    placementId,
    assignmentId:text(placement.assignmentId,120)||null,
    validFrom,
    validUntil,
    placementStartAt:new Date(window.start).toISOString(),
    placementEndAt:new Date(window.end).toISOString(),
    state:'active',
    source:'agency_worker_confirmation',
    clockingSource:'agency_temp_kiosk',
    allowedActions:['clock_in','break_start','break_end','clock_out'],
    credential:{
      mode:credentialMode,
      plaintextStored:false,
      provisioning:'automatic_secure_issue_or_existing_verified_badge',
      delivery:'worker_or_agency_secure_channel',
      rotationRequiredOnReplacement:true,
    },
    eventLinkage:{
      required:['tenantId','siteId','workerId','agencyId','placementId','entitlementId'],
      preserveRawEvents:true,
      reviewBeforePayOrInvoice:true,
      attendanceSource:'agency_temp_kiosk',
    },
    lifecycle:{
      autoActivateAt:validFrom,
      autoExpireAt:validUntil,
      revokeOn:['placement_cancelled','worker_replaced','readiness_revoked','site_access_revoked'],
      rebookingRule:'reuse_stable_principal_create_new_placement_entitlement',
    },
    privacyBoundary:'minimal_kiosk_identity_no_dob_health_protected_characteristics_or_raw_right_to_work_evidence',
    authorityBoundary:'registered_kiosk_clock_events_only_within_placement_entitlement',
    clockingWriteAuthorized:true,
    payrollWriteAuthorized:false,
    scheduleWriteAuthorized:false,
    workerMasterWriteAuthorized:false,
    invoiceWriteAuthorized:false,
  };

  const output={
    version:AGENCY_TEMP_CLOCKING_PROFILE_VERSION,
    status:'provisioned',
    reason:null,
    tenantId,
    siteId,
    agencyId,
    workerId,
    placementId,
    clockingProfile,
    clockingWriteAuthorized:true,
    payrollWriteAuthorized:false,
    scheduleWriteAuthorized:false,
    workerMasterWriteAuthorized:false,
    invoiceWriteAuthorized:false,
    automation:{
      trigger:'final_agency_worker_confirmation_and_work_start_readiness_pass',
      action:'create_or_refresh_temp_clocking_profile',
      managerDayOfShiftSetupRequired:false,
      workerExperience:'arrive_identify_clock_in_clock_out_leave',
      credentialDeliveryRequired:credentialMode!=='verified_badge',
    },
  };
  output.provisioningFingerprint=digest(output,32);
  return Object.freeze(output);
}

export function revokeAgencyTempClockingProfile(profile,reason='placement_cancelled',revokedAt=new Date().toISOString()){
  if(!profile?.entitlementId||profile.profileType!=='temporary_agency_worker')throw new TypeError('valid temporary agency clocking profile is required');
  const next=structuredClone(profile);
  next.state='revoked';
  next.revokedAt=iso(revokedAt);
  if(!next.revokedAt)throw new TypeError('revokedAt invalid');
  next.revocationReason=text(reason,80)||'revoked';
  next.clockingWriteAuthorized=false;
  next.authorityBoundary='new_clock_in_blocked_after_revocation_open_session_may_only_close_safely';
  return Object.freeze(next);
}

export function evaluateAgencyTempClockAction(profile,{action,at,openSession=null}={}){
  const clockAction=text(action,30);
  const atMs=ms(at);
  if(!profile?.entitlementId||profile.profileType!=='temporary_agency_worker')return {allowed:false,reason:'temp_clocking_profile_invalid'};
  if(atMs===null)return {allowed:false,reason:'temp_clocking_time_invalid'};

  if(clockAction==='clock_out'&&openSession?.entitlementId===profile.entitlementId&&openSession?.status==='open'){
    return {
      allowed:true,
      reason:null,
      safeCloseOnly:profile.state!=='active'||atMs>ms(profile.validUntil),
      captureContract:buildAgencyTempClockEventLink(profile,'clock_out',at),
    };
  }

  if(profile.state!=='active'||profile.clockingWriteAuthorized!==true)return {allowed:false,reason:'temp_clocking_profile_not_active'};
  const start=ms(profile.validFrom),end=ms(profile.validUntil);
  if(start===null||end===null||atMs<start||atMs>end)return {allowed:false,reason:'temp_clocking_outside_entitlement_window'};
  if(!['clock_in','break_start','break_end','clock_out'].includes(clockAction))return {allowed:false,reason:'temp_clocking_action_not_allowed'};

  return {
    allowed:true,
    reason:null,
    safeCloseOnly:false,
    captureContract:buildAgencyTempClockEventLink(profile,clockAction,at),
  };
}

export function buildAgencyTempClockEventLink(profile,action,at){
  if(!profile?.entitlementId)throw new TypeError('clocking profile entitlement required');
  const timestamp=iso(at);
  if(!timestamp)throw new TypeError('clock event timestamp invalid');
  return Object.freeze({
    source:'agency_temp_kiosk',
    eventType:text(action,30),
    occurredAt:timestamp,
    tenantId:profile.tenantId,
    siteId:profile.siteId,
    workerId:profile.workerId,
    agencyId:profile.agencyId,
    placementId:profile.placementId,
    entitlementId:profile.entitlementId,
    assignmentId:profile.assignmentId??null,
    preserveRawEvent:true,
    requiresAttendanceReview:true,
    payrollAuthority:false,
    invoiceAuthority:false,
  });
}
