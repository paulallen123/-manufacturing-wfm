import crypto from 'node:crypto';

export const AGENCY_IDENTITY_CONTINUITY_VERSION='agency-identity-continuity-v0.1.1';
export const AGENCY_IDENTITY_CONTINUITY_STORE_VERSION='agency-identity-continuity-store-v0.1.1';

export const AGENCY_IDENTITY_CONTINUITY_DDL=`
CREATE TABLE IF NOT EXISTS wfm_agency_identity_continuity_observations (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  request_id text NOT NULL,
  agency_id text NOT NULL,
  worker_id text NOT NULL,
  assignment_fingerprint text NOT NULL CHECK (assignment_fingerprint ~ '^[0-9a-f]{24}$'),
  assurance_version_id text NOT NULL CHECK (assurance_version_id ~ '^[0-9a-f]{32}$'),
  source_system_id text NOT NULL,
  source_event_fingerprint text NOT NULL CHECK (source_event_fingerprint ~ '^[0-9a-f]{32}$'),
  subject_fingerprint text NOT NULL CHECK (subject_fingerprint ~ '^[0-9a-f]{32}$'),
  signal_type text NOT NULL CHECK (signal_type IN ('access_pass','attendance_clock_in','supervised_identity_check','rtw_dvsp_holder_check')),
  observed_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_system_id, source_event_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_wfm_agency_identity_continuity_scope
  ON wfm_agency_identity_continuity_observations
  (tenant_id, site_id, request_id, agency_id, worker_id, assurance_version_id, observed_at);

CREATE OR REPLACE FUNCTION wfm_agency_identity_continuity_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agency identity continuity observations are append only';
END;
$$;

DROP TRIGGER IF EXISTS trg_wfm_agency_identity_continuity_no_update ON wfm_agency_identity_continuity_observations;
CREATE TRIGGER trg_wfm_agency_identity_continuity_no_update
BEFORE UPDATE ON wfm_agency_identity_continuity_observations
FOR EACH ROW EXECUTE FUNCTION wfm_agency_identity_continuity_append_only();

DROP TRIGGER IF EXISTS trg_wfm_agency_identity_continuity_no_delete ON wfm_agency_identity_continuity_observations;
CREATE TRIGGER trg_wfm_agency_identity_continuity_no_delete
BEFORE DELETE ON wfm_agency_identity_continuity_observations
FOR EACH ROW EXECUTE FUNCTION wfm_agency_identity_continuity_append_only();
`;

const READ_OBSERVATIONS_SQL=`
SELECT o.tenant_id, o.site_id, o.request_id, o.agency_id, o.worker_id, o.assignment_fingerprint, o.assurance_version_id,
       o.source_system_id, o.source_event_fingerprint, o.subject_fingerprint, o.signal_type, o.observed_at,
       COALESCE((
         SELECT json_agg(DISTINCT r.binding_fingerprint ORDER BY r.binding_fingerprint)
         FROM wfm_agency_identity_observation_ingress_receipts r
         WHERE r.tenant_id = o.tenant_id
           AND r.source_system_id = o.source_system_id
           AND r.source_event_fingerprint = o.source_event_fingerprint
       ), '[]'::json) AS provenance_binding_fingerprints
FROM wfm_agency_identity_continuity_observations o
WHERE o.tenant_id = $1
  AND o.site_id = $2
  AND o.request_id = $3
  AND o.agency_id = $4
  AND o.worker_id = $5
  AND o.assignment_fingerprint = $6
  AND o.assurance_version_id = $7
  AND o.observed_at >= $8::timestamptz
  AND o.observed_at <= $9::timestamptz
ORDER BY o.observed_at, o.source_system_id, o.source_event_fingerprint
LIMIT 201;
`;

const SIGNALS=Object.freeze({
  access_pass:Object.freeze({evidenceClass:'operational_credential',directIdentity:false}),
  attendance_clock_in:Object.freeze({evidenceClass:'operational_credential',directIdentity:false}),
  supervised_identity_check:Object.freeze({evidenceClass:'direct_identity',directIdentity:true}),
  rtw_dvsp_holder_check:Object.freeze({evidenceClass:'direct_identity',directIdentity:true}),
});

const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=(value,length=32)=>crypto.createHash('sha256').update(String(value??'')).digest('hex').slice(0,length);
const ms=value=>{const parsed=typeof value==='number'?value:Date.parse(value);return Number.isFinite(parsed)?parsed:null;};
const iso=value=>{const parsed=ms(value);return parsed===null?null:new Date(parsed).toISOString();};
function required(value,name,max=200){const clean=text(value,max+1);if(!clean)throw new TypeError(`${name} is required`);if(clean.length>max)throw new TypeError(`${name} is too long`);return clean;}
function integer(value,min,max,name){if(!Number.isInteger(value)||value<min||value>max)throw new TypeError(`${name} is invalid`);return value;}

function assignmentFingerprint(request={}){
  const scope={roleId:required(request.roleId,'request.roleId',100),location:required(request.location,'request.location',200),startAt:iso(request.startAt),endAt:iso(request.endAt)};
  if(!scope.startAt||!scope.endAt||Date.parse(scope.endAt)<=Date.parse(scope.startAt))throw new TypeError('request assignment window is invalid');
  return digest(JSON.stringify(stable(scope)),24);
}

function normalizePolicy(policy,scope){
  if(!policy||typeof policy!=='object'||Array.isArray(policy))throw new TypeError('identity continuity policy is required');
  const policyId=required(policy.policyId,'policy.policyId',100);
  const siteId=required(policy.siteId,'policy.siteId',100);
  const roleId=required(policy.roleId,'policy.roleId',100);
  if(siteId!==scope.siteId)throw new TypeError('identity continuity policy site mismatch');
  if(roleId!==scope.roleId)throw new TypeError('identity continuity policy role mismatch');
  const minutesBeforeStart=integer(policy.minutesBeforeStart,0,240,'policy.minutesBeforeStart');
  const minutesAfterStart=integer(policy.minutesAfterStart,0,240,'policy.minutesAfterStart');
  const minIndependentSources=integer(policy.minIndependentSources,1,4,'policy.minIndependentSources');
  if(typeof policy.requireDirectIdentity!=='boolean')throw new TypeError('policy.requireDirectIdentity is required');
  if(!policy.allowedSources||typeof policy.allowedSources!=='object'||Array.isArray(policy.allowedSources))throw new TypeError('policy.allowedSources is required');
  const sourceIds=Object.keys(policy.allowedSources).sort();
  if(sourceIds.length===0||sourceIds.length>20)throw new TypeError('policy.allowedSources is invalid');
  const allowedSources=Object.create(null);
  for(const sourceIdRaw of sourceIds){
    const sourceId=required(sourceIdRaw,'policy source id',100);
    const signalTypes=policy.allowedSources[sourceIdRaw];
    if(!Array.isArray(signalTypes)||signalTypes.length===0||signalTypes.length>4)throw new TypeError('policy allowed signal types are invalid');
    const unique=[...new Set(signalTypes.map(value=>text(value,80)))].sort();
    if(unique.some(value=>!SIGNALS[value]))throw new TypeError('policy allowed signal type is unsupported');
    allowedSources[sourceId]=Object.freeze(unique);
  }
  if(minIndependentSources>Object.keys(allowedSources).length)throw new TypeError('policy independent source requirement exceeds configured sources');
  const normalized=Object.freeze({policyId,siteId,roleId,minutesBeforeStart,minutesAfterStart,minIndependentSources,requireDirectIdentity:policy.requireDirectIdentity,allowedSources:Object.freeze(allowedSources)});
  return {policy:normalized,policyFingerprint:digest(JSON.stringify(stable(normalized)),24)};
}

function normalizeFingerprintArray(value){
  let raw=value;
  if(typeof raw==='string'){
    try{raw=JSON.parse(raw);}catch{return [];}
  }
  if(!Array.isArray(raw))return [];
  return [...new Set(raw.map(item=>text(item,32).toLowerCase()).filter(item=>/^[0-9a-f]{32}$/.test(item)))].sort();
}

function safeObservation(row){
  if(!row||typeof row!=='object'||Array.isArray(row))return null;
  return {
    sourceSystemId:text(row.source_system_id??row.sourceSystemId,100),
    sourceEventFingerprint:text(row.source_event_fingerprint??row.sourceEventFingerprint,32).toLowerCase(),
    subjectFingerprint:text(row.subject_fingerprint??row.subjectFingerprint,32).toLowerCase(),
    signalType:text(row.signal_type??row.signalType,80),
    observedAt:iso(row.observed_at??row.observedAt),
    tenantId:text(row.tenant_id??row.tenantId,100),
    siteId:text(row.site_id??row.siteId,100),
    requestId:text(row.request_id??row.requestId,100),
    agencyId:text(row.agency_id??row.agencyId,100),
    workerId:text(row.worker_id??row.workerId,100),
    assignmentFingerprint:text(row.assignment_fingerprint??row.assignmentFingerprint,24).toLowerCase(),
    assuranceVersionId:text(row.assurance_version_id??row.assuranceVersionId,32).toLowerCase(),
    provenanceBindingFingerprints:normalizeFingerprintArray(row.provenance_binding_fingerprints??row.provenanceBindingFingerprints),
  };
}

function expectedBindingFingerprint(row){
  return digest(JSON.stringify(stable({
    tenantId:row.tenantId,
    siteId:row.siteId,
    requestId:row.requestId,
    sourceSystemId:row.sourceSystemId,
    agencyId:row.agencyId,
    workerId:row.workerId,
    assignmentFingerprint:row.assignmentFingerprint,
    assuranceVersionId:row.assuranceVersionId,
    subjectFingerprint:row.subjectFingerprint,
  })),32);
}

export function createPostgresAgencyIdentityContinuityStore({query}={}){
  if(typeof query!=='function')throw new TypeError('query function is required');
  return Object.freeze({
    version:AGENCY_IDENTITY_CONTINUITY_STORE_VERSION,
    async readObservations(scope={}){
      const values=[
        required(scope.tenantId,'tenantId',100),required(scope.siteId,'siteId',100),required(scope.requestId,'requestId',100),required(scope.agencyId,'agencyId',100),required(scope.workerId,'workerId',100),
        required(scope.assignmentFingerprint,'assignmentFingerprint',24).toLowerCase(),required(scope.assuranceVersionId,'assuranceVersionId',32).toLowerCase(),
        required(scope.windowStart,'windowStart',40),required(scope.windowEnd,'windowEnd',40),
      ];
      const result=await query(READ_OBSERVATIONS_SQL,values);
      const rows=Array.isArray(result?.rows)?result.rows.map(safeObservation).filter(Boolean):[];
      if(rows.length>200)throw new Error('unexpected_identity_continuity_observation_count');
      return {rows};
    },
  });
}

export async function evaluateAgencyIdentityContinuity({tenantId,siteId,agencyId,request,workerBinding,now,policy,continuityStore}={}){
  const fail=(reason,{failures=[reason],observations=[],scope=null,policyFingerprint=null}={})=>Object.freeze({
    version:AGENCY_IDENTITY_CONTINUITY_VERSION,
    continuityPassed:false,
    reason,
    failures:[...new Set(failures)],
    requestId:scope?.requestId??(text(request?.requestId,100)||null),
    siteId:scope?.siteId??(text(siteId,100)||null),
    agencyId:scope?.agencyId??(text(agencyId,100)||null),
    workerId:scope?.workerId??(text(workerBinding?.workerId,100)||null),
    assuranceVersionId:scope?.assuranceVersionId??(text(workerBinding?.assuranceVersionId,32).toLowerCase()||null),
    assignmentFingerprint:scope?.assignmentFingerprint??null,
    policyFingerprint,
    observations,
    independentSourceCount:new Set(observations.map(item=>item.sourceSystemId)).size,
    directIdentityObserved:observations.some(item=>item.evidenceClass==='direct_identity'),
    continuityFingerprint:null,
    rankingImpact:'none',
    scheduleWriteAuthorized:false,
    payrollWriteAuthorized:false,
    clockingWriteAuthorized:false,
    authorityBoundary:'identity_continuity_evidence_only_no_ranking_schedule_payroll_invoice_or_clocking_mutation',
    privacyBoundary:'no_subject_identifier_raw_badge_identifier_photo_biometric_date_of_birth_document_number_share_code_source_payload_or_authentication_secret_in_decision_output',
  });

  let scope;
  try{
    const requestId=required(request?.requestId,'request.requestId',100);
    const roleId=required(request?.roleId,'request.roleId',100);
    const startAt=iso(request?.startAt);const endAt=iso(request?.endAt);
    if(!startAt||!endAt||Date.parse(endAt)<=Date.parse(startAt))throw new TypeError('request assignment window invalid');
    scope={tenantId:required(tenantId,'tenantId',100),siteId:required(siteId,'siteId',100),requestId,agencyId:required(agencyId,'agencyId',100),workerId:required(workerBinding?.workerId,'workerBinding.workerId',100),assuranceVersionId:required(workerBinding?.assuranceVersionId,'workerBinding.assuranceVersionId',32).toLowerCase(),roleId,startAt,endAt,assignmentFingerprint:assignmentFingerprint(request)};
    if(!/^[0-9a-f]{32}$/.test(scope.assuranceVersionId))throw new TypeError('worker assurance version invalid');
  }catch{return fail('identity_continuity_scope_invalid');}

  let normalizedPolicy;
  try{normalizedPolicy=normalizePolicy(policy,scope);}catch{return fail('identity_continuity_policy_invalid',{scope});}
  const {policy:policyValue,policyFingerprint}=normalizedPolicy;
  const nowMs=ms(now);const startMs=Date.parse(scope.startAt);const endMs=Date.parse(scope.endAt);
  if(nowMs===null||nowMs<startMs-policyValue.minutesBeforeStart*60000||nowMs>endMs)return fail('identity_continuity_evaluation_time_invalid',{scope,policyFingerprint});
  const windowStartMs=startMs-policyValue.minutesBeforeStart*60000;
  const windowEndMs=Math.min(nowMs,startMs+policyValue.minutesAfterStart*60000);
  if(windowEndMs<windowStartMs)return fail('identity_continuity_observation_window_not_open',{scope,policyFingerprint});
  const readScope={...scope,windowStart:new Date(windowStartMs).toISOString(),windowEnd:new Date(windowEndMs).toISOString()};
  if(!continuityStore||typeof continuityStore.readObservations!=='function')return fail('identity_continuity_store_unavailable',{scope,policyFingerprint});
  let read;
  try{read=await continuityStore.readObservations(readScope);}catch{return fail('identity_continuity_store_unavailable',{scope,policyFingerprint});}
  const rows=Array.isArray(read?.rows)?read.rows:[];
  if(rows.length>200)return fail('identity_continuity_observation_limit_exceeded',{scope,policyFingerprint});

  const failures=[];const seenEvents=new Set();const safe=[];
  for(const raw of rows){
    const row=safeObservation(raw);
    if(!row){failures.push('identity_continuity_observation_invalid');continue;}
    const pair=`${row.sourceSystemId}:${row.sourceEventFingerprint}`;
    if(!row.sourceSystemId||!/^[0-9a-f]{32}$/.test(row.sourceEventFingerprint)||!/^[0-9a-f]{32}$/.test(row.subjectFingerprint)||!SIGNALS[row.signalType]||!row.observedAt){failures.push('identity_continuity_observation_invalid');continue;}
    if(seenEvents.has(pair)){failures.push('identity_continuity_duplicate_observation');continue;}seenEvents.add(pair);
    const mismatches=[['tenantId',scope.tenantId],['siteId',scope.siteId],['requestId',scope.requestId],['agencyId',scope.agencyId],['workerId',scope.workerId],['assignmentFingerprint',scope.assignmentFingerprint],['assuranceVersionId',scope.assuranceVersionId]].filter(([key,value])=>row[key]!==value);
    if(mismatches.length){failures.push('identity_continuity_observation_scope_mismatch');continue;}
    const expectedProvenance=expectedBindingFingerprint(row);
    if(!row.provenanceBindingFingerprints.includes(expectedProvenance)){failures.push('identity_continuity_authenticated_provenance_missing_or_mismatched');continue;}
    const observedMs=Date.parse(row.observedAt);
    if(observedMs<windowStartMs||observedMs>windowEndMs||observedMs>nowMs){failures.push('identity_continuity_observation_outside_window');continue;}
    const allowed=policyValue.allowedSources[row.sourceSystemId];
    if(!allowed||!allowed.includes(row.signalType)){failures.push('identity_continuity_untrusted_source_or_signal');continue;}
    safe.push(Object.freeze({sourceSystemId:row.sourceSystemId,sourceEventFingerprint:row.sourceEventFingerprint,subjectFingerprint:row.subjectFingerprint,signalType:row.signalType,evidenceClass:SIGNALS[row.signalType].evidenceClass,observedAt:row.observedAt,provenanceBindingFingerprint:expectedProvenance}));
  }
  safe.sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.sourceSystemId.localeCompare(b.sourceSystemId)||a.sourceEventFingerprint.localeCompare(b.sourceEventFingerprint));
  if(safe.length===0)failures.push('identity_continuity_evidence_missing');
  const subjects=new Set(safe.map(item=>item.subjectFingerprint));
  if(subjects.size>1)failures.push('identity_continuity_subject_mismatch');
  const independentSources=new Set(safe.map(item=>item.sourceSystemId));
  if(independentSources.size<policyValue.minIndependentSources)failures.push('identity_continuity_independent_sources_insufficient');
  const directIdentityObserved=safe.some(item=>SIGNALS[item.signalType].directIdentity);
  if(policyValue.requireDirectIdentity&&!directIdentityObserved)failures.push('identity_continuity_direct_identity_required');
  const publicObservations=Object.freeze(safe.map(({sourceSystemId,sourceEventFingerprint,signalType,evidenceClass,observedAt})=>Object.freeze({sourceSystemId,sourceEventFingerprint,signalType,evidenceClass,observedAt})));
  if(failures.length)return fail(failures[0],{failures,observations:publicObservations,scope,policyFingerprint});

  const evidence={tenantId:scope.tenantId,siteId:scope.siteId,requestId:scope.requestId,agencyId:scope.agencyId,workerId:scope.workerId,assignmentFingerprint:scope.assignmentFingerprint,assuranceVersionId:scope.assuranceVersionId,policyFingerprint,subjectFingerprint:[...subjects][0],observations:safe.map(({sourceSystemId,sourceEventFingerprint,signalType,observedAt,provenanceBindingFingerprint})=>({sourceSystemId,sourceEventFingerprint,signalType,observedAt,provenanceBindingFingerprint}))};
  return Object.freeze({
    version:AGENCY_IDENTITY_CONTINUITY_VERSION,
    continuityPassed:true,
    reason:null,
    failures:[],
    requestId:scope.requestId,
    siteId:scope.siteId,
    agencyId:scope.agencyId,
    workerId:scope.workerId,
    assuranceVersionId:scope.assuranceVersionId,
    assignmentFingerprint:scope.assignmentFingerprint,
    policyFingerprint,
    observations:publicObservations,
    independentSourceCount:independentSources.size,
    directIdentityObserved,
    continuityFingerprint:digest(JSON.stringify(stable(evidence)),32),
    rankingImpact:'none',
    scheduleWriteAuthorized:false,
    payrollWriteAuthorized:false,
    clockingWriteAuthorized:false,
    authorityBoundary:'identity_continuity_evidence_only_no_ranking_schedule_payroll_invoice_or_clocking_mutation',
    privacyBoundary:'no_subject_identifier_raw_badge_identifier_photo_biometric_date_of_birth_document_number_share_code_source_payload_or_authentication_secret_in_decision_output',
    evidenceRule:'role_and_site_specific_policy_must_be_satisfied_by_fresh_trusted_assignment_and_assurance_bound_observations_with_matching_authenticated_ingress_provenance_before_identity_continuity_can_pass',
  });
}