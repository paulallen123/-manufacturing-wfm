import crypto from 'node:crypto';

export const AGENCY_PORTAL_VERSION='agency-supplier-portal-v0.3.0';
export const AGENCY_PORTAL_HANDOFF_VERSION='agency-supplier-handoff-v0.1.0';
const b64u=v=>Buffer.from(v).toString('base64url');
const from64=v=>Buffer.from(v,'base64url').toString('utf8');
const ms=v=>{const x=typeof v==='number'?v:Date.parse(v);return Number.isFinite(x)?x:null};
const str=(v,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const safeArray=(v,max=50)=>Array.isArray(v)?v.slice(0,max):[];
const stable=v=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v);
const h=(secret,data)=>crypto.createHmac('sha256',secret).update(data).digest('base64url');
const eq=(a,b)=>{try{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)}catch{return false}};
const sha=(value,length=24)=>crypto.createHash('sha256').update(String(value??'')).digest('hex').slice(0,length);

function assertSecret(secret){if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw new TypeError('portal signing secret must be at least 32 bytes');}

function normalizeBindingList(bindings=[]){
  const byWorker=new Map();
  for(const item of safeArray(bindings,100)){
    const workerId=str(item?.workerId,100);
    const assuranceVersionId=str(item?.assuranceVersionId??item?.authoritativeRightToWorkAssurance?.assuranceVersionId,32).toLowerCase();
    if(!workerId)throw new TypeError('preferred worker binding requires workerId');
    if(!/^[0-9a-f]{32}$/.test(assuranceVersionId))throw new TypeError('preferred worker binding requires a 32 character assuranceVersionId');
    const previous=byWorker.get(workerId);
    if(previous&&previous!==assuranceVersionId)throw new TypeError('preferred worker binding contains conflicting assurance versions');
    byWorker.set(workerId,assuranceVersionId);
  }
  return [...byWorker.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([workerId,assuranceVersionId])=>({workerId,assuranceVersionId}));
}

export function agencyPortalOfferFingerprint(bindings=[]){
  return sha(JSON.stringify(stable(normalizeBindingList(bindings))),24);
}

export function issueAgencyPortalToken({tenantId,siteId,requestId,agencyId,expiresAt,tokenId,offerFingerprint},secret){
  assertSecret(secret);
  for(const [k,v] of Object.entries({tenantId,siteId,requestId,agencyId,tokenId}))if(typeof v!=='string'||!v)throw new TypeError(`${k} is required`);
  const exp=ms(expiresAt);if(exp===null)throw new TypeError('expiresAt must be valid');
  const offerFp=offerFingerprint===undefined||offerFingerprint===null?'':str(offerFingerprint,24).toLowerCase();
  if(offerFp&&!/^[0-9a-f]{24}$/.test(offerFp))throw new TypeError('offerFingerprint must be a 24 character hex fingerprint');
  const payload=offerFp?{v:2,tenantId,siteId,requestId,agencyId,tokenId,exp,offerFingerprint:offerFp}:{v:1,tenantId,siteId,requestId,agencyId,tokenId,exp};
  const body=b64u(JSON.stringify(stable(payload)));
  return `${body}.${h(secret,body)}`;
}

export function verifyAgencyPortalToken(token,expected,secret,{now,consumedTokenIds=[]}={}){
  assertSecret(secret);
  const fail=reason=>({valid:false,reason,claims:null,tokenFingerprint:tokenFingerprint(token)});
  if(typeof token!=='string'||!token.includes('.'))return fail('malformed_token');
  const parts=token.split('.');if(parts.length!==2)return fail('malformed_token');
  const [body,sig]=parts;if(!eq(sig,h(secret,body)))return fail('invalid_signature');
  let claims;try{claims=JSON.parse(from64(body))}catch{return fail('malformed_payload')}
  if(claims?.v!==1&&claims?.v!==2)return fail('unsupported_token_version');
  if(claims.v===2&&!/^[0-9a-f]{24}$/i.test(str(claims.offerFingerprint,24)))return fail('invalid_offer_fingerprint');
  const nowMs=ms(now);if(nowMs===null)return fail('invalid_now');
  if(!Number.isFinite(Number(claims.exp))||nowMs>Number(claims.exp))return fail('expired_token');
  for(const k of ['tenantId','siteId','requestId','agencyId'])if(expected?.[k]!==undefined&&claims[k]!==expected[k])return fail(`scope_mismatch:${k}`);
  if(expected?.offerFingerprint!==undefined&&str(claims.offerFingerprint,24).toLowerCase()!==str(expected.offerFingerprint,24).toLowerCase())return fail('scope_mismatch:offerFingerprint');
  if((consumedTokenIds||[]).includes(claims.tokenId))return fail('token_already_consumed');
  return {valid:true,reason:null,claims,tokenFingerprint:tokenFingerprint(token)};
}

export function tokenFingerprint(token){return crypto.createHash('sha256').update(String(token??'')).digest('hex').slice(0,16);}

export function buildAgencyPortalView({requestPack,agencyId,preferredWorkerIds=[],responseDeadline}){
  if(!requestPack?.requestId||!agencyId)throw new TypeError('requestPack.requestId and agencyId are required');
  return {version:AGENCY_PORTAL_VERSION,requestId:requestPack.requestId,agencyId,responseDeadline:responseDeadline??null,assignment:structuredClone(requestPack.assignment),hirer:structuredClone(requestPack.hirer),preferredWorkerIds:[...new Set(safeArray(preferredWorkerIds,100).map(x=>str(x,100)).filter(Boolean))],allowedActions:['confirm_preferred_worker','propose_alternative','partial_fill','decline_request'],instructions:'Confirm a preferred worker, propose an alternative, partially fill, or decline. Alternatives are checked before acceptance.',authorityBoundary:'response_capture_only_no_schedule_payroll_or_invoice_mutation'};
}

export function buildAgencyPortalHandoff({requestPack,agencyId,preferredWorkers=[],responseDeadline}){
  const assuranceBindings=normalizeBindingList(preferredWorkers);
  const offerFingerprint=agencyPortalOfferFingerprint(assuranceBindings);
  const view=buildAgencyPortalView({requestPack,agencyId,preferredWorkerIds:assuranceBindings.map(binding=>binding.workerId),responseDeadline});
  return {
    version:AGENCY_PORTAL_HANDOFF_VERSION,
    view,
    securityContext:Object.freeze({
      version:AGENCY_PORTAL_HANDOFF_VERSION,
      offerFingerprint,
      assuranceBindings:Object.freeze(assuranceBindings.map(binding=>Object.freeze({...binding}))),
      authorityBoundary:'server_side_offer_binding_only_no_schedule_payroll_or_invoice_mutation',
      privacyBoundary:'assurance_version_ids_remain_server_side_and_raw_right_to_work_evidence_is_not_in_agency_view',
    }),
  };
}

function sanitizeAlternative(a={}){
  return {workerRef:str(a.workerRef,100),consentToShare:a.consentToShare===true,available:a.available===true,siteReady:a.siteReady===true,restCompliant:a.restCompliant===true,suitabilityStatus:str(a.suitabilityStatus,40),availability:{startAt:a.availability?.startAt??null,endAt:a.availability?.endAt??null},inductionValidUntil:a.inductionValidUntil??null,rightToWork:{status:str(a.rightToWork?.status,40),validUntil:a.rightToWork?.validUntil??null,indefinite:a.rightToWork?.indefinite===true},skills:safeArray(a.skills,50).map(x=>({id:str(x?.id,100),level:Number(x?.level??0)})),qualifications:safeArray(a.qualifications,50).map(x=>({id:str(x?.id,100),level:Number(x?.level??0),status:str(x?.status,40),validUntil:x?.validUntil??null,noExpiry:x?.noExpiry===true})),awr:{weeksInSameRole:Number(a.awr?.weeksInSameRole??0),equalTreatmentConfirmed:a.awr?.equalTreatmentConfirmed===true},chargeRatePerHour:Number(a.chargeRatePerHour??NaN)};
}

export function normalizeAgencyPortalSubmission({view,claims,submission}){
  const f=[];
  if(!view||!claims||!submission)return {valid:false,failures:['missing_portal_context']};
  if(claims.requestId!==view.requestId)f.push('request_scope_mismatch');
  if(claims.agencyId!==view.agencyId)f.push('agency_scope_mismatch');
  const action=str(submission.action,50);
  if(!view.allowedActions.includes(action))f.push('unsupported_action');
  const out={version:AGENCY_PORTAL_VERSION,requestId:view.requestId,agencyId:view.agencyId,action,workerId:null,alternative:null,partialFill:null,declineReason:null,status:'captured_for_validation',authorityBoundary:'response_capture_only_no_schedule_payroll_or_invoice_mutation'};
  if(action==='confirm_preferred_worker'){
    out.workerId=str(submission.workerId,100);
    if(!out.workerId||!view.preferredWorkerIds.includes(out.workerId))f.push('worker_not_in_preferred_list');
  }
  if(action==='propose_alternative'){
    out.alternative=sanitizeAlternative(submission.alternative);
    if(!out.alternative.workerRef)f.push('alternative_worker_ref_required');
    out.status='pending_alternative_revalidation';
  }
  if(action==='partial_fill'){
    out.partialFill={confirmedPreferredWorkerIds:[...new Set(safeArray(submission.confirmedPreferredWorkerIds,100).map(x=>str(x,100)).filter(Boolean))],alternativeWorkers:safeArray(submission.alternativeWorkers,100).map(sanitizeAlternative)};
    for(const id of out.partialFill.confirmedPreferredWorkerIds)if(!view.preferredWorkerIds.includes(id))f.push('partial_fill_contains_nonpreferred_confirmation');
    if(out.partialFill.alternativeWorkers.some(x=>!x.workerRef))f.push('partial_fill_alternative_worker_ref_required');
    out.status=out.partialFill.alternativeWorkers.length?'pending_alternative_revalidation':'captured_for_validation';
  }
  if(action==='decline_request')out.declineReason=str(submission.reason,500);
  return {valid:f.length===0,failures:f,response:out};
}

function preferredWorkerIds(normalized){
  const response=normalized?.response;
  if(response?.action==='confirm_preferred_worker')return response.workerId?[response.workerId]:[];
  if(response?.action==='partial_fill')return safeArray(response.partialFill?.confirmedPreferredWorkerIds,100).map(x=>str(x,100)).filter(Boolean);
  return [];
}

function validatePreferredWorkerHandoff({verification,view,normalized,handoffSecurityContext}){
  const selectedIds=preferredWorkerIds(normalized);
  if(selectedIds.length===0)return {required:false,valid:true,reason:null,selectedBindings:[],offerFingerprint:null};
  if(!handoffSecurityContext||typeof handoffSecurityContext!=='object')return {required:true,valid:false,reason:'preferred_worker_handoff_unbound',selectedBindings:[],offerFingerprint:null};
  let bindings;
  try{bindings=normalizeBindingList(handoffSecurityContext.assuranceBindings)}catch{return {required:true,valid:false,reason:'preferred_worker_handoff_invalid',selectedBindings:[],offerFingerprint:null};}
  const offerFingerprint=agencyPortalOfferFingerprint(bindings);
  if(str(handoffSecurityContext.offerFingerprint,24).toLowerCase()!==offerFingerprint)return {required:true,valid:false,reason:'preferred_worker_handoff_fingerprint_mismatch',selectedBindings:[],offerFingerprint};
  if(verification?.claims?.v!==2||str(verification?.claims?.offerFingerprint,24).toLowerCase()!==offerFingerprint)return {required:true,valid:false,reason:'preferred_worker_token_not_bound_to_offer',selectedBindings:[],offerFingerprint};
  const bindingByWorker=new Map(bindings.map(binding=>[binding.workerId,binding]));
  const selectedBindings=[];
  for(const workerId of selectedIds){
    const binding=bindingByWorker.get(workerId);
    if(!binding)return {required:true,valid:false,reason:'preferred_worker_assurance_binding_missing',selectedBindings:[],offerFingerprint};
    selectedBindings.push(binding);
  }
  const viewIds=new Set(safeArray(view?.preferredWorkerIds,100).map(x=>str(x,100)).filter(Boolean));
  if(bindings.some(binding=>!viewIds.has(binding.workerId)))return {required:true,valid:false,reason:'preferred_worker_handoff_view_mismatch',selectedBindings:[],offerFingerprint};
  return {required:true,valid:true,reason:null,selectedBindings,offerFingerprint};
}

export async function captureAgencyPortalSubmission({token,expected,secret,now,view,submission,tokenStore,handoffSecurityContext}){
  const verification=verifyAgencyPortalToken(token,expected,secret,{now});
  if(!verification.valid)return {accepted:false,reason:verification.reason,verification,normalized:null,consumption:null,receipt:portalAuditReceipt({verification,normalized:null,receivedAt:now})};

  const normalized=normalizeAgencyPortalSubmission({view,claims:verification.claims,submission});
  if(!normalized.valid)return {accepted:false,reason:'invalid_submission',verification,normalized,consumption:null,receipt:portalAuditReceipt({verification,normalized,receivedAt:now})};

  const preferredGate=validatePreferredWorkerHandoff({verification,view,normalized,handoffSecurityContext});
  if(!preferredGate.valid)return {accepted:false,reason:preferredGate.reason,verification,normalized,consumption:null,receipt:portalAuditReceipt({verification,normalized,receivedAt:now,preferredGate})};

  if(!tokenStore||typeof tokenStore.consumeOnce!=='function'){
    return {accepted:false,reason:'token_store_unavailable',verification,normalized,consumption:null,receipt:portalAuditReceipt({verification,normalized,receivedAt:now,preferredGate})};
  }
  if(preferredGate.required&&typeof tokenStore.consumeOnceWithAssuranceBindings!=='function'){
    return {accepted:false,reason:'token_store_assurance_gate_unavailable',verification,normalized,consumption:null,receipt:portalAuditReceipt({verification,normalized,receivedAt:now,preferredGate})};
  }

  const record={
    tenantId:verification.claims.tenantId,
    siteId:verification.claims.siteId,
    requestId:verification.claims.requestId,
    agencyId:verification.claims.agencyId,
    tokenId:verification.claims.tokenId,
    tokenFingerprint:verification.tokenFingerprint,
    expiresAt:new Date(Number(verification.claims.exp)).toISOString(),
    consumedAt:new Date(ms(now)).toISOString(),
    action:normalized.response.action,
  };

  let consumption;
  try{
    consumption=preferredGate.required
      ?await tokenStore.consumeOnceWithAssuranceBindings(record,preferredGate.selectedBindings)
      :await tokenStore.consumeOnce(record);
  }catch{
    return {accepted:false,reason:'token_store_unavailable',verification,normalized,consumption:null,receipt:portalAuditReceipt({verification,normalized,receivedAt:now,preferredGate})};
  }

  if(consumption?.consumed!==true){
    const reason=consumption?.reason==='already_consumed'
      ?'token_already_consumed'
      :consumption?.reason==='assurance_version_changed'
        ?'preferred_worker_assurance_changed'
        :consumption?.reason==='assurance_bindings_missing'
          ?'preferred_worker_assurance_bindings_invalid'
          :'token_store_rejected';
    return {accepted:false,reason,verification,normalized,consumption:consumption??null,receipt:portalAuditReceipt({verification:{...verification,valid:false},normalized,receivedAt:now,consumption,preferredGate})};
  }

  return {accepted:true,reason:null,verification,normalized,consumption,receipt:portalAuditReceipt({verification,normalized,receivedAt:now,consumption,preferredGate})};
}

export function portalAuditReceipt({verification,normalized,receivedAt,consumption,preferredGate}){
  return {version:AGENCY_PORTAL_VERSION,receivedAt:receivedAt??null,tokenFingerprint:verification?.tokenFingerprint??null,tokenId:verification?.claims?.tokenId??null,requestId:normalized?.response?.requestId??verification?.claims?.requestId??null,agencyId:normalized?.response?.agencyId??verification?.claims?.agencyId??null,action:normalized?.response?.action??null,validToken:verification?.valid===true,validSubmission:normalized?.valid===true,tokenConsumed:consumption?.consumed===true,status:normalized?.response?.status??'rejected',preferredWorkerAssuranceBound:preferredGate?.required===true,preferredWorkerAssuranceMatched:preferredGate?.required===true?consumption?.assuranceMatched===true:null,preferredWorkerCount:preferredGate?.selectedBindings?.length??0,offerFingerprint:preferredGate?.offerFingerprint??verification?.claims?.offerFingerprint??null,secretOrRawTokenStored:false,rawRightToWorkEvidenceStored:false};
}
