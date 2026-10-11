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
function fixture(sourceProvider,role='manager'){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-action-bridge-'));
  const dbPath=path.join(dir,'db.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);");
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha',1,'{}');
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
    env:{WFM_TENANT_TIMEZONE:'Europe/London',WFM_TODAY_MAX_AGE_MS:'300000'}
  });
  return {engine,manager,employee,bravo,close(){engine.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function report(overrides={}){
  return {
    tenant:'alpha',
    generatedAt:'2026-09-19T15:00:00.000Z',
    authorityRequired:'Manager time-review decision',
    teams:[{id:'team-a',issues:[
      {id:'issue-1',status:'open',reasonCode:'MISSED_CLOCK_OUT',title:'Alex · missed clock-out'},
      {id:'closed-1',status:'resolved',reasonCode:'MISSED_CLOCK_IN'}
    ]}],
    ...overrides
  };
}

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

test('default source reader preserves hosted reverse-proxy protocol context',async()=>{
  let seen=null;
  const source=http.createServer((req,res)=>{
    seen={host:req.headers.host,proto:req.headers['x-forwarded-proto'],cookie:req.headers.cookie,url:req.url};
    res.statusCode=200;
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(report()));
  });
  await new Promise((resolve,reject)=>{
    source.once('error',reject);
    source.listen(0,'127.0.0.1',resolve);
  });
  try{
    const port=source.address().port;
    const result=await fetchAuthoritativeTimeReview({
      headers:{
        host:'wfm-ci.invalid',
        cookie:'wfm_session=test-session',
        'x-forwarded-proto':'https'
      },
      socket:{localPort:port},
      url:TIME_REVIEW_PATH+'?period=2026-09-07'
    },{port,timeoutMs:1000});
    assert.equal(result.status,200);
    assert.equal(result.body.tenant,'alpha');
    assert.deepEqual(seen,{
      host:'wfm-ci.invalid',
      proto:'https',
      cookie:'wfm_session=test-session',
      url:'/api/weekly-review?period=2026-09-07'
    });
  }finally{
    await new Promise(resolve=>source.close(resolve));
  }
});


test('default source reader binds action evidence to weekly review and forwards the requested period',async()=>{
  let seenUrl=null;
  const source=http.createServer((req,res)=>{
    seenUrl=req.url;
    res.statusCode=200;
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(report()));
  });
  await new Promise((resolve,reject)=>{
    source.once('error',reject);
    source.listen(0,'127.0.0.1',resolve);
  });
  try{
    const port=source.address().port;
    const result=await fetchAuthoritativeTimeReview({
      headers:{host:'wfm-ci.invalid',cookie:'wfm_session=test-session','x-forwarded-proto':'https'},
      socket:{localPort:port},
      url:TIME_REVIEW_PATH+'?period=2026-09-07'
    },{port,timeoutMs:1000});
    assert.equal(result.status,200);
    assert.equal(seenUrl,'/api/weekly-review?period=2026-09-07');
  }finally{
    await new Promise(resolve=>source.close(resolve));
  }
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
