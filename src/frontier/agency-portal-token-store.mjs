export const AGENCY_PORTAL_TOKEN_STORE_VERSION='agency-portal-token-store-v0.1.0';

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
  PRIMARY KEY (tenant_id, token_id)
);
`;

const INSERT_SQL=`
INSERT INTO wfm_agency_portal_token_consumptions
  (tenant_id, token_id, site_id, request_id, agency_id, token_fingerprint, action, expires_at, consumed_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (tenant_id, token_id) DO NOTHING
RETURNING tenant_id, token_id, consumed_at;
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

export function createPostgresAgencyPortalTokenStore({query}){
  if(typeof query!=='function')throw new TypeError('query function is required');
  return Object.freeze({
    version:AGENCY_PORTAL_TOKEN_STORE_VERSION,
    async consumeOnce(record={}){
      const values=[
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
      const result=await query(INSERT_SQL,values);
      const rowCount=Number(result?.rowCount??(Array.isArray(result?.rows)?result.rows.length:0));
      if(rowCount===1)return {consumed:true,reason:null,tokenId:values[1],consumedAt:values[8]};
      if(rowCount===0)return {consumed:false,reason:'already_consumed',tokenId:values[1],consumedAt:null};
      throw new Error('unexpected_token_store_result');
    },
  });
}
