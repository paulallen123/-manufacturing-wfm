'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const {isDue,automationPurpose,runVectorAutomationCycle}=require('./vector-automation-worker.cjs');

function setup(detail,status='PENDING_RUNNER'){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-auto-'));const dbPath=path.join(dir,'db.sqlite');const db=new DatabaseSync(dbPath);
  db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,state TEXT NOT NULL);CREATE TABLE vector_automations(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,owner_email TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,source_request_id TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE vector_reports(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,owner_email TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,source_request_id TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE vector_tasks(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,owner_email TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,source_request_id TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);");
  db.prepare('INSERT INTO tenants VALUES(?,?)').run('t1',JSON.stringify({timezone:'Europe/London',staff:[{id:'1',siteId:'a',status:'present'},{id:'2',siteId:'a',status:'sick'}]}));
  db.prepare('INSERT INTO vector_automations VALUES(?,?,?,?,?,?,?,?,?)').run('a1','t1','ops@example.com','Monday operations',status,'r1',JSON.stringify(detail),'2026-09-19T10:00:00Z','2026-09-19T10:00:00Z');
  db.close();return {dir,dbPath};
}

test('weekly cadence is due once in its local day/hour',()=>{
  const cadence={parsed:true,frequency:'WEEKLY',dayOfWeek:1,hour:8};
  assert.equal(isDue(cadence,null,new Date('2026-09-21T07:15:00Z'),'Europe/London'),true);
  assert.equal(isDue(cadence,'2026-09-21T07:05:00Z',new Date('2026-09-21T07:15:00Z'),'Europe/London'),false);
});

test('purpose separates task and report automations',()=>{
  assert.equal(automationPurpose('Every Monday create a task to check agency spend'),'TASK');
  assert.equal(automationPurpose('Every Monday email the operations summary'),'REPORT');
});

test('scheduled email report refreshes tenant state and records delivery',async()=>{
  const s=setup({request:'Every Monday morning email the operations summary',cadence:{parsed:true,frequency:'WEEKLY',dayOfWeek:1,hour:8},siteIds:['a'],role:'OPS_MANAGER',scope:'MULTI_SITE',snapshot:{decisionLens:{soWhat:'Review current site performance.',nextAction:'Act on exceptions.'}}});
  const sent=[];
  const result=await runVectorAutomationCycle({
    dbPath:s.dbPath,now:new Date('2026-09-21T07:15:00Z'),
    env:{WFM_VECTOR_EMAIL_PROVIDER:'resend',WFM_VECTOR_RESEND_TOKEN:'12345678',WFM_VECTOR_EMAIL_FROM:'Vector <vector@example.com>'},
    sendEmail:async payload=>{sent.push(payload);return {provider:'RESEND',id:'email-1',to:[payload.to]};}
  });
  assert.equal(result.results[0].status,'SENT');
  assert.equal(sent.length,1);
  assert.match(sent[0].text,/People in scope: 2/);
  const db=new DatabaseSync(s.dbPath);
  const report=db.prepare('SELECT status,detail_json FROM vector_reports').get();
  assert.equal(report.status,'SENT');
  assert.equal(JSON.stringify(JSON.parse(report.detail_json)).includes('ops@example.com'),false);
  const automation=db.prepare('SELECT status,detail_json FROM vector_automations').get();
  assert.equal(automation.status,'ACTIVE');
  assert.ok(JSON.parse(automation.detail_json).lastRunAt);
  db.close();fs.rmSync(s.dir,{recursive:true,force:true});
});

test('email automation fails closed when delivery provider is absent',async()=>{
  const s=setup({request:'Every Monday morning email the operations summary',cadence:{parsed:true,frequency:'WEEKLY',dayOfWeek:1,hour:8},siteIds:['a']});
  const result=await runVectorAutomationCycle({dbPath:s.dbPath,now:new Date('2026-09-21T07:15:00Z'),env:{}});
  assert.equal(result.results[0].status,'BLOCKED_PROVIDER');
  const db=new DatabaseSync(s.dbPath);assert.equal(db.prepare('SELECT status FROM vector_automations').get().status,'BLOCKED_PROVIDER');assert.equal(db.prepare('SELECT COUNT(*) n FROM vector_reports').get().n,0);db.close();fs.rmSync(s.dir,{recursive:true,force:true});
});
