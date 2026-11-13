'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFrozenCapacityRescueSimulation:create,replayFrozenCapacityRescueSimulation:replay}=require('./capacity-rescue-frozen-simulation.cjs');
const {buildCapacityRescueShadow}=require('./capacity-rescue-shadow.cjs');
const economicKeys=['recoveredContribution','avoidedDowntime','avoidedExpedite','avoidedLabourPremium','avoidedScrap','interventionCost','inducedDownstreamCost'];
function declaration(){
 const zero=Object.fromEntries(economicKeys.map(k=>[k,0]));
 return {
  asKnownAt:'2026-10-13T08:00:00Z',simulatorRevision:'scenario-model:r1',policyRevision:'policy:r1',
  economics:{basis:'INCREMENTAL_TO_DO_NOTHING',currency:'GBP',window:{start:'2026-10-13T08:00:00Z',end:'2026-10-13T16:00:00Z'}},
  sources:[{ref:'declared:twin-r1',revision:'r1',digest:'a'.repeat(64),observedAt:'2026-10-13T07:59:00Z',knownAt:'2026-10-13T08:00:00Z'}],
  input:{tenant:'fixture-alpha',site:'fixture-plant',triggerKind:'OUTPUT_SHORTFALL',triggerId:'line:shift',triggeredAt:'2026-10-13T08:00:00Z',contextRevision:'twin:r1',sourceEvidence:['declared:twin-r1'],
   state:{lineId:'line-4',targetUnits:1000,projectedUnits:800,currentUnits:400,plannedHeadcount:30,staffedHeadcount:30},
   constraints:[{id:'machine-loss',domain:'machine',confidence:.9,severity:.8,limitingImpactPct:80,evidenceRefs:['declared:twin-r1']}],
   objective:{throughputUnits:1,uncertaintyPenalty:0},
   plans:[
    {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,prediction:{throughputUnits:800,planAttainmentPct:80,labourCost:1000,delayMinutes:40},evidenceRefs:['declared:twin-r1'],economic:{...zero}},
    {id:'recover-machine',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,prediction:{throughputUnits:980,planAttainmentPct:98,labourCost:1050,delayMinutes:20},evidenceRefs:['declared:twin-r1'],
     actions:[{id:'maintenance',type:'MAINTENANCE',target:'packaging-3',reversible:false,requiresApproval:true,evidenceRefs:['declared:twin-r1']}],
     economic:{...zero,recoveredContribution:9500,interventionCost:350,inducedDownstreamCost:100}}
   ]
  }
 };
}
const scope=Object.freeze({tenant:'fixture-alpha',site:'fixture-plant'});

function copy(v){return JSON.parse(JSON.stringify(v));}
function graph(r,id){return r.result.interventionGraph.plans.find(p=>p.id===id);}
function cf(r,id){return r.result.interventionGraph.counterfactuals.find(p=>p.planId===id);}

test('public frozen API invokes actual Capacity Rescue consumer on the same supplied scenarios',()=>{
 const d=declaration(),r=create(d,scope);
 assert.deepEqual(r.result,buildCapacityRescueShadow(r.snapshot.input));
 assert.equal(r.result.recommendedPlan.id,'recover-machine');
 assert.equal(cf(r,'recover-machine').throughputDelta,180);
 assert.equal(cf(r,'recover-machine').delayMinutesDelta,-20);
 assert.equal(cf(r,'recover-machine').netRecoveredValue,9050);
 assert.equal(cf(r,'do-nothing').throughputDelta,0);
 assert.equal(cf(r,'do-nothing').netRecoveredValue,0);
 assert.equal(r.snapshot.economics.basis,'INCREMENTAL_TO_DO_NOTHING');
});
for(const key of economicKeys)test('negative economic component is rejected at frozen and existing consumer: '+key,()=>{
 const d=declaration();d.input.plans[1].economic[key]=-1;
 assert.throws(()=>create(d,scope),/economic .*invalid/);
 assert.throws(()=>buildCapacityRescueShadow(d.input),/economic .*invalid/);
});
test('unknown economics remain unknown; legitimate costs greater than benefit preserve a loss',()=>{
 const d=declaration();delete d.input.plans[1].economic.avoidedScrap;
 assert.equal(cf(create(d,scope),'recover-machine').netRecoveredValue,null);
 d.input.plans[1].economic.avoidedScrap=0;d.input.plans[1].economic.interventionCost=12000;
 assert.equal(cf(create(d,scope),'recover-machine').netRecoveredValue,-2600);
});
test('genuine do-nothing has zero incremental economic components and eligible inert actions',()=>{
 for(const change of [d=>d.input.plans[0].economic.interventionCost=1,d=>delete d.input.plans[0].economic.avoidedScrap,d=>d.input.plans[0].feasible=false,d=>d.input.plans[0].actions=[{id:'work',type:'MAINTENANCE',evidenceRefs:['declared:twin-r1']}],d=>d.input.plans.shift()]){
  const d=declaration();change(d);assert.throws(()=>create(d,scope),/do-nothing/);
 }
});
for(const [field,value] of [['knownAt','2026-10-13T09:00:00Z'],['observedAt','2026-10-13T09:00:00Z'],['knownAt','2026-10-13T07:58:00Z']])test('declared evidence chronology refuses '+field+' '+value,()=>{
 const d=declaration();d.sources[0][field]=value;assert.throws(()=>create(d,scope),/knownAt|observedAt/);
});
test('decision trigger and economic window must match the frozen cutoff',()=>{
 for(const change of [d=>d.input.triggeredAt='2026-10-13T08:01:00Z',d=>d.economics.window.start='2026-10-13T07:59:00Z',d=>d.economics.window.end=d.economics.window.start,d=>d.asKnownAt='2026-02-30T08:00:00Z']){
  const d=declaration();change(d);assert.throws(()=>create(d,scope),/asKnownAt|window|timestamp/);
 }
});
test('source refs require exact revision/digest, a complete reference set, and no duplicate alias',()=>{
 for(const change of [d=>delete d.sources[0].revision,d=>d.sources[0].digest='r1',d=>d.sources.push({...d.sources[0]}),d=>d.input.plans[1].evidenceRefs=['unbound:future'],d=>d.sources.push({...d.sources[0],ref:'unused'}),d=>d.input.plans[1].evidenceRefs=[]]){
  const d=declaration();change(d);assert.throws(()=>create(d,scope),/source|evidence|revision|digest/);
 }
});
test('mandatory caller context rejects create and replay for a different tenant or site',()=>{
 const r=create(declaration(),scope);
 for(const s of [undefined,{}, {...scope,tenant:'fixture-beta'},{...scope,site:'other-plant'}]){
  assert.throws(()=>create(declaration(),s),/scope/);assert.throws(()=>replay(r,s),/scope/);
 }
});
test('observed outcomes and authority declarations are not accepted as scenario fields',()=>{
 for(const change of [d=>d.input.outcome={actual:{throughputUnits:9999}},d=>d.input.plans[1].prediction.actual=9999,d=>d.input.executionPermitted=true,d=>d.input.plans[1].economic.realisedSavings=9999,d=>d.sources[0].sourceAuthenticated=true]){
  const d=declaration();change(d);assert.throws(()=>create(d,scope),/Unsupported/);
 }
});
test('snapshot identity binds state, constraints, economics, source content, policy and simulator revision',()=>{
 const r=create(declaration(),scope);
 for(const change of [d=>d.input.state.currentUnits++,d=>d.input.constraints[0].confidence=.89,d=>d.input.plans[1].economic.interventionCost++,d=>d.sources[0].digest='b'.repeat(64),d=>d.policyRevision='policy:r2',d=>d.simulatorRevision='scenario-model:r2']){
  const d=declaration();change(d);const changed=create(d,scope);assert.notEqual(r.snapshotDigest,changed.snapshotDigest);assert.notEqual(r.simulationDigest,changed.simulationDigest);
 }
});
test('JSON persistence replays the complete immutable record deterministically',()=>{
 const r=create(declaration(),scope);
 assert.deepEqual(replay(copy(r),scope),r);assert.deepEqual(create(declaration(),scope),r);
});
test('replay refuses changed snapshot, changed economics, changed result and false authority flags',()=>{
 const original=create(declaration(),scope);
 for(const change of [r=>r.snapshot.sources[0].knownAt='2026-10-13T09:00:00Z',r=>r.snapshot.input.plans[1].economic.interventionCost++,r=>r.result.recommendedPlan.economic.netRecoveredValue++,r=>r.executionPermitted=true,r=>r.sourceAuthenticated=true,r=>r.simulationDigest='a'.repeat(64)]){
  const r=copy(original);change(r);assert.throws(()=>replay(r,scope),/integrity|replay/);
 }
});
test('full record identity is stable across declared set order and object key insertion order',()=>{
 const d=declaration(),expected=create(d,scope);d.input.plans.reverse();d.input=Object.fromEntries(Object.entries(d.input).reverse());
 assert.deepEqual(create(d,scope),expected);
});
test('accessors and proxies are rejected without executing caller code',()=>{
 const d=declaration();let reads=0;Object.defineProperty(d.input,'state',{enumerable:true,get(){reads++;return {};}});
 assert.throws(()=>create(d,scope),/inert/);assert.equal(reads,0);
 const p=new Proxy(declaration(),{get(){reads++;throw Error('must not run');}});
 assert.throws(()=>create(p,scope),/inert/);assert.equal(reads,0);
});
test('input mutation cannot alter a created record; every nested record value is frozen',()=>{
 const d=declaration(),r=create(d,scope),before=JSON.stringify(r);d.input.plans[1].economic.interventionCost=999999;d.sources[0].digest='b'.repeat(64);
 assert.equal(JSON.stringify(r),before);assert.throws(()=>r.snapshot.input.plans[1].economic.interventionCost=1,TypeError);
 const check=v=>{if(v&&typeof v==='object'){assert.equal(Object.isFrozen(v),true);Object.values(v).forEach(check);}};check(r);
});
test('inert input is not mutated or frozen by evaluation',()=>{
 const d=declaration(),before=JSON.stringify(d);create(d,scope);assert.equal(JSON.stringify(d),before);assert.equal(Object.isFrozen(d),false);
});
test('nonfinite unsupported JSON and caller authority cannot affect claims',()=>{
 const d=declaration();d.input.plans[1].economic.interventionCost=Infinity;assert.throws(()=>create(d,scope),/finite/);
 const r=create(declaration(),scope);
 assert.equal(r.classification,'SIMULATED');assert.equal(r.evaluationMethod,'SUPPLIED_SCENARIO_PREDICTIONS');assert.equal(r.sourceAuthority,'CALLER_DECLARED');
 for(const key of ['sourceAuthenticated','asKnownAtVerified','executionPermitted','verifiedOperationalOutcome','realisedFinancialOutcome','learningEligible'])assert.equal(r[key],false);
 assert.equal(r.result.shadowOnly,true);assert.equal(r.result.executionPermitted,false);assert.equal(r.result.episode.mode,'SHADOW');assert.equal(r.result.recommendedPlan.causalEvidence.status,'HYPOTHESIS_ONLY');
});
test('duplicate constraint ids cannot identify different declared constraints',()=>{
 const d=declaration();d.input.constraints.push({...d.input.constraints[0],severity:.1});
 assert.throws(()=>create(d,scope),/constraint.*unique/i);
});
for(const missing of ['absent','null'])test('do-nothing must supply each positively weighted comparator metric: '+missing,()=>{
 const d=declaration();if(missing==='absent')delete d.input.plans[0].prediction.throughputUnits;else d.input.plans[0].prediction.throughputUnits=null;
 assert.throws(()=>create(d,scope),/do-nothing.*weighted/i);
});
test('unweighted missing baseline metrics remain explicit unknown comparisons',()=>{
 const d=declaration();delete d.input.plans[0].prediction.delayMinutes;
 const r=create(d,scope);assert.equal(cf(r,'recover-machine').delayMinutesDelta,null);
 assert.equal(r.result.recommendedPlan.id,'recover-machine');
});
test('same legal Unicode snapshot and tied options replay across process locales',()=>{
 const {spawnSync}=require('node:child_process'),path=require('node:path');
 const d=declaration(),source=d.sources[0];source.ref='ä-mes:r1';d.sources.push({...source,ref:'z-cmms:r2',digest:'b'.repeat(64)});
 d.input.sourceEvidence=d.sources.map(s=>s.ref);d.input.constraints[0].id='ä-machine';d.input.constraints[0].evidenceRefs=[source.ref];
 d.input.constraints.push({...d.input.constraints[0],id:'z-machine'});
 for(const plan of d.input.plans){plan.evidenceRefs=[source.ref];for(const action of plan.actions||[])action.evidenceRefs=[source.ref];}
 const plan=d.input.plans[1];plan.id='ä-repair';plan.actions[0].id='ä-action';plan.actions.push({...plan.actions[0],id:'z-action'});
 d.input.plans.push({...copy(plan),id:'z-repair'});
 const modulePath=path.join(__dirname,'capacity-rescue-frozen-simulation.cjs');
 function run(locale,record){
  const code=`const fs=require('node:fs'),api=require(${JSON.stringify(modulePath)}),arg=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(arg.record?api.replayFrozenCapacityRescueSimulation(arg.record,arg.scope):api.createFrozenCapacityRescueSimulation(arg.declaration,arg.scope)));`;
  const child=spawnSync(process.execPath,['-e',code],{encoding:'utf8',input:JSON.stringify({declaration:d,scope,record}),env:{...process.env,LANG:locale,LC_ALL:locale}});
  assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout);
 }
 const en=run('en_US.UTF-8'),sv=run('sv_SE.UTF-8');assert.deepEqual(en,sv);assert.deepEqual(run('sv_SE.UTF-8',en),en);
 assert.equal(en.result.recommendedPlan.id,'z-repair');
});
