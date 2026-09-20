const BROAD_RESOURCE_SCOPES=new Set(['all','all-resources','all-sites','all-stations','all-entities','all-company','company-wide','tenant-wide']);
const MUTATION_HINTS=[
  /(^|[-_:])(write|create|update|delete|admin|administrator|manage|control|command|publish|provision|impersonate)([-_:]|$)/i,
  /read[-_ ]?write/i
];
const SECRET_FIELD_NAMES=new Set([
  'apikey','api_key','secret','secretkey','secret_key','password','authorization','authorizationheader','authorization_header',
  'token','accesstoken','access_token','refreshtoken','refresh_token','credentialvalue','credential_value'
]);

function normalizedCapability(value){
  return String(value??'').trim();
}

function hasMutationAuthority(capabilities=[]){
  return capabilities.map(normalizedCapability).filter(Boolean).some(capability=>MUTATION_HINTS.some(pattern=>pattern.test(capability)));
}

function normalizedScope(value){
  return String(value??'unknown').trim().toLowerCase();
}

function findSecretMaterial(value,path='evidence',hits=[]){
  if(!value||typeof value!=='object') return hits;
  if(Array.isArray(value)){
    value.forEach((item,index)=>findSecretMaterial(item,`${path}[${index}]`,hits));
    return hits;
  }
  for(const [key,item] of Object.entries(value)){
    const normalized=key.replace(/[^a-z0-9_]/gi,'').toLowerCase();
    if(SECRET_FIELD_NAMES.has(normalized) && item!==null && item!==undefined && String(item).length>0){
      hits.push(`${path}.${key}`);
      continue;
    }
    findSecretMaterial(item,`${path}.${key}`,hits);
  }
  return hits;
}

export function assertNoStaticCredentialMaterial(evidence){
  const hits=findSecretMaterial(evidence);
  if(hits.length){
    const error=new Error(`Static credential material is not permitted in evidence payloads: ${hits.join(', ')}`);
    error.code='WFM_STATIC_CREDENTIAL_EVIDENCE_LEAK';
    error.paths=hits;
    throw error;
  }
  return true;
}

export function evaluateStaticCredentialAuthority({
  transport='https',
  hostPinned=false,
  runtimeCapabilities=[],
  resourceCoverage='unknown',
  customerApprovedBroadScope=false,
  companyBindingVerified=false,
  rotationVerified=false,
  revocationVerified=false,
  credentialAgeDays=null,
  maxCredentialAgeDays=null,
  evidence=null
}={}){
  const reasons=[];
  const scope=normalizedScope(resourceCoverage);
  const broadScope=BROAD_RESOURCE_SCOPES.has(scope);

  if(String(transport).toLowerCase()!=='https') reasons.push('encrypted-transport-required');
  if(hostPinned!==true) reasons.push('canonical-host-pin-required');
  if(hasMutationAuthority(runtimeCapabilities)) reasons.push('write-or-admin-authority-present');
  if(broadScope && customerApprovedBroadScope!==true) reasons.push('broad-resource-scope-not-approved');
  if(companyBindingVerified!==true) reasons.push('company-or-tenant-binding-not-proven');
  if(rotationVerified!==true) reasons.push('credential-rotation-not-proven');
  if(revocationVerified!==true) reasons.push('credential-revocation-not-proven');

  if(maxCredentialAgeDays!==null && maxCredentialAgeDays!==undefined){
    const max=Number(maxCredentialAgeDays);
    const age=Number(credentialAgeDays);
    if(!Number.isFinite(max)||max<=0) reasons.push('invalid-max-credential-age');
    else if(!Number.isFinite(age)||age<0) reasons.push('credential-age-not-proven');
    else if(age>max) reasons.push('credential-age-exceeds-policy');
  }

  if(evidence!==null){
    try{assertNoStaticCredentialMaterial(evidence);}catch(error){
      if(error?.code==='WFM_STATIC_CREDENTIAL_EVIDENCE_LEAK') reasons.push('credential-material-present-in-evidence');
      else throw error;
    }
  }

  return {
    allowed:reasons.length===0,
    mode:reasons.length===0?'bounded-static-read-authority':'blocked-static-credential-authority',
    reasons,
    broadScope,
    resourceCoverage:scope,
    runtimeReadOnly:!hasMutationAuthority(runtimeCapabilities),
    retainCredentialInEvidence:false,
    retryAuthenticationFailure:false
  };
}

export function assertStaticCredentialAuthoritySafe(input){
  const decision=evaluateStaticCredentialAuthority(input);
  if(!decision.allowed){
    const error=new Error(`Static credential authority rejected: ${decision.reasons.join(', ')}`);
    error.code='WFM_STATIC_CREDENTIAL_AUTHORITY_BLOCKED';
    error.decision=decision;
    throw error;
  }
  return decision;
}
