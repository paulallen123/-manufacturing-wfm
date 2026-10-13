'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/implementation-journey.js','utf8');
test('repeated implementation observer delivery settles without rewriting an unchanged navigation label',()=>{
 const start=source.indexOf('function apply(){'),end=source.indexOf("document.addEventListener('submit'",start);
 let label='Employee onboarding',writes=0,queued=1;
 const nav={get textContent(){return label;},set textContent(v){label=v;writes++;queued++;}};
 const content={dataset:{wfmImplementationJourney:'version-d-3'}};
 const context={currentPage:()=> 'onboarding',isEmployeeRole:()=>false,stop(){},VERSION:'version-d-3',S:{loading:false,timer:1},schedule(){},renderView(){throw Error('unexpected render');},load(){throw Error('unexpected implementation work');},document:{querySelector:s=>s==='.content'?content:nav}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 for(let i=0;i<20&&queued;i++){queued--;context.apply();}
 assert.equal(queued,0,'observer must become idle');assert.equal(writes,1,'only an actual label change may mutate DOM');assert.equal(label,'Implementation');
});


test('implementation integrations separate current readiness from discovery and history',()=>{
 assert.match(source,/function nonCurrentIntegrationRows\(/);
 assert.match(source,/Discovery & historical systems/);
 assert.match(source,/do not count toward current launch readiness/);
 assert.match(source,/Mandatory provider journey remains unproved/);
});

function render(status){
  const context=vm.createContext({});
  vm.runInContext(source.slice(source.indexOf("const IMPL="),source.indexOf('function errorMarkup()')),context);
  context.input=status;
  return vm.runInContext('S.status=input; ({stages:stageMarkup(),training:trainingPanel(false)})',context);
}
function status(overrides={}){
  return {requirements:[{key:'source-systems',satisfied:true},{key:'role-learning',satisfied:false},{key:'privileged-competency',satisfied:false},{key:'frontline-readiness',satisfied:false}],integrationTruth:{unifiedReady:false},providerJourney:{required:true,proven:false},learningSummary:{masteryPercent:100,mastered:124,assignments:124,users:12,requiredPopulation:50,privilegedReady:true,fullyCertified:true,populationReconciliationRequired:true,roleLearningPopulationReady:false,populationAndRoleCoverageReady:false,privilegedCoverageReady:true},...overrides};
}
function integrationStage(html){return html.match(/<div class="wfm-ij-stage [^>]+>.*?<b>Integrations<\/b><small>(.*?)<\/small>/)?.[1];}
function trainingStage(html){return html.match(/<b>Training<\/b><small>(.*?)<\/small>/)?.[1];}
test('connected source alone does not present blocked unified integrations as complete',()=>{
  assert.notEqual(integrationStage(render(status()).stages),'Complete');
});
test('missing unified integration evidence does not present integrations as complete',()=>{
  assert.notEqual(integrationStage(render(status({integrationTruth:undefined,providerJourney:{required:false}})).stages),'Complete');
});
test('mandatory unproven provider prevents a contradictory complete integration stage',()=>{
  assert.notEqual(integrationStage(render(status({integrationTruth:{unifiedReady:true}})).stages),'Complete');
});
test('current unified integration and provider evidence can present complete',()=>{
  assert.equal(integrationStage(render(status({integrationTruth:{unifiedReady:true},providerJourney:{required:true,proven:true}})).stages),'Complete');
});
test('full learning completion does not claim readiness for an unreconciled population',()=>{
  const html=render(status()).training;
  assert.doesNotMatch(html,/team ready/i);
  assert.match(html,/100%/);
  assert.match(html,/learning completion/i);
  assert.match(html,/population coverage incomplete/i);
  assert.match(html,/50/);
  assert.doesNotMatch(html,/<b>Yes<\/b> privileged roles ready/);
});
test('population coverage alone cannot replace missing training-control evidence',()=>{
  const base=status(); base.learningSummary.populationAndRoleCoverageReady=true;
  const view=render(base);
  assert.doesNotMatch(view.training,/team ready/i);
  assert.notEqual(trainingStage(view.stages),'Complete');
});
test('all current training controls and population coverage can present team readiness',()=>{
  const base=status(); for(const row of base.requirements)row.satisfied=true;
  base.learningSummary.roleLearningPopulationReady=true; base.learningSummary.populationAndRoleCoverageReady=true; base.learningSummary.users=50;
  const view=render(base),html=view.training;
  assert.equal(trainingStage(view.stages),'Complete');
  assert.match(html,/team ready/i);
  assert.match(html,/<b>Yes<\/b> privileged roles ready/);
  assert.doesNotMatch(html,/population coverage incomplete/i);
});

test('training remediation labels distinguish population coverage from the combined readiness gate',()=>{
  const controls=satisfied=>[
    {key:'source-systems',satisfied:true},
    {key:'role-learning',satisfied},
    {key:'privileged-competency',satisfied},
    {key:'frontline-readiness',satisfied}
  ];
  const cases=[
    {name:'population not reconciled',role:false,combined:false,controls:false,label:/Population coverage incomplete/i,not:/Team ready/i,stageComplete:false},
    {name:'population field absent',combined:false,controls:true,label:/Population coverage incomplete/i,not:/Team ready/i,stageComplete:false},
    {name:'population ready but competency incomplete',role:true,combined:false,controls:false,label:/Training readiness evidence incomplete/i,not:/Population coverage incomplete|Team ready/i,stageComplete:false},
    {name:'combined backend gate incomplete',role:true,combined:false,controls:true,label:/Training readiness evidence incomplete/i,not:/Population coverage incomplete|Team ready/i,stageComplete:false},
    {name:'requirements incomplete despite combined evidence',role:true,combined:true,controls:false,label:/Training readiness evidence incomplete/i,not:/Population coverage incomplete|Team ready/i,stageComplete:false},
    {name:'all population and training gates complete',role:true,combined:true,controls:true,label:/Team ready/i,not:/Population coverage incomplete|Training readiness evidence incomplete/i,stageComplete:true}
  ];
  for(const row of cases){
    const base=status({requirements:controls(row.controls)});
    if('role' in row)base.learningSummary.roleLearningPopulationReady=row.role;
    else delete base.learningSummary.roleLearningPopulationReady;
    base.learningSummary.populationAndRoleCoverageReady=row.combined;
    const view=render(base);
    assert.match(view.training,row.label,row.name);
    assert.doesNotMatch(view.training,row.not,row.name);
    assert.equal(trainingStage(view.stages)==='Complete',row.stageComplete,row.name);
  }
});
test('missing population coverage cannot present team readiness even with satisfied controls',()=>{
  const base=status();for(const row of base.requirements)row.satisfied=true;
  delete base.learningSummary.populationAndRoleCoverageReady;
  const view=render(base);
  assert.doesNotMatch(view.training,/team ready/i);
  assert.notEqual(trainingStage(view.stages),'Complete');
});

test('false population coverage prevents a complete Training stage even when controls are satisfied',()=>{
  const base=status(); for(const row of base.requirements)row.satisfied=true;
  const view=render(base);
  assert.notEqual(trainingStage(view.stages),'Complete');
  assert.doesNotMatch(view.training,/team ready/i);
});

