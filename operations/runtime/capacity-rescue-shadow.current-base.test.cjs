'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildCapacityRescueShadow,normalisePlan}=require('./capacity-rescue-shadow.cjs');
const {createDecisionEpisode,selectDecisionOption,recordDecisionOutcome}=require('./decision-episode.cjs');

// Machine-constrained fixture reused from PR240, without its service/learning tests.
function input(){
  return {
    tenant:'alpha',site:'plant-1',triggerKind:'OUTPUT_SHORTFALL',triggerId:'line-4:shift-a',
    triggeredAt:'2026-09-25T11:00:00Z',contextRevision:'twin:r42',
    sourceEvidence:['mes:line-4','wfm:shift-a','cmms:pack-3','material:buffer-12'],
    state:{lineId:'line-4',targetUnits:1000,projectedUnits:800,currentUnits:420,plannedHeadcount:30,staffedHeadcount:30},
    constraints:[
      {id:'packaging-speed-loss',domain:'machine',label:'Packaging speed loss',confidence:.9,severity:.8,limitingImpactPct:80,evidenceRefs:['mes:pack-3-rate','cmms:pack-3']},
      {id:'skill-mix',domain:'workforce',label:'Level-3 setter coverage',confidence:.75,severity:.5,limitingImpactPct:25,evidenceRefs:['skills:line-4']}
    ],
    objective:{throughputUnits:.45,planAttainmentPct:.3,labourCost:.1,riskScore:.15,uncertaintyPenalty:.1},
    plans:[
      {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.05,
        prediction:{throughputUnits:800,planAttainmentPct:80,labourCost:1000,riskScore:3},
        evidenceRefs:['sim:none'],economic:{}},
      {id:'add-agency',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,
        actions:[{id:'agency',type:'AGENCY',target:'line-4',reversible:true,requiresApproval:true,evidenceRefs:['agency:pool']}],
        prediction:{throughputUnits:850,planAttainmentPct:85,labourCost:1300,riskScore:3},
        evidenceRefs:['sim:agency'],economic:{interventionCost:300}},
      {id:'recover-machine',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.08,
        actions:[
          {id:'maintenance',type:'MAINTENANCE',target:'packaging-3',reversible:false,requiresApproval:true,evidenceRefs:['cmms:pack-3']},
          {id:'skill-swap',type:'SKILL_SWAP',target:'line-4',reversible:true,requiresApproval:true,dependsOn:['maintenance'],evidenceRefs:['skills:line-4']}
        ],
        prediction:{throughputUnits:980,planAttainmentPct:98,labourCost:1050,riskScore:1.5},
        evidenceRefs:['sim:maint-skill'],
        economic:{recoveredContribution:9500,interventionCost:350,inducedDownstreamCost:100},
        causalEvidence:{comparableInterventions:4,matchedControl:true,sourceDiversity:.8,dataCompleteness:.9,simulatorCalibration:.8}
      }
    ]
  };
}

test('canonical optionId binds recommendedPlan on the historical machine fixture',()=>{
 const result=buildCapacityRescueShadow(input());
 assert.equal(result.episode.recommendation.optionId,'recover-machine');
 assert.equal(result.recommendedPlan?.id,result.episode.recommendation.optionId);
});

const economicKeys=['recoveredContribution','avoidedDowntime','avoidedExpedite','avoidedLabourPremium','avoidedScrap','interventionCost','inducedDownstreamCost'];
function completeEconomics(plan){
  // Explicit fixture assumptions, never production defaults.
  plan.economic={...Object.fromEntries(economicKeys.map(k=>[k,0])),...plan.economic};
  return plan;
}
function option(result,id){ return result.episode.options.find(p=>p.id===id); }
function graph(result,id){ return result.interventionGraph.plans.find(p=>p.id===id); }
function cf(result,id){ return result.interventionGraph.counterfactuals.find(p=>p.planId===id); }
function freeze(value){
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}

test('delegates ranking to actual canonical Decision Episode and preserves graph metadata',()=>{
  const data=input(),result=buildCapacityRescueShadow(data),ep=result.episode;
  const direct=createDecisionEpisode({...data,decisionType:'capacity-rescue',mode:'SHADOW',options:ep.options});
  assert.deepEqual(ep,direct);
  assert.equal(result.state.capacityGapUnits,200);
  assert.equal(result.constraintAssessment.primaryConstraint.id,'packaging-speed-loss');
  const plan=graph(result,'recover-machine');
  assert.equal(plan.executionClass,'ADVISORY_ONLY');
  assert.deepEqual(plan.actions.find(a=>a.id==='skill-swap').dependsOn,['maintenance']);
  assert.deepEqual(plan.actions.find(a=>a.id==='maintenance').evidenceRefs,['cmms:pack-3']);
  assert.equal(plan.actions.find(a=>a.id==='maintenance').requiresApproval,true);
  assert.equal(plan.actions.find(a=>a.id==='maintenance').reversible,false);
  assert.equal(result.recommendedPlan.planGraphDigest,plan.planGraphDigest);
  assert.ok(option(result,plan.id).reasonCodes.includes('PLAN_GRAPH_'+plan.planGraphDigest));
});

for(const type of ['AGENCY','OVERTIME']) test('suppresses '+type+' including mixed plans when fully manned and machine constrained',()=>{
  for(const mixed of [false,true]){
    const data=input();data.plans[1].actions[0].type=type;
    if(mixed)data.plans[1].actions.push({...data.plans[2].actions[0],id:'machine-step'});
    data.plans[1].prediction.throughputUnits=100000;
    const r=buildCapacityRescueShadow(data);
    assert.equal(r.constraintAssessment.labourAdditionSuppressed,true);
    assert.equal(option(r,'add-agency').feasible,false);
    assert.equal(option(r,'add-agency').hardConstraintsPassed,false);
    assert.ok(option(r,'add-agency').reasonCodes.includes('LABOUR_QUANTITY_NOT_PRIMARY_CONSTRAINT'));
    assert.notEqual(r.recommendedPlan.id,'add-agency');
  }
});
test('does not automatically suppress labour with evidenced workforce constraint or understaffing',()=>{
  for(const change of [d=>d.constraints[0].domain='workforce',d=>d.state.staffedHeadcount=29]){
    const data=input();change(data);const r=buildCapacityRescueShadow(data);
    assert.equal(r.constraintAssessment.labourAdditionSuppressed,false);
    assert.equal(option(r,'add-agency').feasible,true);
    assert.equal(r.executionPermitted,false);
  }
});

test('mandatory genuine do-nothing, unique plan IDs and hard eligibility remain enforced',()=>{
  const data=input();data.plans=data.plans.slice(1);
  assert.throws(()=>buildCapacityRescueShadow(data),/do-nothing/);
  const fake=input();fake.plans[0].actions=fake.plans[1].actions;
  assert.throws(()=>buildCapacityRescueShadow(fake),/only DO_NOTHING/);
  const duplicate=input();duplicate.plans[2].id='add-agency';
  assert.throws(()=>buildCapacityRescueShadow(duplicate),/ids must be unique/);
  for(const field of ['feasible','policyAllowed','hardConstraintsPassed']){
    const d=input();d.plans[2][field]=false;
    assert.equal(buildCapacityRescueShadow(d).recommendedPlan.id,'do-nothing');
    d.plans.forEach(p=>p[field]=false);
    const r=buildCapacityRescueShadow(d);
    assert.equal(r.episode.recommendation.reason,'NO_ELIGIBLE_OPTIONS');
    assert.equal(r.episode.recommendation.optionId,null);
    assert.equal(r.recommendedPlan,null);
  }
});

for(const [name,mutate,pattern] of [
  ['duplicate IDs',a=>a.push({...a[0]}),/ids must be unique/],
  ['missing dependency',a=>a[1].dependsOn=['absent'],/dependency is missing: absent/],
  ['self dependency',a=>a[0].dependsOn=['maintenance'],/self dependency: maintenance/],
  ['two-node cycle',a=>a[0].dependsOn=['skill-swap'],/dependency cycle/],
  ['longer cycle',a=>{a.push({...a[0],id:'third',dependsOn:['skill-swap']});a[0].dependsOn=['third'];},/dependency cycle/],
  ['malformed dependency',a=>a[1].dependsOn=[null],/dependencies are invalid/],
  ['non-array dependency',a=>a[1].dependsOn='maintenance',/dependencies are invalid/],
  ['edge beyond old truncation limit',a=>a[1].dependsOn=Array.from({length:21},(_,i)=>i===20?'absent':'maintenance'),/dependency is missing/]
])test('rejects graph '+name+' deterministically',()=>{
  const data=input();mutate(data.plans[2].actions);
  for(let i=0;i<2;i++)assert.throws(()=>buildCapacityRescueShadow(data),pattern);
});
test('accepts a diamond DAG and preserves every dependency',()=>{
  const p=input().plans[2],action=p.actions[0];
  p.actions=[{...action,id:'a'},{...action,id:'b',dependsOn:['a']},{...action,id:'c',dependsOn:['a']},{...action,id:'d',dependsOn:['b','c']}];
  assert.deepEqual(normalisePlan(p).actions.find(a=>a.id==='d').dependsOn,['b','c']);
});

test('missing or non-string source and constraint evidence is rejected',()=>{
  for(const evidence of [undefined,[],[' '],[{}],[42]]){
    const d=input();d.sourceEvidence=evidence;
    assert.throws(()=>buildCapacityRescueShadow(d),/source evidence/);
    const c=input();c.constraints[0].evidenceRefs=evidence;
    assert.throws(()=>buildCapacityRescueShadow(c),/Constraint evidence/);
  }
  const d=input();d.constraints=[];
  assert.throws(()=>buildCapacityRescueShadow(d),/evidenced Capacity Rescue constraint/);
});
const malformed=[undefined,null,'',' ',true,false,[],{},'12',NaN,Infinity,-Infinity];
for(const field of ['targetUnits','projectedUnits','currentUnits','plannedHeadcount','staffedHeadcount'])test('requires finite numeric state '+field,()=>{
  for(const value of [...malformed,-1]){
    const d=input();d.state[field]=value;
    assert.throws(()=>buildCapacityRescueShadow(d),new RegExp(field+' is invalid'));
  }
});
for(const field of ['confidence','severity','limitingImpactPct'])test('requires finite bounded constraint '+field,()=>{
  for(const value of [...malformed,-1,101]){
    const d=input();d.constraints[0][field]=value;
    assert.throws(()=>buildCapacityRescueShadow(d),new RegExp('constraint '+field+' is invalid'));
  }
});
test('validates uncertainty, objectives and optional numbers without coercion',()=>{
  for(const value of malformed){
    const d=input();d.plans[2].uncertainty=value;
    assert.throws(()=>buildCapacityRescueShadow(d),/plan uncertainty is invalid/);
  }
  for(const value of malformed.filter(v=>v!==undefined&&v!==null)){
    for(const change of [d=>d.plans[2].prediction.throughputUnits=value,d=>d.plans[2].economic.interventionCost=value,d=>d.plans[2].causalEvidence.sourceDiversity=value,d=>d.objective.throughputUnits=value]){
      const d=input();change(d);assert.throws(()=>buildCapacityRescueShadow(d),/is invalid/);
    }
  }
  const d=input();d.plans[2].causalEvidence.comparableInterventions=1.5;
  assert.throws(()=>buildCapacityRescueShadow(d),/comparableInterventions is invalid/);
});
test('unknown predictions and economics remain null; missing weighted metrics cannot recommend',()=>{
  const d=input();d.plans.forEach(p=>p.prediction={});
  const r=buildCapacityRescueShadow(d);
  assert.equal(r.episode.recommendation.reason,'MISSING_WEIGHTED_METRICS');
  assert.equal(r.recommendedPlan,null);
  for(const p of r.interventionGraph.counterfactuals){
    for(const key of ['throughputDelta','planAttainmentDelta','labourCostDelta','delayMinutesDelta','netRecoveredValue'])assert.equal(p[key],null);
  }
  const original=buildCapacityRescueShadow(input());
  assert.equal(cf(original,'recover-machine').delayMinutesDelta,null);
  assert.equal(graph(original,'recover-machine').economic.avoidedScrap,null);
  assert.equal(graph(original,'do-nothing').causalEvidence.comparableInterventions,null);
});
test('explicit zero stays zero and complete economics preserve net value including losses',()=>{
  const d=input();d.plans.forEach(completeEconomics);
  const r=buildCapacityRescueShadow(d);
  assert.equal(cf(r,'recover-machine').netRecoveredValue,9050);
  assert.equal(cf(r,'recover-machine').throughputDelta,180);
  assert.equal(cf(r,'recover-machine').planAttainmentDelta,18);
  assert.equal(cf(r,'do-nothing').netRecoveredValue,0);
  d.plans[2].economic.interventionCost=12000;
  d.plans[2].prediction.throughputUnits=700;
  const adverse=buildCapacityRescueShadow(d);
  assert.equal(cf(adverse,'recover-machine').netRecoveredValue,-2600);
  assert.equal(cf(adverse,'recover-machine').throughputDelta,-100);
  assert.equal(cf(adverse,'recover-machine').causalStatus,'HYPOTHESIS_ONLY');
});
test('rejects overflow in derived economic values',()=>{
  const d=input();d.plans.forEach(completeEconomics);
  d.plans[2].economic.recoveredContribution=Number.MAX_VALUE;
  d.plans[2].economic.avoidedDowntime=Number.MAX_VALUE;
  assert.throws(()=>buildCapacityRescueShadow(d),/netRecoveredValue is invalid/);
});
test('negative economic components cannot turn intervention cost into a fictitious benefit',()=>{
 for(const field of economicKeys){
  const d=input();d.plans.forEach(completeEconomics);
  d.plans[2].economic[field]=-1;
  assert.throws(()=>buildCapacityRescueShadow(d),new RegExp('economic '+field+' is invalid'));
 }
 const adverse=input();adverse.plans.forEach(completeEconomics);
 adverse.plans[2].economic.interventionCost=12000;
 const result=buildCapacityRescueShadow(adverse);
 assert.ok(cf(result,'recover-machine').netRecoveredValue<0);
 assert.equal(result.executionPermitted,false);
});
test('client flags are neither causal proof nor execution authority',()=>{
  const d=input();Object.assign(d,{mode:'POLICY_BOUNDED',executionPermitted:true,productionApproved:true});
  Object.assign(d.plans[2].causalEvidence,{experimental:true,matchedControl:true,comparableInterventions:100,verified:true,status:'PROVEN_SUCCESS'});
  d.plans[2].actions.forEach(a=>a.requiresApproval=false);
  const r=buildCapacityRescueShadow(d);
  assert.equal(r.shadowOnly,true);assert.equal(r.executionPermitted,false);
  assert.equal(r.episode.mode,'SHADOW');
  assert.equal(r.episode.recommendation.authorityRequired,'NO_EXECUTION');
  assert.equal(r.episode.recommendation.executionPermitted,false);
  assert.equal(r.recommendedPlan.causalEvidence.status,'HYPOTHESIS_ONLY');
  assert.equal(r.recommendedPlan.causalEvidence.confidence,null);
  assert.equal(r.recommendedPlan.causalEvidence.experimental,true);
  assert.equal(r.recommendedPlan.causalEvidence.comparableInterventions,100);
  assert.throws(()=>selectDecisionOption(r.episode,{optionId:r.recommendedPlan.id,selectedAt:d.triggeredAt,authorityDecision:'POLICY_GATE_PASSED'}),/Shadow mode/);
});
test('canonical adverse outcome remains adverse and shadow-observed',()=>{
  const r=buildCapacityRescueShadow(input());
  const selected=selectDecisionOption(r.episode,{optionId:r.recommendedPlan.id,selectedAt:'2026-09-25T11:01:00Z',authorityDecision:'SHADOW_OBSERVED'});
  const result=recordDecisionOutcome(selected,{observedAt:'2026-09-25T12:00:00Z',evidenceRefs:['mes:actual'],actual:{throughputUnits:700,labourCost:2000}});
  assert.equal(result.outcome.predictionError.throughputUnits,-280);
  assert.equal(result.outcome.predictionError.labourCost,950);
  assert.equal(result.selection.executionPermitted,false);
  assert.equal(result.outcome.actual.throughputUnits,700);
  assert.equal(result.outcome.success,undefined);
});
test('identity is deterministic across plan/action order and changes with graph edges',()=>{
  const a=input(),b=input();b.plans.reverse();b.plans.find(p=>p.id==='recover-machine').actions.reverse();
  const x=buildCapacityRescueShadow(a),y=buildCapacityRescueShadow(b);
  assert.equal(x.episode.episodeId,y.episode.episodeId);
  assert.equal(x.recommendedPlan.planGraphDigest,y.recommendedPlan.planGraphDigest);
  a.plans[2].actions[1].dependsOn=[];
  const changed=buildCapacityRescueShadow(a);
  assert.notEqual(x.recommendedPlan.planGraphDigest,changed.recommendedPlan.planGraphDigest);
  assert.notEqual(x.episode.episodeId,changed.episode.episodeId);
});
test('does not mutate or retain mutable aliases to input',()=>{
  const data=freeze(input()),before=JSON.stringify(data);
  const result=buildCapacityRescueShadow(data);
  assert.equal(JSON.stringify(data),before);
  assert.throws(()=>result.recommendedPlan.actions[1].dependsOn.push('untrusted-local-edit'),TypeError);
  assert.equal(JSON.stringify(data),before);
  assert.deepEqual(buildCapacityRescueShadow(data).recommendedPlan.actions[1].dependsOn,['maintenance']);
});

test('rejects aggregate objective overflow before canonical ranking',()=>{
  const d=input();d.objective={throughputUnits:Number.MAX_VALUE,planAttainmentPct:Number.MAX_VALUE};
  const canonical=createDecisionEpisode({...d,decisionType:'capacity-rescue',mode:'SHADOW',options:d.plans});
  assert.equal(canonical.recommendation.reason,'RANKED');
  assert.ok(canonical.recommendation.ranking.some(r=>r.score===null));
  assert.throws(()=>buildCapacityRescueShadow(d),/objective total is invalid/);
});
test('finite large objective aggregate retains finite ranked scores',()=>{
  const d=input();d.objective={throughputUnits:Number.MAX_VALUE/4,planAttainmentPct:Number.MAX_VALUE/4};
  const r=buildCapacityRescueShadow(d);
  assert.equal(r.episode.recommendation.reason,'RANKED');
  assert.ok(r.episode.recommendation.ranking.every(r=>Number.isFinite(r.score)));
});
test('preserves supported action preconditions and rejects lossy precondition inputs',()=>{
  const d=input();d.plans[2].actions[0].preconditions=Array.from({length:30},(_,i)=>'required-'+i);
  assert.deepEqual(graph(buildCapacityRescueShadow(d),'recover-machine').actions[0].preconditions,d.plans[2].actions[0].preconditions);
  for(const value of [Array.from({length:31},(_,i)=>'required-'+i),['x'.repeat(181)],['valid',null],['valid',{}],['valid',' '],'required',null]){
    d.plans[2].actions[0].preconditions=value;
    assert.throws(()=>buildCapacityRescueShadow(d),/preconditions.*invalid/);
  }
});
test('reserves canonical reason slots for graph identity and labour suppression',()=>{
  const d=input();d.plans[1].reasonCodes=Array.from({length:18},(_,i)=>'REASON_'+i);
  const r=buildCapacityRescueShadow(d),reasons=option(r,'add-agency').reasonCodes;
  assert.equal(reasons.length,20);
  for(const code of d.plans[1].reasonCodes)assert.ok(reasons.includes(code));
  assert.ok(reasons.includes('PLAN_GRAPH_'+graph(r,'add-agency').planGraphDigest));
  assert.ok(reasons.includes('LABOUR_QUANTITY_NOT_PRIMARY_CONSTRAINT'));
  for(const count of [19,20,21]){
    d.plans[1].reasonCodes=Array.from({length:count},(_,i)=>'REASON_'+i);
    assert.throws(()=>buildCapacityRescueShadow(d),/plan reasonCodes.*invalid/);
  }
});
test('rejects evidence and reason bounds instead of silently losing safety inputs',()=>{
  for(const change of [
    d=>d.sourceEvidence=Array.from({length:51},(_,i)=>'evidence:'+i),
    d=>d.plans[2].evidenceRefs=Array.from({length:31},(_,i)=>'evidence:'+i),
    d=>d.constraints[0].evidenceRefs=['x'.repeat(221)],
    d=>d.plans[2].actions[0].evidenceRefs=['valid',{}],
    d=>d.plans[2].reasonCodes=['x'.repeat(101)],
    d=>d.constraints[0].reasonCodes=['valid',null]
  ]){const d=input();change(d);assert.throws(()=>buildCapacityRescueShadow(d),/invalid/);}
});


test('rejects non-finite canonical rank scores from extreme prediction ranges',()=>{
  const d=input();d.objective={riskScore:1};
  d.plans[0].prediction.riskScore=-Number.MAX_VALUE;
  d.plans[2].prediction.riskScore=Number.MAX_VALUE;
  assert.throws(()=>buildCapacityRescueShadow(d),/canonical rank score is invalid/);
});
test('returned complete snapshot and normalized graphs are deeply immutable',()=>{
  const d=input(),r=buildCapacityRescueShadow(d);
  function assertFrozen(v){
    if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));Object.values(v).forEach(assertFrozen);}
  }
  assertFrozen(r);assertFrozen(normalisePlan(d.plans[2]));
  assert.throws(()=>r.interventionGraph.plans[2].actions.push({id:'injected'}),TypeError);
  assert.throws(()=>r.recommendedPlan.economic.interventionCost=0,TypeError);
  assert.throws(()=>r.constraintAssessment.rankedConstraints.pop(),TypeError);
  assert.throws(()=>r.episode.options[0].reasonCodes.push('injected'),TypeError);
  assert.equal(Object.isFrozen(d),false);
  assert.equal(Object.isFrozen(d.plans[2].actions),false);
});

