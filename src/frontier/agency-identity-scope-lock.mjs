import crypto from 'node:crypto';

export const AGENCY_IDENTITY_SCOPE_LOCK_VERSION='agency-identity-scope-lock-v0.2.0';
// Legacy SQL is retained only for deterministic compatibility/race fixtures.
// Runtime acquisition uses the database-owned canonical scope primitive below.
export const AGENCY_IDENTITY_SCOPE_LOCK_SQL='SELECT pg_advisory_xact_lock($1::bigint) AS locked;';
export const AGENCY_IDENTITY_SCOPE_LOCK_DB_SQL=`SELECT scope_lock_key,scope_fingerprint
FROM public.wfm_lock_agency_identity_assignment_scope_v1($1,$2,$3,$4,$5,$6);`;

const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
function required(value,name,max=200){const clean=text(value,max+1);if(!clean||clean.length>max)throw new TypeError(`${name} invalid`);return clean;}
function hex(value,length,name){const clean=required(value,name,length).toLowerCase();if(!new RegExp(`^[0-9a-f]{${length}}$`).test(clean))throw new TypeError(`${name} invalid`);return clean;}

// Deterministic mirror retained for migration diagnostics/tests only. Runtime
// concurrency authority is the database-owned primitive, not this function.
export function deriveAgencyIdentityScopeLock(scope={}){
  const canonical=JSON.stringify([
    required(scope.tenantId,'tenantId',100),
    required(scope.siteId,'siteId',100),
    required(scope.requestId,'requestId',100),
    required(scope.agencyId,'agencyId',100),
    required(scope.workerId,'workerId',100),
    hex(scope.assignmentFingerprint,24,'assignmentFingerprint'),
  ]);
  const digest=crypto.createHash('sha256').update(canonical).digest();
  return Object.freeze({
    version:AGENCY_IDENTITY_SCOPE_LOCK_VERSION,
    advisoryKey:digest.readBigInt64BE(0).toString(),
    scopeFingerprint:digest.toString('hex').slice(0,24),
    authority:'diagnostic_mirror_only',
  });
}

export async function acquireAgencyIdentityScopeLock({query,scope}={}){
  if(typeof query!=='function')throw new TypeError('query function is required');
  const values=[
    required(scope?.tenantId,'tenantId',100),
    required(scope?.siteId,'siteId',100),
    required(scope?.requestId,'requestId',100),
    required(scope?.agencyId,'agencyId',100),
    required(scope?.workerId,'workerId',100),
    hex(scope?.assignmentFingerprint,24,'assignmentFingerprint'),
  ];
  const result=await query(AGENCY_IDENTITY_SCOPE_LOCK_DB_SQL,values);
  const rows=Array.isArray(result?.rows)?result.rows:[];
  if(rows.length!==1)throw new Error(rows.length===0?'identity_scope_lock_missing':'identity_scope_lock_ambiguous');
  const row=rows[0]??{};
  const advisoryKey=String(row.scope_lock_key??row.scopeLockKey??'');
  const scopeFingerprint=text(row.scope_fingerprint??row.scopeFingerprint,24).toLowerCase();
  if(!/^-?\d+$/.test(advisoryKey)||!new RegExp('^[0-9a-f]{24}$').test(scopeFingerprint))throw new Error('identity_scope_lock_invalid');
  return Object.freeze({version:AGENCY_IDENTITY_SCOPE_LOCK_VERSION,advisoryKey,scopeFingerprint,authority:'database_owned_canonical_scope'});
}
