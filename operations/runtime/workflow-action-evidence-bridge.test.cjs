'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  createWorkflowActionEvidenceBridge,
  fetchAuthoritativeTimeReview,
  TIME_REVIEW_PATH
} = require('./workflow-action-evidence-bridge.cjs');

function sha(value){ return createHash('sha256').update(String(value)).digest('hex'); }
function response(){
  return {
    statusCode:200,headersSent:false,writableEnded:false,body:'',headers:{},
    setHeader(name,value){this.headers[String(name).toLowerCase()]=value;},
    end(value=''){this.body=String(value);this.headersSent=true;this.writableEnded=true;}
  };
}
async function call(engine,token,method='GET',url=TIME_REVIEW_PATH){
  const req=Readable.from([]);
  req.method=method;req.url=url;req.headers=token?{cookie:'wfm_session='+token,host:'localhost'}:{host:'localhost'};
  const res=response();
  assert.equal(await engine.handleRequest(req,res),true);
  return {status:res.statusCode,body:res.body?JSON.parse(res.body):null,headers:res.headers};
}
function fixture(sourceProvider,role='manager',options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-action-bridge-'));
  const dbPath=path.join(dir,'db.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);");
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha',1,JSON.stringify({version:1,org:[{id:'m1'},{id:'team-a',parent:'m1'}],staff:[{id:'e1',manager:'team-a'}]}));
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('bravo',1,'{}');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@alpha','alpha','m1',role,1,'s','00','[]');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('employee@alpha','alpha','e1','employee',0,'s','00','[]');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@bravo','bravo','m2','manager',1,'s','00','[]');
  const manager='a'.repeat(64),employee='e'.repeat(64),bravo='b'.repeat(64);
  for(const [token,email] of [[manager,'manager@alpha'],[employee,'employee@alpha'],[bravo,'manager@bravo']]){
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token),email,Date.now()+60000);
  }
  db.close();
  const engine=createWorkflowActionEvidenceBridge({
    dbPath,timeReviewSourceProvider:sourceProvider,
    now:()=>Date.parse('2026-09-19T15:02:00.000Z'),
    env:{WFM_TENANT_TIMEZONE:'Europe/London',WFM_TODAY_MAX_AGE_MS:'300000'},...options
  });
  return {engine,manager,employee,bravo,dbPath,close(){engine.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function report(overrides={}){
  return {
    tenant:'alpha',period:'2026-09-07',
    generatedAt:'2026-09-19T15:00:00.000Z',
    authorityRequired:'Manager time-review decision',
    teams:[{id:'team-a',issues:[
      {id:'issue-1',status:'open',reasonCode:'MISSED_CLOCK_OUT',title:'Alex · missed clock-out'},
      {id:'closed-1',status:'resolved',reasonCode:'MISSED_CLOCK_IN'}
    ]}],
    ...overrides
  };
}

test('native bridge carries an opaque original-request owner through both await fences and release',async()=>{
 const ticket=Object.freeze({}),events=[];let original,view;
 const sourceOwner={capture(req,sourceRequest){original=req;view=sourceRequest;assert.notEqual(req,sourceRequest);events.push('capture');return ticket;},assertCurrent(cap,req,state){assert.equal(cap,ticket);assert.equal(req,original);assert.notEqual(req,view);assert.equal(state.version,1);events.push('current');},release(cap,req){assert.equal(cap,ticket);assert.equal(req,original);events.push('release');}};
 const f=fixture(async(req,ctx,cap)=>{assert.equal(req,view);assert.equal(cap,ticket);events.push('provider');return {status:200,body:report()};},'manager',{sourceOwner});
 try{const result=await call(f.engine,f.manager);assert.equal(result.status,200);assert.deepEqual(events,['capture','current','provider','current','current','release']);}finally{f.close();}
});
for(const boundary of ['provider','calendar'])for(const status of [403,503])test('native owner '+status+' after '+boundary+' await is not flattened to source502',async()=>{
 const ticket=Object.freeze({});let changed=false,released=0;
 const sourceOwner={capture(){return ticket;},assertCurrent(cap){assert.equal(cap,ticket);if(changed)throw Object.assign(Error('Native workflow authority changed'),{status,statusCode:status});},release(){released++;}};
 const provider=async()=>{if(boundary==='provider')changed=true;return {status:200,body:report()};};
 const calendarProvider=async()=>{if(boundary==='calendar')changed=true;return {schemaVersion:'tenant-calendar-1',tenant:'alpha',timeZone:'Europe/London',asOf:'2026-09-19T15:02:00.000Z',maxAgeMs:300000};};
 const f=fixture(provider,'manager',{sourceOwner,calendarProvider});try{const result=await call(f.engine,f.manager);assert.equal(result.status,status);assert.equal(result.body.items,undefined);assert.equal(released,1);}finally{f.close();}
});

test('read-only bridge emits only contract-valid Time Review actions from the authenticated source response',async()=>{
  const seen=[];
  const f=fixture(async(_req,ctx)=>{seen.push(ctx);return{status:200,body:report()};});
  try{
    const result=await call(f.engine,f.manager);
    assert.equal(result.status,200);
    assert.equal(result.body.contractVersion,'WFM_WORKFLOW_ACTION_EVIDENCE_V1');
    assert.equal(result.body.workflow,'time-review');
    assert.equal(result.body.source,'/api/weekly-review');
    assert.equal(result.body.timeZone,'Europe/London');
    assert.equal(result.body.asOf,'2026-09-19T15:02:00.000Z');
    assert.equal(result.body.maxAgeMs,300000);
    assert.equal(result.body.items.length,1);
    assert.equal(result.body.items[0].sourceId,'issue-1');
    assert.equal(result.body.items[0].reasonCode,'MISSED_CLOCK_OUT');
    assert.equal(result.body.items[0].freshness.state,'current');
    assert.equal(result.body.items[0].confirmation.state,'action_required');
    assert.deepEqual(seen,[{tenant:'alpha',role:'manager',email:'manager@alpha'}]);
  }finally{f.close();}
});

test('bridge classifies stale source observations from the trusted tenant-calendar envelope',async()=>{
  const f=fixture(async()=>({status:200,body:report({generatedAt:'2026-09-19T14:00:00.000Z'})}));
  try{
    const result=await call(f.engine,f.manager);
    assert.equal(result.status,200);
    assert.equal(result.body.items.length,1);
    assert.equal(result.body.items[0].freshness.state,'stale');
    assert.equal(result.body.items[0].freshness.policyRef,'server-authoritative-tenant-calendar');
  }finally{f.close();}
});

test('bridge exposes the sealed saved-adjustment shape while preserving fail-closed evidence rules',async()=>{
  const f=fixture(async()=>({status:200,body:report({
    teams:[{id:'team-a',issues:[{
      id:'issue-adjustment-1',
      status:'open',
      type:'adjustment',
      row:'row-17',
      sourceFingerprint:'sha256:fixture-source',
      proposed:{clockOut:'2026-09-19T17:05:00.000Z'},
      message:'Manager proposed a five-minute correction.'
    }]}]
  })}));
  try{
    const result=await call(f.engine,f.manager,'GET',TIME_REVIEW_PATH+'?period=2026-09-07');
    assert.equal(result.status,200);
    assert.equal(result.body.items.length,1);
    assert.equal(result.body.items[0].sourceId,'issue-adjustment-1');
    assert.equal(result.body.items[0].reasonCode,'TIME_REVIEW_ADJUSTMENT');
    assert.equal(result.body.items[0].confirmation.state,'action_required');
  }finally{f.close();}
});

test('bridge simulation keeps unrelated reasonless issues suppressed beside a valid adjustment',async()=>{
  const f=fixture(async()=>({status:200,body:report({
    teams:[{id:'team-a',issues:[
      {id:'copy-only',status:'open',title:'Urgent-looking presentation copy only'},
      {
        id:'issue-adjustment-sim',
        status:'open',
        type:'adjustment',
        row:'row-sim',
        sourceFingerprint:'sha256:simulated-source',
        proposed:{clockOut:'2026-09-19T17:10:00.000Z'},
        message:'Manager proposed a bounded correction.'
      }
    ]}]
  })}));
  try{
    const result=await call(f.engine,f.manager,'GET',TIME_REVIEW_PATH+'?period=2026-09-07');
    assert.equal(result.status,200);
    assert.deepEqual(result.body.items.map(item=>item.sourceId),['issue-adjustment-sim']);
  }finally{f.close();}
});

test('bridge fails closed for employees before reading Time Review',async()=>{
  let calls=0;
  const f=fixture(async()=>{calls++;return{status:200,body:report()};});
  try{
    const result=await call(f.engine,f.employee);
    assert.equal(result.status,403);
    assert.equal(calls,0);
  }finally{f.close();}
});

test('bridge rejects a source response whose explicit tenant disagrees with the authenticated session',async()=>{
  const f=fixture(async()=>({status:200,body:report({tenant:'bravo'})}));
  try{
    const result=await call(f.engine,f.manager);
    assert.equal(result.status,502);
    assert.match(result.body.error,/scope did not match/i);
  }finally{f.close();}
});

test('incomplete source records remain absent instead of gaining presentation-owned urgency or evidence',async()=>{
  const f=fixture(async()=>({status:200,body:report({teams:[{id:'team-a',issues:[
    {id:'issue-copy-only',status:'open',title:'URGENT critical exception'},
    {id:'issue-with-reason',status:'open',reasonCode:'MISSED_CLOCK_IN'}
  ]}]})}));
  try{
    const result=await call(f.engine,f.manager);
    assert.equal(result.status,200);
    assert.equal(result.body.items.length,1);
    assert.equal(result.body.items[0].sourceId,'issue-with-reason');
  }finally{f.close();}
});

test('bridge preserves source authentication and authorization denials without leaking source details',async()=>{
  for(const status of [401,403]){
    const f=fixture(async()=>({status,body:{error:'private source detail',teams:[{id:'secret-team'}]}}));
    try{const denied=await call(f.engine,f.manager);assert.equal(denied.status,status);assert.equal(denied.headers['cache-control'],'no-store');assert.ok(denied.body.error);assert.doesNotMatch(JSON.stringify(denied.body),/private source detail|secret-team/);assert.equal(denied.body.items,undefined);}finally{f.close();}
  }
});

test('source failure and non-GET access fail closed without exposing a synthetic fallback',async()=>{
  const f=fixture(async()=>({status:503,body:null}));
  try{
    const failed=await call(f.engine,f.manager);
    assert.equal(failed.status,502);
    assert.match(failed.body.error,/unavailable/i);
    const write=await call(f.engine,f.manager,'POST');
    assert.equal(write.status,405);
  }finally{f.close();}
});

test('legacy HTTP source helper fails unavailable before forwarding cookies or client/source headers',async()=>{
  let calls=0;
  const server=http.createServer((_req,res)=>{calls++;res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    await assert.rejects(fetchAuthoritativeTimeReview({headers:{cookie:'wfm_session=synthetic-only',
      'user-agent':'browser','x-forwarded-for':'198.51.100.17','x-forwarded-proto':'https','x-wfm-internal':'true'},
      socket:{localPort:server.address().port},url:TIME_REVIEW_PATH+'?period=2026-09-07'},
      {port:server.address().port,allowLoopback:true,authSourceMode:'observe-only'}),
      error=>error.statusCode===503&&error.code==='WFM_ACTION_EVIDENCE_SOURCE_READER_REQUIRED');
    assert.equal(calls,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('denied roles make zero manager evidence source reads',async()=>{
 for(const role of ['employee','payroll_admin','viewer','','MANAGER']){
  let calls=0;const f=fixture(async()=>{calls++;return {status:200,body:report()};},role);
  try{const result=await call(f.engine,f.manager);assert.equal(result.status,403,role);assert.equal(calls,0,role);}finally{f.close();}
 }
});
test('manager director and supervisor retain evidence source access',async()=>{
 for(const role of ['manager','director','supervisor']){
  let calls=0;const f=fixture(async()=>{calls++;return {status:200,body:report()};},role);
  try{const result=await call(f.engine,f.manager);assert.equal(result.status,200,role);assert.equal(calls,1,role);}finally{f.close();}
 }
});

const ABSENCE_PATH='/api/workforce/lifecycle/action-evidence/absence';
const WEEKLY_PATH='/api/workforce/lifecycle/action-evidence/weekly-signoff';
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function bootstrap(){return {actor:{tenant:'alpha',email:'manager@alpha',role:'manager',personId:'m1'},state:{version:1,
  org:[{id:'m1'},{id:'team-a',parent:'m1'}],staff:[{id:'e1',manager:'team-a'}],
  requests:[{id:'leave-1',employee:'e1',status:'pending',date:'2026-09-20',kind:'Annual leave'}],audit:[]}};}
function weekly(){return {period:'2026-09-07',teams:[{id:'team-a',period:'2026-09-07',revision:2,status:'signed',canSign:false,
  signature:{by:'m1',at:'2026-09-19T15:00:00.000Z',revision:2}}],audit:[{id:'pa-1',type:'team-signed',period:'2026-09-07',team:'team-a',revision:2,actor:'m1',at:'2026-09-19T15:00:00.001Z'}]};}

for(const workflow of ['time-review','absence','weekly-signoff']){
  const url=workflow==='absence'?ABSENCE_PATH:workflow==='time-review'?TIME_REVIEW_PATH:WEEKLY_PATH+'?period=2026-09-07';
  for(const [name,sql,status] of [
    ['deleted session',"DELETE FROM sessions",401],
    ['expired session',"UPDATE sessions SET expires=0",401],
    ['revoked role',"UPDATE users SET role='employee' WHERE email='manager@alpha'",403],
    ['switched allowed role',"UPDATE users SET role='director' WHERE email='manager@alpha'",403],
    ['switched tenant',"UPDATE users SET tenant='bravo' WHERE email='manager@alpha'",403],
    ['switched person',"UPDATE users SET person_id='m2' WHERE email='manager@alpha'",403],
    ['switched session actor',"UPDATE sessions SET email='manager@bravo'",403],
    ['changed permission',"UPDATE users SET permissions='[\"company.configure\"]' WHERE email='manager@alpha'",403],
    ['changed reporting state',"UPDATE tenants SET version=2 WHERE id='alpha'",409]
  ])test(workflow+' discards pending read after '+name,async()=>{
    const started=deferred(),read=deferred(),provider=()=>{started.resolve();return read.promise;};
    const f=fixture(provider,'manager',{absenceSourceProvider:provider,weeklySignoffSourceProvider:provider});
    try{
      const pending=call(f.engine,f.manager,'GET',url);
      // Baseline unknown routes must fail explicitly rather than hang on a never-started read.
      if(workflow!=='time-review' && !require('./workflow-action-evidence-bridge.cjs').ABSENCE_PATH){
        const old=await pending;assert.equal(old.status,200,'source route is missing');return;
      }
      await started.promise;
      const db=new DatabaseSync(f.dbPath);db.exec(sql);db.close();
      read.resolve({status:200,body:workflow==='time-review'?report():workflow==='absence'?bootstrap():weekly()});
      const result=await pending;assert.equal(result.status,status);assert.equal(result.body.items,undefined);
      assert.doesNotMatch(JSON.stringify(result.body),/leave-1|issue-1|pa-1/);
    }finally{f.close();}
  });
}

test('new source cases preserve workflow, tenant, team, period and source identity',async()=>{
  const f=fixture(async()=>({status:200,body:report()}),'manager',{
    absenceSourceProvider:async()=>({status:200,body:bootstrap()}),
    weeklySignoffSourceProvider:async()=>({status:200,body:weekly()})});
  try{
    const a=await call(f.engine,f.manager,'GET',ABSENCE_PATH+'?team=team-a&sourceId=leave-1');
    assert.equal(a.status,200);assert.equal(a.body.workflow,'absence');assert.equal(a.body.source,'/api/bootstrap');
    assert.deepEqual(a.body.items,[]);assert.equal(a.body.availability,'unavailable');
    assert.ok(a.body.unavailable[0].missingFields.includes('observedAt'));
    assert.deepEqual(a.body.unavailable[0].binding,{workflow:'absence',tenant:'alpha',teamId:'team-a',period:null,sourceId:'leave-1'});
    const w=await call(f.engine,f.manager,'GET',WEEKLY_PATH+'?period=2026-09-07&team=team-a&sourceId=team-a');
    assert.equal(w.status,200);assert.equal(w.body.workflow,'weekly-signoff');
    assert.equal(w.body.items[0].confirmation.state,'resolved');assert.equal(w.body.items[0].confirmation.decisionId,'pa-1');
    assert.equal(w.body.items[0].binding.period,'2026-09-07');assert.equal(w.body.items[0].binding.workflow,'weekly-signoff');
  }finally{f.close();}
});

test('source mismatch, partial reports and unbound period reads cannot become successful empty queues',async()=>{
  for(const [body,url] of [
    [weekly(),WEEKLY_PATH+'?period=2026-09-14'],
    [{...weekly(),workflow:'absence'},WEEKLY_PATH+'?period=2026-09-07'],
    [{...weekly(),partial:true},WEEKLY_PATH+'?period=2026-09-07'],
    [{...weekly(),teams:null},WEEKLY_PATH+'?period=2026-09-07'],
    [{...weekly(),teams:[{...weekly().teams[0],period:'2026-09-14'}]},WEEKLY_PATH+'?period=2026-09-07']
  ]){
    const f=fixture(async()=>({status:200,body}),'manager',{weeklySignoffSourceProvider:async()=>({status:200,body})});
    try{const result=await call(f.engine,f.manager,'GET',url);assert.equal(result.status,502);assert.equal(result.body.items,undefined);}finally{f.close();}
  }
});

test('query selectors cannot change authority, silently truncate IDs or accept invalid/duplicate periods',async()=>{
  let calls=0;const provider=async()=>{calls++;return {status:200,body:weekly()};};
  const f=fixture(provider,'manager',{absenceSourceProvider:provider,weeklySignoffSourceProvider:provider});
  try{
    for(const url of [WEEKLY_PATH,WEEKLY_PATH+'?period=2026-02-30',WEEKLY_PATH+'?period=2026-09-07&period=2026-09-14',
      ABSENCE_PATH+'?period=2026-09-07',ABSENCE_PATH+'?tenant=bravo',ABSENCE_PATH+'?sourceId='+('a'.repeat(161))]){
      assert.equal((await call(f.engine,f.manager,'GET',url)).status,400,url);
    }
    assert.equal(calls,0);
    assert.equal((await call(f.engine,f.manager,'GET',ABSENCE_PATH+'?team=outside')).status,403);
    assert.equal(calls,0);
  }finally{f.close();}
});

test('async calendar read also fences revocation and does not leak completed source evidence',async()=>{
  const started=deferred(),calendar=deferred();
  const f=fixture(async()=>({status:200,body:report()}),'manager',{calendarProvider:()=>{started.resolve();return calendar.promise;}});
  try{
    const pending=call(f.engine,f.manager);await started.promise;
    const db=new DatabaseSync(f.dbPath);db.exec('DELETE FROM sessions');db.close();
    calendar.resolve({schemaVersion:'tenant-calendar-1',tenant:'alpha',timeZone:'Europe/London',asOf:'2026-09-19T15:02:00.000Z',maxAgeMs:300000});
    assert.equal((await pending).status,401);
  }finally{f.close();}
});

test('duplicate or incomplete team/source identity is rejected instead of a successful empty queue',async()=>{
  for(const change of [r=>{r.teams.push({...r.teams[0]});},r=>{delete r.teams[0].period;},r=>{r.teams[0].id='a'.repeat(161);},r=>{r.teams[0].sourceId='other';},r=>{r.teams[0].teamId='other';}]){
    const source=weekly();change(source);const f=fixture(async()=>null,'manager',{weeklySignoffSourceProvider:async()=>({status:200,body:source})});
    try{assert.equal((await call(f.engine,f.manager,'GET',WEEKLY_PATH+'?period=2026-09-07')).status,502);}finally{f.close();}
  }
});

test('absence nested source conflicts fail closed instead of disappearing from the queue',async()=>{
  for(const layer of ['state','request'])for(const conflict of [{tenant:'bravo'},{workflow:'weekly-signoff'},{partial:true},{complete:false}]){
    const source=bootstrap();Object.assign(layer==='state'?source.state:source.state.requests[0],conflict);
    const f=fixture(async()=>null,'manager',{absenceSourceProvider:async()=>({status:200,body:source})});
    try{const response=await call(f.engine,f.manager,'GET',ABSENCE_PATH);assert.equal(response.status,502);assert.equal(response.body.items,undefined);}finally{f.close();}
  }
});

test('interleaved workflow reads with identical source IDs keep separate workflow identity',async()=>{
  const absence=deferred(),signoff=deferred(),aBody=bootstrap(),wBody=weekly();
  aBody.state.requests[0].id='team-a';
  const f=fixture(async()=>null,'manager',{absenceSourceProvider:()=>absence.promise,weeklySignoffSourceProvider:()=>signoff.promise});
  try{
    const pendingAbsence=call(f.engine,f.manager,'GET',ABSENCE_PATH+'?sourceId=team-a');
    const pendingWeekly=call(f.engine,f.manager,'GET',WEEKLY_PATH+'?period=2026-09-07&sourceId=team-a');
    signoff.resolve({status:200,body:wBody});const weeklyResult=await pendingWeekly;
    absence.resolve({status:200,body:aBody});const absenceResult=await pendingAbsence;
    assert.equal(weeklyResult.body.items[0].binding.workflow,'weekly-signoff');
    assert.equal(absenceResult.body.unavailable[0].binding.workflow,'absence');
    assert.equal(absenceResult.body.items.length,0);
    assert.equal(absenceResult.body.scope.period,null);assert.equal(weeklyResult.body.scope.period,'2026-09-07');
  }finally{f.close();}
});

test('unsupported Time Review confirmation is unavailable, never a resolved or healthy empty queue',async()=>{
  const source=report();source.teams[0].issues[0].confirmation={state:'resolved',decisionId:'click',confirmedAt:'2026-09-19T15:00:00Z',auditRef:'invented'};
  const f=fixture(async()=>({status:200,body:source}));
  try{const result=await call(f.engine,f.manager);assert.equal(result.status,200);assert.deepEqual(result.body.items,[]);assert.equal(result.body.availability,'unavailable');assert.ok(result.body.unavailable[0].missingFields.includes('sourceAudit'));}finally{f.close();}
});

test('weekly teamId-only alias cannot become a healthy empty source response',async()=>{
  const source=weekly();source.teams[0].teamId=source.teams[0].id;delete source.teams[0].id;
  const f=fixture(async()=>null,'manager',{weeklySignoffSourceProvider:async()=>({status:200,body:source})});
  try{const result=await call(f.engine,f.manager,'GET',WEEKLY_PATH+'?period=2026-09-07');assert.equal(result.status,502);assert.equal(result.body.items,undefined);}finally{f.close();}
});

function pinnedActor(t,db,mode){
  const {execFileSync}=require('node:child_process'),{compileFunction}=require('node:vm');
  const archive=process.env.WFM_EVIDENCE_SEALED_ARCHIVE||path.resolve(__dirname,'../../artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
  if(!fs.existsSync(archive)){t.skip('Pinned actor/session proof unrun: canonical archive unavailable.');return null;}
  assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),'3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vector-pinned-actor-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  execFileSync('tar',['-xzf',archive,'-C',root]);
  const source=fs.readFileSync(path.join(root,'server.cjs'),'utf8');
  const cut=(start,end)=>{assert.equal(source.split(start).length,2);assert.equal(source.split(end).length,2);return source.slice(source.indexOf(start),source.indexOf(end));};
  // Execute the exact pinned actor, fingerprint and source-mode code, with real
  // SQLite and the pinned request-source resolver. Only secondary telemetry sinks
  // are inert; session deletion/update and audit INSERT are the original SQL.
  const code=cut('function tokenHash(t){','function kioskDevice(req){')+
    cut('const SESSION_CONTEXT_WINDOW_MS=','function json(res,code,body,headers={}){')+
    cut('const authSourceMode=','const authAbuse=')+'\nreturn actor;';
  db.exec(`CREATE TABLE personnel_links(email TEXT,staff_id TEXT,status TEXT);
    CREATE TABLE audit_events(tenant TEXT,actor TEXT,action TEXT,detail TEXT,created_at TEXT);`);
  for(const [name,ddl] of [['issued_at','INTEGER'],['last_seen','INTEGER'],['source_hash','TEXT'],['source_basis','TEXT'],['source_authoritative','INTEGER NOT NULL DEFAULT 0'],['client_hash','TEXT']])
    db.exec('ALTER TABLE sessions ADD COLUMN '+name+' '+ddl);
  return compileFunction(code,['db','E','RS','protection','process','createHash'])(db,
    require(path.join(root,'lib/engine.js')),require(path.join(root,'lib/request-source.cjs')),
    {observe(){},recordContainment(){}},{env:{WFM_AUTH_SOURCE_MODE:mode,WFM_TRUSTED_PROXY_IPS:'127.0.0.1'}},createHash);
}
function browserRequest(token,url=TIME_REVIEW_PATH){
  return {url,method:'GET',headers:{host:'fixture.invalid',cookie:'wfm_session='+token,'user-agent':'fixture-browser/1'},socket:{remoteAddress:'198.51.100.17'}};
}

for(const mode of ['direct','observe-only','trusted-proxy'])for(const workflow of ['time-review','absence','weekly-signoff']){
  test('default '+workflow+' read preserves the pinned '+mode+' session before any loopback forwarding',async t=>{
    let actor,reads=0;const source=http.createServer((req,res)=>{
      reads++;
      try{actor(req);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(workflow==='absence'?bootstrap():workflow==='weekly-signoff'?weekly():report()));}
      catch(error){res.writeHead(error.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
    });
    await new Promise(resolve=>source.listen(0,'127.0.0.1',resolve));
    const f=fixture(undefined,'manager',{source:{port:source.address().port,timeoutMs:1000}}),db=new DatabaseSync(f.dbPath);
    try{
      actor=pinnedActor(t,db,mode);if(!actor)return;
      const url=workflow==='absence'?ABSENCE_PATH:workflow==='weekly-signoff'?WEEKLY_PATH+'?period=2026-09-07':TIME_REVIEW_PATH;
      const req=browserRequest(f.manager,url);actor(req);
      const session=()=>db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(sha(f.manager))||null;
      const before=session(),res=response();await f.engine.handleRequest(req,res);
      assert.deepEqual({status:res.statusCode,reads,session:session()}, {status:503,reads:0,session:before});
      assert.equal(JSON.parse(res.body).code,'WFM_ACTION_EVIDENCE_SOURCE_READER_REQUIRED');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
    }finally{db.close();f.close();source.closeAllConnections();await new Promise(resolve=>source.close(resolve));}
  });
}

test('pinned direct actor still revokes genuine changed source plus client and records containment audit',t=>{
  const f=fixture(async()=>null),db=new DatabaseSync(f.dbPath);
  try{
    const actor=pinnedActor(t,db,'direct');if(!actor)return;
    actor(browserRequest(f.manager));
    const changed=browserRequest(f.manager);changed.socket.remoteAddress='127.0.0.1';changed.headers['user-agent']='wfm-workflow-action-evidence-bridge/1';
    assert.throws(()=>actor(changed),error=>error.status===401);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash=?').get(sha(f.manager)).n,0);
    assert.equal(db.prepare('SELECT action FROM audit_events').get().action,'session-revoked-context-divergence');
  }finally{db.close();f.close();}
});

test('pinned observe-only actor updates client metadata on a successful authenticated loopback read',t=>{
  const f=fixture(async()=>null),db=new DatabaseSync(f.dbPath);
  try{
    const actor=pinnedActor(t,db,'observe-only');if(!actor)return;
    actor(browserRequest(f.manager));const before=db.prepare('SELECT client_hash FROM sessions WHERE token_hash=?').get(sha(f.manager)).client_hash;
    const changed=browserRequest(f.manager);changed.socket.remoteAddress='127.0.0.1';changed.headers['user-agent']='wfm-workflow-action-evidence-bridge/1';
    assert.equal(actor(changed).tenant,'alpha');
    assert.notEqual(db.prepare('SELECT client_hash FROM sessions WHERE token_hash=?').get(sha(f.manager)).client_hash,before);
  }finally{db.close();f.close();}
});

test('weekly producer missing-evidence diagnostics survive the bridge for nested alias and temporal mismatches',async()=>{
  for(const change of [r=>{r.teams[0].signature.teamId='other';},r=>{r.audit[0].teamId='other';},r=>{r.teams[0].signature.at='2025-09-19T15:00:00.000Z';}]){
    const source=weekly();change(source);const f=fixture(async()=>null,'manager',{weeklySignoffSourceProvider:async()=>({status:200,body:source})});
    try{
      const result=await call(f.engine,f.manager,'GET',WEEKLY_PATH+'?period=2026-09-07&team=team-a&sourceId=team-a');
      assert.equal(result.status,200);assert.equal(result.body.availability,'unavailable');assert.deepEqual(result.body.items,[]);
      assert.equal(result.body.unavailable.length,1);assert.equal(result.body.unavailable[0].freshness.state,'unknown');
      assert.deepEqual(result.body.unavailable[0].binding,{workflow:'weekly-signoff',tenant:'alpha',teamId:'team-a',period:'2026-09-07',sourceId:'team-a'});
    }finally{f.close();}
  }
});
