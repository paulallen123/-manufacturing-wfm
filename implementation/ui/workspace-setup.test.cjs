'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/implementation-journey.js','utf8');
function fixture(respond=()=>({status:200,body:{}})) {
  let now=100000,serial=0,renders=0;const timers=new Map();
  const calls=[],events={},content={dataset:{},value:'unsaved DOM',get innerHTML(){return this.value;},set innerHTML(value){renders++;this.value=value;}},errorBox={textContent:''},reviewBox={innerHTML:''},saveStatus={textContent:''},button={disabled:false,textContent:'Save and review'},applyButton={disabled:false};
  class ClockDate extends Date {static now(){return now;}}
  const context=vm.createContext({URL,Date:ClockDate,JSON,Number,String,Set,clearTimeout(id){timers.delete(id);},setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,at:now+Number(ms)});return id;},ui:{page:'onboarding'},
    window:{location:{href:'https://vector.test/#vector/onboarding'}},
    FormData:class {constructor(form){this.values=form.values;} get(name){return this.getAll(name)[0]??null;} getAll(name){const v=this.values[name];return v===undefined?[]:Array.isArray(v)?v:[v];}},
    document:{addEventListener(name,handler){events[name]=handler;},querySelector(selector){if(selector==='.content')return content;if(selector==='[data-ij-setup-error]')return errorBox;if(selector==='[data-ij-setup-form]')return context.currentForm;if(selector==='[data-ij-setup-review-host]')return reviewBox;if(selector==='[data-ij-setup-save-status]')return saveStatus;if(selector==='[data-ij-setup-apply]')return applyButton;return null;}},
    async fetch(url,options){calls.push({url,...options});const out=await respond(url,options);return {ok:out.status<400,status:out.status,async json(){return out.body;}};}});
  vm.runInContext(source.slice(source.indexOf('const IMPL='),source.indexOf("document.addEventListener('submit'")),context);
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('submit'"),source.indexOf('const priorRender')),context);
  const run=code=>vm.runInContext(code,context);
  const set=(name,value)=>{context.value=value;run('S.'+name+'=value');};
  set('status',{state:'BUILDING',runId:'run-a',requirements:[]});
  const form={values:{organisationName:'Example Works',countries:'UK',siteCode:['AA'],siteName:['Factory'],siteTimezone:['Europe/London'],workforceCount:'25',languages:'en',shiftPatterns:'2',module:['core','scheduling'],trainingRole:['employee','manager'],connectionTiming:'later'},querySelector(){return button;}};
  context.form=form;context.currentForm=form;
  const settled=async()=>{for(let n=0;n<15;n++)await Promise.resolve();};
  const advance=async(ms=1000)=>{const end=now+ms;for(let n=0;n<100;n++){const due=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!due)break;timers.delete(due[0]);now=due[1].at;due[1].fn();await settled();}now=end;await settled();};
  const edit=(name,value,event='input')=>{form.values[name]=value;events[event]?.({target:{closest(){return context.currentForm;}}});};
  const click=selector=>events.click({preventDefault(){},target:{closest(value){return value===selector?{}:null;}}});
  return {context,calls,content,button,errorBox,reviewBox,saveStatus,applyButton,form,run,set,events,advance,settled,edit,click,get renders(){return renders;}};
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

const setupRoute='/api/implementation/autonomous/setup';
function boundFixture(respond){const f=fixture(respond);f.set('status',{tenant:'alpha',runId:'run-a',state:'BUILDING',requirements:[]});f.set('setup',{tenant:'alpha',runId:'run-a',revision:2,status:'DRAFT',answers:{}});return f;}
function savedDraft(call,revision=JSON.parse(call.body).expectedRevision+1,tenant='alpha',runId='run-a'){return {tenant,runId,revision,status:'DRAFT',questionnaireComplete:false,answers:JSON.parse(call.body).answers,compiled:{status:'compiled'},reviewToken:'review-'+revision};}

test('quiet questionnaire edits autosave one latest draft and prepare review without applying',async()=>{
 const f=boundFixture(()=>({status:200,body:savedDraft(f.calls.at(-1))}));
 f.edit('organisationName','First');await f.advance(150);f.edit('organisationName','Final answer');
 await f.advance(499);assert.equal(f.calls.length,0);await f.advance(1);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,setupRoute);assert.equal(JSON.parse(f.calls[0].body).answers.organisation.name,'Final answer');assert.equal(JSON.parse(f.calls[0].body).expectedRevision,2);
 assert.equal(f.run('S.setupDirty'),false);assert.equal(f.run('S.setup.questionnaireComplete'),false);assert.match(f.reviewBox.innerHTML,/Apply reviewed setup/);assert.equal(f.renders,0,'autosave must preserve the editing form and caret');
});
test('selection changes autosave and explicit Save before debounce does not duplicate the draft',async()=>{
 const f=boundFixture(()=>({status:200,body:savedDraft(f.calls.at(-1))}));f.edit('connectionTiming','later','change');await f.advance(500);assert.equal(f.calls.length,1);
 f.edit('organisationName','Manual final answer');await f.run('saveSetup(form)');await f.advance(2000);assert.equal(f.calls.length,2);assert.equal(JSON.parse(f.calls[1].body).expectedRevision,3);
});
test('edits during slow autosave serialize the latest answer against the acknowledged revision',async()=>{
 let release;const f=boundFixture(()=>f.calls.length===1?new Promise(resolve=>{release=resolve;}):{status:200,body:savedDraft(f.calls.at(-1),4)});
 f.edit('organisationName','In flight');await f.advance(500);assert.equal(f.calls.length,1);
 f.edit('organisationName','Latest queued answer');await f.advance(2000);assert.equal(f.calls.length,1);
 release({status:200,body:savedDraft(f.calls[0])});await f.settled();await f.advance(500);
 assert.equal(f.calls.length,2);assert.equal(JSON.parse(f.calls[1].body).expectedRevision,3);assert.equal(JSON.parse(f.calls[1].body).answers.organisation.name,'Latest queued answer');assert.equal(f.run('S.setup.revision'),4);assert.equal(f.run('S.setupDirty'),false);
});
test('autosave can retain its detached last-answer model when navigation removes the form',async()=>{
 const f=boundFixture(()=>({status:200,body:savedDraft(f.calls.at(-1))}));f.edit('organisationName','Persist before resume');f.context.currentForm=null;f.context.ui.page='overview';await f.advance(500);
 assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.calls[0].body).answers.organisation.name,'Persist before resume');assert.equal(f.content.innerHTML,'unsaved DOM');assert.equal(f.run('S.setupDirty'),false);
});
test('discard cancels pending autosave and ignores a superseded in-flight save result',async()=>{
 let release,remoteRevision=2;const f=boundFixture((url,options)=>options?.method==='POST'?new Promise(resolve=>{release=resolve;}):{status:200,body:url===setupRoute?{tenant:'alpha',runId:'run-a',revision:remoteRevision,status:'DRAFT',answers:{}}:{tenant:'alpha',runId:'run-a',state:'BUILDING',requirements:[]}});
 f.edit('organisationName','Discard before timer');f.click('[data-ij-setup-reload]');await f.settled();await f.advance(500);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 f.edit('organisationName','Discard after send');await f.advance(500);const sent=f.calls.find(c=>c.method==='POST');assert.ok(sent);remoteRevision=9;f.click('[data-ij-setup-reload]');await f.settled();
 release({status:200,body:savedDraft(sent,3)});await f.settled();assert.equal(f.run('S.setup.revision'),9);assert.equal(f.run('S.setupDirty'),false);
});
for(const status of [200,500])test('old save '+status+' cannot alter a later A epoch after A to B to A',async()=>{
 let release,remote={tenant:'alpha',runId:'run-a',revision:2,status:'DRAFT',answers:{}};
 const f=boundFixture((url,options)=>options?.method==='POST'?new Promise(resolve=>{release=resolve;}):{status:200,body:url===setupRoute?remote:{tenant:remote.tenant,runId:remote.runId,state:'BUILDING',requirements:[]}});
 const pending=f.run('saveSetup(form)');remote={tenant:'bravo',runId:'run-b',revision:1,status:'DRAFT',answers:{}};await f.run('load(true)');remote={tenant:'alpha',runId:'run-a',revision:9,status:'DRAFT',answers:{}};await f.run('load(true)');
 release({status,body:status===200?savedDraft(f.calls[0],3):{error:'Old epoch error'}});await pending;
 assert.equal(f.run('S.setup.revision'),9);assert.notEqual(f.errorBox.textContent,'Old epoch error');assert.equal(f.run('S.setupDirty'),false);
});
test('a failed autosave keeps the latest typed answer without an automatic retry loop',async()=>{
 const f=boundFixture(()=>({status:409,body:{error:'Another draft changed; reload before retrying.'}}));f.edit('organisationName','Still here');await f.advance(500);
 assert.equal(f.calls.length,1);assert.equal(f.run('S.setupInput.organisation.name'),'Still here');assert.equal(f.run('S.setupDirty'),true);assert.equal(f.run('S.setup.revision'),2);assert.match(f.errorBox.textContent,/Another draft/);await f.advance(20000);assert.equal(f.calls.length,1);
});
test('an invalid partial answer remains editable and a later valid answer is autosaved',async()=>{
 const f=boundFixture(()=>f.calls.length===1?{status:400,body:{error:'Site timezone is incomplete.'}}:{status:200,body:savedDraft(f.calls.at(-1))});f.edit('siteTimezone',['Europe/Lon']);await f.advance(500);assert.equal(f.calls.length,1);assert.equal(f.run('S.setupDirty'),true);
 f.edit('siteTimezone',['Europe/London']);await f.advance(500);assert.equal(f.calls.length,2);assert.equal(f.run('S.setupDirty'),false);assert.equal(f.run('S.setup.revision'),3);
});
test('newer edits during explicit Apply wait and autosave only as a completed-workspace draft',async()=>{
 let release;const f=boundFixture((url)=>url.endsWith('/apply')?new Promise(resolve=>{release=resolve;}):{status:200,body:{...savedDraft(f.calls.at(-1),3),questionnaireComplete:true,completedAt:'completed-once'}});
 f.set('setup',{tenant:'alpha',runId:'run-a',revision:2,status:'DRAFT',reviewToken:'review-two'});const applying=f.run('applySetup()');f.edit('organisationName','Later settings');await f.advance(1000);assert.equal(f.calls.length,1);
 release({status:200,body:{tenant:'alpha',runId:'run-a',revision:2,status:'APPLIED',questionnaireComplete:true,completedAt:'completed-once',answers:{}}});await applying;await f.advance(500);
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].url,setupRoute);assert.equal(JSON.parse(f.calls[1].body).expectedRevision,2);assert.equal(f.run('S.setup.completedAt'),'completed-once');assert.equal(f.run('S.setupSettings'),true);assert.equal(f.run('S.setup.status'),'DRAFT');
});

for(const oldStatus of [200,500])test('late old-epoch save '+oldStatus+' cannot unlock a newer pending request',async()=>{
 const releases=[];let remote={tenant:'alpha',runId:'run-a',revision:2,status:'DRAFT',answers:{}};
 const f=boundFixture((url,options)=>options?.method==='POST'?new Promise(resolve=>releases.push(resolve)):{status:200,body:url===setupRoute?remote:{tenant:remote.tenant,runId:remote.runId,state:'BUILDING',requirements:[]}});
 const old=f.run('saveSetup(form)');remote={tenant:'bravo',runId:'run-b',revision:1,status:'DRAFT',answers:{}};await f.run('load(true)');remote={tenant:'alpha',runId:'run-a',revision:9,status:'DRAFT',answers:{}};await f.run('load(true)');
 f.edit('organisationName','Current epoch in flight');await f.advance(500);assert.equal(releases.length,2);
 releases[0]({status:oldStatus,body:oldStatus===200?savedDraft(f.calls[0],3):{error:'Old epoch failure'}});await old;
 assert.equal(f.run('S.setupSaving'),true);assert.equal(f.run('S.setup.revision'),9);assert.notEqual(f.errorBox.textContent,'Old epoch failure');
 f.edit('organisationName','Current latest');await f.advance(500);assert.equal(releases.length,2,'Old finally must not allow a parallel stale-revision write');
 const current=f.calls.filter(call=>call.method==='POST')[1];releases[1]({status:200,body:savedDraft(current,10)});await f.settled();assert.equal(f.run('S.setupSaving'),false);assert.equal(f.run('S.setupDirty'),true);
});
for(const oldStatus of [200,500])test('old Apply '+oldStatus+' cannot alter a re-entered workspace epoch',async()=>{
 let release,remote={tenant:'alpha',runId:'run-a',revision:2,status:'DRAFT',answers:{}};
 const f=boundFixture((url,options)=>options?.method==='POST'?new Promise(resolve=>{release=resolve;}):{status:200,body:url===setupRoute?remote:{tenant:remote.tenant,runId:remote.runId,state:'BUILDING',requirements:[]}});
 f.set('setup',{...remote,reviewToken:'review-two'});const pending=f.run('applySetup()');remote={tenant:'bravo',runId:'run-b',revision:1,status:'DRAFT',answers:{}};await f.run('load(true)');remote={tenant:'alpha',runId:'run-a',revision:9,status:'DRAFT',answers:{}};await f.run('load(true)');
 release({status:oldStatus,body:oldStatus===200?{...savedDraft({body:JSON.stringify({answers:{}})},2),status:'APPLIED',questionnaireComplete:true}:{error:'Old Apply failure'}});await pending;
 assert.equal(f.run('S.setup.revision'),9);assert.equal(f.run('S.setup.questionnaireComplete'),undefined);assert.notEqual(f.errorBox.textContent,'Old Apply failure');
});
test('autosaved incomplete answers resume from SQLite in a new UI before explicit review and later settings',async t=>{
 const {DatabaseSync}=require('node:sqlite'),os=require('node:os'),path=require('node:path');
 const compiler=require('../runtime/test-support/sealed-compiler.cjs')(t);
 const {createWorkspaceSetup}=require('../runtime/workspace-setup.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v011-ui-resume-')),database=path.join(dir,'questionnaire.sqlite');
 const binding={tenant:'alpha',runId:'run-a'};let db,setup,applies=0;
 function reopen(){
   db=new DatabaseSync(database);db.exec('CREATE TABLE IF NOT EXISTS configured(tenant TEXT PRIMARY KEY,run TEXT,scope TEXT,manifest TEXT)');
   const state=({tenant,runId})=>{const row=db.prepare('SELECT scope,manifest FROM configured WHERE tenant=? AND run=?').get(tenant,runId);return {scopeDigest:row?.scope||null,configurationDigest:row?.manifest||null};};
   setup=createWorkspaceSetup({db,compiler,candidateSha:'a'.repeat(40),deploymentId:'isolated-ui-resume',getAppliedState:state,applyConfiguration(value){applies++;db.prepare('INSERT INTO configured VALUES(?,?,?,?) ON CONFLICT(tenant) DO UPDATE SET scope=excluded.scope,manifest=excluded.manifest').run(value.tenant,value.runId,value.compiled.scopeDigest,value.compiled.manifestDigest);return state(value);}});
 }
 reopen();t.after(()=>{db?.close();fs.rmSync(dir,{recursive:true,force:true});});
 const api=(url,options)=>{
   try{
     if(url===setupRoute&&options?.method==='POST')return {status:200,body:setup.save({...binding,...JSON.parse(options.body),actor:'synthetic-ui-fixture'})};
     if(url===setupRoute+'/apply')return {status:200,body:setup.apply({...binding,...JSON.parse(options.body),actor:'synthetic-ui-fixture'})};
     return {status:200,body:url===setupRoute?setup.read(binding):{...binding,state:'BUILDING',requirements:[]}};
   }catch(error){return {status:error.statusCode||500,body:{error:error.message}};}
 };
 const first=boundFixture(api);first.set('setup',setup.read(binding));first.form.values.connectionTiming='';first.edit('organisationName','Durable questionnaire');await first.advance(500);
 assert.equal(setup.read(binding).compiled.status,'needs_clarification');assert.equal(setup.read(binding).answers.organisation.name,'Durable questionnaire');assert.equal(applies,0);
 db.close();db=null;reopen();const resumed=boundFixture(api);resumed.set('setup',null);await resumed.run('load(true)');
 assert.match(resumed.run('workspaceSetupMarkup()'),/Durable questionnaire/);assert.equal(resumed.run('S.setup.revision'),1);
 resumed.form.values.organisationName='Durable questionnaire';resumed.edit('connectionTiming','later');await resumed.advance(500);
 assert.equal(setup.read(binding).revision,2);assert.equal(setup.read(binding).compiled.status,'compiled');assert.equal(setup.read(binding).questionnaireComplete,false);assert.equal(applies,0);assert.match(resumed.reviewBox.innerHTML,/Apply reviewed setup/);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM workspace_setup_events WHERE event='CONFIGURATION_APPLIED'").get().n,0);
 await resumed.run('applySetup()');const completed=setup.read(binding);assert.equal(applies,1);assert.equal(completed.questionnaireComplete,true);assert.ok(completed.completedAt);
 db.close();db=null;reopen();const settings=boundFixture(api);settings.set('setup',null);await settings.run('load(true)');assert.doesNotMatch(settings.run('workspaceSetupMarkup()'),/data-ij-setup-form/);settings.run('openSetupSettings()');
 settings.edit('organisationName','Later workspace setting');await settings.advance(500);const amendment=setup.read(binding);
 assert.equal(amendment.answers.organisation.name,'Later workspace setting');assert.equal(amendment.status,'DRAFT');assert.equal(amendment.completedAt,completed.completedAt);assert.equal(amendment.questionnaireComplete,true);assert.equal(applies,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM workspace_setup_events WHERE event='DRAFT_SAVED'").get().n,3);assert.equal(db.prepare("SELECT COUNT(*) n FROM workspace_setup_events WHERE event='CONFIGURATION_APPLIED'").get().n,1);
 assert.equal(setup.read({tenant:'bravo',runId:'run-a'}).answers,null);assert.equal(setup.read({tenant:'bravo',runId:'run-a'}).revision,0);
});
test('temporary refresh failure retains unsaved answers and resumes saving only after the same workspace returns',async()=>{
 let failed=true;const remote={tenant:'alpha',runId:'run-a',revision:2,status:'DRAFT',answers:{organisation:{name:'Older saved name'}}};
 const f=boundFixture((url,options)=>options?.method==='POST'?{status:200,body:savedDraft(f.calls.at(-1))}:url.endsWith('/status')&&failed?{status:500,body:{error:'Temporary interruption'}}:{status:200,body:url===setupRoute?remote:{tenant:remote.tenant,runId:remote.runId,state:'BUILDING',requirements:[]}});
 f.edit('organisationName','Retained unsaved name');await f.run('load(true)');await f.advance(1000);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.equal(f.run('S.setupInput.organisation.name'),'Retained unsaved name');
 failed=false;await f.run('load(true)');assert.equal(f.run('S.setupDirty'),true);assert.match(f.run('workspaceSetupMarkup()'),/Retained unsaved name/);await f.advance(500);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.run('S.setupDirty'),false);
});
test('explicit access denial clears the private draft and cancels its delayed save',async()=>{
 const f=boundFixture((url)=>({status:url.endsWith('/status')?403:200,body:url===setupRoute?{tenant:'alpha',runId:'run-a',revision:2,answers:{}}:{error:'Access denied'}}));
 f.edit('organisationName','Private old workspace');await f.run('load(true)');await f.advance(1000);assert.equal(f.run('S.setup'),null);assert.equal(f.run('S.setupInput'),null);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.doesNotMatch(f.content.innerHTML,/Private old workspace/);
});

test('V011 save and Apply carry the binding from the loaded setup',async()=>{
 const binding='a'.repeat(64);
 const f=boundFixture((url,options)=>({status:200,body:{...savedDraft(options),setupBinding:binding,status:url.endsWith('/apply')?'APPLIED':'DRAFT',reviewToken:'review'}}));
 f.set('setup',{tenant:'alpha',runId:'run-a',revision:2,setupBinding:binding});
 f.edit('organisationName','Session-bound draft');await f.advance(500);
 assert.equal(JSON.parse(f.calls[0].body).setupBinding,binding);
 await f.run('applySetup()');assert.equal(JSON.parse(f.calls[1].body).setupBinding,binding);
});
test('V011 a changed session binding on refresh clears pending old-session input',async()=>{
 const remote={tenant:'alpha',runId:'run-a',revision:2,answers:{},setupBinding:'b'.repeat(64)};
 const f=boundFixture(url=>({status:200,body:url===setupRoute?remote:{tenant:'alpha',runId:'run-a',state:'BUILDING'}}));
 f.set('setup',{...remote,setupBinding:'a'.repeat(64)});
 f.edit('organisationName','Old-session private draft');await f.run('load(true)');await f.advance(500);
 assert.equal(f.run('S.setupInput'),null);assert.equal(f.run('S.setupDirty'),false);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 assert.equal(f.run('S.setup.setupBinding'),'b'.repeat(64));
});

for(const normalized of [false,true])test('V011 blur after autosave keeps the reviewed Apply available: normalized='+normalized,async()=>{
 const f=boundFixture((url)=>{
   const saved=savedDraft(f.calls.find(call=>call.url===setupRoute));
   if(normalized)saved.answers.organisation.sites[0].code='AA';
   return {status:200,body:{...saved,status:url.endsWith('/apply')?'APPLIED':'DRAFT'}};
 });
 const field=normalized?'siteCode':'organisationName',value=normalized?['aa']:'Focused saved answer';
 f.edit(field,value);await f.advance(500);const generation=f.run('S.setupEditGeneration');
 assert.equal(f.run('S.setupDirty'),false);
 // A real text input emits change on blur after its input event has autosaved.
 f.edit(field,value,'change');
 assert.equal(f.run('S.setupDirty'),false,'Unchanged blur must not revoke the saved review');
 assert.equal(f.run('S.setupEditGeneration'),generation);
 await f.run('applySetup()');await f.advance(1000);
 assert.deepEqual(f.calls.map(c=>c.url),[setupRoute,setupRoute+'/apply']);
 assert.equal(f.run('S.setup.status'),'APPLIED');
});

test('V011 duplicate change during a pending save does not queue an identical revision',async()=>{
 let release;const f=boundFixture(()=>f.calls.length===1?new Promise(resolve=>{release=resolve;}):{status:200,body:savedDraft(f.calls.at(-1))});
 f.edit('organisationName','Pending answer');await f.advance(500);
 f.edit('organisationName','Pending answer','change');release({status:200,body:savedDraft(f.calls[0])});await f.settled();await f.advance(1000);
 assert.equal(f.calls.length,1);assert.equal(f.run('S.setupDirty'),false);
 f.edit('organisationName','Genuine later answer');await f.advance(500);
 assert.equal(f.calls.length,2);assert.equal(JSON.parse(f.calls[1].body).answers.organisation.name,'Genuine later answer');
});

test('V011 identical input in a new form or workspace epoch is still observed',async()=>{
 const f=boundFixture(()=>({status:200,body:savedDraft(f.calls.at(-1))}));
 f.edit('organisationName','Same field value');await f.advance(500);
 const newer={...f.form,values:{...f.form.values}};f.context.currentForm=newer;
 f.events.input({target:{closest(){return newer;}}});await f.advance(500);assert.equal(f.calls.length,2);
 f.run('S.setupEpoch++');f.events.input({target:{closest(){return newer;}}});await f.advance(500);assert.equal(f.calls.length,3);
});
