import crypto from 'node:crypto';
import {deriveAgencyIdentityScopeLock} from './agency-identity-scope-lock.mjs';

export const AGENCY_IDENTITY_OBSERVATION_INGRESS_VERSION='agency-identity-observation-ingress-v0.2.0';
export const AGENCY_IDENTITY_OBSERVATION_INGRESS_STORE_VERSION='agency-identity-observation-ingress-store-v0.3.0';
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

export const AGENCY_IDENTITY_OBSERVATION_BOUNDARY_APPEND_SQL=`SELECT observation_duplicate,receipt_duplicate
FROM public.wfm_append_agency_identity_observation_v1(
 $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13,$14,$15,$16::timestamptz,$17::bigint
);`;

const canon=r=>({tenantId:txt(r.tenant_id??r.tenantId,100),siteId:txt(r.site_id??r.siteId,100),requestId:txt(r.request_id??r.requestId,100),agencyId:txt(r.agency_id??r.agencyId,100),workerId:txt(r.worker_id??r.workerId,100),assignmentFingerprint:txt(r.assignment_fingerprint??r.assignmentFingerprint,24).toLowerCase(),assuranceVersionId:txt(r.assurance_version_id??r.assuranceVersionId,32).toLowerCase(),sourceSystemId:txt(r.source_system_id??r.sourceSystemId,100),sourceEventFingerprint:txt(r.source_event_fingerprint??r.sourceEventFingerprint,32).toLowerCase(),subjectFingerprint:txt(r.subject_fingerprint??r.subjectFingerprint,32).toLowerCase(),signalType:txt(r.signal_type??r.signalType,80),observedAt:iso(r.observed_at??r.observedAt)});

function normalizeObservation(o={}){
 const row={tenantId:req(o.tenantId,'tenantId',100),siteId:req(o.siteId,'siteId',100),requestId:req(o.requestId,'requestId',100),agencyId:req(o.agencyId,'agencyId',100),workerId:req(o.workerId,'workerId',100),assignmentFingerprint:hex(o.assignmentFingerprint,24,'assignment'),assuranceVersionId:hex(o.assuranceVersionId,32,'assurance'),sourceSystemId:req(o.sourceSystemId,'source',100),sourceEventFingerprint:hex(o.sourceEventFingerprint,32,'event fp'),subjectFingerprint:hex(o.subjectFingerprint,32,'subject fp'),signalType:req(o.signalType,'signal',80),observedAt:iso(o.observedAt)};
 const provenance={auth:hex(o.sourceAuthFingerprint,32,'auth fp'),binding:hex(o.bindingFingerprint,32,'binding fp'),version:req(o.ingressVersion,'ingress version',100),receivedAt:iso(o.receivedAt)};
 if(!SIGNALS.has(row.signalType)||!row.observedAt||!provenance.receivedAt)throw new TypeError('observation invalid');
 return {row,provenance};
}

function booleanField(row,snake,camel){
 const value=row?.[snake]??row?.[camel];
 if(typeof value!=='boolean')throw new Error('unexpected_identity_observation_boundary_result');
 return value;
}

export function createPostgresAgencyIdentityObservationIngressStore({executeBoundary}={}){
 if(typeof executeBoundary!=='function')throw new TypeError('executeBoundary function is required');
 return Object.freeze({
  version:AGENCY_IDENTITY_OBSERVATION_INGRESS_STORE_VERSION,
  concurrencyBoundary:'database_function_assignment_scoped_transaction_lock',
  credentialBoundary:'wfm_agency_identity_ingress_writer_function_only',
  directTableDmlAllowed:false,
  async appendObservation(o={}){
   const {row,provenance:p}=normalizeObservation(o);
   const scopeLock=deriveAgencyIdentityScopeLock(row);
   const values=[
    row.tenantId,row.siteId,row.requestId,row.agencyId,row.workerId,row.assignmentFingerprint,row.assuranceVersionId,
    row.sourceSystemId,row.sourceEventFingerprint,row.subjectFingerprint,row.signalType,row.observedAt,
    p.auth,p.binding,p.version,p.receivedAt,scopeLock.advisoryKey,
   ];
   const result=await executeBoundary(AGENCY_IDENTITY_OBSERVATION_BOUNDARY_APPEND_SQL,values);
   const rows=Array.isArray(result?.rows)?result.rows:[];
   if(rows.length!==1)throw new Error('unexpected_identity_observation_boundary_result');
   const duplicate=booleanField(rows[0],'observation_duplicate','observationDuplicate');
   const receiptDuplicate=booleanField(rows[0],'receipt_duplicate','receiptDuplicate');
   return Object.freeze({duplicate,receiptDuplicate,row:Object.freeze(canon(row)),scopeFingerprint:scopeLock.scopeFingerprint});
  },
 });
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
