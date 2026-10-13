'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDecisionEpisode,selectDecisionOption,recordDecisionOutcome}=require('./decision-episode.cjs');

const base={
  tenant:'alpha',site:'tamworth',decisionType:'absence-recovery',triggerId:'absence:42',
  triggeredAt:'2026-09-22T08:00:00Z',contextRevision:'twin:abc',mode:'SHADOW',
  sourceEvidence:['absence:42','skills:line-4','plan:shift-a'],
  objective:{labourCost:0.25,planAttainmentPct:0.55,riskScore:0.2,uncertaintyPenalty:0.1},
  options:[
    {id:'do-nothing',label:'Accept loss',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.05,prediction:{labourCost:0,planAttainmentPct:82,riskScore:2},evidenceRefs:['sim:1']},
    {id:'redeploy',label:'Redeploy qualified operator',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.1,prediction:{labourCost:120,planAttainmentPct:98,riskScore:1},evidenceRefs:['sim:2']},
    {id:'unsafe',label:'Use unqualified operator',feasible:true,policyAllowed:false,hardConstraintsPassed:false,uncertainty:0.01,prediction:{labourCost:10,planAttainmentPct:100,riskScore:0},evidenceRefs:['sim:3']}
  ]
};

test('episode is deterministic regardless of option order',()=>{
  const a=createDecisionEpisode(base);
  const b=createDecisionEpisode({...base,options:[...base.options].reverse()});
  assert.equal(a.episodeId,b.episodeId);
  assert.equal(a.recommendation.optionId,'redeploy');
  assert.equal(a.recommendation.executionPermitted,false);
  assert.equal(a.recommendation.authorityRequired,'NO_EXECUTION');
});
test('hard constraint or policy violating option is never recommended',()=>{
  const e=createDecisionEpisode(base);
  assert.notEqual(e.recommendation.optionId,'unsafe');
});
test('do-nothing option is mandatory',()=>{
  assert.throws(()=>createDecisionEpisode({...base,options:base.options.filter(o=>o.id!=='do-nothing')}),/do-nothing/);
});
test('shadow mode cannot create execution authority',()=>{
  const e=createDecisionEpisode(base);
  assert.throws(()=>selectDecisionOption(e,{optionId:'redeploy',selectedAt:'2026-09-22T08:01:00Z',authorityDecision:'HUMAN_APPROVED'}),/Shadow mode/);
  const selected=selectDecisionOption(e,{optionId:'redeploy',selectedAt:'2026-09-22T08:01:00Z',authorityDecision:'SHADOW_OBSERVED'});
  assert.equal(selected.selection.executionPermitted,false);
});
test('a selection before its trigger cannot grant execution authority',()=>{
  for(const mode of ['HUMAN_APPROVAL','POLICY_BOUNDED']){
    const episode=createDecisionEpisode({...base,mode});
    const authorityDecision=mode==='HUMAN_APPROVAL'?'HUMAN_APPROVED':'POLICY_GATE_PASSED';
    assert.throws(()=>selectDecisionOption(episode,{optionId:'redeploy',selectedAt:'2026-09-22T07:59:59Z',authorityDecision}),/selection.*trigger/i);
    const valid=selectDecisionOption(episode,{optionId:'redeploy',selectedAt:episode.triggeredAt,authorityDecision});
    assert.equal(valid.selection.executionPermitted,true);
  }
});
test('outcome records predicted versus actual delta with evidence',()=>{
  const e=createDecisionEpisode({...base,mode:'HUMAN_APPROVAL'});
  const selected=selectDecisionOption(e,{optionId:'redeploy',selectedAt:'2026-09-22T08:02:00Z',authorityDecision:'HUMAN_APPROVED',actorRef:'manager:hash'});
  const final=recordDecisionOutcome(selected,{observedAt:'2026-09-22T16:00:00Z',evidenceRefs:['mes:shift-a','payroll:shift-a'],actual:{labourCost:125,planAttainmentPct:97.5,riskScore:1}});
  assert.equal(final.outcome.predictionError.labourCost,5);
  assert.equal(final.outcome.predictionError.planAttainmentPct,-0.5);
  assert.ok(final.outcomeDigest);
});

