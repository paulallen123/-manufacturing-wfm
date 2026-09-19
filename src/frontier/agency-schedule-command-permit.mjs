import crypto from 'node:crypto';
import { guardAgencyScheduleAuthority } from './agency-schedule-authority-guard.mjs';

export const AGENCY_SCHEDULE_COMMAND_PERMIT_VERSION='agency-schedule-command-permit-v0.1.1';

const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const ms=value=>{const parsed=typeof value==='number'?value:Date.parse(value);return Number.isFinite(parsed)?parsed:null;};
const iso=value=>{const parsed=ms(value);return parsed===null?null:new Date(parsed).toISOString();};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=(value,length=24)=>crypto.createHash('sha256').update(String(value??'')).digest('hex').slice(0,length);
function required(value,name,max=200){const clean=text(value,max+1);if(!clean)throw new TypeError(`${name} is required`);if(clean.length>max)throw new TypeError(`${name} is too long`);return clean;}

function assignmentFingerprint(request={}){
  const scope={roleId:required(request.roleId,'request.roleId',100),location:required(request.location,'request.location',200),startAt:iso(request.startAt),endAt:iso(request.endAt)};
  if(!scope.startAt||!scope.endAt||Date.parse(scope.endAt)<=Date.parse(scope.startAt))throw new TypeError('request assignment window is invalid');
  return digest(JSON.stringify(stable(scope)));
}

function normalizeBindings(bindings){
  if(!Array.isArray(bindings)||bindings.length===0||bindings.length>100)return null;
  const out=[];const seen=new Set();
  for(const binding of bindings){
    if(!binding||typeof binding!=='object'||Array.isArray(binding))return null;
    const keys=Object.keys(binding).sort();
    if(keys.length!==2||keys[0]!=='assuranceVersionId'||keys[1]!=='workerId')return null;
    const workerId=text(binding.workerId,100);const assuranceVersionId=text(binding.assuranceVersionId,32).toLowerCase();
    if(!workerId||seen.has(workerId)||!/^[0-9a-f]{32}$/.test(assuranceVersionId))return null;
    seen.add(workerId);out.push(Object.freeze({workerId,assuranceVersionId}));
  }
  return Object.freeze(out.sort((a,b)=>a.workerId.localeCompare(b.workerId)));
}

function makeError(code){const error=new Error(code);error.code=code;return error;}

function fail(reason,{guard=null,request=null,siteId=null,agencyId=null,shadowCommandFingerprint=null}={}){
  return {
    version:AGENCY_SCHEDULE_COMMAND_PERMIT_VERSION,
    permitPassed:false,
    reason,
    guardPassed:guard?.guardPassed===true,
    guardReason:guard?.reason??null,
    requestId:text(request?.requestId,100)||null,
    siteId:text(siteId,100)||null,
    agencyId:text(agencyId,100)||null,
    guardFingerprint:text(guard?.guardFingerprint,32)||null,
    scheduleHandoffFingerprint:text(guard?.scheduleHandoffFingerprint,32)||null,
    shadowCommandFingerprint,
    scheduleWriteAuthorized:false,
    authorityBoundary:'transaction_scoped_shadow_permit_only_no_live_schedule_payroll_invoice_or_worker_master_mutation',
    privacyBoundary:'no_portal_token_share_code_date_of_birth_document_number_destination_or_raw_right_to_work_evidence_in_permit_output',
  };
}

function validateCommand(command,expected){
  if(!command||typeof command!=='object'||Array.isArray(command))return {ok:false,reason:'schedule_command_invalid'};
  const allowed=['agencyId','assignmentFingerprint','endAt','location','requestId','roleId','scheduleHandoffFingerprint','siteId','startAt','tenantId','type','workerAssuranceBindings'];
  const unexpected=Object.keys(command).filter(key=>!allowed.includes(key));
  if(unexpected.length)return {ok:false,reason:'schedule_command_unexpected_field'};
  if(text(command.type,80)!=='shadow_schedule_assignment')return {ok:false,reason:'schedule_command_type_invalid'};
  for(const key of ['tenantId','siteId','requestId','agencyId'])if(text(command[key],100)!==expected[key])return {ok:false,reason:`schedule_command_${key.replace(/[A-Z]/g,m=>`_${m.toLowerCase()}`)}_mismatch`};
  if(text(command.roleId,100)!==expected.roleId||text(command.location,200)!==expected.location)return {ok:false,reason:'schedule_command_assignment_scope_mismatch'};
  if(iso(command.startAt)!==expected.startAt||iso(command.endAt)!==expected.endAt)return {ok:false,reason:'schedule_command_assignment_window_mismatch'};
  if(text(command.assignmentFingerprint,24).toLowerCase()!==expected.assignmentFingerprint)return {ok:false,reason:'schedule_command_assignment_fingerprint_mismatch'};
  if(text(command.scheduleHandoffFingerprint,32).toLowerCase()!==expected.scheduleHandoffFingerprint)return {ok:false,reason:'schedule_command_handoff_fingerprint_mismatch'};
  const bindings=normalizeBindings(command.workerAssuranceBindings);if(!bindings)return {ok:false,reason:'schedule_command_worker_bindings_invalid'};
  if(JSON.stringify(bindings)!==JSON.stringify(expected.workerAssuranceBindings))return {ok:false,reason:'schedule_command_worker_bindings_mismatch'};
  return {ok:true,bindings};
}

// Module-private capability registry: a structurally similar object cannot impersonate a permit.
const issuedPermits=new WeakMap();

export function consumeAgencyScheduleCommandPermitAtIngress(permit,command={}){
  const state=permit&&typeof permit==='object'?issuedPermits.get(permit):null;
  if(!state)throw makeError('schedule_command_permit_untrusted');
  if(!state.active)throw makeError('schedule_command_permit_expired');
  if(state.consumed)throw makeError('schedule_command_permit_already_consumed');
  const checked=validateCommand(command,state.expected);
  if(!checked.ok){state.onFailure(checked.reason);throw makeError(checked.reason);}
  state.consumed=true;
  const expected=state.expected;
  const evidence={type:'shadow_schedule_assignment',tenantId:expected.tenantId,siteId:expected.siteId,requestId:expected.requestId,agencyId:expected.agencyId,roleId:expected.roleId,location:expected.location,startAt:expected.startAt,endAt:expected.endAt,assignmentFingerprint:expected.assignmentFingerprint,scheduleHandoffFingerprint:expected.scheduleHandoffFingerprint,workerAssuranceBindings:checked.bindings};
  const shadowCommandFingerprint=digest(JSON.stringify(stable(evidence)),32);
  const envelope=Object.freeze({version:AGENCY_SCHEDULE_COMMAND_PERMIT_VERSION,acceptedForShadow:true,scheduleWriteAuthorized:false,requestId:expected.requestId,siteId:expected.siteId,agencyId:expected.agencyId,assignmentFingerprint:expected.assignmentFingerprint,scheduleHandoffFingerprint:expected.scheduleHandoffFingerprint,workerAssuranceBindings:checked.bindings,shadowCommandFingerprint,authorityBoundary:'shadow_command_envelope_only_no_live_schedule_mutation'});
  state.onEnvelope(envelope);
  return envelope;
}

export async function evaluateAgencyScheduleCommandPermit({tenantId,siteId,agencyId,tokenId,request,now,preflight,authorityStore,shadowScheduleCommand}={}){
  if(typeof shadowScheduleCommand!=='function')return fail('shadow_schedule_command_required',{request,siteId,agencyId});
  let requestScope;
  try{
    requestScope={
      tenantId:required(tenantId,'tenantId',100),siteId:required(siteId,'siteId',100),requestId:required(request?.requestId,'request.requestId',100),agencyId:required(agencyId,'agencyId',100),
      roleId:required(request?.roleId,'request.roleId',100),location:required(request?.location,'request.location',200),startAt:iso(request?.startAt),endAt:iso(request?.endAt),assignmentFingerprint:assignmentFingerprint(request),
    };
    if(!requestScope.startAt||!requestScope.endAt)throw new TypeError('request assignment window is invalid');
  }catch{return fail('schedule_command_scope_invalid',{request,siteId,agencyId});}

  let permitFailure=null;let shadowEnvelope=null;let permitIssued=false;
  const guard=await guardAgencyScheduleAuthority({tenantId,siteId,agencyId,tokenId,request,now,preflight,authorityStore,shadowCriticalSection:async guardContext=>{
    const expectedBindings=normalizeBindings(guardContext.workerAssuranceBindings);
    if(!expectedBindings){permitFailure='schedule_command_guard_bindings_invalid';throw makeError(permitFailure);}
    const expected=Object.freeze({...requestScope,scheduleHandoffFingerprint:text(guardContext.scheduleHandoffFingerprint,32).toLowerCase(),workerAssuranceBindings:expectedBindings});
    const state={active:true,consumed:false,expected,onFailure:reason=>{permitFailure=reason;},onEnvelope:envelope=>{shadowEnvelope=envelope;}};
    permitIssued=true;
    let permit;
    permit=Object.freeze({
      version:AGENCY_SCHEDULE_COMMAND_PERMIT_VERSION,
      consume(command={}){return consumeAgencyScheduleCommandPermitAtIngress(permit,command);},
    });
    issuedPermits.set(permit,state);
    try{
      await shadowScheduleCommand(permit);
      if(!state.consumed){permitFailure='schedule_command_permit_not_consumed';throw makeError(permitFailure);}
    }finally{state.active=false;}
  }});

  if(!guard?.guardPassed)return fail(permitFailure??guard?.reason??'schedule_command_guard_failed',{guard,request,siteId,agencyId,shadowCommandFingerprint:shadowEnvelope?.shadowCommandFingerprint??null});
  if(!permitIssued||!shadowEnvelope)return fail('schedule_command_permit_not_consumed',{guard,request,siteId,agencyId});
  return {
    version:AGENCY_SCHEDULE_COMMAND_PERMIT_VERSION,
    permitPassed:true,
    reason:null,
    guardPassed:true,
    guardReason:null,
    requestId:requestScope.requestId,
    siteId:requestScope.siteId,
    agencyId:requestScope.agencyId,
    guardFingerprint:guard.guardFingerprint,
    scheduleHandoffFingerprint:shadowEnvelope.scheduleHandoffFingerprint,
    workerAssuranceBindings:shadowEnvelope.workerAssuranceBindings,
    shadowCommandFingerprint:shadowEnvelope.shadowCommandFingerprint,
    scheduleWriteAuthorized:false,
    authorityBoundary:'transaction_scoped_shadow_permit_only_no_live_schedule_payroll_invoice_or_worker_master_mutation',
    privacyBoundary:'no_portal_token_share_code_date_of_birth_document_number_destination_or_raw_right_to_work_evidence_in_permit_output',
    atomicityRule:'permit_is_issued_consumed_and_invalidated_inside_the_same_locked_database_transaction_and_never_grants_live_schedule_write_authority',
  };
}