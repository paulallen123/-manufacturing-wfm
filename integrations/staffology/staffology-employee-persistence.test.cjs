'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {mkdtempSync,rmSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');

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

test('reviewed Staffology employee import persists across restart without duplicate apply or cross-tenant read',t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'staffology-employee-persistence-')),file=path.join(directory,'state.sqlite');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 let db=new DatabaseSync(file);schema(db);
 const tenant='northstar-demo',actor={tenant,personId:'d1',email:'director@northstar.example',costs:true,permissions:['company.configure']};
 const cfg={id:'staffology-people',provider:'staffology',tenant,scope:'d1',objectTypes:['people']},profile={binding:{tenant},connector:cfg};
 const state=seed();db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(tenant,state.version,JSON.stringify(state));
 const load=()=>JSON.parse(db.prepare('SELECT state FROM tenants WHERE id=?').get(tenant).state);
 const integrations=IG.createStore(db);
 const prepare=(record)=>{
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
 const acquisition={objectType:'people',paginationComplete:true,atomicProviderSnapshot:false,cursor:'cursor-1',sourceVersion:'staffology-revision-1',records:[{externalId:'employee-001',revision:'revision-1',operation:'upsert',data:{identity:{employeeId:'employee-001',payrollCode:'PAY001'},person:{firstName:'Jamie',lastName:'Taylor',email:'jamie.taylor@example.invalid'},employment:{effectiveFrom:'2026-10-01'}}}]};
 const receipt={approved:true,connectorId:cfg.id,connectorScope:cfg.scope,idempotencyKey:'staffology-people-001',mappings:[{externalId:'employee-001',payrollId:'PAY001',managerId:'m1',site:'Tamworth',job:'Machine operator',contractType:'full_time',weeklyHours:37.5,language:'en-GB'}]};
 runtime.assertEmployeeStaging(actor,receipt);
 const staged=runtime.stageEmployeeAcquisition(actor,acquisition,receipt);
 assert.equal(staged.status,'staged');assert.equal(staged.valid,1);assert.equal(staged.held,0);
 db.exec('BEGIN IMMEDIATE');
 try{
  const current=load();
  const applied=integrations.apply(actor,staged.id,true,{people:(rows,batch)=>{
   const raw=rows.map(({canonical:v})=>({source_id:v.sourceId,payroll_id:v.payrollId,name:v.name,email:v.email,manager_id:v.manager,site:v.site,job:v.job,start_date:v.startDate,contract_type:v.contractType,weekly_hours:String(v.weeklyHours),language:v.locale,skills:(v.selfReportedSkills||[]).join(',')}));
   return ON.stage(current,actor,{rows:raw,clientKey:'gateway:'+batch.id});
  }});
  assert.equal(applied.status,'applied');assert.equal(applied.applied,1);
  current.version++;db.prepare('UPDATE tenants SET version=?,state=? WHERE id=?').run(current.version,JSON.stringify(current),tenant);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 db.close();

 db=new DatabaseSync(file);
 const reopened=IG.createStore(db),persisted=JSON.parse(db.prepare('SELECT state FROM tenants WHERE id=?').get(tenant).state);
 assert.equal(persisted.onboarding.people.filter(person=>person.sourceId==='employee-001').length,1);
 const detail=reopened.detail(actor,staged.id);assert.equal(detail.status,'applied');assert.equal(detail.records[0].status,'applied');
 let handlerCalls=0;const replay=reopened.apply(actor,staged.id,true,{people:()=>{handlerCalls++;}});
 assert.equal(replay.replayed,true);assert.equal(handlerCalls,0);
 assert.throws(()=>reopened.detail({...actor,tenant:'isolation-test'},staged.id),{status:404});
 assert.deepEqual(db.prepare("SELECT action FROM audit_events ORDER BY id").all().map(row=>row.action),['integration-stage','integration-apply']);
 assert.throws(()=>db.exec('DELETE FROM audit_events'),/Audit events are append only/);
 db.close();
});
