'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/implementation-journey.js','utf8');
function importLabel(detail,satisfied=true,status='PASS'){
 const context=vm.createContext({});context.input={requirements:[{key:'live-data-import',detail,satisfied,status}]};
 vm.runInContext(source.slice(source.indexOf('const IMPL='),source.indexOf('function errorMarkup()')),context);
 return vm.runInContext("S.status=input;requirementCard('live-data-import','Import','Synthetic count fixture')",context);
}
test('current exact PASS with measured numeric zero retains its reconciled count',()=>{
 assert.match(importLabel({sourceCount:0,importedCount:0}),/0 \/ 0 records reconciled/);
});
test('partial measured import counts remain visible without asserting current reconciliation',()=>{
 const html=importLabel({sourceCount:10,importedCount:7},false,'REVALIDATION_REQUIRED');
 assert.match(html,/7 \/ 10 records reported/);assert.match(html,/reconciliation needs rechecking/);assert.doesNotMatch(html,/records reconciled/);
});
for(const [name,value] of [['null',null],['missing',undefined],['boolean',false],['string-zero','0'],['array',[]],['fractional',0.5],['negative',-1]])test(name+' imported count remains unknown rather than a measured reconciliation',()=>{
 const html=importLabel({sourceCount:0,importedCount:value},false,'REVALIDATION_REQUIRED');
 assert.match(html,/Record counts need verification/);assert.doesNotMatch(html,/records reconciled/);
});
for(const status of ['REVALIDATION_REQUIRED','FAIL','UNKNOWN'])test(status+' import keeps measured counts but requires reconciliation recheck',()=>{
 const html=importLabel({sourceCount:0,importedCount:0},false,status);
 assert.match(html,/0 \/ 0 records reported/);assert.match(html,/reconciliation needs rechecking/);assert.doesNotMatch(html,/records reconciled/);
});
test('current handler revalidates a retained legacy-shaped unknown import receipt and its card preserves that uncertainty',async t=>{
 const {DatabaseSync}=require('node:sqlite'),{Readable}=require('node:stream'),{createHash}=require('node:crypto'),os=require('node:os'),path=require('node:path');
 const {createOneDayEnterpriseEngine}=require('../runtime/one-day-enterprise-engine.cjs');
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'v020-import-card-')),database=path.join(directory,'state.sqlite'),db=new DatabaseSync(database);
 db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);");
 db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('synthetic-label',1,'{}');db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('synthetic-label@fixture.invalid','synthetic-label','owner','manager',0,'disabled','00','["company.configure"]');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash('synthetic-label-session'),'synthetic-label@fixture.invalid',Date.now()+60000);
 const engine=createOneDayEnterpriseEngine({dbPath:database,agentsApiEnabled:false,strictEvidence:true,candidateSha:'a'.repeat(40),deploymentId:'isolated-import-label',notificationRetryPollMs:0,internalToken:'synthetic-label-worker'});
 t.after(()=>{engine.close();db.close();fs.rmSync(directory,{recursive:true,force:true});});
 db.prepare('INSERT INTO implementation_runs VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-label-run','synthetic-label',hash('synthetic-contract'),'BUILDING',Date.now(),Date.now()+86400000,240,new Date().toISOString(),new Date().toISOString());
 async function call(body){
  const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);req.method=body===undefined?'GET':'POST';req.url='/api/implementation/autonomous/'+(body===undefined?'status':'evidence');req.headers=body===undefined?{cookie:'wfm_session=synthetic-label-session'}:{'x-wfm-implementation-internal':'synthetic-label-worker'};
  const res={statusCode:200,headersSent:false,writableEnded:false,setHeader(){},end(value){this.body=JSON.parse(value);this.headersSent=this.writableEnded=true;}};
  assert.equal(await engine.handleRequest(req,res),true);return res;
 }
 const detail={fixtureOnly:false,zeroHuman:true,humanInterventions:0,sourceAuthoritative:true,sourceCount:0,importedCount:null,invalidCount:0,checksumMatch:true};
 const input={runId:'synthetic-label-run',kind:'live-data-import',status:'PASS',confidence:1,source:'synthetic-count-fixture',detail};
 assert.equal((await call(input)).statusCode,409,'Current admission must keep refusing unknown counts');assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_evidence').get().n,0);
 assert.equal((await call({...input,detail:{...detail,importedCount:0}})).statusCode,200,'Explicit numeric zero remains valid');
 const accepted=db.prepare('SELECT * FROM implementation_evidence').get();
 // Append an explicit historical audit fixture with the shape accepted by older
 // code. Current admission above refuses it; no old binary or real import runs.
 const legacy={...JSON.parse(accepted.detail_json),importedCount:null};
 db.prepare('INSERT INTO implementation_evidence(run_id,tenant,kind,status,confidence,source,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(accepted.run_id,accepted.tenant,accepted.kind,accepted.status,accepted.confidence,'synthetic-retained-legacy-shape',JSON.stringify(legacy),accepted.created_at);
 const audit=db.prepare('SELECT * FROM implementation_evidence ORDER BY id').all(),current=await call();assert.equal(current.statusCode,200);
 const row=current.body.requirements.find(value=>value.key==='live-data-import');assert.equal(row.satisfied,false);assert.equal(row.status,'REVALIDATION_REQUIRED');assert.equal(row.detail.importedCount,null);assert.match(row.evidenceValidation.reason,/reconciled numeric counts/);assert.equal(current.body.operationalReady,false);assert.deepEqual(db.prepare('SELECT * FROM implementation_evidence ORDER BY id').all(),audit);
 const html=importLabel(row.detail,row.satisfied,row.status);assert.match(html,/Record counts need verification/);assert.doesNotMatch(html,/records reconciled/);
});
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
  return vm.runInContext('S.status=input; ({stages:stageMarkup(),training:trainingPanel(false),importAdvice:importAdvice()})',context);
}
function status(overrides={}){
  return {requirements:[{key:'source-systems',satisfied:true},{key:'role-learning',satisfied:false},{key:'privileged-competency',satisfied:false},{key:'frontline-readiness',satisfied:false}],integrationTruth:{unifiedReady:false},providerJourney:{required:true,proven:false},learningSummary:{masteryPercent:100,mastered:124,assignments:124,users:12,requiredPopulation:50,privilegedReady:true,fullyCertified:true,populationReconciliationRequired:true,roleLearningPopulationReady:false,populationAndRoleCoverageReady:false,privilegedCoverageReady:true},...overrides};
}
test('Data Readiness explains a held import without replacing an unmet prerequisite',()=>{
  const readyRequirements=['source-systems','people-data','organisation-model','payroll-mapping','test-data-cleanup']
    .map(key=>({key,satisfied:true}));
  const importRequirement={key:'live-data-import',satisfied:false,status:'REVALIDATION_REQUIRED'};
  const adviceFor=(requirements,liveImport)=>render(status({requirements:[...requirements,liveImport]})).importAdvice;

  assert.equal(adviceFor(readyRequirements,importRequirement),'<ul><li>Review the live import status before proceeding.</li></ul>');
  const cleanupPending=readyRequirements.map(item=>item.key==='test-data-cleanup'?{...item,satisfied:false}:item);
  assert.equal(adviceFor(cleanupPending,importRequirement),'<ul><li>Live import remains locked until test data is proven clean.</li></ul>');
  assert.equal(adviceFor(readyRequirements,{...importRequirement,status:'MISSING'}),'<ul><li>Source data is ready. The live import can now be reconciled.</li></ul>');
  assert.equal(adviceFor(readyRequirements,{...importRequirement,status:'PASS',satisfied:true}),'<ul><li>Live data has been imported and reconciled.</li></ul>');
});
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

