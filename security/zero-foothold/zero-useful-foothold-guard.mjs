export const ZERO_USEFUL_FOOTHOLD_VERSION='zero-useful-foothold-v0.2.0';

const str=v=>typeof v==='string'?v.trim():'';
const arr=v=>Array.isArray(v)?v:[];
const uniq=a=>[...new Set(a.map(String))];
const NONCANONICAL_PUBLIC_LIFECYCLES=new Set(['proof','test','test-harness','diagnostic','retired','legacy']);

function fail(code,detail={}){return {ok:false,code,detail};}

function validateIdentity(service){
  if(service.identity?.mode!=='workload') return fail('WORKLOAD_IDENTITY_REQUIRED',{service:service.id});
  const ttl=Number(service.identity?.ttlSeconds);
  if(!Number.isFinite(ttl)||ttl<=0||ttl>3600) return fail('WORKLOAD_IDENTITY_TTL_INVALID',{service:service.id,ttl});
  if(!str(service.identity?.audience)) return fail('WORKLOAD_IDENTITY_AUDIENCE_REQUIRED',{service:service.id});
  if(!str(service.identity?.cellId)||service.identity.cellId!==service.cellId) return fail('WORKLOAD_IDENTITY_CELL_BINDING_REQUIRED',{service:service.id});
  return {ok:true};
}

function validateService(service,{release,telemetry,recovery}={}){
  if(!str(service?.id)||!str(service?.cellId)) return fail('SERVICE_ID_OR_CELL_MISSING');
  if(service.environment==='production' && service.public===true && service.exposureApproved!==true) return fail('PUBLIC_EXPOSURE_NOT_APPROVED',{service:service.id});
  if(['test','staging','demo'].includes(service.environment) && service.public===true && service.exposureApproved!==true) return fail('NONPROD_PUBLIC_EXPOSURE_NOT_APPROVED',{service:service.id});
  if(arr(service.listeners).some(x=>['admin','debug','shell','metrics-admin'].includes(String(x)))) return fail('PRIVILEGED_LISTENER_EXPOSED',{service:service.id});
  if(arr(service.longLivedSecrets).length>0) return fail('LONG_LIVED_SECRET_PRESENT',{service:service.id});
  if(arr(service.buildSecrets).length>0) return fail('BUILD_SECRET_PRESENT',{service:service.id});
  if(service.build?.networkInstall===true) return fail('NETWORK_INSTALL_DURING_BUILD',{service:service.id});
  if(service.runtime?.mutableImage===true || !str(service.runtime?.imageDigest)) return fail('IMMUTABLE_IMAGE_REQUIRED',{service:service.id});
  if(service.runtime?.rootUser===true) return fail('ROOT_RUNTIME_FORBIDDEN',{service:service.id});
  if(service.runtime?.readOnlyFilesystem!==true) return fail('READ_ONLY_RUNTIME_REQUIRED',{service:service.id});
  if(service.runtime?.packageManagerPresent===true) return fail('RUNTIME_PACKAGE_MANAGER_FORBIDDEN',{service:service.id});
  if(service.runtime?.shellPresent===true && service.runtime?.shellRequired!==true) return fail('UNNECESSARY_RUNTIME_SHELL_PRESENT',{service:service.id});
  if(service.egress?.defaultDeny!==true) return fail('EGRESS_DEFAULT_DENY_REQUIRED',{service:service.id});
  if(arr(service.egress?.allowHosts).some(x=>str(x)==='*')) return fail('EGRESS_WILDCARD_FORBIDDEN',{service:service.id});
  const identity=validateIdentity(service); if(!identity.ok) return identity;
  if(service.agent===true){
    if(!Number.isFinite(Number(service.agentPolicy?.actionBudget))||Number(service.agentPolicy.actionBudget)<0) return fail('AGENT_ACTION_BUDGET_REQUIRED',{service:service.id});
    if(service.agentPolicy?.killSwitch!==true) return fail('AGENT_KILL_SWITCH_REQUIRED',{service:service.id});
    if(service.agentPolicy?.modelCanGrantAuthority===true) return fail('MODEL_CREATED_AUTHORITY_FORBIDDEN',{service:service.id});
    if(service.agentPolicy?.toolBrokered!==true) return fail('AGENT_TOOL_BROKER_REQUIRED',{service:service.id});
  }
  if(service.public===true && service.tripwire?.enabled!==true) return fail('PUBLIC_TRIPWIRE_REQUIRED',{service:service.id});
  if(service.privileged===true){
    if(!telemetry?.independentPrimary || !telemetry?.independentSecondary) return fail('DUAL_TELEMETRY_REQUIRED',{service:service.id});
    if(telemetry.failClosedOnDisagreement!==true) return fail('TELEMETRY_DISAGREEMENT_FAIL_CLOSED_REQUIRED',{service:service.id});
  }
  if(recovery?.sameAuthorityAsRuntime===true) return fail('RECOVERY_AUTHORITY_NOT_INDEPENDENT',{service:service.id});
  if(release?.branchProtected!==true) return fail('RELEASE_BRANCH_PROTECTION_REQUIRED');
  if(release?.commitVerified!==true) return fail('VERIFIED_RELEASE_COMMIT_REQUIRED');
  if(release?.requiredChecksPassed!==true) return fail('REQUIRED_RELEASE_CHECKS_NOT_PROVEN');
  if(!str(release?.artifactDigest)) return fail('RELEASE_ARTIFACT_DIGEST_REQUIRED');
  return {ok:true};
}

function validateIngress(input){
  const publicServices=arr(input.services).filter(s=>s?.public===true);
  for(const service of publicServices){
    if(service.ingressRole!=='canonical-edge') return fail('PUBLIC_SERVICE_NOT_CANONICAL_EDGE',{service:service.id});
    if(!str(service.region)) return fail('PUBLIC_SERVICE_REGION_REQUIRED',{service:service.id});
    if(NONCANONICAL_PUBLIC_LIFECYCLES.has(String(service.lifecycle||'').toLowerCase())) {
      return fail('NONCANONICAL_LIFECYCLE_PUBLIC',{service:service.id,lifecycle:service.lifecycle});
    }
  }
  const byRegion=new Map();
  for(const service of publicServices){
    const key=String(service.region);
    const items=byRegion.get(key)||[];
    items.push(service.id);
    byRegion.set(key,items);
  }
  for(const [region,ids] of byRegion){
    if(ids.length>1) return fail('MULTIPLE_PUBLIC_EDGES_SAME_REGION',{region,services:ids});
  }
  return {ok:true};
}

function validateTopology(input){
  const cells=arr(input.cells);
  const services=arr(input.services);
  const cellIds=uniq(cells.map(c=>c.id));
  if(cellIds.length!==cells.length || cellIds.some(x=>!str(x))) return fail('CELL_IDS_MUST_BE_UNIQUE');
  const serviceIds=uniq(services.map(s=>s.id));
  if(serviceIds.length!==services.length || serviceIds.some(x=>!str(x))) return fail('SERVICE_IDS_MUST_BE_UNIQUE');
  for(const s of services) if(!cellIds.includes(String(s.cellId))) return fail('SERVICE_REFERENCES_UNKNOWN_CELL',{service:s.id,cell:s.cellId});
  for(const edge of arr(input.crossCellEdges)){
    if(!cellIds.includes(String(edge.from))||!cellIds.includes(String(edge.to))) return fail('CROSS_CELL_EDGE_UNKNOWN_CELL',{edge});
    if(edge.approved!==true || edge.leastPrivilege!==true || !str(edge.purpose)) return fail('CROSS_CELL_EDGE_NOT_EXPLICITLY_AUTHORISED',{edge});
  }
  return {ok:true};
}

export function evaluateZeroUsefulFoothold(input={}){
  const topology=validateTopology(input); if(!topology.ok) return {status:'blocked',...topology};
  const ingress=validateIngress(input); if(!ingress.ok) return {status:'blocked',...ingress};
  for(const service of arr(input.services)){
    const result=validateService(service,input);
    if(!result.ok) return {status:'blocked',...result};
  }
  const profiles=arr(input.scaleProfiles);
  const required=['1/1','small','100','500','2000','10000'];
  for(const id of required) if(!profiles.some(p=>String(p.id)===id&&p.proven===true)) return {status:'blocked',...fail('SCALE_PROFILE_NOT_PROVEN',{profile:id})};
  return {
    status:'pass',
    claim:'No unnecessary useful foothold was found in the supplied service/topology evidence.',
    boundary:'This does not prove zero vulnerability or impossibility of compromise; it proves the reviewed candidate satisfies the zero-useful-foothold invariants represented by this contract.'
  };
}
