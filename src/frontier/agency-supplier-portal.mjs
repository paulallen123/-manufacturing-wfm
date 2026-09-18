import crypto from 'node:crypto';

export const AGENCY_PORTAL_VERSION='agency-supplier-portal-v0.2.0';
const b64u=v=>Buffer.from(v).toString('base64url');
const from64=v=>Buffer.from(v,'base64url').toString('utf8');
const ms=v=>{const x=typeof v==='number'?v:Date.parse(v);return Number.isFinite(x)?x:null};
const str=(v,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const safeArray=(v,max=50)=>Array.isArray(v)?v.slice(0,max):[];
const stable=v=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v);
const h=(secret,data)=>crypto.createHmac('sha256',secret).update(data).digest('base64url');
const eq=(a,b)=>{try{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)}catch{return false}};

function assertSecret(secret){if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw new TypeError('portal signing secret must be at least 32 bytes');}

export function issueAgencyPortalToken({tenantId,siteId,requestId,agencyId,expiresAt,tokenId},secret){
  assertSecret(secret);
  for(const [k,v] of Object.entries({tenantId,siteId,requestId,agencyId,tokenId}))if(typeof v!=='string'||!v)throw new TypeError(`${k} is required`);
  const exp=ms(expiresAt);if(exp===null)throw new TypeError('expiresAt must be valid');
  const payload={v:1,tenantId,siteId,requestId,agencyId,tokenId,exp};
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
  if(claims?.v!==1)return fail('unsupported_token_version');
  const nowMs=ms(now);if(nowMs===null)return fail('invalid_now');
  if(!Number.isFinite(Number(claims.exp))||nowMs>Number(claims.exp))return fail('expired_token');
  for(const k of ['tenantId','siteId','requestId','agencyId'])if(expected?.[k]!==undefined&&claims[k]!==expected[k])return fail(`scope_mismatch:${k}`);
  if((consumedTokenIds||[]).includes(claims.tokenId))return fail('token_already_consumed');
  return {valid:true,reason:null,claims,tokenFingerprint:tokenFingerprint(token)};
}

export function tokenFingerprint(token){return crypto.createHash('sha256').update(String(token??'')).digest('hex').slice(0,16);}

export function buildAgencyPortalView({requestPack,agencyId,preferredWorkerIds=[],responseDeadline}){
  if(!requestPack?.requestId||!agencyId)throw new TypeError('requestPack.requestId and agencyId are required');
  return {version:AGENCY_PORTAL_VERSION,requestId:requestPack.requestId,agencyId,responseDeadline:responseDeadline??null,assignment:structuredClone(requestPack.assignment),hirer:structuredClone(requestPack.hirer),preferredWorkerIds:[...new Set(safeArray(preferredWorkerIds,100).map(x=>str(x,100)).filter(Boolean))],allowedActions:['confirm_preferred_worker','propose_alternative','partial_fill','decline_request'],instructions:'Confirm a preferred worker, propose an alternative, partially fill, or decline. Alternatives are checked before acceptance.',authorityBoundary:'response_capture_only_no_schedule_payroll_or_invoice_mutation'};
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

export async function captureAgencyPortalSubmission({token,expected,secret,now,view,submission,tokenStore}){
  const verification=verifyAgencyPortalToken(token,expected,secret,{now});
  if(!verification.valid)return {accepted:false,reason:verification.reason,verification,normalized:null,consumption:null,receipt:portalAuditReceipt({verification,normalized:null,receivedAt:now})};

  const normalized=normalizeAgencyPortalSubmission({view,claims:verification.claims,submission});
  if(!normalized.valid)return {accepted:false,reason:'invalid_submission',verification,normalized,consumption:null,receipt:portalAuditReceipt({verification,normalized,receivedAt:now})};

  if(!tokenStore||typeof tokenStore.consumeOnce!=='function'){
    return {accepted:false,reason:'token_store_unavailable',verification,normalized,consumption:null,receipt:portalAuditReceipt({verification,normalized,receivedAt:now})};
  }

  let consumption;
  try{
    consumption=await tokenStore.consumeOnce({
      tenantId:verification.claims.tenantId,
      siteId:verification.claims.siteId,
      requestId:verification.claims.requestId,
      agencyId:verification.claims.agencyId,
      tokenId:verification.claims.tokenId,
      tokenFingerprint:verification.tokenFingerprint,
      expiresAt:new Date(Number(verification.claims.exp)).toISOString(),
      consumedAt:new Date(ms(now)).toISOString(),
      action:normalized.response.action,
    });
  }catch{
    return {accepted:false,reason:'token_store_unavailable',verification,normalized,consumption:null,receipt:portalAuditReceipt({verification,normalized,receivedAt:now})};
  }

  if(consumption?.consumed!==true){
    const reason=consumption?.reason==='already_consumed'?'token_already_consumed':'token_store_rejected';
    return {accepted:false,reason,verification,normalized,consumption:consumption??null,receipt:portalAuditReceipt({verification:{...verification,valid:false},normalized,receivedAt:now,consumption})};
  }

  return {accepted:true,reason:null,verification,normalized,consumption,receipt:portalAuditReceipt({verification,normalized,receivedAt:now,consumption})};
}

export function portalAuditReceipt({verification,normalized,receivedAt,consumption}){
  return {version:AGENCY_PORTAL_VERSION,receivedAt:receivedAt??null,tokenFingerprint:verification?.tokenFingerprint??null,tokenId:verification?.claims?.tokenId??null,requestId:normalized?.response?.requestId??verification?.claims?.requestId??null,agencyId:normalized?.response?.agencyId??verification?.claims?.agencyId??null,action:normalized?.response?.action??null,validToken:verification?.valid===true,validSubmission:normalized?.valid===true,tokenConsumed:consumption?.consumed===true,status:normalized?.response?.status??'rejected',secretOrRawTokenStored:false};
}
