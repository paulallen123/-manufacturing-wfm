export const CAPABILITY_PROVENANCE_VERSION='capability-provenance-v0.1.0';

const DIRECT_PII_KEYS=new Set(['name','firstName','lastName','email','phone','address','employeeId','payrollId','nationalId']);
function clean(v){return typeof v==='string'?v.trim():'';}
function when(v){const t=Date.parse(String(v??''));return Number.isFinite(t)?t:null;}

function containsDirectPii(value){
  if(!value||typeof value!=='object')return false;
  for(const [k,v] of Object.entries(value)){
    if(DIRECT_PII_KEYS.has(k)&&clean(v))return true;
    if(v&&typeof v==='object'&&containsDirectPii(v))return true;
  }
  return false;
}

export function buildCapabilityAttestation({event,requirement,credential,scope}={}){
  const executedAt=when(event?.executedAt),validFrom=when(credential?.validFrom),validUntil=when(credential?.validUntil);
  if(!clean(scope?.tenantId)||!clean(scope?.siteId)||!clean(event?.productRef)||!clean(event?.processStep)||executedAt==null){
    return {status:'blocked',reason:'invalid_event_scope'};
  }
  if(event?.authoritative!==true||requirement?.authoritative!==true||credential?.authoritative!==true){
    return {status:'blocked',reason:'non_authoritative_evidence'};
  }
  if(clean(event.tenantId)!==clean(scope.tenantId)||clean(credential.tenantId)!==clean(scope.tenantId)){
    return {status:'blocked',reason:'tenant_scope_mismatch'};
  }
  if(clean(event.siteId)!==clean(scope.siteId)||clean(credential.siteId)!==clean(scope.siteId)){
    return {status:'blocked',reason:'site_scope_mismatch'};
  }
  if(clean(requirement.processStep)!==clean(event.processStep)||clean(requirement.skillCode)!==clean(credential.skillCode)){
    return {status:'blocked',reason:'process_or_skill_mismatch'};
  }
  if(clean(event.holderRef)!==clean(credential.holderRef)||!clean(event.holderRef)){
    return {status:'blocked',reason:'holder_binding_mismatch'};
  }
  if(clean(credential.status)!=='active')return {status:'blocked',reason:'credential_not_active'};
  if(validFrom==null||validUntil==null||executedAt<validFrom||executedAt>validUntil){
    return {status:'blocked',reason:'credential_not_valid_at_execution'};
  }
  if(!clean(credential.credentialRef)||!clean(credential.issuerRef)||!clean(credential.revision)||!clean(event.revision)){
    return {status:'blocked',reason:'missing_provenance'};
  }
  if(containsDirectPii({event,credential}))return {status:'blocked',reason:'direct_pii_present'};

  return {
    status:'attestable',
    attestation:{
      productRef:clean(event.productRef),
      lotRef:clean(event.lotRef)||null,
      processStep:clean(event.processStep),
      executedAt:new Date(executedAt).toISOString(),
      skillCode:clean(requirement.skillCode),
      credentialRef:clean(credential.credentialRef),
      issuerRef:clean(credential.issuerRef),
      credentialRevision:clean(credential.revision),
      eventRevision:clean(event.revision),
      competenceCoverage:true,
      holderDisclosure:'withheld',
      proofStatus:'ready_for_external_signature',
      claimBoundary:'Confirms authoritative evidence that a valid competence credential was bound to the recorded process event at execution time. It does not independently prove physical task execution or product conformity.'
    }
  };
}

export function verifyAttestationPrivacy(attestation){
  return {status:containsDirectPii(attestation)?'rejected':'accepted',directPiiDetected:containsDirectPii(attestation)};
}
