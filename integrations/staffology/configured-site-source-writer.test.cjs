'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream'),{DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const {createOneDayEnterpriseEngine}=require('../../implementation/runtime/one-day-enterprise-engine.cjs');
const {createConfiguredSiteAuthority}=require('./configured-site-authority.cjs');
const compiler=require('../../implementation/runtime/test-support/sealed-compiler.cjs')(test);

test('real signed-workspace setup writer supplies applied provenance while empty workforce facts remain unavailable',async t=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'staffology-source-writer-')),dbPath=path.join(temporary,'state.sqlite'),db=new DatabaseSync(dbPath),owner='synthetic.owner@example.invalid';
 db.exec(`CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);`);
 const engine=createOneDayEnterpriseEngine({dbPath,agentsApiEnabled:false,publicOrigin:'https://vector.test',notificationRetryPollMs:0,candidateSha:'a'.repeat(40),deploymentId:'synthetic-source-writer',contractWebhookSecret:'synthetic-webhook',internalToken:'synthetic-internal',invitationRecoverySecret:'synthetic-invitation-recovery-key',configurationCompiler:compiler,
  verifySignedContract(){return{verified:true,ownerAuthorized:true,customerId:'source-customer',customerAuthorityRef:'synthetic-crm',tenant:'source-tenant',provider:'synthetic-provider',eventId:'source-first',contractRef:'source-contract',relationship:'initial',ownerEmail:owner,ownerAuthorityRef:'synthetic-signed-owner',profile:{organisationName:'Source Works'}};},
  createCanonicalTenant({db,binding}){db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(binding.tenant,1,JSON.stringify({staff:[],org:[{id:'owner-anchor',name:'Synthetic Owner'}],workRules:{jobs:[],contracts:{}}}));},
  provisionInitialOwner({db,tenant,email,role,costs,permissions}){db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(email,tenant,'owner-anchor',role,costs,'disabled','00',JSON.stringify(permissions));},async sendInvitation(){return{provider:'synthetic-delivery',messageId:'source-message'};}});
 t.after(()=>{engine.close();db.close();fs.rmSync(temporary,{recursive:true,force:true});});
 async function request(url,input,cookie=''){const req=Readable.from(input===undefined?[]:[JSON.stringify(input)]);req.method=input===undefined?'GET':'POST';req.url=url;req.socket={};req.headers={origin:'https://vector.test','content-type':'application/json','x-forwarded-proto':'https','x-wfm-contract-webhook':'synthetic-webhook',cookie};const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.text=String(value);this.writableEnded=true;}};await engine.handleRequest(req,res);const body=JSON.parse(res.text||'{}');assert.ok(res.statusCode<300,JSON.stringify(body));return body;}
 await request('/api/implementation/autonomous/contract-signed',{syntheticVerifiedSigningFixture:true});
 // Test identity is explicit; production setup still uses its existing authenticated owner guard.
 const session='synthetic-source-session';db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(session).digest('hex'),owner,Date.now()+60000);
 const setupBinding=(await request('/api/implementation/autonomous/setup',undefined,'wfm_session='+session)).setupBinding;
 const answers={organisation:{name:'Source Works',countries:['UK'],sites:[{code:'ONE',name:'First Exact Factory',timezone:'UTC'}]},workforce:{count:1,languages:['en'],shiftPatterns:1},capabilities:{modules:['core'],trainingRoles:['manager']},connections:{timing:'later',systems:[]}},saved=await request('/api/implementation/autonomous/setup',{setupBinding,expectedRevision:0,answers},'wfm_session='+session);
 await request('/api/implementation/autonomous/setup/apply',{setupBinding,expectedRevision:saved.revision,reviewToken:saved.reviewToken},'wfm_session='+session);
 const authority=createConfiguredSiteAuthority({db}),snapshot=authority.snapshotForTenant({tenant:'source-tenant'});assert.deepEqual(snapshot.siteLabels,['First Exact Factory']);assert.equal(snapshot.applied,true);assert.equal(snapshot.sourceProvenance.appliedReviewToken,saved.reviewToken);assert.ok(snapshot.sourceProvenance.appliedEventId>0);
 const requirements=authority.mappingPrerequisitesForTenant({tenant:'source-tenant'});assert.equal(requirements.available,false);assert.deepEqual(requirements.missing,['configuredJobs','configuredContracts','configuredWeeklyHours']);assert.deepEqual(JSON.parse(db.prepare('SELECT permissions FROM users').get().permissions),['company.configure']);assert.equal(JSON.parse(db.prepare('SELECT state FROM tenants').get().state).staff.length,0);
});

// Bounded synthetic actual-route regressions for stable coded-site authority.
{
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {Readable}=require('node:stream'),{createHash}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'../..'),out=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'v024-coded-sites-'));
test.after(()=>fs.rmSync(out,{recursive:true,force:true}));
const {createOneDayEnterpriseEngine}=require(path.join(root,'implementation/runtime/one-day-enterprise-engine.cjs'));
const {createConfiguredSiteAuthority}=require(path.join(root,'integrations/staffology/configured-site-authority.cjs'));
const sha=v=>createHash('sha256').update(v).digest('hex');
const tenant='synthetic-topology-tenant',run='synthetic-topology-run',token='synthetic-topology-session';
function answers(duplicate=false){return {organisation:{name:'Synthetic topology company',countries:['UK'],sites:[
  {code:'SYN-A',name:'Synthetic plant',timezone:'Europe/London'},
  {code:'SYN-B',name:duplicate?'Synthetic plant':'Synthetic second plant',timezone:'Europe/London'}]},
  workforce:{count:2,languages:['en'],shiftPatterns:1},capabilities:{modules:['core','scheduling'],trainingRoles:['manager']},connections:{timing:'later',systems:[]}};}
function fixture(t){
 const dir=fs.mkdtempSync(path.join(out,'synthetic-')),dbPath=path.join(dir,'state.sqlite'),db=new DatabaseSync(dbPath),now=Date.now();
 db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);");
 db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(tenant,1,JSON.stringify({staff:[],org:[],operations:{siteAccess:{}}}));
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('synthetic-owner@invalid.test',tenant,'synthetic-owner','manager',0,'synthetic','00','["company.configure"]');
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token),'synthetic-owner@invalid.test',now+3600000);db.close();
 const compiler=require(path.join(root,'implementation/runtime/test-support/sealed-compiler.cjs'))(t);
 const options={dbPath,configurationCompiler:compiler,agentsApiEnabled:false,notificationRetryPollMs:0,
  candidateSha:'80ab03b0d4647659a00f34a10d52ca61d8c037d5',deploymentId:'synthetic-topology-route-only',requireCandidateBinding:true,strictEvidence:true};
 let engine=createOneDayEnterpriseEngine(options);
 const seed=new DatabaseSync(dbPath);
 seed.prepare('INSERT INTO implementation_runs VALUES(?,?,?,?,?,?,?,?,?)').run(run,tenant,sha('synthetic-contract'),'BUILDING',now,now+86400000,24,new Date(now).toISOString(),new Date(now).toISOString());
 seed.prepare('INSERT INTO customer_workspaces VALUES(?,?,?,?,?)').run(sha('synthetic-customer'),'synthetic-workspace',tenant,run,new Date(now).toISOString());seed.close();
 t.after(()=>engine.close());
 return {dir,dbPath,get engine(){return engine;},reopen(){engine.close();engine=createOneDayEnterpriseEngine(options);},inspect(){const d=new DatabaseSync(dbPath);try{
  const scope=d.prepare('SELECT scope_json FROM implementation_scope WHERE tenant=?').get(tenant),env=d.prepare('SELECT * FROM tenant_environments WHERE tenant=?').get(tenant),draft=d.prepare('SELECT * FROM workspace_setup_drafts WHERE tenant=?').get(tenant);
  let authority;try{authority={ok:true,value:createConfiguredSiteAuthority({db:d}).snapshotForTenant({tenant})};}catch(e){authority={ok:false,message:e.message,code:e.code,status:e.status};}
  let legacyAuthority;try{legacyAuthority={ok:true,value:createConfiguredSiteAuthority({db:d}).configuredSitesForTenant({tenant})};}catch(e){legacyAuthority={ok:false,message:e.message,code:e.code,status:e.status};}
  return {legacyAuthority,scope:scope?JSON.parse(scope.scope_json):null,environment:env?{...env,configuration:JSON.parse(env.configuration_json)}:null,draft:draft?{...draft,answers:JSON.parse(draft.answers_json),compiled:JSON.parse(draft.compiled_json)}:null,
   events:d.prepare('SELECT * FROM workspace_setup_events').all(),tenantState:d.prepare('SELECT * FROM tenants').all(),users:d.prepare('SELECT email,tenant,person_id,role,costs,permissions FROM users').all(),authority};
 }finally{d.close();}}};
}
async function call(f,method,suffix='',body){
 const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);req.method=method;req.url='/api/implementation/autonomous/setup'+suffix;req.headers={cookie:'wfm_session='+token};
 const res={statusCode:200,headersSent:false,writableEnded:false,body:'',setHeader(){},end(v=''){this.body=String(v);this.headersSent=true;this.writableEnded=true;}};
 assert.equal(await f.engine.handleRequest(req,res),true);return {status:res.statusCode,body:JSON.parse(res.body)};
}
async function save(f,value){const loaded=await call(f,'GET');assert.equal(loaded.status,200,JSON.stringify(loaded));return call(f,'POST','',{expectedRevision:0,setupBinding:loaded.body.setupBinding,answers:value});}
async function apply(f,saved){return call(f,'POST','/apply',{expectedRevision:saved.body.revision,reviewToken:saved.body.reviewToken,setupBinding:saved.body.setupBinding});}
function persist(){}
test('distinct code and display name control survives reviewed apply, reopen and configured authority readback',async t=>{
 const f=fixture(t),before=f.inspect(),input=answers(),saved=await save(f,input);assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.compiled.status,'compiled');
 const applied=await apply(f,saved);assert.equal(applied.status,200,JSON.stringify(applied));assert.equal(applied.body.status,'APPLIED');f.reopen();const after=f.inspect();
 assert.equal(after.authority.ok,true,JSON.stringify(after.authority));assert.deepEqual(after.authority.value.siteLabels,input.organisation.sites.map(x=>x.name));
 assert.deepEqual(after.environment.configuration.workspaceSetup.organisation.sites,input.organisation.sites);assert.deepEqual(after.tenantState,before.tenantState);assert.deepEqual(after.users,before.users);
 persist('distinct-name-control',{fixtureDir:f.dir,input,saved,applied,after});
});
test('distinct site codes retain exact authority after apply and reopen while ambiguous legacy mappings stay denied',async t=>{
 const f=fixture(t),before=f.inspect(),input=answers(true),saved=await save(f,input);assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.compiled.status,'compiled');
 assert.deepEqual(saved.body.compiled.scope.sites.map(x=>x.code),['SYN-A','SYN-B']);const applied=await apply(f,saved);assert.equal(applied.status,200,JSON.stringify(applied));assert.equal(applied.body.status,'APPLIED');
 f.reopen();const reloaded=await call(f,'GET'),after=f.inspect();assert.equal(reloaded.body.status,'APPLIED');assert.deepEqual(after.scope.sites,['Synthetic plant']);
 assert.equal(after.draft.answers.organisation.sites.length,2);assert.equal(after.draft.compiled.scope.sites.length,2);assert.equal(after.environment.configuration.workspaceSetup.organisation.sites.length,2);
 assert.equal(after.authority.ok,true,JSON.stringify(after.authority));assert.deepEqual(after.authority.value.sites,input.organisation.sites);assert.deepEqual(after.authority.value.siteLabels,['Synthetic plant','Synthetic plant']);
 assert.equal(after.legacyAuthority.ok,false);assert.equal(after.legacyAuthority.code,'STAFFOLOGY_CONFIGURED_SITE_AUTHORITY_REQUIRED');assert.match(after.legacyAuthority.message,/ambiguous/);
 assert.equal(after.events.filter(x=>x.event==='CONFIGURATION_APPLIED').length,1);assert.deepEqual(after.tenantState,before.tenantState);assert.deepEqual(after.users,before.users);
 persist('duplicate-display-name-reproduction',{fixtureDir:f.dir,input,saved,applied,reloaded,after});
});
test('typed legal entity input is rejected before draft writes, rather than accepted then silently dropped',async t=>{
 const f=fixture(t),before=f.inspect(),input=answers();input.organisation.legalEntities=[{id:'synthetic-entity',name:'Synthetic entity'}];
 const denied=await save(f,input);assert.equal(denied.status,400);const after=f.inspect();assert.equal(after.draft,null);assert.deepEqual(after.events,before.events);assert.deepEqual(after.tenantState,before.tenantState);assert.deepEqual(after.users,before.users);
 persist('unsupported-typed-input',{fixtureDir:f.dir,input,denied,after});
});
test('site code identity is independent of input order across review apply and authority readback',async t=>{
 const f=fixture(t),input=answers();input.organisation.sites.reverse();const saved=await save(f,input);assert.equal(saved.status,200,JSON.stringify(saved));
 assert.deepEqual(saved.body.answers.organisation.sites.map(x=>x.code),['SYN-B','SYN-A']);assert.deepEqual(saved.body.compiled.scope.sites.map(x=>x.code),['SYN-A','SYN-B']);
 const applied=await apply(f,saved);assert.equal(applied.status,200,JSON.stringify(applied));assert.equal(applied.body.status,'APPLIED');f.reopen();const after=f.inspect();
 assert.deepEqual(after.scope.sites,['Synthetic plant','Synthetic second plant']);assert.equal(after.authority.ok,true,JSON.stringify(after.authority));assert.deepEqual(after.authority.value.sites,answers().organisation.sites);assert.equal(after.legacyAuthority.ok,true);assert.deepEqual(after.legacyAuthority.value.siteLabels,after.scope.sites);
 persist('input-order-reproduction',{fixtureDir:f.dir,input,saved,applied,after});
});

test('reviewed site display names preserve internal whitespace through actual compiler and authority',async t=>{
 const f=fixture(t),input=answers();input.organisation.sites[1].name='Synthetic  second plant';const saved=await save(f,input);assert.equal(saved.status,200,JSON.stringify(saved));
 assert.equal(saved.body.compiled.scope.sites[1].name,'Synthetic  second plant');const applied=await apply(f,saved);assert.equal(applied.status,200,JSON.stringify(applied));f.reopen();const after=f.inspect();
 assert.equal(after.authority.ok,true,JSON.stringify(after.authority));assert.deepEqual(after.authority.value.sites,input.organisation.sites);assert.equal(after.legacyAuthority.ok,true);assert.deepEqual(after.legacyAuthority.value.siteLabels,input.organisation.sites.map(x=>x.name));
});

}
