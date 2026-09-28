const SAFE_METHODS=new Set(['GET','HEAD']);

function clean(value,name){
  const v=String(value??'').trim();
  if(!v) throw Object.assign(new Error(`${name} is required`),{code:'WFM_CAPABILITY_SCOPE_INVALID'});
  if(v.length>256) throw Object.assign(new Error(`${name} is too long`),{code:'WFM_CAPABILITY_SCOPE_INVALID'});
  return v;
}

function cleanSet(values,name){
  if(!Array.isArray(values)) throw Object.assign(new Error(`${name} must be an array`),{code:'WFM_CAPABILITY_SCOPE_INVALID'});
  const out=[]; const seen=new Set();
  for(const value of values){
    const v=clean(value,name);
    if(seen.has(v)) throw Object.assign(new Error(`${name} contains a duplicate`),{code:'WFM_CAPABILITY_SCOPE_INVALID'});
    seen.add(v); out.push(v);
  }
  return Object.freeze(out.sort());
}

function cleanOperation(operation){
  if(!operation||typeof operation!=='object'||Array.isArray(operation)) throw Object.assign(new Error('operation must be an object'),{code:'WFM_CAPABILITY_OPERATION_INVALID'});
  const method=clean(operation.method,'operation.method').toUpperCase();
  const path=clean(operation.path,'operation.path');
  const capability=clean(operation.capability,'operation.capability');
  const operationId=clean(operation.operationId,'operation.operationId');
  if(!path.startsWith('/')) throw Object.assign(new Error('operation.path must be absolute'),{code:'WFM_CAPABILITY_OPERATION_INVALID'});
  if(path.includes('..')||path.includes('://')) throw Object.assign(new Error('operation.path is unsafe'),{code:'WFM_CAPABILITY_OPERATION_INVALID'});
  if(!SAFE_METHODS.has(method)||operation.readOnly!==true) throw Object.assign(new Error('operation is not an approved read'),{code:'WFM_CAPABILITY_OPERATION_MUTATIVE'});
  return Object.freeze({method,path,capability,operationId,readOnly:true});
}

function opKey(op){return `${op.method} ${op.path}#${op.operationId}`;}

export function evaluateProviderCapabilityAuthority({
  provider,
  wfmTenant,
  connectionId,
  exactHost,
  credentialRevision,
  approvedCapabilities=[],
  observedCapabilities=[],
  requiredCapabilities=[],
  approvedOperations=[],
  requestedOperation,
  customerApprovedCapabilityExpansion=false
}={}){
  const reasons=[];
  let p,t,c,h,cr,approved,observed,required,ops,requested;
  try{
    p=clean(provider,'provider'); t=clean(wfmTenant,'wfmTenant'); c=clean(connectionId,'connectionId');
    h=clean(exactHost,'exactHost').toLowerCase(); cr=clean(credentialRevision,'credentialRevision');
    if(!/^https:\/\//.test(h)||h.includes('*')) reasons.push('exact-https-host-required');
    approved=cleanSet(approvedCapabilities,'approvedCapabilities');
    observed=cleanSet(observedCapabilities,'observedCapabilities');
    required=cleanSet(requiredCapabilities,'requiredCapabilities');
    ops=Object.freeze(approvedOperations.map(cleanOperation));
    requested=cleanOperation(requestedOperation);
  }catch(error){
    reasons.push(error.code||'invalid-capability-evidence');
    return {allowed:false,mode:'blocked-provider-capability-authority',reasons:Object.freeze([...new Set(reasons)])};
  }

  const approvedSet=new Set(approved), observedSet=new Set(observed);
  const unexpected=observed.filter(x=>!approvedSet.has(x));
  const missing=required.filter(x=>!observedSet.has(x));
  if(unexpected.length && customerApprovedCapabilityExpansion!==true) reasons.push('unapproved-provider-capability-expansion');
  if(missing.length) reasons.push('required-provider-capability-missing');
  if(!approvedSet.has(requested.capability)||!observedSet.has(requested.capability)) reasons.push('requested-capability-not-entitled');
  if(!ops.some(op=>opKey(op)===opKey(requested)&&op.capability===requested.capability)) reasons.push('requested-operation-not-approved');

  const decision={
    allowed:reasons.length===0,
    mode:reasons.length===0?'bounded-provider-capability-authority':'blocked-provider-capability-authority',
    reasons:Object.freeze([...new Set(reasons)]),
    scope:Object.freeze({provider:p,wfmTenant:t,connectionId:c,exactHost:h,credentialRevision:cr}),
    approvedCapabilities:approved,
    observedCapabilities:observed,
    requiredCapabilities:required,
    requestedOperation:requested,
    unexpectedCapabilities:Object.freeze(unexpected),
    missingRequiredCapabilities:Object.freeze(missing),
    mutationAuthority:false,
    capabilityExpansionAuthority:false,
    checkpointAuthority:false
  };
  return Object.freeze(decision);
}

export function assertProviderCapabilityAuthoritySafe(input){
  const decision=evaluateProviderCapabilityAuthority(input);
  if(!decision.allowed){
    const error=new Error(`Provider capability authority rejected: ${decision.reasons.join(', ')}`);
    error.code='WFM_PROVIDER_CAPABILITY_AUTHORITY_BLOCKED';
    error.decision=decision;
    throw error;
  }
  return decision;
}
