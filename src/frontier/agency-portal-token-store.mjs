export const AGENCY_PORTAL_TOKEN_STORE_VERSION='agency-portal-token-store-v0.2.0';

export const AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL=`
CREATE TABLE IF NOT EXISTS wfm_agency_portal_token_consumptions (
  tenant_id text NOT NULL,
  token_id text NOT NULL,
  site_id text NOT NULL,
  request_id text NOT NULL,
  agency_id text NOT NULL,
  token_fingerprint varchar(16) NOT NULL,
  action text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL,
  assurance_bindings jsonb,
  PRIMARY KEY (tenant_id, token_id)
);
ALTER TABLE wfm_agency_portal_token_consumptions
  ADD COLUMN IF NOT EXISTS assurance_bindings jsonb;
`;

const INSERT_SQL=`
INSERT INTO wfm_agency_portal_token_consumptions
  (tenant_id, token_id, site_id, request_id, agency_id, token_fingerprint, action, expires_at, consumed_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (tenant_id, token_id) DO NOTHING
RETURNING tenant_id, token_id, consumed_at;
`;

const INSERT_WITH_ASSURANCE_SQL=`
WITH expected AS (
  SELECT binding->>'workerId' AS worker_id, binding->>'assuranceVersionId' AS assurance_version_id
  FROM jsonb_array_elements($10::jsonb) AS entry(binding)
), existing AS MATERIALIZED (
  SELECT tenant_id, token_id
  FROM wfm_agency_portal_token_consumptions
  WHERE tenant_id = $1 AND token_id = $2
  LIMIT 1
), locked AS MATERIALIZED (
  SELECT current.worker_id, current.assurance_version_id
  FROM wfm_agency_rtw_assurance_current AS current
  JOIN expected
    ON expected.worker_id = current.worker_id
   AND expected.assurance_version_id = current.assurance_version_id
  WHERE current.tenant_id = $1
    AND current.agency_id = $5
    AND current.site_id = $3
    AND current.request_id = $4
    AND current.conflicted = false
    AND NOT EXISTS (SELECT 1 FROM existing)
  ORDER BY current.worker_id
  FOR UPDATE OF current
), counts AS (
  SELECT
    (SELECT count(*)::int FROM expected) AS expected_count,
    (SELECT count(*)::int FROM locked) AS matched_count
), inserted AS (
  INSERT INTO wfm_agency_portal_token_consumptions
    (tenant_id, token_id, site_id, request_id, agency_id, token_fingerprint, action, expires_at, consumed_at, assurance_bindings)
  SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb
  FROM counts
  WHERE NOT EXISTS (SELECT 1 FROM existing)
    AND expected_count > 0
    AND matched_count = expected_count
  ON CONFLICT (tenant_id, token_id) DO NOTHING
  RETURNING tenant_id, token_id, consumed_at
)
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM existing) THEN 'already_consumed'
    WHEN counts.expected_count = 0 THEN 'assurance_bindings_missing'
    WHEN counts.matched_count <> counts.expected_count THEN 'assurance_version_changed'
    WHEN EXISTS (SELECT 1 FROM inserted) THEN 'consumed'
    ELSE 'already_consumed'
  END AS outcome,
  counts.expected_count,
  counts.matched_count,
  COALESCE((SELECT consumed_at FROM inserted LIMIT 1), NULL) AS consumed_at
FROM counts;
`;

const requiredString=(value,name,max=200)=>{
  if(typeof value!=='string'||!value.trim())throw new TypeError(`${name} is required`);
  const clean=value.trim();
  if(clean.length>max)throw new TypeError(`${name} is too long`);
  return clean;
};
const iso=(value,name)=>{
  const parsed=Date.parse(value);
  if(!Number.isFinite(parsed))throw new TypeError(`${name} must be a valid timestamp`);
  return new Date(parsed).toISOString();
};

function normalizedAssuranceBindings(bindings){
  if(!Array.isArray(bindings)||bindings.length===0||bindings.length>100)throw new TypeError('assuranceBindings must contain 1 to 100 workers');
  const byWorker=new Map();
  for(const binding of bindings){
    const workerId=requiredString(binding?.workerId,'assuranceBindings.workerId',100);
    const assuranceVersionId=requiredString(binding?.assuranceVersionId,'assuranceBindings.assuranceVersionId',32);
    if(!/^[0-9a-f]{32}$/i.test(assuranceVersionId))throw new TypeError('assuranceBindings.assuranceVersionId must be a 32 character hex version');
    const previous=byWorker.get(workerId);
    if(previous&&previous!==assuranceVersionId)throw new TypeError('assuranceBindings contains conflicting worker versions');
    byWorker.set(workerId,assuranceVersionId.toLowerCase());
  }
  return [...byWorker.entries()]
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([workerId,assuranceVersionId])=>({workerId,assuranceVersionId}));
}

function tokenValues(record={}){
  return [
    requiredString(record.tenantId,'tenantId',100),
    requiredString(record.tokenId,'tokenId',200),
    requiredString(record.siteId,'siteId',100),
    requiredString(record.requestId,'requestId',100),
    requiredString(record.agencyId,'agencyId',100),
    requiredString(record.tokenFingerprint,'tokenFingerprint',16),
    requiredString(record.action,'action',50),
    iso(record.expiresAt,'expiresAt'),
    iso(record.consumedAt,'consumedAt'),
  ];
}

export function createPostgresAgencyPortalTokenStore({query}){
  if(typeof query!=='function')throw new TypeError('query function is required');
  return Object.freeze({
    version:AGENCY_PORTAL_TOKEN_STORE_VERSION,
    async consumeOnce(record={}){
      const values=tokenValues(record);
      const result=await query(INSERT_SQL,values);
      const rowCount=Number(result?.rowCount??(Array.isArray(result?.rows)?result.rows.length:0));
      if(rowCount===1)return {consumed:true,reason:null,tokenId:values[1],consumedAt:values[8],assuranceMatched:null};
      if(rowCount===0)return {consumed:false,reason:'already_consumed',tokenId:values[1],consumedAt:null,assuranceMatched:null};
      throw new Error('unexpected_token_store_result');
    },
    async consumeOnceWithAssuranceBindings(record={},assuranceBindings=[]){
      const values=tokenValues(record);
      const normalized=normalizedAssuranceBindings(assuranceBindings);
      values.push(JSON.stringify(normalized));
      const result=await query(INSERT_WITH_ASSURANCE_SQL,values);
      const rows=Array.isArray(result?.rows)?result.rows:[];
      if(rows.length!==1)throw new Error('unexpected_token_assurance_store_result');
      const row=rows[0];
      const outcome=String(row.outcome??'');
      const expectedCount=Number(row.expected_count??row.expectedCount??0);
      const matchedCount=Number(row.matched_count??row.matchedCount??0);
      if(outcome==='consumed')return {consumed:true,reason:null,tokenId:values[1],consumedAt:row.consumed_at??row.consumedAt??values[8],assuranceMatched:true,expectedCount,matchedCount};
      if(outcome==='already_consumed')return {consumed:false,reason:'already_consumed',tokenId:values[1],consumedAt:null,assuranceMatched:matchedCount===expectedCount&&expectedCount>0,expectedCount,matchedCount};
      if(outcome==='assurance_version_changed')return {consumed:false,reason:'assurance_version_changed',tokenId:values[1],consumedAt:null,assuranceMatched:false,expectedCount,matchedCount};
      if(outcome==='assurance_bindings_missing')return {consumed:false,reason:'assurance_bindings_missing',tokenId:values[1],consumedAt:null,assuranceMatched:false,expectedCount,matchedCount};
      throw new Error('unexpected_token_assurance_store_outcome');
    },
  });
}
