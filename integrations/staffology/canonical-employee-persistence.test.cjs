'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {mkdtempSync,rmSync}=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Bridge=require('./canonical-runtime-bridge.cjs');

function person(externalId,payrollCode,name){const [firstName,lastName]=name.split(' ');return {externalId,revision:`revision-${externalId}`,operation:'upsert',data:{identity:{provider:'staffology',employeeId:externalId,payrollCode},person:{firstName,lastName,email:`${externalId}@example.invalid`},employment:{effectiveFrom:'2026-09-01'}}};}
function mapping(externalId,payrollId){return {externalId,payrollId,managerId:'m1',site:'Leeds',job:'Operator',contractType:'full_time',weeklyHours:'40',language:'en-GB'};}
function initialState(){return {version:1,audit:[],staff:[{id:'existing-1',site:'Leeds'}],org:[{id:'m1',label:'Manufacturing'}],profiles:{},workRules:{schemaVersion:1,jobs:[{name:'Operator',skills:[]}],contracts:{}},onboarding:{schemaVersion:1,batches:[],people:[],receipts:[],audit:[]}};}

test('reviewed Staffology cohort persists through sealed module boundaries and independent reopen',t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'staffology-canonical-persistence-')),database=path.join(directory,'wfm.sqlite');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 assert.equal(spawnSync('tar',['-xzf',path.resolve('artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'),'-C',directory],{encoding:'utf8'}).status,0);
 // This deliberately invokes the sealed gateway/onboarding modules directly.
 // It proves their persistence contract, but does not start server.cjs or prove
 // process-level shutdown/startup, HTTP routing, UI rendering or a built image.
 const IG=require(path.join(directory,'lib/integration-gateway.cjs')),ON=require(path.join(directory,'public/onboarding-engine.js'));
 let db=new DatabaseSync(database);db.exec('CREATE TABLE audit_events(tenant TEXT,actor TEXT,action TEXT,detail TEXT,created_at TEXT); CREATE TABLE tenants(id TEXT PRIMARY KEY,state TEXT NOT NULL);');
 const tenant='synthetic-persistence-tenant',actor={tenant,personId:'d1',email:'reviewer@example.invalid',permissions:['company.configure'],costs:true},cfg={id:'staffology-people',provider:'staffology',tenant,scope:'d1',objectTypes:['people']},store=IG.createStore(db),state=initialState();
 db.prepare('INSERT INTO tenants(id,state) VALUES(?,?)').run(tenant,JSON.stringify(state));
 const acquisition={objectType:'people',cursor:'pageNum:0',sourceVersion:'staffology-snapshot-1',paginationComplete:true,atomicProviderSnapshot:false,records:[person('employee-1','PAY001','Test One'),person('employee-2','PAY002','Test Two')]};
 const receipt={approved:true,mappings:[mapping('employee-1','PAY001'),mapping('employee-2','PAY002')]},envelope=Bridge.peopleEnvelope(acquisition,receipt);
 const prepare=(_objectType,record)=>{const row={...record.data,source_id:record.externalId},checked=ON.validateRows(state,actor,[row]);assert.equal(checked.canStage,true);return checked.valid[0];};
 const staged=store.stage(cfg,envelope,'staffology-cohort-001',prepare);assert.equal(staged.status,'staged');assert.equal(staged.valid,2);
 db.exec('BEGIN IMMEDIATE');try{const persisted=JSON.parse(db.prepare('SELECT state FROM tenants WHERE id=?').get(tenant).state),applied=store.apply(actor,staged.id,true,{people:(rows,batch)=>ON.stage(persisted,actor,{rows:rows.map(({canonical:v})=>({source_id:v.sourceId,payroll_id:v.payrollId,name:v.name,email:v.email,manager_id:v.manager,site:v.site,job:v.job,start_date:v.startDate,contract_type:v.contractType,weekly_hours:String(v.weeklyHours),language:v.locale,skills:(v.selfReportedSkills||[]).join(',')})),clientKey:`gateway:${batch.id}`})});assert.equal(applied.status,'applied');persisted.version++;db.prepare('UPDATE tenants SET state=? WHERE id=?').run(JSON.stringify(persisted),tenant);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 db.close();db=new DatabaseSync(database);
 const readbackState=JSON.parse(db.prepare('SELECT state FROM tenants WHERE id=?').get(tenant).state),readback=IG.createStore(db).detail(actor,staged.id);
 assert.equal(readback.status,'applied');assert.equal(readback.records.length,2);assert.deepEqual(readback.records.map(row=>[row.externalId,row.status]),[['employee-1','applied'],['employee-2','applied']]);
 assert.deepEqual(readbackState.onboarding.people.map(row=>[row.sourceId,row.payrollId,row.status]),[['employee-1','PAY001','staged'],['employee-2','PAY002','staged']]);
 db.close();
});
