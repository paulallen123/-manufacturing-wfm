'use strict';

let decision;
try{ decision=require('/app/operations-runtime/decision-episode.cjs'); }
catch{ decision=require('../../operations/runtime/decision-episode.cjs'); }

function buildAbsenceRecoveryScenario(input={}){
  const role=String(input.role||'manager');
  const scenarioRevision='absence-recovery-training-v1';
  const episode=decision.createDecisionEpisode({
    tenant:'training',
    site:'Synthetic Plant A',
    decisionType:'absence-recovery-training',
    triggerId:'training-absence-001',
    triggeredAt:'2026-09-22T09:00:00.000Z',
    contextRevision:scenarioRevision,
    mode:'SHADOW',
    sourceEvidence:['synthetic:absence:A17','synthetic:skills:line3','synthetic:production:plan'],
    objective:{planAttainmentPct:0.6,labourCost:0.4,uncertaintyPenalty:0.15},
    options:[
      {id:'do-nothing',label:'Do nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.05,prediction:{planAttainmentPct:78,labourCost:0},evidenceRefs:['synthetic:baseline'],reasonCodes:['OUTPUT_RISK']},
      {id:'redeploy',label:'Redeploy qualified operator',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.08,prediction:{planAttainmentPct:96,labourCost:80},evidenceRefs:['synthetic:skills:E42','synthetic:coverage:line1'],reasonCodes:['SKILLS_VALID','SOURCE_LINE_PROTECTED']},
      {id:'overtime',label:'Approve overtime',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.06,prediction:{planAttainmentPct:98,labourCost:260},evidenceRefs:['synthetic:fatigue:E18'],reasonCodes:['FATIGUE_SAFE']},
      {id:'agency',label:'Request agency cover',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.18,prediction:{planAttainmentPct:99,labourCost:450},evidenceRefs:['synthetic:agency:eligible'],reasonCodes:['SUPPLIER_ELIGIBLE']}
    ]
  });
  return {
    contractVersion:'VECTOR_TRAINING_SCENARIO_V1',
    scenarioRevision,
    competencyKey:input.competencyKey||'schedule.recover',
    role,
    prompt:'A qualified operator on Line 3 calls in sick before the shift. Review all eligible options and choose the best response.',
    episode:{
      ...episode,
      recommendation:input.revealRecommendation===true?episode.recommendation:{
        ...episode.recommendation,
        optionId:null,
        ranking:[],
        reason:'HIDDEN_DURING_PRACTICE'
      }
    }
  };
}
function scenarioFor(competencyKey,input={}){
  if(['schedule.recover','labour.cost'].includes(String(competencyKey||''))) return buildAbsenceRecoveryScenario({...input,competencyKey});
  return null;
}
function evaluateScenarioAnswer(competencyKey,optionId,input={}){
  const scenario=scenarioFor(competencyKey,{...input,revealRecommendation:true});
  if(!scenario) throw new Error('No interactive scenario is available for this competency.');
  const selected=scenario.episode.options.find(x=>x.id===optionId);
  if(!selected) throw new Error('Selected scenario option is invalid.');
  const recommended=scenario.episode.recommendation.optionId;
  return {
    contractVersion:'VECTOR_TRAINING_SCENARIO_RESULT_V1',
    competencyKey,
    selectedOptionId:selected.id,
    recommendedOptionId:recommended,
    matchedRecommendation:selected.id===recommended,
    practiceOnly:true,
    masteryAwarded:false,
    feedback:selected.id===recommended
      ? 'Your choice matches the current evidence-backed recommendation. Review why it wins, then complete the live task independently when assigned.'
      : 'Your choice is feasible, but another eligible option ranks better against the stated production and labour objectives. Review the evidence and compare again.'
  };
}
module.exports={scenarioFor,evaluateScenarioAnswer,buildAbsenceRecoveryScenario};
