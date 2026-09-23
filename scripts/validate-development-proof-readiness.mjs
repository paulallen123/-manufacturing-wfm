#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const control=JSON.parse(fs.readFileSync(path.join(ROOT,'release/development-proof-control.json'),'utf8'));
const knowledge=JSON.parse(fs.readFileSync(path.join(ROOT,'release/proof-blocker-knowledge.json'),'utf8'));
const hostedClaim=JSON.parse(fs.readFileSync(path.join(ROOT,'release/hosted-proof-claim-contract.json'),'utf8'));
const consumptionClaim=JSON.parse(fs.readFileSync(path.join(ROOT,'release/point-of-consumption-proof.json'),'utf8'));

assert.equal(control.schemaVersion,1);
assert.equal(control.name,'VECTOR_DEVELOPMENT_TO_PROOF_CONTROL_V1');
for(const key of [
  'everyChangeHasProofRoute','preflightBeforeExpensiveProof','classifyBeforeRetry',
  'rootCauseRepairBeforeRetry','neverWeakenGateToGetGreen','exactSourceShaAcrossFallbackLanes',
  'providerFailureTriggersFallback','productFailureNeverMaskedByFallback',
  'learnedBlockerBecomesPermanentGuard','unknownBlockerFailsClosed',
  'blockerIsolationByCapability','unaffectedDevelopmentAlwaysContinues',
  'unaffectedProofStagesAlwaysContinue','blockedCapabilityDiagnosticsContinue',
  'neverGloballyFreezeForSingleCapabilityBlocker','promotionStopsOnlyAtExplicitDependencyBoundary',
  'deploymentSuccessNeverCountsAsHostedProof','publicIngressVerificationRequired',
  'applicationIdentityVerificationRequired','proofLinkMayBeSharedOnlyAfterExternalVerification',
  'proofEndsAtPointOfConsumption','nextRealWorldStepSimulationRequired',
  'userActionMustBeExecutedNotInferred','downstreamOutcomeIndependentReadbackRequired'
]) assert.equal(control.rules[key],true,key);
assert.equal(control.stageIsolationPolicy?.onBlocker,'QUARANTINE_AFFECTED_SCOPE');
assert.equal(control.stageIsolationPolicy?.unaffectedDevelopment,'CONTINUE');
assert.equal(control.stageIsolationPolicy?.unaffectedProofStages,'CONTINUE');
assert.equal(control.stageIsolationPolicy?.affectedCapabilityLaterDiagnostics,'CONTINUE_DIAGNOSTIC_ONLY');
assert.equal(control.stageIsolationPolicy?.affectedCapabilityPromotion,'BLOCK_UNTIL_REPAIRED');
assert.equal(control.blockerReceiptContract?.globalStopDefault,false);
assert.ok(control.phases.includes('public-ingress-verification'),'public ingress verification phase missing');
assert.ok(control.blockerClasses.includes('PUBLIC_RUNTIME_UNREACHABLE'),'public runtime blocker class missing');
assert.equal(hostedClaim.schemaVersion,1);
assert.equal(hostedClaim.name,'VECTOR_HOSTED_PROOF_CLAIM_V1');
for(const key of ['deploymentSuccessAloneNeverCountsAsHostedProof','publicIngressMustReturn2xx','applicationIdentityMarkerRequired','proofLinkMayBeSharedOnlyAfterHostedProven','unknownResponseFailsClosed']) assert.equal(hostedClaim.rules[key],true,key);
assert.equal(consumptionClaim.name,'VECTOR_POINT_OF_CONSUMPTION_PROOF_V1');
for(const key of ['upstreamSuccessNeverImpliesDownstreamSuccess','userActionMustBePerformedNotInferred','downstreamStateMustBeReadBackIndependently','nextRealWorldStepMustBeSimulatedBeforeClaim','everyDiscoveredFailureBecomesARegressionGuard','repeatAfterSuccessByAttackingRecoveryDriftAndEdgeCases','unknownsFailClosed']) assert.equal(consumptionClaim.rules[key],true,key);
assert.ok(Array.isArray(control.pathRules)&&control.pathRules.length>=8);
assert.ok(Array.isArray(knowledge.entries)&&knowledge.entries.length>=5);
for(const item of knowledge.entries){
  assert.ok(item.id&&item.class&&item.symptom&&item.prevention&&item.permanentGuard,item.id||'knowledge-entry');
}

const scanRoots=['tests','test','clocking-security-v2','integration-fabric/runtime','learning/runtime','operations/runtime','scripts'];
const codeFiles=[];
function walk(dir){
  if(!fs.existsSync(dir)) return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(entry.name==='node_modules'||entry.name.startsWith('.git')) continue;
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) walk(full);
    else if(/\.(?:js|mjs|cjs)$/.test(entry.name)) codeFiles.push(full);
  }
}
for(const rel of scanRoots) walk(path.join(ROOT,rel));

const blockers=[];
let localRefs=0;
const urlRef=/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
for(const file of codeFiles){
  const src=fs.readFileSync(file,'utf8');
  if(/\.test\.(?:js|mjs|cjs)$/.test(file)){
    if(/type\s*:\s*['"]windows_wef['"]/.test(src)) blockers.push({class:'STALE_PROOF_CONTRACT',file,reason:'retired-windows_wef-source-alias'});
    if(/type\s*:\s*['"]legacy_taa['"]/.test(src)) blockers.push({class:'STALE_PROOF_CONTRACT',file,reason:'retired-legacy_taa-source-alias'});
    if(/result\.artifact\.url\b/.test(src)) blockers.push({class:'STALE_PROOF_CONTRACT',file,reason:'retired-training-artifact-url-field'});
  }
  for(const match of src.matchAll(urlRef)){
    const rel=match[1];
    if(!rel.startsWith('.')) continue;
    localRefs++;
    const resolved=path.resolve(path.dirname(file),rel);
    if(!fs.existsSync(resolved)) blockers.push({class:'MISSING_PROOF_DEPENDENCY',file,dependency:rel,resolved});
  }
}

const loaderPath=path.join(ROOT,'integration-fabric/scripts/load-catalog.mjs');
if(fs.existsSync(loaderPath)){
  const loader=fs.readFileSync(loaderPath,'utf8');
  if(!/function\s+mergePatch\s*\(/.test(loader)) blockers.push({class:'EVIDENCE_OR_CATALOG_DRIFT',file:loaderPath,reason:'recursive-overlay-merge-guard-missing'});
  if(/byId\.set\(entry\.id,\s*\{\.\.\.current,\s*\.\.\.structuredClone\(entry\.patch\)/.test(loader)) blockers.push({class:'EVIDENCE_OR_CATALOG_DRIFT',file:loaderPath,reason:'retired-shallow-overlay-merge-present'});
}

const docker=fs.readFileSync(path.join(ROOT,'Dockerfile'),'utf8');
for(const match of docker.matchAll(/\bnode\s+(scripts\/[A-Za-z0-9_.\/-]+\.(?:mjs|cjs|js))/g)){
  const target=path.join(ROOT,match[1]);
  if(!fs.existsSync(target)) blockers.push({class:'MISSING_PROOF_DEPENDENCY',file:'Dockerfile',dependency:match[1]});
}

if(blockers.length){
  console.error(JSON.stringify({status:'FAIL',blockers},null,2));
  process.exit(1);
}
console.log('VECTOR_DEVELOPMENT_PROOF_PREFLIGHT=PASS files='+codeFiles.length+' localRefs='+localRefs+' learnedGuards='+knowledge.entries.length);
