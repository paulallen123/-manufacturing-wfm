'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Reporting=require('./vector-reporting-service.cjs');
test('valid fictional manager save leaves no durable report when creation audit is refused',async()=>{
  const dir=fs.mkdtempSync(path.join(__dirname,'disposable-')),dbPath=path.join(dir,'reporting.sqlite');
  let service;
  const inspect=fn=>{const db=new DatabaseSync(dbPath);try{return fn(db);}finally{db.close();}};
  try{
    inspect(db=>{
      db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
      db.prepare('INSERT INTO users VALUES(?,?,?)').run('manager@fictional.invalid','fictional-reporting','manager');
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('fictional-report-token').digest('hex'),'manager@fictional.invalid',Date.now()+600000);
    });
    service=Reporting.createVectorReportingService({dbPath});
    inspect(db=>db.exec("CREATE TRIGGER fictional_creation_audit_refusal BEFORE INSERT ON vector_report_audit WHEN NEW.event='REPORT_CREATED' BEGIN SELECT RAISE(ABORT,'fictional creation audit refusal'); END;"));
    const req=Readable.from([Buffer.from(JSON.stringify({definition:{title:'Fictional factory readiness',sourceId:'factory-readiness'}}))]);
    Object.assign(req,{method:'POST',url:'/api/reporting/reports',headers:{cookie:'wfm_session=fictional-report-token'}});
    const res={statusCode:200,setHeader(){},end(body){this.body=String(body);this.headersSent=true;this.writableEnded=true;}};
    assert.equal(await service.handleRequest(req,res),true);
    assert.equal(res.statusCode,400,'audit refusal must not acknowledge a saved report');
    assert.match(JSON.parse(res.body).error,/fictional creation audit refusal/,'fixture must reach creation audit insertion');
    service.close();service=undefined;
    const durable=inspect(db=>({reports:db.prepare('SELECT count(*) n FROM vector_report_definitions').get().n,audits:db.prepare('SELECT count(*) n FROM vector_report_audit').get().n}));
    console.log(JSON.stringify({responseStatus:res.statusCode,durable}));
    assert.deepEqual(durable,{reports:0,audits:0},'audit refusal must roll back the durable report insertion');
  }finally{service?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
