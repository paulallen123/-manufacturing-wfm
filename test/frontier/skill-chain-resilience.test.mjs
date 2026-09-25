import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSkillChainResilience,compareWithRarestSkillAlternative} from '../../src/frontier/skill-chain-resilience.mjs';

const evidence={
  processMap:{authoritative:true,ref:'mes:process:v8',revision:'v8'},
  skills:{authoritative:true,ref:'wfm:skills:v5',revision:'v5'},
  supplyCriticality:{authoritative:true,ref:'erp:supply:v3',revision:'v3'}
};

function base(){
  return {
    evidence,
    stress:{qualifiedWorkerLoss:1},
    workers:[
      {workerId:'w1',siteId:'s1',skills:[{skillId:'weld-a',current:true}]},
      {workerId:'w2',siteId:'s1',skills:[{skillId:'pack',current:true}]},
      {workerId:'w3',siteId:'s1',skills:[{skillId:'inspect',current:true}]}
    ],
    flows:[
      {flowId:'critical-valve',siteId:'s1',skillId:'weld-a',minimumQualified:1,valueAtRisk:120000,supplyDependencyWeight:2,inventoryUrgencyWeight:1},
      {flowId:'packaging',siteId:'s1',skillId:'pack',minimumQualified:1,valueAtRisk:8000,supplyDependencyWeight:1,inventoryUrgencyWeight:1},
      {flowId:'inspection',siteId:'s1',skillId:'inspect',minimumQualified:1,valueAtRisk:15000,supplyDependencyWeight:1,inventoryUrgencyWeight:1}
    ],
    trainingCandidates:[
      {workerId:'w2',siteId:'s1',skillId:'weld-a',eligible:true,trainingHours:12,trainingCost:900},
      {workerId:'w3',siteId:'s1',skillId:'pack',eligible:true,trainingHours:4,trainingCost:250}
    ]
  };
}

test('links workforce redundancy to process and supply-chain value at risk',()=>{
  const r=evaluateSkillChainResilience(base());
  assert.equal(r.status,'evaluated');
  assert.equal(r.baseline.totalExposure,263000);
  assert.equal(r.recommendation.skillId,'weld-a');
  assert.equal(r.recommendation.exposureReduction,240000);
});

test('does not pick rarity alone when the higher-value dependency is elsewhere',()=>{
  const input=base();
  input.workers.push({workerId:'w4',siteId:'s1',skills:[{skillId:'weld-a',current:true}]});
  input.flows[0].minimumQualified=2;
  const r=evaluateSkillChainResilience(input);
  const c=compareWithRarestSkillAlternative(r,input);
  assert.equal(c.status,'compared');
  assert.equal(c.valueAware.skillId,'weld-a');
  assert.ok(c.valueAware.exposureReduction>=c.rarestSkill.exposureReduction);
});

test('micro manufacturer fails honestly to external backup when no second person exists',()=>{
  const input={
    evidence,
    stress:{qualifiedWorkerLoss:1},
    workers:[{workerId:'owner',siteId:'micro',skills:[{skillId:'cnc',current:true}]}],
    flows:[{flowId:'only-line',siteId:'micro',skillId:'cnc',minimumQualified:1,valueAtRisk:20000,supplyDependencyWeight:1.5,inventoryUrgencyWeight:1}],
    trainingCandidates:[]
  };
  const r=evaluateSkillChainResilience(input);
  assert.equal(r.status,'evaluated');
  assert.equal(r.recommendation,null);
  assert.equal(r.fallback.type,'backup_required');
});

test('large multi-site model remains site-scoped and cannot borrow competence silently',()=>{
  const input={evidence,stress:{qualifiedWorkerLoss:1},workers:[],flows:[],trainingCandidates:[]};
  for(let s=0;s<50;s++){
    const siteId='site-'+s;
    input.workers.push({workerId:'a-'+s,siteId,skills:[{skillId:'critical',current:true}]});
    input.workers.push({workerId:'b-'+s,siteId,skills:[{skillId:'general',current:true}]});
    input.flows.push({flowId:'flow-'+s,siteId,skillId:'critical',minimumQualified:1,valueAtRisk:10000+s*100,supplyDependencyWeight:1,inventoryUrgencyWeight:1});
    input.trainingCandidates.push({workerId:'b-'+s,siteId,skillId:'critical',eligible:true,trainingHours:8,trainingCost:500});
  }
  const r=evaluateSkillChainResilience(input);
  assert.equal(r.status,'evaluated');
  assert.equal(r.baseline.exposedFlowCount,50);
  assert.equal(r.recommendation.siteId,'site-49');
  assert.equal(r.recommendation.exposureReduction,14900);
});

test('non-authoritative skills or supply criticality cannot create a recommendation',()=>{
  const input=base();
  input.evidence.skills={authoritative:false,ref:'x',revision:'1'};
  assert.equal(evaluateSkillChainResilience(input).reason,'missing_authoritative_skills');
  const input2=base();
  input2.evidence.supplyCriticality.revision='';
  assert.equal(evaluateSkillChainResilience(input2).reason,'missing_provenance_supplyCriticality');
});
