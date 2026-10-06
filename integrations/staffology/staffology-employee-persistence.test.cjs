'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {mkdtempSync,rmSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
process.env.WFM_STAFFOLOGY_LOCAL_PROOF='true';
process.env.WFM_TENANT_CLOCK_ISO='2026-10-01T00:00:00Z';

const runtimeRoot=process.env.WFM_RUNTIME||path.resolve(__dirname,'../..');
const Bridge=require('./canonical-runtime-bridge.cjs');
const Operations=require('./canonical-operations.cjs');
const IG=require(path.join(runtimeRoot,'lib/integration-gateway.cjs'));
const W=require(path.join(runtimeRoot,'public/core.js'));
const E=require(path.join(runtimeRoot,'lib/engine'));
const C=require(path.join(runtimeRoot,'public/cost-engine.js'));
const P=require(path.join(runtimeRoot,'public/payroll-control.js'));
const R=require(path.join(runtimeRoot,'public/work-rules.js'));
const RD=require(path.join(runtimeRoot,'public/readiness-engine.js'));
const SP=require(path.join(runtimeRoot,'public/schedule-publication.js'));
const OA=require(path.join(runtimeRoot,'public/org-admin.js'));
const ON=require(path.join(runtimeRoot,'public/onboarding-engine.js'));

function seed(){return ON.decorate(OA.decorate(SP.decorate(RD.decorate(R.decorate(P.decorate(C.decorate(E.decorate(W.seed()))))))));}
function schema(db){db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);
 CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TRIGGER no_audit_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit events are append only.'); END;
 CREATE TRIGGER no_audit_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit events are append only.'); END;`);}

test('reviewed one-character Staffology payroll codes persist across restart without duplicate apply or cross-tenant read',t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'staffology-employee-persistence-')),file=path.join(directory,'state.sqlite');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 let db=new DatabaseSync(file);schema(db);
 const tenant='northstar-demo',actor={tenant,personId:'d1',email:'director@northstar.example',costs:true,permissions:['company.configure']};
 const cfg={id:'staffology-people',provider:'staffology',tenant,scope:'d1',objectTypes:['people']},profile={binding:{tenant},connector:cfg};
 const state=seed();db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(tenant,state.version,JSON.stringify(state));
 const load=()=>JSON.parse(db.prepare('SELECT state FROM tenants WHERE id=?').get(tenant).state);
 const integrations=IG.createStore(db);
 const prepare=(record)=>{
  Bridge.assertPeopleApplicationRecord(record);
  const current=load(),serviceActor={tenant,personId:cfg.scope,role:'director',costs:true,permissions:['company.configure']};
  const checked=ON.validateRows(current,serviceActor,[{...record.data,source_id:record.externalId}]);
  if(!checked.canStage)throw Error(checked.errors.map(x=>x.message).join(' ')||'People record failed validation.');
  return checked.valid[0];
 };
 const resolveConnector=(currentActor,receipt)=>Operations.stagingConnector({profile,configured:[],actor:currentActor,receipt});
 const runtime=Bridge.createRuntime({loadState:load,assertStagePeople:resolveConnector,stagePeople:(currentActor,envelope,receipt)=>{
  const scoped=resolveConnector(currentActor,receipt);
  return integrations.stage(scoped,envelope,receipt.idempotencyKey,(_objectType,record)=>prepare(record));
 }});
 const currentIds=['retained-current-1','retained-current-2','retained-current-3','retained-current-4'],formerId='3a7e7298-b414-4b87-9cf9-ab9c75bded62',ids=[...currentIds,formerId];
 const acquisition={objectType:'people',paginationComplete:true,atomicProviderSnapshot:false,cursor:'cursor-5',sourceVersion:'staffology-five-person-revision',records:ids.map((externalId,index)=>({externalId,revision:`revision-${index+1}`,operation:'upsert',data:{identity:{employeeId:externalId,payrollCode:String(index+1)},person:{firstName:index===4?'Ian':`Retained${index+1}`,lastName:index===4?'Jones':'Current',email:''},employment:{status:index===4?'Former':'Current',effectiveFrom:'2018-01-01',...(index===4?{effectiveTo:'2019-07-21'}:{})}}}))};
 const receipt={approved:true,connectorId:cfg.id,connectorScope:cfg.scope,idempotencyKey:'staffology-people-five',mappings:ids.map((externalId,index)=>({externalId,payrollId:String(index+1),email:`retained-${index+1}@example.invalid`,managerId:'m1',site:'Tamworth',job:'Machine operator',contractType:'full_time',weeklyHours:37.5,language:'en-GB'}))};
 runtime.assertEmployeeStaging(actor,receipt);
 const staged=runtime.stageEmployeeAcquisition(actor,acquisition,receipt);
 assert.equal(staged.status,'staged');assert.equal(staged.valid,4);assert.equal(staged.held,0);assert.equal(staged.lifecycleHold.held,1);assert.deepEqual(staged.lifecycleHold.employeeIds,[formerId]);
 const held=integrations.detail(actor,staged.lifecycleHold.batchId),heldRecords=held.records.filter(row=>row.status==='held'),validRecords=held.records.filter(row=>row.status==='valid');assert.equal(held.status,'review_required');assert.equal(validRecords.length,4);assert.equal(heldRecords.length,1);assert.equal(heldRecords[0].externalId,formerId);assert.match(held.records.find(row=>row.externalId===formerId).reason,/Former employee .*2019-07-21/);
 assert.throws(()=>integrations.apply(actor,held.id,true,{people:()=>assert.fail('held cohort must not apply')}),{status:409});
 db.exec('BEGIN IMMEDIATE');
 try{
  const current=load();
  const applied=integrations.apply(actor,staged.id,true,{people:(rows,batch)=>{
   const raw=rows.map(({canonical:v})=>({source_id:v.sourceId,payroll_id:v.payrollId,name:v.name,email:v.email,manager_id:v.manager,site:v.site,job:v.job,start_date:v.startDate,contract_type:v.contractType,weekly_hours:String(v.weeklyHours),language:v.locale,skills:(v.selfReportedSkills||[]).join(',')}));
   return ON.stage(current,actor,{rows:raw,clientKey:'gateway:'+batch.id});
  }});
  assert.equal(applied.status,'applied');assert.equal(applied.applied,4);
  current.version++;db.prepare('UPDATE tenants SET version=?,state=? WHERE id=?').run(current.version,JSON.stringify(current),tenant);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 db.close();

 db=new DatabaseSync(file);
 const reopened=IG.createStore(db),persisted=JSON.parse(db.prepare('SELECT state FROM tenants WHERE id=?').get(tenant).state);
 assert.equal(persisted.onboarding.people.filter(person=>currentIds.includes(person.sourceId)).length,4);assert.equal(persisted.onboarding.people.filter(person=>currentIds.includes(person.sourceId)).every(person=>person.identityVerified===false),true);assert.deepEqual(persisted.onboarding.people.filter(person=>currentIds.includes(person.sourceId)).map(person=>person.payrollId),['1','2','3','4']);assert.equal(persisted.onboarding.people.some(person=>person.sourceId===formerId),false);
 const detail=reopened.detail(actor,staged.id);assert.equal(detail.status,'applied');assert.equal(detail.records.every(row=>row.status==='applied'),true);const reopenedHeld=reopened.detail(actor,staged.lifecycleHold.batchId);assert.equal(reopenedHeld.records.find(row=>row.externalId===formerId).status,'held');assert.match(reopenedHeld.records.find(row=>row.externalId===formerId).reason,/2019-07-21/);
 let handlerCalls=0;const replay=reopened.apply(actor,staged.id,true,{people:()=>{handlerCalls++;}});
 assert.equal(replay.replayed,true);assert.equal(handlerCalls,0);
 assert.throws(()=>reopened.detail({...actor,tenant:'isolation-test'},staged.id),{status:404});
 assert.deepEqual(db.prepare("SELECT action FROM audit_events ORDER BY id").all().map(row=>row.action),['integration-stage','integration-stage','integration-apply']);
 assert.throws(()=>db.exec('DELETE FROM audit_events'),/Audit events are append only/);
 db.close();
});


test('canonical onboarding keeps strict source identity and unsafe or duplicate payroll rejection',()=>{
 const current=seed(),actor={tenant:'northstar-demo',personId:'d1',permissions:['company.configure']};
 const row={source_id:'provider-employee-1',payroll_id:'1',name:'Demo Worker',email:'demo-worker@example.invalid',manager_id:'m1',site:'Tamworth',job:'Machine operator',start_date:'2026-09-01',contract_type:'full_time',weekly_hours:37.5};
 assert.equal(ON.validateRows(current,actor,[row]).canStage,true);
 for(const unsafe of ['', '../1', 'one space', 'a'.repeat(65)])assert.equal(ON.validateRows(current,actor,[{...row,payroll_id:unsafe}]).canStage,false);
 assert.equal(ON.validateRows(current,actor,[{...row,source_id:'1'}]).canStage,false);
 const duplicate=ON.validateRows(current,actor,[row,{...row,source_id:'provider-employee-2',email:'another-worker@example.invalid'}]);
 assert.equal(duplicate.canStage,false);assert.equal(duplicate.rejected,1);assert.match(duplicate.errors[0].message,/Duplicate payroll ID/);
});
