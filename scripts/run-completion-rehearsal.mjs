#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {routeProofBlocker} from './proof-stage-router.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const contract=JSON.parse(fs.readFileSync(path.join(ROOT,'release/completion-rehearsal-contract.json'),'utf8'));
const superset=JSON.parse(fs.readFileSync(path.join(ROOT,'release/capability-superset.json'),'utf8'));
const control=JSON.parse(fs.readFileSync(path.join(ROOT,'release/development-proof-control.json'),'utf8'));
const docker=fs.readFileSync(path.join(ROOT,'Dockerfile'),'utf8');
const assertOrchestration=process.argv.includes('--assert-orchestration');

function exists(rel){ return fs.existsSync(path.join(ROOT,rel)); }
function isTest(rel){ return /\.test\.(?:mjs|cjs|js)$/.test(rel); }
function dockerCoversTest(rel){
  if(docker.includes(rel)) return true;
  if(rel.startsWith('clocking-security-v2/') && docker.includes("find clocking-security-v2 -maxdepth 1 -name '*.test.mjs'")) return true;
  if(rel.startsWith('integration-fabric/runtime/') && docker.includes('integration-fabric/runtime/*.test.mjs')) return true;
  if(/^test\/frontier\/agency-.*\.test\.mjs$/.test(rel) && docker.includes("find test/frontier -maxdepth 1 -name 'agency-*.test.mjs'")) return true;
  return false;
}
function tagsFor(id){
  const tags=new Set();
  for(const rule of contract.capabilityTagRules||[]) if(String(id).includes(rule.match)) for(const tag of rule.tags||[]) tags.add(tag);
  if(!tags.size) tags.add('all');
  return [...tags];
}
function scenariosFor(tags){
  return (contract.scenarioCatalogue||[]).filter(s=>s.applies.includes('all')||s.applies.some(tag=>tags.includes(tag)));
}
function requiredStages(cap){
  const stages=new Set(['source-and-contract','exact-image','hosted-runtime','authenticated-golden-journey','refresh-new-login-persistence','restart-recovery','security-destructive','customer-quality-demonstration','independent-promotion']);
  for(const p of cap.integratedPaths||[]){
    for(const rule of control.pathRules||[]) if(p.startsWith(rule.prefix)) for(const stage of rule.required||[]) stages.add(stage);
  }
  return (contract.completionStages||[]).map(s=>s.id).filter(id=>stages.has(id));
}
function stageState(id,{sourceReady,exactImageReady}){
  if(id==='source-and-contract') return sourceReady?'READY_FOR_PROOF':'BLOCKED_ACTUAL';
  if(id==='exact-image') return exactImageReady?'READY_FOR_PROOF':'BLOCKED_ACTUAL';
  return 'PENDING_REAL_WORLD_PROOF';
}

const capabilities=[];
const allActualBlockers=[];
for(const cap of superset.capabilities||[]){
  const paths=cap.integratedPaths||[];
  const missingPaths=paths.filter(p=>!exists(p));
  const tests=paths.filter(isTest);
  const uncoveredTests=tests.filter(t=>!dockerCoversTest(t));
  const sourceReady=missingPaths.length===0;
  const exactImageReady=sourceReady && tests.length>0 && uncoveredTests.length===0;
  const tags=tagsFor(cap.id);
  const actualBlockers=[];
  if(missingPaths.length) actualBlockers.push({
    blockerClass:'MISSING_PROOF_DEPENDENCY',
    reason:'integrated-path-missing',
    details:missingPaths
  });
  if(sourceReady && tests.length===0) actualBlockers.push({
    blockerClass:'MISSING_PROOF_DEPENDENCY',
    reason:'no-integrated-test-route',
    details:['Capability declares no integrated deterministic test path.']
  });
  if(sourceReady && tests.length>0 && uncoveredTests.length) actualBlockers.push({
    blockerClass:'PACKAGING_DRIFT',
    reason:'integrated-tests-not-admitted-to-exact-image',
    details:uncoveredTests
  });

  const stages=requiredStages(cap).map(id=>({id,state:stageState(id,{sourceReady,exactImageReady})}));
  const firstUnfinished=stages.find(s=>s.state!=='READY_FOR_PROOF')?.id||null;
  const scopedRoutes=actualBlockers.map(b=>({
    blocker:b,
    route:routeProofBlocker({
      blocker:b,
      affectedCapability:cap.id,
      affectedStage:firstUnfinished||'source-and-contract'
    })
  }));
  for(const item of scopedRoutes) allActualBlockers.push({capabilityId:cap.id,...item});

  capabilities.push({
    id:cap.id,
    declaredStatus:cap.status,
    rehearsalMode:'AS_IF_FINISHED_PRODUCT',
    proofClaim:'NONE_SIMULATION_ONLY',
    tags,
    sourceInspection:{
      integratedPaths:paths.length,
      tests:tests.length,
      missingPaths,
      uncoveredExactImageTests:uncoveredTests
    },
    stages,
    firstUnfinishedStage:firstUnfinished,
    actualBlockers,
    simulatedFutureRisks:scenariosFor(tags).map(s=>({
      scenarioId:s.id,
      expectedBehavior:s.expected,
      status:'MUST_REHEARSE',
      proofClaim:'NONE_SIMULATION_ONLY'
    })),
    finishedCustomerJourney:[...contract.finishedCustomerJourney],
    nextSteps:[
      ...actualBlockers.map(b=>'Repair actual blocker: '+b.reason),
      ...(firstUnfinished?['Exercise next completion stage with real evidence: '+firstUnfinished]:[]),
      'Continue rehearsing all later stages in diagnostic mode even if an earlier stage is quarantined.'
    ]
  });
}

const receipt={
  schemaVersion:1,
  name:'VECTOR_FINISH_LINE_REHEARSAL_RECEIPT_V1',
  simulationOnly:true,
  counts:{
    capabilities:capabilities.length,
    actualBlockers:allActualBlockers.length,
    futureRiskScenarios:capabilities.reduce((n,c)=>n+c.simulatedFutureRisks.length,0)
  },
  globalDevelopment:'CONTINUE',
  globalProof:'CONTINUE_UNAFFECTED_SCOPES',
  simulationCountsAsProof:false,
  capabilities,
  actualBlockers:allActualBlockers,
  generatedAt:new Date().toISOString()
};

fs.writeFileSync(path.join(ROOT,'completion-rehearsal.json'),JSON.stringify(receipt,null,2)+'\n');
console.log('VECTOR_FINISH_LINE_REHEARSAL=PASS capabilities='+receipt.counts.capabilities+' actualBlockers='+receipt.counts.actualBlockers+' futureRiskScenarios='+receipt.counts.futureRiskScenarios);
console.log(JSON.stringify({
  globalDevelopment:receipt.globalDevelopment,
  globalProof:receipt.globalProof,
  next:capabilities.slice(0,20).map(c=>({id:c.id,firstUnfinishedStage:c.firstUnfinishedStage,actualBlockers:c.actualBlockers.map(b=>b.reason)}))
},null,2));

if(assertOrchestration){
  if(receipt.simulationCountsAsProof!==false) process.exit(1);
  if(receipt.globalDevelopment!=='CONTINUE') process.exit(1);
  if(receipt.globalProof!=='CONTINUE_UNAFFECTED_SCOPES') process.exit(1);
  if(receipt.actualBlockers.some(x=>x.route?.globalStop!==false)) process.exit(1);
}
