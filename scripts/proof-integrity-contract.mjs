const COMMIT_SHA=/^[0-9a-f]{40}$/;

export function proofHealthCode(status){
  return String(status||'').toUpperCase()==='PASS'?200:503;
}

export function assertRuntimeIdentity(identity){
  const sha=String(identity?.candidateSha||'').trim().toLowerCase();
  if(!COMMIT_SHA.test(sha)) throw new Error('Invalid runtime candidate SHA.');
  if(identity?.sourceBinding!=='build-file-matched'){
    throw new Error('Runtime identity must be build-file-matched.');
  }
  return sha;
}

export function validateProofRegistry(registry){
  if(registry?.schemaVersion!==1) throw new Error('Unsupported proof registry schema.');
  if(registry?.name!=='VECTOR_PROOF_INTEGRITY_REGISTRY_V1') throw new Error('Unexpected proof registry name.');

  const identity=registry?.candidateIdentity||{};
  if(identity.authority!=='runtime-identity-endpoint') throw new Error('Candidate authority must be runtime-identity-endpoint.');
  if(identity.endpoint!=='/api/runtime-identity') throw new Error('Candidate identity endpoint must be /api/runtime-identity.');
  if(identity.requiredSourceBinding!=='build-file-matched') throw new Error('Candidate identity must require build-file-matched.');
  if(identity.manualExpectedShaAuthoritative!==false) throw new Error('Manual expected SHA must never be authoritative.');

  const railway=registry?.railwayStatus||{};
  if(railway.deploymentSuccessCountsAsProofPass!==false) throw new Error('Railway deployment success must not count as proof success.');
  if(railway.healthRequiresTerminalPass!==true) throw new Error('Railway health must require terminal proof PASS.');
  if(railway.nonPassHealthCode!==503) throw new Error('Non-PASS proof health must be HTTP 503.');

  const readiness=registry?.productReadiness||{};
  if(readiness.scopePassNeverImpliesProductReady!==true) throw new Error('A scoped PASS must never imply product readiness.');
  if(readiness.requiresExplicitAggregateGate!==true) throw new Error('Product readiness requires an explicit aggregate gate.');
  if(readiness.aggregateGateId!=='customer-proof-gate') throw new Error('Product readiness aggregate gate must be customer-proof-gate.');

  const ids=new Set();
  const services=new Set();
  const canonicalOwners=new Map();
  for(const runner of registry?.runners||[]){
    if(!runner?.id||!runner?.service||!runner?.claim||!runner?.role||!runner?.lifecycle){
      throw new Error('Every proof runner requires id, service, claim, role and lifecycle.');
    }
    if(ids.has(runner.id)) throw new Error('Duplicate proof runner id: '+runner.id);
    ids.add(runner.id);
    if(services.has(runner.service)) throw new Error('Duplicate proof service registration: '+runner.service);
    services.add(runner.service);

    if(runner.deploymentSuccessCountsAsPass!==false){
      throw new Error('Runner deployment success cannot count as proof success: '+runner.id);
    }

    if(['retired','negative','helper'].includes(runner.lifecycle)&&runner.promotionEligible===true){
      throw new Error(runner.lifecycle+' runner cannot be promotion eligible: '+runner.id);
    }

    if(runner.promotionEligible===true){
      if(runner.identityBinding!=='runtime-identity-endpoint'){
        throw new Error('Promotion runner must use runtime-identity-endpoint: '+runner.id);
      }
      if(runner.terminalProofOwnsHealth!==true){
        throw new Error('Promotion runner health must be owned by terminal proof PASS: '+runner.id);
      }
      if(runner.statusSemanticsAudited!==true){
        throw new Error('Promotion runner status semantics must be audited: '+runner.id);
      }
      if(runner.mutatesTarget===true && runner.stateIsolation!=='immutable-seed-per-run'){
        throw new Error('Mutating promotion proof requires immutable-seed-per-run state isolation: '+runner.id);
      }
      if(runner.mutatesTarget===true && !runner.isolatedTargetService){
        throw new Error('Mutating promotion proof requires an isolated target service: '+runner.id);
      }
      if(runner.mutatesTarget===true && runner.freshTargetDeploymentRequired!==true){
        throw new Error('Mutating promotion proof requires a fresh target deployment: '+runner.id);
      }
      if(!runner.failureDomain) throw new Error('Promotion runner requires failure domain: '+runner.id);
    }

    if(runner.role==='canonical'&&runner.lifecycle==='active'){
      const count=(canonicalOwners.get(runner.claim)||0)+1;
      canonicalOwners.set(runner.claim,count);
      if(count>1) throw new Error('Each proof claim must have exactly one active canonical owner: '+runner.claim);
    }
  }

  return true;
}

export function assertRegisteredRunner(registry, runnerId){
  validateProofRegistry(registry);
  const runner=(registry.runners||[]).find(item=>item.id===runnerId);
  if(!runner) throw new Error('Unregistered proof runner: '+runnerId);
  if(runner.lifecycle!=='active') throw new Error('Inactive proof runner cannot execute as canonical proof: '+runnerId);
  return runner;
}
