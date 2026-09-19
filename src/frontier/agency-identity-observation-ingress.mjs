import crypto from 'node:crypto';

export const AGENCY_IDENTITY_OBSERVATION_INGRESS_VERSION='agency-identity-observation-ingress-v0.1.0';
export const AGENCY_IDENTITY_OBSERVATION_INGRESS_STORE_VERSION='agency-identity-observation-ingress-store-v0.1.0';
export const AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL=`
CREATE TABLE IF NOT EXISTS wfm_agency_identity_observation_ingress_receipts (
 tenant_id text NOT NULL, source_system_id text NOT NULL,
 source_event_fingerprint text NOT NULL CHECK (source_event_fingerprint ~ '^[0-9a-f]{32}$'),
 source_auth_fingerprint text NOT NULL CHECK (source_auth_fingerprint ~ '^[0-9a-f]{32}$'),
 binding_fingerprint text NOT NULL CHECK (binding_fingerprint ~ '^[0-9a-f]{32}$'),
 ingress_version text NOT NULL, received_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint));
CREATE INDEX IF NOT EXISTS idx_wfm_agency_identity_observation_ingress_receipts_scope
 ON wfm_agency_identity_observation_ingress_receipts (tenant_id,source_system_id,source_event_fingerprint,received_at);
CREATE OR REPLACE FUNCTION wfm_agency_identity_observation_ingress_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'agency identity observation ingress receipts are append only'; END; $$;
DROP TRIGGER IF EXISTS trg_wfm_agency_identity_observation_ingress_no_update ON wfm_agency_identity_observation_ingress_receipts;
CREATE TRIGGER trg_wfm_agency_identity_observation_ingress_no_update BEFORE UPDATE ON wfm_agency_identity_observation_ingress_receipts FOR EACH ROW EXECUTE FUNCTION wfm_agency_identity_observation_ingress_append_only();
DROP TRIGGER IF EXISTS trg_wfm_agency_identity_observation_ingress_no_delete ON wfm_agency_identity_observation_ingress_receipts;
CREATE TRIGGER trg_wfm_agency_identity_observation_ingress_no_delete BEFORE DELETE ON wfm_agency_identity_observation_ingress_receipts FOR EACH ROW EXECUTE FUNCTION wfm_agency_identity_observation_ingress_append_only();`;

const SIGNALS=new Set(['access_pass','attendance_clock_in','supervised_identity_check','rtw_dvsp_holder_check']);
const txt=(v,n=200)=>typeof v==='string'?v.trim().slice(0,n):'';
const time=v=>{const x=typeof v==='number'?v:Date.parse(v);return Number.isFinite(x)?x:null;};
const iso=v=>{const x=time(v);return x===null?null:new Date(x).toISOString();};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=(v,n=32)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
function req(v,name,n=200){const x=txt(v,n+1);if(!x||x.length>n)throw new TypeError(`${name} invalid`);return x;}
function hex(v,n,name){const x=req(v,name,n).toLowerCase();if(!new RegExp(`^[0-9a-f]{${n}}$`).test(x))throw new TypeError(`${name} invalid`);return x;}
function hdr(h,n){for(const [k,v] of Object.entries(h??{}))if(k.toLowerCase()===n.toLowerCase())return String(Array.isArray(v)?v[0]??'':v??'');return '';}
function bytes(v){if(Buffer.isBuffer(v))return v;if(typeof v==='string')return Buffer.from(v);throw new TypeError('raw body required');}
function sameHex(a,b){if(!/^[0-9a-f]{64}$/i.test(a)||!/^[0-9a-f]{64}$/i.test(b))return false;return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}

export function createHmacJsonAgencyIdentityObservationAdapter({secret,signatureHeader='x-wfm-signature',timestampHeader='x-wfm-timestamp',toleranceSeconds=300,normalize}={}){
 const key=Buffer.from(secret??''); if(key.length<32)throw new TypeError('secret must be at least 32 bytes');
 if(!Number.isInteger(toleranceSeconds)||toleranceSeconds<30||toleranceSeconds>900)throw new TypeError('tolerance invalid');
 const version='agency-identity-observation-hmac-json-v0.1.0', norm=typeof normalize==='function'?normalize:x=>x;
 return Object.freeze({version,async verifyAndNormalize({rawBody,headers,receivedAt}={}){
  const b=bytes(rawBody); if(!b.length||b.length>65536)throw new Error('payload invalid');
  const received=time(receivedAt), ts=hdr(headers,timestampHeader).trim(); if(received===null||!/^\d{10}$/.test(ts)||Math.abs(received-Number(ts)*1000)>toleranceSeconds*1000)throw new Error('signature time invalid');
  const sig=hdr(headers,signatureHeader).trim().toLowerCase(), expected=crypto.createHmac('sha256',key).update(ts).update('.').update(b).digest('hex'); if(!sameHex(sig,expected))throw new Error('signature invalid');
  let parsed;try{parsed=JSON.parse(b.toString('utf8'));}catch{throw new Error('json invalid');} const p=await norm(structuredClone(parsed));
  const eventId=req(p?.eventId,'eventId'), sourceSubjectRef=req(p?.sourceSubjectRef,'sourceSubjectRef'), signalType=req(p?.signalType,'signalType',80), observedAt=iso(p?.observedAt);
  if(!SIGNALS.has(signalType)||!observedAt)throw new Error('normalized event invalid');
  return Object.freeze({eventId,sourceSubjectRef,signalType,observedAt,authFingerprint:hash(`${version}|${ts}|${sig}`)});
 }});
}

const INS_RECEIPT=`INSERT INTO wfm_agency_identity_observation_ingress_receipts (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint,binding_fingerprint,ingress_version,received_at) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz) ON CONFLICT (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint) DO NOTHING RETURNING *;`;
const READ_RECEIPT=`SELECT tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint,binding_fingerprint,ingress_version,received_at FROM wfm_agency_identity_observation_ingress_receipts WHERE tenant_id=$1 AND source_system_id=$2 AND source_event_fingerprint=$3 AND source_auth_fingerprint=$4 LIMIT 2;`;
const INS_OBS=`INSERT INTO wfm_agency_identity_continuity_observations (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz) ON CONFLICT (tenant_id,source_system_id,source_event_fingerprint) DO NOTHING RETURNING *;`;
const READ_OBS=`SELECT tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at FROM wfm_agency_identity_continuity_observations WHERE tenant_id=$1 AND source_system_id=$2 AND source_event_fingerprint=$3 LIMIT 2;`;
const canon=r=>({tenantId:txt(r.tenant_id??r.tenantId,100),siteId:txt(r.site_id??r.siteId,100),requestId:txt(r.request_id??r.requestId,100),agencyId:txt(r.agency_id??r.agencyId,100),workerId:txt(r.worker_id??r.workerId,100),assignmentFingerprint:txt(r.assignment_fingerprint??r.assignmentFingerprint,24).toLowerCase(),assuranceVersionId:txt(r.assurance_version_id??r.assuranceVersionId,32).toLowerCase(),sourceSystemId:txt(r.source_system_id??r.sourceSystemId,100),sourceEventFingerprint:txt(r.source_event_fingerprint??r.sourceEventFingerprint,32).toLowerCase(),subjectFingerprint:txt(r.subject_fingerprint??r.subjectFingerprint,32).toLowerCase(),signalType:txt(r.signal_type??r.signalType,80),observedAt:iso(r.observed_at??r.observedAt)});
const same=(a,b)=>JSON.stringify(stable(canon(a)))===JSON.stringify(stable(canon(b)));

export function createPostgresAgencyIdentityObservationIngressStore({query}={}){
 if(typeof query!=='function')throw new TypeError('query required');
 return Object.freeze({version:AGENCY_IDENTITY_OBSERVATION_INGRESS_STORE_VERSION,async appendObservation(o={}){
  const row={tenantId:req(o.tenantId,'tenantId',100),siteId:req(o.siteId,'siteId',100),requestId:req(o.requestId,'requestId',100),agencyId:req(o.agencyId,'agencyId',100),workerId:req(o.workerId,'workerId',100),assignmentFingerprint:hex(o.assignmentFingerprint,24,'assignment'),assuranceVersionId:hex(o.assuranceVersionId,32,'assurance'),sourceSystemId:req(o.sourceSystemId,'source',100),sourceEventFingerprint:hex(o.sourceEventFingerprint,32,'event fp'),subjectFingerprint:hex(o.subjectFingerprint,32,'subject fp'),signalType:req(o.signalType,'signal',80),observedAt:iso(o.observedAt)};
  const p={auth:hex(o.sourceAuthFingerprint,32,'auth fp'),binding:hex(o.bindingFingerprint,32,'binding fp'),version:req(o.ingressVersion,'ingress version',100),receivedAt:iso(o.receivedAt)}; if(!SIGNALS.has(row.signalType)||!row.observedAt||!p.receivedAt)throw new TypeError('observation invalid');
  const rv=[row.tenantId,row.sourceSystemId,row.sourceEventFingerprint,p.auth,p.binding,p.version,p.receivedAt], ri=await query(INS_RECEIPT,rv), rr=Array.isArray(ri?.rows)?ri.rows:[]; if(rr.length>1)throw new Error('unexpected_identity_observation_receipt_store_result');
  let receiptDuplicate=!rr.length; if(receiptDuplicate){const q=await query(READ_RECEIPT,rv.slice(0,4)), rows=q?.rows??[];if(rows.length!==1)throw new Error('unexpected_identity_observation_receipt_store_result');const x=rows[0];if(txt(x.binding_fingerprint??x.bindingFingerprint,32)!==p.binding||txt(x.ingress_version??x.ingressVersion,100)!==p.version||iso(x.received_at??x.receivedAt)!==p.receivedAt)throw new Error('identity_observation_receipt_conflict');}
  const ov=[row.tenantId,row.siteId,row.requestId,row.agencyId,row.workerId,row.assignmentFingerprint,row.assuranceVersionId,row.sourceSystemId,row.sourceEventFingerprint,row.subjectFingerprint,row.signalType,row.observedAt], oi=await query(INS_OBS,ov), orows=Array.isArray(oi?.rows)?oi.rows:[]; if(orows.length>1||(orows.length===1&&!same(orows[0],row)))throw new Error('unexpected_identity_observation_store_result');
  if(orows.length===1)return {duplicate:false,receiptDuplicate,row:canon(orows[0])};
  const q=await query(READ_OBS,[row.tenantId,row.sourceSystemId,row.sourceEventFingerprint]), rows=q?.rows??[]; if(rows.length!==1)throw new Error('unexpected_identity_observation_store_result'); if(!same(rows[0],row))throw new Error('identity_observation_replay_conflict'); return {duplicate:true,receiptDuplicate,row:canon(rows[0])};
 }});
}

export async function ingestAgencyIdentityObservation({tenantId,siteId,requestId,sourceSystemId,rawBody,headers,receivedAt,sourceRegistry,bindingResolver,continuityStore}={}){
 const base={version:AGENCY_IDENTITY_OBSERVATION_INGRESS_VERSION,accepted:false,duplicate:false,rankingImpact:'none',scheduleWriteAuthorized:false,payrollWriteAuthorized:false,clockingWriteAuthorized:false,authorityBoundary:'authenticated_identity_observation_ingress_only_no_ranking_schedule_payroll_invoice_or_clocking_mutation'}; const fail=reason=>Object.freeze({...base,reason});
 let s;try{s={tenantId:req(tenantId,'tenant',100),siteId:req(siteId,'site',100),requestId:req(requestId,'request',100),sourceSystemId:req(sourceSystemId,'source',100)}}catch{return fail('identity_observation_scope_invalid');}
 let src;try{src=await sourceRegistry?.resolveSource?.(s);}catch{return fail('identity_observation_source_registry_unavailable');} if(!src||src.sourceSystemId!==s.sourceSystemId||typeof src.adapter?.verifyAndNormalize!=='function')return fail('identity_observation_source_untrusted');
 const allowed=[...new Set((src.allowedSignalTypes??[]).map(x=>txt(x,80)))]; if(!allowed.length||allowed.some(x=>!SIGNALS.has(x)))return fail('identity_observation_source_policy_invalid');
 let e;try{e=await src.adapter.verifyAndNormalize({rawBody,headers,receivedAt});}catch{return fail('identity_observation_authentication_failed');} if(!allowed.includes(e.signalType))return fail('identity_observation_signal_untrusted');
 const r=time(receivedAt), o=time(e.observedAt), age=(Number.isInteger(src.maxEventAgeMinutes)?src.maxEventAgeMinutes:1440)*60000, skew=(Number.isInteger(src.maxFutureSkewSeconds)?src.maxFutureSkewSeconds:120)*1000; if(r===null||o===null||o<r-age||o>r+skew)return fail('identity_observation_event_time_invalid');
 let b;try{b=await bindingResolver?.resolveBinding?.({...s,sourceSubjectRef:e.sourceSubjectRef,observedAt:e.observedAt,signalType:e.signalType});b={tenantId:req(b?.tenantId,'binding tenant',100),siteId:req(b?.siteId,'binding site',100),requestId:req(b?.requestId,'binding request',100),sourceSystemId:req(b?.sourceSystemId,'binding source',100),agencyId:req(b?.agencyId,'agency',100),workerId:req(b?.workerId,'worker',100),assignmentFingerprint:hex(b?.assignmentFingerprint,24,'assignment'),assuranceVersionId:hex(b?.assuranceVersionId,32,'assurance'),subjectFingerprint:hex(b?.subjectFingerprint,32,'subject')};if(['tenantId','siteId','requestId','sourceSystemId'].some(k=>b[k]!==s[k]))throw new Error();}catch{return fail('identity_observation_binding_invalid');}
 const sourceEventFingerprint=hash(JSON.stringify(stable({sourceSystemId:s.sourceSystemId,eventId:e.eventId}))), bindingFingerprint=hash(JSON.stringify(stable(b))); let authFingerprint;try{authFingerprint=hex(e.authFingerprint,32,'auth');}catch{return fail('identity_observation_authentication_failed');}
 const obs={...s,agencyId:b.agencyId,workerId:b.workerId,assignmentFingerprint:b.assignmentFingerprint,assuranceVersionId:b.assuranceVersionId,subjectFingerprint:b.subjectFingerprint,sourceEventFingerprint,signalType:e.signalType,observedAt:e.observedAt,sourceAuthFingerprint:authFingerprint,bindingFingerprint,ingressVersion:AGENCY_IDENTITY_OBSERVATION_INGRESS_VERSION,receivedAt:iso(receivedAt)};
 let stored;try{stored=await continuityStore?.appendObservation?.(obs);if(!stored)throw new Error();}catch(err){if(['identity_observation_replay_conflict','identity_observation_receipt_conflict'].includes(err?.message))return fail(err.message);return fail('identity_observation_store_unavailable');}
 return Object.freeze({...base,accepted:true,duplicate:stored.duplicate===true,reason:null,tenantId:s.tenantId,siteId:s.siteId,requestId:s.requestId,sourceSystemId:s.sourceSystemId,agencyId:b.agencyId,workerId:b.workerId,assignmentFingerprint:b.assignmentFingerprint,assuranceVersionId:b.assuranceVersionId,signalType:e.signalType,observedAt:e.observedAt,sourceEventFingerprint,bindingFingerprint,authFingerprint,ingressFingerprint:hash(JSON.stringify(stable({tenantId:s.tenantId,siteId:s.siteId,requestId:s.requestId,sourceSystemId:s.sourceSystemId,sourceEventFingerprint,bindingFingerprint,authFingerprint,signalType:e.signalType,observedAt:e.observedAt}))) });
}
