'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Reporting=require(process.env.VECTOR_AUDIT_SERVICE_PATH||'./vector-reporting-service.cjs');

const hash=value=>createHash('sha256').update(value).digest('hex');
const principals=[
  ['manager@fictional.invalid','fictional-a','manager','manager-a'],
  ['peer@fictional.invalid','fictional-a','manager','peer-a'],
  ['employee@fictional.invalid','fictional-a','employee','employee-a'],
  ['other@fictional.invalid','fictional-b','manager','manager-b']
];
const tables=['vector_report_definitions','vector_report_dashboards','vector_report_schedules',
  'vector_report_schedule_events','vector_report_audit','vector_report_deliveries',
  'vector_report_delivery_intents','vector_report_delivery_observations'];

async function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-audit-atomicity-'));
  const dbPath=path.join(dir,'fictional.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
  for(const [email,tenant,role,token] of principals){
    db.prepare('INSERT INTO users VALUES(?,?,?)').run(email,tenant,role);
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),email,Date.now()+3600000);
  }
  db.close();
  let service=Reporting.createVectorReportingService({dbPath,schedulerTickMs:2147483647});
  const server=http.createServer((req,res)=>{
    Promise.resolve(service.handleRequest(req,res)).then(handled=>{
      if(!handled){res.statusCode=404;res.end('{}');}
    },error=>{res.statusCode=500;res.end(JSON.stringify({error:String(error)}));});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  const sql=fn=>{const connection=new DatabaseSync(dbPath);try{return fn(connection);}finally{connection.close();}};
  const snapshot=()=>sql(connection=>Object.fromEntries(tables.map(table=>[table,connection.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row}))])));
  async function call(route,body,token='manager-a',method='POST'){
    const payload=body===undefined?null:Buffer.from(JSON.stringify(body));
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port,path:'/api/reporting'+route,method,headers:{connection:'close',...(token?{cookie:'wfm_session='+token}:{}),...(payload?{'content-type':'application/json','content-length':payload.length}:{})}},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
        res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(error){reject(error);}});
      });
      req.on('error',reject);if(payload)req.write(payload);req.end();
    });
  }
  async function stop(){if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));if(service){service.close();service=null;}}
  return {dbPath,call,snapshot,sql,stop,
    refuse(event,kind='ABORT'){assert.ok(['ABORT','FAIL'].includes(kind));assert.match(event,/^[A-Z_]+$/);sql(connection=>connection.exec("CREATE TRIGGER fictional_audit_refusal BEFORE INSERT ON vector_report_audit WHEN NEW.event='"+event+"' BEGIN SELECT RAISE("+kind+",'fictional audit refusal'); END;"));},
    async close(){await stop();fs.rmSync(dir,{recursive:true,force:true});}
  };
}

const definition=title=>({title,sourceId:'factory-readiness',columns:['site','status']});
async function report(x,title='Fictional operational report'){
  const response=await x.call('/reports',{definition:definition(title)});
  assert.equal(response.status,201);return response.body.report;
}
async function pin(x,id){const response=await x.call('/dashboards/pin',{reportId:id});assert.equal(response.status,201);return response.body.dashboard;}
const schedule=id=>({reportId:id,cadence:'daily',hour:16,minute:5,timeZone:'UTC',delivery:'in_app'});

async function prepare(x,kind){
  if(kind==='create')return {route:'/reports',body:{definition:definition('New fictional report')},event:'REPORT_CREATED'};
  const saved=await report(x);
  if(kind==='version')return {route:'/reports',body:{versionOf:saved.id,definition:definition('Fictional revision')},event:'REPORT_VERSION_CREATED',report:saved};
  if(kind==='initial-pin')return {route:'/dashboards/pin',body:{reportId:saved.id},event:'REPORT_PINNED',report:saved};
  if(kind==='schedule')return {route:'/schedules',body:schedule(saved.id),event:'REPORT_SCHEDULE_CREATED',report:saved};
  const previous=await pin(x,saved.id);
  if(kind==='unpin')return {route:'/dashboards/unpin',body:{reportId:saved.id},event:'REPORT_UNPINNED',report:saved,previous};
  assert.equal(kind,'pin-revision');
  const second=await report(x,'Second fictional report');
  return {route:'/dashboards/pin',body:{reportId:second.id},event:'REPORT_PINNED',report:second,previous};
}

function verifyCommitted(before,after,response,action){
  const audits=after.vector_report_audit.slice(before.vector_report_audit.length);
  assert.equal(audits.length,1,'exactly one linked mutation audit');
  const audit=audits[0],detail=JSON.parse(audit.detail_json);
  assert.equal(audit.event,action.event);assert.equal(audit.tenant,'fictional-a');assert.equal(audit.actor,'manager@fictional.invalid');
  const changed=action.event==='REPORT_CREATED'||action.event==='REPORT_VERSION_CREATED'?'vector_report_definitions':action.event==='REPORT_SCHEDULE_CREATED'?'vector_report_schedules':'vector_report_dashboards';
  assert.equal(after[changed].length,before[changed].length+1);
  const row=after[changed].at(-1);assert.equal(row.tenant,'fictional-a');assert.equal(row.created_by,'manager@fictional.invalid');
  if(changed==='vector_report_definitions'){
    assert.equal(audit.report_id,row.id);assert.equal(response.body.report.id,row.id);assert.equal(detail.definitionDigest,row.definition_digest);
    assert.deepEqual(JSON.parse(row.definition_json),response.body.report.definition);assert.equal(row.version_of,action.report?.id||null);
  }else if(changed==='vector_report_dashboards'){
    assert.equal(audit.report_id,action.report.id);assert.equal(detail.dashboardId,row.id);assert.equal(response.body.dashboard.id,row.id);
    assert.equal(detail.dashboardDigest,row.dashboard_digest);assert.deepEqual(JSON.parse(row.dashboard_json),response.body.dashboard.dashboard);
    assert.equal(row.version_of,action.previous?.id||null);assert.equal(detail.versionOf,action.previous?.id||null);
    const ids=JSON.parse(row.dashboard_json).reportIds;
    assert.equal(ids.includes(action.report.id),action.event==='REPORT_PINNED');
    if(action.previous)assert.deepEqual(before.vector_report_dashboards,after.vector_report_dashboards.slice(0,-1),'immutable prior versions retained');
  }else{
    assert.equal(audit.report_id,action.report.id);assert.equal(detail.scheduleId,row.id);assert.equal(response.body.schedule.id,row.id);
    assert.equal(detail.scheduleDigest,row.schedule_digest);assert.deepEqual(JSON.parse(row.schedule_json),response.body.schedule.schedule);
    const events=after.vector_report_schedule_events.slice(before.vector_report_schedule_events.length);
    assert.equal(events.length,1);assert.equal(events[0].schedule_id,row.id);assert.equal(events[0].tenant,row.tenant);assert.equal(events[0].actor,row.created_by);assert.equal(events[0].enabled,1);
  }
  for(const table of tables){
    if(table===changed||table==='vector_report_audit'||table==='vector_report_schedule_events'&&changed==='vector_report_schedules')continue;
    assert.deepEqual(after[table],before[table],table+' must remain unchanged');
  }
}

for(const kind of ['create','version','initial-pin','pin-revision','unpin','schedule']){
  for(const refusal of ['ABORT','FAIL'])test(kind+' audit '+refusal+' rolls back all mutation rows after HTTP response and database reopen',async()=>{
    const x=await fixture();
    try{
      const action=await prepare(x,kind),before=x.snapshot();
      x.refuse(action.event,refusal);
      const response=await x.call(action.route,action.body);
      assert.equal(response.status,400);assert.match(response.body.error,/fictional audit refusal/);
      const stillOpen=x.snapshot();
      await x.stop();const after=x.snapshot();
      console.log(JSON.stringify({kind,refusal,status:response.status,beforeCounts:Object.fromEntries(tables.map(t=>[t,before[t].length])),afterCounts:Object.fromEntries(tables.map(t=>[t,after[t].length]))}));
      assert.deepEqual(after,before,'refused audit must leave exactly the prior durable state');
      assert.deepEqual(stillOpen,before,'rollback must already be visible before close');
    }finally{await x.close();}
  });
  test(kind+' success commits only intended rows and linked tenant/actor/digest audit',async()=>{
    const x=await fixture();
    try{
      const action=await prepare(x,kind),before=x.snapshot();
      const response=await x.call(action.route,action.body);
      assert.equal(response.status,201);await x.stop();
      verifyCommitted(before,x.snapshot(),response,action);
    }finally{await x.close();}
  });
}

test('audit refusal does not poison later authorized request on the same service connection',async()=>{
  const x=await fixture();
  try{
    const action=await prepare(x,'unpin'),before=x.snapshot();x.refuse(action.event);
    assert.equal((await x.call(action.route,action.body)).status,400);
    x.sql(connection=>connection.exec('DROP TRIGGER fictional_audit_refusal'));
    const response=await x.call(action.route,action.body);assert.equal(response.status,201);
    await x.stop();verifyCommitted(before,x.snapshot(),response,action);
  }finally{await x.close();}
});

test('denied role, absent session, other tenant and another creator cannot add mutation or audit rows',async()=>{
  const x=await fixture();
  try{
    const saved=await report(x);await pin(x,saved.id);
    const routes=[['/reports',{versionOf:saved.id,definition:definition('Unauthorized revision')}],['/dashboards/pin',{reportId:saved.id}],['/dashboards/unpin',{reportId:saved.id}],['/schedules',schedule(saved.id)]];
    const before=x.snapshot();
    for(const [token,status] of [['',401],['employee-a',403],['manager-b',404],['peer-a',404]]){
      for(const [route,body] of routes)assert.equal((await x.call(route,body,token)).status,status,route+' '+token);
    }
    await x.stop();assert.deepEqual(x.snapshot(),before);
  }finally{await x.close();}
});
