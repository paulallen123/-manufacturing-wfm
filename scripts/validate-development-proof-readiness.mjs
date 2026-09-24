#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const control=JSON.parse(fs.readFileSync(path.join(ROOT,'release/development-proof-control.json'),'utf8'));
const knowledge=JSON.parse(fs.readFileSync(path.join(ROOT,'release/proof-blocker-knowledge.json'),'utf8'));

assert.equal(control.schemaVersion,1);
assert.equal(control.name,'VECTOR_DEVELOPMENT_TO_PROOF_CONTROL_V1');
for(const key of [
  'everyChangeHasProofRoute','preflightBeforeExpensiveProof','classifyBeforeRetry',
  'rootCauseRepairBeforeRetry','neverWeakenGateToGetGreen','exactSourceShaAcrossFallbackLanes',
  'providerFailureTriggersFallback','productFailureNeverMaskedByFallback',
  'learnedBlockerBecomesPermanentGuard','unknownBlockerFailsClosed',
  'blockerIsolationByCapability','unaffectedDevelopmentAlwaysContinues',
  'unaffectedProofStagesAlwaysContinue','blockedCapabilityDiagnosticsContinue',
  'neverGloballyFreezeForSingleCapabilityBlocker','promotionStopsOnlyAtExplicitDependencyBoundary'
]) assert.equal(control.rules[key],true,key);
assert.equal(control.stageIsolationPolicy?.onBlocker,'QUARANTINE_AFFECTED_SCOPE');
assert.equal(control.stageIsolationPolicy?.unaffectedDevelopment,'CONTINUE');
assert.equal(control.stageIsolationPolicy?.unaffectedProofStages,'CONTINUE');
assert.equal(control.stageIsolationPolicy?.affectedCapabilityLaterDiagnostics,'CONTINUE_DIAGNOSTIC_ONLY');
assert.equal(control.stageIsolationPolicy?.affectedCapabilityPromotion,'BLOCK_UNTIL_REPAIRED');
assert.equal(control.blockerReceiptContract?.globalStopDefault,false);
assert.ok(Array.isArray(control.pathRules)&&control.pathRules.length>=8);
assert.ok(Array.isArray(knowledge.entries)&&knowledge.entries.length>=5);
for(const item of knowledge.entries){
  assert.ok(item.id&&item.class&&item.symptom&&item.prevention&&item.permanentGuard,item.id||'knowledge-entry');
}

const learnedGuardChecks={
  'runner-or-builder-no-execution':[
    ['resilience/pre-freeze-simulator.cjs','PROVIDER_DEGRADED_PREEXECUTION'],
    ['release/proof-lane-policy.json','failureDomain']
  ],
  'hosted-proof-lane-runtime-contract-missing':[
    ['resilience/pre-freeze-simulator.cjs','RUNTIME_VARIABLE_CONTRACT_MISSING'],
    ['release/proof-lane-policy.json','liveRuntimeContractRequiredBeforeLaneAdmission']
  ],
  'fixed-port-and-readiness-window':[
    ['ux-overlay/vector-workflows.test.cjs','reservePort'],
    ['ux-overlay/vector-workflows.test.cjs','WFM_PROOF_STARTUP_BUDGET_MS']
  ],
  'same-provider-false-parallelism':[
    ['resilience/pre-freeze-simulator.cjs','falseParallelism'],
    ['release/proof-lane-policy.json','sharedFailureDomainNeverCountsAsIndependent']
  ],
  'proof-on-every-intermediate-commit':[
    ['release/proof-lane-policy.json','artifact/vector-proof-freeze.trigger'],
    ['.circleci/config.yml','require_frozen_candidate']
  ],
  'presentation-provenance-source-tree-drift':[
    ['Dockerfile','/tmp/vector-provenance/reporting/ui'],
    ['scripts/prove-vector-built-asset-provenance.mjs','reporting/ui/vector-reporting-ui.js']
  ],
  'manual-candidate-identity-env-drift':[
    ['release/proof-lane-policy.json','manualCandidateShaVariableNeverAuthoritative'],
    ['release/proof-lane-policy.json','deployment commit metadata']
  ]
};
for(const [id,guards] of Object.entries(learnedGuardChecks)){
  assert.ok(knowledge.entries.some(item=>item.id===id),'Missing learned blocker entry: '+id);
  for(const [relativePath,marker] of guards){
    const target=path.join(ROOT,relativePath);
    assert.ok(fs.existsSync(target),'Missing permanent guard file for '+id+': '+relativePath);
    assert.ok(fs.readFileSync(target,'utf8').includes(marker),'Missing permanent guard marker for '+id+': '+relativePath+' -> '+marker);
  }
}
const workflowTest=fs.readFileSync(path.join(ROOT,'ux-overlay/vector-workflows.test.cjs'),'utf8');
assert.ok(!workflowTest.includes('const port = 43217'),'Retired fixed workflow proof port reappeared.');
assert.ok(!/for\s*\(let\s+attempt\s*=\s*0;\s*attempt\s*<\s*80/.test(workflowTest),'Retired fixed startup-attempt window reappeared.');

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
