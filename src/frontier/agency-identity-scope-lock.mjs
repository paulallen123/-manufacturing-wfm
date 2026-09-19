import crypto from 'node:crypto';

export const AGENCY_IDENTITY_SCOPE_LOCK_VERSION='agency-identity-scope-lock-v0.1.0';
export const AGENCY_IDENTITY_SCOPE_LOCK_SQL='SELECT pg_advisory_xact_lock($1::bigint) AS locked;';

const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
function required(value,name,max=200){const clean=text(value,max+1);if(!clean||clean.length>max)throw new TypeError(`${name} invalid`);return clean;}
function hex(value,length,name){const clean=required(value,name,length).toLowerCase();if(!new RegExp(`^[0-9a-f]{${length}}$`).test(clean))throw new TypeError(`${name} invalid`);return clean;}

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
  });
}

export async function acquireAgencyIdentityScopeLock({query,scope}={}){
  if(typeof query!=='function')throw new TypeError('query function is required');
  const derived=deriveAgencyIdentityScopeLock(scope);
  await query(AGENCY_IDENTITY_SCOPE_LOCK_SQL,[derived.advisoryKey]);
  return derived;
}
