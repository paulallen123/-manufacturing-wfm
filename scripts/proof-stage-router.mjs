#!/usr/bin/env node
import fs from 'node:fs';

export function routeProofBlocker({blocker={},affectedCapability='unknown',affectedStage='unknown',explicitDependencies=[],sharedCriticalInvariant=false}={}){
  const dependencyScopes=[...new Set((explicitDependencies||[]).map(String).filter(Boolean))];
  const propagates=sharedCriticalInvariant===true || dependencyScopes.length>0;
  const quarantinedScopes=[affectedCapability,...dependencyScopes].filter(Boolean);
  return {
    schemaVersion:1,
    strategy:'QUARANTINE_AFFECTED_SCOPE',
    affectedCapability,
    affectedStage,
    blockerClass:blocker.blockerClass||'UNKNOWN_FAIL_CLOSED',
    globalDevelopment:'CONTINUE',
    globalProof:'CONTINUE',
    globalStop:false,
    quarantinedScopes,
    affectedCapabilityDevelopment:'CONTINUE',
    affectedCapabilityProof:'DIAGNOSTIC_ONLY',
    affectedCapabilityPromotion:'BLOCK_UNTIL_REPAIRED',
    unaffectedCapabilities:'CONTINUE_ALL_STAGES',
    propagate:propagates,
    propagationReason:sharedCriticalInvariant?'shared-critical-invariant':dependencyScopes.length?'explicit-dependency':null,
    claimBoundary:'Quarantined scopes cannot claim PASS or promotion until repaired and re-proven.'
  };
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const raw=fs.readFileSync(0,'utf8').trim();
  const input=raw?JSON.parse(raw):{};
  process.stdout.write(JSON.stringify(routeProofBlocker(input),null,2)+'\n');
}
