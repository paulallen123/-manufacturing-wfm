'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/implementation-journey.js','utf8');
function fixture(respond=()=>({status:200,body:{}})) {
  const calls=[],events={},content={dataset:{},innerHTML:'unsaved DOM'},errorBox={textContent:''},button={disabled:false,textContent:'Save and review'};
  const context=vm.createContext({URL,Date,JSON,Number,String,Set,clearTimeout(){},setTimeout(){return 1;},ui:{page:'onboarding'},
    window:{location:{href:'https://vector.test/#vector/onboarding'}},
    FormData:class {constructor(form){this.values=form.values;} get(name){return this.getAll(name)[0]??null;} getAll(name){const v=this.values[name];return v===undefined?[]:Array.isArray(v)?v:[v];}},
    document:{addEventListener(name,handler){events[name]=handler;},querySelector(selector){if(selector==='.content')return content;if(selector==='[data-ij-setup-error]')return errorBox;if(selector==='[data-ij-setup-form]')return context.currentForm;return null;}},
    async fetch(url,options){calls.push({url,...options});const out=await respond(url,options);return {ok:out.status<400,status:out.status,async json(){return out.body;}};}});
  vm.runInContext(source.slice(source.indexOf('const IMPL='),source.indexOf("document.addEventListener('submit'")),context);
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('input'"),source.indexOf('const priorRender')),context);
  const run=code=>vm.runInContext(code,context);
  const set=(name,value)=>{context.value=value;run('S.'+name+'=value');};
  set('status',{state:'BUILDING',runId:'run-a',requirements:[]});
  const form={values:{organisationName:'Example Works',countries:'UK',siteCode:['AA'],siteName:['Factory'],siteTimezone:['Europe/London'],workforceCount:'25',languages:'en',shiftPatterns:'2',module:['core','scheduling'],trainingRole:['employee','manager'],connectionTiming:'later'},querySelector(){return button;}};
  context.form=form;context.currentForm=form;
  return {context,calls,content,button,errorBox,form,run,set,events};
}
test('opening setup shows four question groups and restores the saved answers safely',()=>{
  const f=fixture(); f.set('setup',{revision:2,status:'DRAFT',answers:{organisation:{name:'<Works>',countries:['UK'],sites:[]},workforce:{count:30},capabilities:{modules:['core'],trainingRoles:['employee']},connections:{timing:'later',systems:[]}}});
  const html=f.run('workspaceSetupMarkup()');
  assert.equal((html.match(/<fieldset/g)||[]).length,4); assert.match(html,/&lt;Works&gt;/); assert.match(html,/30/); assert.match(html,/Save and review/);
  assert.doesNotMatch(html,/data-ij-setup-apply/);
});
test('save sends a revisioned draft and renders the returned review without applying',async()=>{
  const f=fixture(()=>({status:200,body:{revision:1,status:'DRAFT',reviewToken:'review-a',answers:{},compiled:{status:'compiled'}}}));
  f.set('setup',{revision:0}); await f.run('saveSetup(form)');
  assert.equal(f.calls.length,1); assert.equal(f.calls[0].url,'/api/implementation/autonomous/setup');
  const body=JSON.parse(f.calls[0].body); assert.equal(body.expectedRevision,0);
  assert.equal(body.answers.organisation.sites[0].timezone,'Europe/London');
  assert.equal(body.answers.workforce.count,25); assert.equal(body.answers.connections.timing,'later');
  assert.equal(f.run('S.setup.revision'),1); assert.match(f.content.innerHTML,/data-ij-setup-apply/);
});
test('background refresh preserves unsaved form values and the revision they were based on',async()=>{
  const f=fixture(url=>({status:200,body:url.endsWith('/setup')?{revision:9}:{state:'BUILDING',requirements:[]}}));
  f.set('setup',{revision:2}); f.set('setupDirty',true);
  await f.run('load(true)'); assert.equal(f.content.innerHTML,'unsaved DOM'); assert.equal(f.run('S.setup.revision'),2);
});
for(const status of [409,500,401,403]) test('save failure '+status+' preserves typed answers and does not report success',async()=>{
  const f=fixture(()=>({status,body:{error:'Save refused'}}));f.set('setup',{revision:2});f.set('setupDirty',true);
  await f.run('saveSetup(form)'); assert.equal(f.content.innerHTML,'unsaved DOM'); assert.equal(f.run('S.setup.revision'),2);
  assert.match(f.errorBox.textContent,/Save refused|Sign in|access/i); assert.equal(f.button.disabled,false);
});
test('apply submits only the reviewed revision and token and keeps failures visible',async()=>{
  const f=fixture(()=>({status:409,body:{error:'Review changed'}}));
  f.set('setup',{revision:3,reviewToken:'review-a',status:'DRAFT'}); await f.run('applySetup()');
  assert.equal(f.calls[0].url,'/api/implementation/autonomous/setup/apply');
  assert.deepEqual(JSON.parse(f.calls[0].body),{expectedRevision:3,reviewToken:'review-a'});
  assert.equal(f.run('S.setup.status'),'DRAFT'); assert.match(f.errorBox.textContent,/Review changed/);
});
test('typing after review prevents applying the earlier answers',async()=>{
  const f=fixture(); f.set('setup',{revision:3,reviewToken:'review-a'});f.set('setupDirty',true);
  await f.run('applySetup()'); assert.equal(f.calls.length,0);
});
test('applied workspace setup never presents operational readiness as completed',()=>{
  const f=fixture(); f.set('setup',{revision:1,status:'APPLIED',answers:{},applied:{configurationDigest:'a'.repeat(64)}});
  const html=f.run('workspaceSetupMarkup()');assert.match(html,/Workspace setup applied/);assert.match(html,/operational readiness/i);assert.doesNotMatch(html,/ready to go live/i);
});
test('completed questionnaire stays hidden on later logins and settings drafts',()=>{
  const f=fixture();
  for(const state of ['APPLIED','DRAFT']){
    f.set('setup',{revision:3,status:state,questionnaireComplete:true,completedAt:'2026-10-11T22:00:00Z',answers:{},applied:{configurationDigest:'a'.repeat(64)}});
    const html=f.run('workspaceSetupMarkup()');assert.doesNotMatch(html,/<fieldset|data-ij-setup-form/);
    assert.match(html,/Workspace settings/);assert.match(html,/data-ij-route="overview"/);assert.match(html,/operational readiness/i);
  }
});

test('editing while save is pending preserves newer answers and requires another review',async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  f.set('setup',{revision:2});f.set('setupDirty',true);
  const pending=f.run('saveSetup(form)');
  f.form.values.organisationName='Newer typed name';
  finish({status:200,body:{revision:3,status:'DRAFT',reviewToken:'older-review',answers:{},compiled:{status:'compiled'}}});
  await pending;
  assert.equal(f.content.innerHTML,'unsaved DOM');assert.equal(f.run('S.setupDirty'),true);
  assert.equal(f.run('S.setup.revision'),3);
  await f.run('applySetup()');assert.equal(f.calls.length,1);
});

test('navigation away and back restores the dirty model when the host replaces the form',()=>{
  const f=fixture();f.set('setup',{revision:2,tenant:'alpha',runId:'run-a',answers:{}});
  f.form.values.organisationName='Unsaved organisation';f.events.input({target:{closest(){return f.form;}}});
  f.context.ui.page='overview';f.context.currentForm=null;f.content.innerHTML='Overview';f.run('apply()');
  f.context.ui.page='onboarding';f.content.innerHTML='Host onboarding DOM';delete f.content.dataset.wfmImplementationJourney;
  f.run('renderView()');
  assert.match(f.content.innerHTML,/Unsaved organisation/);assert.equal(f.run('S.setupDirty'),true);
});

for(const remove of [false,true])test('row replacement and typing during pending save survive the older response: '+remove,async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));f.set('setup',{revision:2});
  const pending=f.run('saveSetup(form)');f.run(remove?"changeSetupRows('site',0)":"changeSetupRows('site')");
  const newer={...f.form,values:{...f.form.values,organisationName:'Typed in replacement form',siteCode:remove?[]:['AA','BB'],siteName:remove?[]:['Factory','Second'],siteTimezone:remove?[]:['UTC','UTC']}};
  f.context.currentForm=newer;f.events.input({target:{closest(){return newer;}}});
  finish({status:200,body:{revision:3,status:'DRAFT',reviewToken:'stale-review',answers:{},compiled:{status:'compiled'}}});await pending;
  assert.equal(f.run('S.setupInput.organisation.name'),'Typed in replacement form');assert.equal(f.run('S.setupInput.organisation.sites.length'),remove?0:2);
  assert.equal(f.run('S.setupDirty'),true);assert.equal(f.run('S.setup.revision'),3);await f.run('applySetup()');assert.equal(f.calls.length,1);
});

test('completed workspace has an explicit reviewed settings editor without reopening initial onboarding',()=>{
  const f=fixture();f.set('setup',{tenant:'alpha',runId:'run-a',revision:2,status:'APPLIED',questionnaireComplete:true,completedAt:'done-once',answers:{}});
  assert.match(f.run('workspaceSetupMarkup()'),/data-ij-setup-settings/);
  f.run('openSetupSettings()');const settings=f.run('workspaceSetupMarkup()');
  assert.match(settings,/Workspace settings/);assert.match(settings,/data-ij-setup-form/);assert.doesNotMatch(settings,/Four questions to get started/);
  assert.equal(f.run('S.setup.completedAt'),'done-once');
  f.run('closeSetupSettings()');assert.doesNotMatch(f.run('workspaceSetupMarkup()'),/data-ij-setup-form/);
});

test('edits made while apply is pending remain as an amendment to the completed workspace',async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));f.set('setup',{tenant:'alpha',runId:'run-a',revision:2,reviewToken:'review-two'});
  const pending=f.run('applySetup()');f.form.values.organisationName='Typed while applying';f.events.input({target:{closest(){return f.form;}}});
  finish({status:200,body:{tenant:'alpha',runId:'run-a',revision:2,status:'APPLIED',questionnaireComplete:true,completedAt:'once',answers:{}}});await pending;
  assert.equal(f.run('S.setupInput.organisation.name'),'Typed while applying');assert.equal(f.run('S.setupDirty'),true);assert.equal(f.run('S.setupSettings'),true);
  f.context.currentForm=null;f.run('renderView()');assert.match(f.content.innerHTML,/Typed while applying/);assert.match(f.content.innerHTML,/Workspace settings/);
});

test('late apply response from an old tenant cannot replace the current workspace',async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));f.set('setup',{tenant:'alpha',runId:'run-a',revision:2,reviewToken:'review-two'});
  const pending=f.run('applySetup()');f.set('status',{tenant:'bravo',runId:'run-b',state:'BUILDING'});f.set('setup',{tenant:'bravo',runId:'run-b',revision:0,answers:{}});
  finish({status:200,body:{tenant:'alpha',runId:'run-a',revision:2,status:'APPLIED',questionnaireComplete:true,answers:{}}});await pending;
  assert.equal(f.run('S.setup.tenant'),'bravo');assert.equal(f.run('S.setup.runId'),'run-b');assert.equal(f.run('S.setup.revision'),0);
});
