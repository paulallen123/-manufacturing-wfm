'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Reporting=require('./vector-reporting-service.cjs');
function fixture(){
  const dir=fs.mkdtempSync(path.join(__dirname,'disposable-version-')),dbPath=path.join(dir,'reporting.sqlite');
  const inspect=fn=>{const db=new DatabaseSync(dbPath);try{return fn(db);}finally{db.close();}};
  inspect(db=>{
    db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
    db.prepare('INSERT INTO users VALUES(?,?,?)').run('manager@fictional.invalid','fictional-reporting','manager');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('fictional-version-token').digest('hex'),'manager@fictional.invalid',Date.now()+600000);
  });
  const service=Reporting.createVectorReportingService({dbPath});
  async function save(versionOf){
    const req=Readable.from([Buffer.from(JSON.stringify({versionOf,definition:{title:versionOf?'Fictional readiness revision':'Fictional initial readiness',sourceId:'factory-readiness'}}))]);
    Object.assign(req,{method:'POST',url:'/api/reporting/reports',headers:{cookie:'wfm_session=fictional-version-token'}});
    const res={statusCode:200,setHeader(){},end(body){this.body=String(body);this.headersSent=true;this.writableEnded=true;}};
    assert.equal(await service.handleRequest(req,res),true);
    return {status:res.statusCode,body:JSON.parse(res.body)};
  }
  const durable=()=>inspect(db=>({reports:db.prepare('SELECT id,version_of,definition_json FROM vector_report_definitions ORDER BY id').all().map(row=>({...row})),audits:db.prepare('SELECT report_id,event,detail_json FROM vector_report_audit ORDER BY id').all().map(row=>({...row}))}));
  return {service,inspect,save,durable,close(){service.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('refused version audit preserves only original durable report and creation audit',async()=>{
  const x=fixture();
  try{
    const initial=await x.save();assert.equal(initial.status,201);
    const before=x.durable();assert.equal(before.reports.length,1);assert.equal(before.audits.length,1);assert.equal(before.audits[0].event,'REPORT_CREATED');
    x.inspect(db=>db.exec("CREATE TRIGGER fictional_version_audit_refusal BEFORE INSERT ON vector_report_audit WHEN NEW.event='REPORT_VERSION_CREATED' BEGIN SELECT RAISE(ABORT,'fictional version audit refusal'); END;"));
    const revision=await x.save(initial.body.report.id);
    assert.equal(revision.status,400);assert.match(revision.body.error,/fictional version audit refusal/);
    x.service.close();
    const after=x.durable();
    console.log(JSON.stringify({versionStatus:revision.status,reports:after.reports.length,audits:after.audits.length,versionAudits:after.audits.filter(row=>row.event==='REPORT_VERSION_CREATED').length}));
    assert.deepEqual(after,before,'failed version audit must preserve original bytes without a durable revision');
  }finally{x.close();}
});
test('normal version save commits revision and linked audit together',async()=>{
  const x=fixture();
  try{
    const initial=await x.save();assert.equal(initial.status,201);
    const revision=await x.save(initial.body.report.id);assert.equal(revision.status,201);
    x.service.close();
    const rows=x.durable();assert.equal(rows.reports.length,2);assert.equal(rows.audits.length,2);
    assert.equal(rows.reports.find(row=>row.id===revision.body.report.id).version_of,initial.body.report.id);
    const audit=rows.audits.find(row=>row.event==='REPORT_VERSION_CREATED');assert.equal(audit.report_id,revision.body.report.id);assert.equal(JSON.parse(audit.detail_json).versionOf,initial.body.report.id);
  }finally{x.close();}
});
