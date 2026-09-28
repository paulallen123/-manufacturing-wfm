const DEFAULT_PRIVILEGED_CAPABILITIES = new Set([
  'administrator',
  'admin',
  'manage-all-data',
  'override-permissions:manage-all-data',
  'platform-management',
  'user-admin',
  'group-admin',
  'permission-admin',
  'site-admin',
  'impersonate',
  'delete',
  'archive',
  'write',
  'control'
]);

function normalizeCapability(value){
  return String(value||'').trim().toLowerCase();
}

function capabilityIsPrivileged(value){
  const normalized=normalizeCapability(value);
  if(!normalized) return false;
  if(DEFAULT_PRIVILEGED_CAPABILITIES.has(normalized)) return true;
  return [...DEFAULT_PRIVILEGED_CAPABILITIES].some(token=>normalized.includes(token));
}

export function evaluatePrivilegedBootstrap({
  surface='integration',
  registrationRequiresElevatedAuthority=false,
  bootstrapCapabilities=[],
  runtimeCapabilities=[],
  customerPreProvisioned=false,
  runtimeCanOperateWithoutBootstrapCredential=false,
  verificationMaterialSeparated=false
}={}){
  const bootstrap=[...new Set(bootstrapCapabilities.map(normalizeCapability).filter(Boolean))];
  const runtime=[...new Set(runtimeCapabilities.map(normalizeCapability).filter(Boolean))];
  const privilegedBootstrap=registrationRequiresElevatedAuthority || bootstrap.some(capabilityIsPrivileged);
  const privilegedRuntime=runtime.some(capabilityIsPrivileged);

  if(privilegedRuntime){
    return {
      allowed:false,
      surface,
      mode:'blocked-runtime-authority',
      reason:'steady-state runtime retains privileged or mutative authority',
      retainBootstrapCredential:false,
      reuseBootstrapCredentialAtRuntime:false
    };
  }

  if(!privilegedBootstrap){
    return {
      allowed:true,
      surface,
      mode:'least-privilege-steady-state',
      reason:'no elevated bootstrap authority is required by the reviewed route',
      retainBootstrapCredential:false,
      reuseBootstrapCredentialAtRuntime:false
    };
  }

  if(customerPreProvisioned && runtimeCanOperateWithoutBootstrapCredential && verificationMaterialSeparated){
    return {
      allowed:true,
      surface,
      mode:'customer-preprovisioned-separated-bootstrap',
      reason:'elevated setup is completed outside WFM and steady-state runtime retains only bounded data-plane or verification material',
      retainBootstrapCredential:false,
      reuseBootstrapCredentialAtRuntime:false
    };
  }

  return {
    allowed:false,
    surface,
    mode:'bootstrap-separation-required',
    reason:'elevated setup authority must be completed outside the WFM runtime or replaced with a lower-privilege vendor route',
    retainBootstrapCredential:false,
    reuseBootstrapCredentialAtRuntime:false
  };
}

export function assertPrivilegedBootstrapSafe(input){
  const decision=evaluatePrivilegedBootstrap(input);
  if(!decision.allowed){
    const error=new Error(`${decision.surface}: ${decision.reason}`);
    error.code='WFM_PRIVILEGED_BOOTSTRAP_BLOCKED';
    error.decision=decision;
    throw error;
  }
  return decision;
}
