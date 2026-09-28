#!/usr/bin/env node
import fs from 'node:fs';

export function classifyProofBlocker(input=''){
  const text=String(input||'');
  const hasTestFailure=/\bnot ok\b|ERR_ASSERTION|AssertionError|# fail\s+[1-9]/i.test(text);
  const providerSkipped=/no deployment needed[^\n]*(?:watched paths? not modified|path filter)|deployment (?:was )?skipped|status-only green/i.test(text) && /(?:"state"\s*:\s*"success"|state\s*[=:]\s*success)/i.test(text);
  if(providerSkipped) return result('PROVIDER_SKIPPED_NO_PROOF',true,true,true,'Freeze the exact candidate through an admitted trigger or route it to an equivalent executable lane; the provider success status is not proof.');
  const providerOnly=/runner_id=0|no runner allocated|runner allocation|builder unavailable|provider unavailable|scheduling build[^\n]*(?:timeout|failed before execution)/i.test(text) && !hasTestFailure;
  if(providerOnly) return result('PROVIDER_DEGRADED',false,true,true,'Run the identical source SHA through the next executable independent proof lane.');
  if(/ENOENT|MODULE_NOT_FOUND|Cannot find module|no such file or directory/i.test(text)) return result('MISSING_PROOF_DEPENDENCY',true,true,false,'Repair the missing/incorrect proof dependency or package it explicitly; do not skip the gate.');
  if(/COPY .*not found|final Docker stage.*missing|bootstrap dependenc|runtime packaging/i.test(text)) return result('PACKAGING_DRIFT',true,true,false,'Repair exact-image packaging and re-run the same proof contract.');
  if(hasTestFailure && /tenant|cross-tenant|payroll authority|credential|identity|security|permission|isolation/i.test(text)) return result('SECURITY_INVARIANT',true,true,false,'Treat as a security/product blocker until the invariant is restored and independently re-tested.');
  if(hasTestFailure && /version|obsolete|deprecated|stale|retired/i.test(text) && /expected|actual|did not match|assert/i.test(text)) return result('STALE_PROOF_CONTRACT',true,true,false,'Update the proof contract only after confirming the runtime/source-of-truth is correct.');
  if(hasTestFailure && /integration-fabric|catalog|catalogue|protocol|evidenceBlockers|canonicalTargets|provider documentation|spec-verified/i.test(text)) return result('EVIDENCE_OR_CATALOG_DRIFT',true,true,false,'Reconcile test expectations with authoritative evidence; preserve least privilege and do not invent capabilities.');
  if(hasTestFailure && /expected|actual|did not match|obsolete|deprecated|stale/i.test(text)) return result('STALE_PROOF_CONTRACT',true,true,false,'Update the proof contract only after confirming the runtime/source-of-truth is correct.');
  if(/PROOF_REQUIRED|missing evidence|evidence unavailable|unproven|NO_PROOF/i.test(text)) return result('MISSING_EVIDENCE',true,true,false,'Gather the required exact-candidate evidence; absence of proof is not a pass.');
  if(hasTestFailure) return result('PRODUCT_REGRESSION',true,true,false,'Repair the product or deterministic test fixture at root cause and add a regression guard.');
  return result('UNKNOWN_FAIL_CLOSED',true,true,false,'Preserve evidence, stop blind retries, isolate the first failing gate and classify before further action.');
}

function result(blockerClass,blocking,developmentCanContinue,fallbackAllowed,nextAction){
  return {
    schemaVersion:1,
    blockerClass,
    blocking,
    countsAsProof:false,
    executedEvidence:false,
    developmentCanContinue,
    fallbackAllowed,
    affectedScope:'affected-capability',
    affectedStage:'current-proof-stage',
    dependencyBoundary:'exact-failing-contract',
    globalStop:false,
    unaffectedDevelopment:'CONTINUE',
    unaffectedProof:'CONTINUE',
    affectedScopeMode:blocking?'DIAGNOSTIC_ONLY':'CONTINUE',
    affectedPromotion:blocking?'QUARANTINED':'CONTINUE',
    propagateOnlyOn:['explicit-dependency','shared-security-invariant','shared-authority-boundary','shared-data-integrity-boundary'],
    nextAction,
    learningAction:'After resolution, record the cause and add a deterministic regression or preflight guard.'
  };
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const fileIndex=process.argv.indexOf('--file');
  const input=fileIndex>=0 ? fs.readFileSync(process.argv[fileIndex+1],'utf8') : fs.readFileSync(0,'utf8');
  process.stdout.write(JSON.stringify(classifyProofBlocker(input),null,2)+'\n');
}
