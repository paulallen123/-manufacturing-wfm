#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

function listTests(dir, predicate){
  const abs=path.join(ROOT,dir);
  if(!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs)
    .filter(name=>predicate(name))
    .sort()
    .map(name=>path.posix.join(dir,name));
}

export function summarizeProofStages(stages=[]){
  const mandatoryFailures=stages.filter(stage=>stage.mandatory!==false && stage.status!=='PASS');
  return Object.freeze({
    contract:'VECTOR_PROOF_CONTINUATION_V1',
    strategy:'FAIL_CLOSED_NOT_FAIL_STOP',
    allMandatoryStagesPassed:mandatoryFailures.length===0,
    mandatoryFailureCount:mandatoryFailures.length,
    failedMandatoryStageIds:Object.freeze(mandatoryFailures.map(x=>x.id)),
    continuedAfterFailure:stages.some((stage,index)=>stage.status!=='PASS' && index<stages.length-1),
    promotionClaim:'NONE',
    promotionBlocked:mandatoryFailures.length>0,
    productionMutation:false,
    productionAuthorityGranted:false,
    customerMutation:false,
    stages:Object.freeze(stages.map(x=>Object.freeze({...x})))
  });
}

function runNodeStage(id,args,{mandatory=true,scopes=[]}={}){
  const started=Date.now();
  console.log('\n=== VECTOR_PROOF_STAGE_START '+id+' ===');
  const result=spawnSync(process.execPath,args,{
    cwd:ROOT,
    stdio:'inherit',
    env:process.env
  });
  const receipt={
    id,
    mandatory,
    scopes,
    status:result.status===0&&!result.error?'PASS':'FAIL',
    exitCode:result.status,
    launchError:result.error?String(result.error.message||result.error):null,
    durationMs:Date.now()-started
  };
  console.log('VECTOR_PROOF_STAGE_RESULT='+JSON.stringify(receipt));
  return receipt;
}

function integratedTestFiles(){
  const explicit=[
    'tests/vector-consolidation.test.cjs',
    'tests/vector-runtime-packaging.test.cjs',
    'tests/vector-http-verifier.test.cjs',
    'tests/vector-release-proof-binding.test.cjs',
    'tests/vector-source-guard.test.cjs',
    'ux-overlay/vector-action-queue.test.cjs',
    'operations/runtime/workflow-action-evidence-contract.test.cjs',
    'operations/runtime/decision-episode.test.cjs',
    'operations/runtime/customer-demand-intelligence.test.cjs',
    'operations/runtime/absence-recovery-shadow.test.cjs',
    'operations/runtime/demand-decision-service.test.cjs',
    'operations/runtime/decision-outcome-proof.test.cjs',
    'scripts/compose-vector-presentation.regression.test.mjs',
    'scripts/prove-vector-built-asset-provenance.test.mjs',
    'test/frontier/cash-to-capacity-engine.test.mjs',
    'test/frontier/cash-to-capacity-evidence.test.mjs',
    'test/frontier/cash-to-capacity-decision.test.mjs',
    'test/frontier/cash-to-capacity-outcome.test.mjs',
    'test/frontier/energy-bill-evidence.test.mjs',
    'test/frontier/energy-coordination-sensitivity.test.mjs',
    'test/frontier/energy-data-reconciliation.test.mjs',
    'test/frontier/energy-flexibility.test.mjs',
    'test/frontier/energy-input-hardening.test.mjs',
    'test/frontier/energy-profile-benchmark.test.mjs',
    'test/frontier/energy-profile-binding.test.mjs',
    'operations/runtime/realtime-event-service.test.cjs',
    'operations/runtime/autopilot-execution-engine.test.cjs',
    'learning/runtime/training-workflow-manifest.test.cjs',
    'learning/runtime/training-twin.test.cjs',
    'learning/runtime/training-scenario-engine.test.cjs',
    'learning/runtime/training-delivery-service.test.cjs',
    'learning/runtime/training-video-contract.test.cjs',
    'learning/runtime/training-artifact-registry.test.cjs',
    'learning/runtime/training-regeneration-planner.test.cjs'
  ];
  const agency=listTests('test/frontier',name=>/^agency-.*\.test\.mjs$/.test(name)&&!name.includes('postgres'));
  const clocking=listTests('clocking-security-v2',name=>/\.test\.mjs$/.test(name)&&!/(soak|live|enterprise-scale)/.test(name));
  const integration=listTests('integration-fabric/runtime',name=>/\.test\.mjs$/.test(name));
  return [...explicit,...agency,...clocking,...integration];
}

export function buildProofPlan(){
  return Object.freeze([
    Object.freeze({
      id:'integrated-regression-suite',
      args:['--test',...integratedTestFiles()],
      mandatory:true,
      scopes:['product-regression','frontier','integration-fabric','clocking','realtime','learning']
    }),
    Object.freeze({
      id:'local-vector-proof',
      args:['scripts/run-local-vector-proof.mjs','/proof-vector-integrated'],
      mandatory:true,
      scopes:['local-integrated-runtime']
    }),
    Object.freeze({
      id:'portable-autonomy-proof',
      args:['scripts/run-portable-autonomy-proof.mjs','--strict-runtime'],
      mandatory:true,
      scopes:['portable-autonomy','security-boundary']
    })
  ]);
}

async function main(){
  const stages=[];
  const plan=buildProofPlan();
  for(const spec of plan){
    if(spec.id==='portable-autonomy-proof'){
      try{ fs.rmSync(path.join(ROOT,'scripts/validate-deployment.mjs'),{force:true}); }catch{}
    }
    const receipt=runNodeStage(spec.id,spec.args,spec);
    stages.push(receipt);
    if(spec.id==='local-vector-proof'){
      const summary=path.join('/proof-vector-integrated','summary.json');
      if(fs.existsSync(summary)) console.log(fs.readFileSync(summary,'utf8'));
    }
    // Deliberately continue independent, non-mutating proof stages after a failure.
    // Final admission remains fail-closed below.
  }
  const receipt=summarizeProofStages(stages);
  fs.writeFileSync(path.join(ROOT,'proof-continuation.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log('VECTOR_PROOF_CONTINUATION='+JSON.stringify(receipt));
  if(!receipt.allMandatoryStagesPassed) process.exit(1);
}

const invoked=process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(invoked) main().catch(error=>{ console.error(error?.stack||error); process.exit(1); });
