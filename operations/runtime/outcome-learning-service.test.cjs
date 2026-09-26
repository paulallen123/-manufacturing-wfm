'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createDecisionEpisode,selectDecisionOption,recordDecisionOutcome}=require('./decision-episode.cjs');
const {createOutcomeLearningService}=require('./outcome-learning-service.cjs');

function completed({tenant='A',trigger,actual}){
  const episode=createDecisionEpisode({
    tenant,site:'S1',decisionType:'absence-recovery',triggerId:trigger,
    triggeredAt:new Date().toISOString(),contextRevision:'ctx-'+trigger,mode:'HUMAN_APPROVAL',
    sourceEvidence:['attendance:'+trigger,'demand:'+trigger],
    objective:{labourCost:1,uncertaintyPenalty:.1},
    options:[
      {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.05,prediction:{labourCost:500}},
      {id:'overtime',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.05,prediction:{labourCost:300}}
    ]
  });
  const selected=selectDecisionOption(episode,{
    optionId:'overtime',selectedAt:new Date().toISOString(),
    actorRef:'manager@example.invalid',authorityDecision:'HUMAN_APPROVED'
  });
  return recordDecisionOutcome(selected,{
    observedAt:new Date().toISOString(),
    evidenceRefs:['payroll:result:'+trigger,'mes:result:'+trigger],
    actual:{labourCost:actual}
  });
}

function verifiedInput(trigger,actual,tenant='A'){
  return {
    episode:completed({tenant,trigger,actual}),
    metric:'labourCost',
    direction:'MINIMIZE',
    classification:'VERIFIED_OPERATIONAL',
    baselineActual:520,
    baselineEvidenceRefs:['payroll:baseline:'+trigger]
  };
}

test('verified operational learning persists across restart without granting authority',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-outcome-learning-'));
  const dbPath=path.join(dir,'proof.sqlite');
  const engineModulePath=path.resolve(__dirname,'../../adaptive-intelligence/engine.mjs');

  let service=createOutcomeLearningService({dbPath,engineModulePath});
  await service.ready();

  const inputs=[
    verifiedInput('win-1',320),
    verifiedInput('win-2',315),
    verifiedInput('win-3',310)
  ];
  const receipts=[];
  for(const input of inputs) receipts.push(await service.recordOutcome(input));
  assert.ok(receipts.every(x=>x.duplicate===false));

  const duplicate=await service.recordOutcome(inputs[0]);
  assert.equal(duplicate.duplicate,true,'same proof must be idempotent');

  const before=await service.snapshotForTenant('A');
  assert.equal(before.outcomes.length,3);
  assert.equal(before.skills.length,1);
  assert.equal(before.skills[0].status,'candidate');
  assert.equal(before.skills[0].authority,'none');
  assert.equal(before.skills[0].verifiedWinCount,3);

  await assert.rejects(
    service.recordOutcome({
      episode:completed({tenant:'A',trigger:'simulated',actual:320}),
      metric:'labourCost',direction:'MINIMIZE',classification:'SIMULATED'
    }),
    /verified|learning/i
  );

  service.close();

  service=createOutcomeLearningService({dbPath,engineModulePath});
  await service.ready();
  const after=await service.snapshotForTenant('A');
  assert.equal(after.outcomes.length,3,'persisted proofs must replay exactly once');
  assert.equal(after.skills.length,1,'restart must recreate one candidate, not duplicate it');
  assert.equal(after.skills[0].authority,'none');
  assert.equal(after.skills[0].verifiedWinCount,3);

  const other=await service.snapshotForTenant('B');
  assert.deepEqual(other.outcomes,[]);
  assert.deepEqual(other.skills,[]);
  assert.deepEqual(other.evals,[]);

  service.close();
  fs.rmSync(dir,{recursive:true,force:true});
});


test('HTTP outcome learning route is internal-write and tenant-scoped manager-read',async()=>{
  const {createHash}=require('node:crypto');
  const {DatabaseSync}=require('node:sqlite');
  const http=require('node:http');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-outcome-learning-http-'));
  const dbPath=path.join(dir,'proof.sqlite');
  const engineModulePath=path.resolve(__dirname,'../../adaptive-intelligence/engine.mjs');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
  const tokenA='a'.repeat(64),tokenB='b'.repeat(64);
  const hash=v=>createHash('sha256').update(v).digest('hex');
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('manager-a@example.invalid','A','manager');
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('manager-b@example.invalid','B','manager');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(tokenA),'manager-a@example.invalid',Date.now()+60000);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(tokenB),'manager-b@example.invalid',Date.now()+60000);
  db.close();

  const service=createOutcomeLearningService({dbPath,engineModulePath,internalToken:'trusted-learning-worker'});
  await service.ready();
  const server=http.createServer(async(req,res)=>{
    if(!await service.handleRequest(req,res)){res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  async function post(body,headers={}){
    return fetch(origin+'/api/learning/outcomes/record',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  }

  const denied=await post(verifiedInput('http-denied',320));
  assert.equal(denied.status,403);

  for(const [trigger,actual] of [['http-1',320],['http-2',315],['http-3',310]]){
    const response=await post(verifiedInput(trigger,actual),{'x-wfm-learning-internal':'trusted-learning-worker'});
    assert.equal(response.status,200);
  }

  const a=await fetch(origin+'/api/learning/outcomes/status',{headers:{cookie:'wfm_session='+tokenA}});
  assert.equal(a.status,200);
  const aBody=await a.json();
  assert.equal(aBody.tenant,'A');
  assert.equal(aBody.snapshot.outcomes.length,3);
  assert.equal(aBody.snapshot.skills.length,1);
  assert.equal(aBody.snapshot.skills[0].authority,'none');

  const b=await fetch(origin+'/api/learning/outcomes/status',{headers:{cookie:'wfm_session='+tokenB}});
  assert.equal(b.status,200);
  const bBody=await b.json();
  assert.equal(bBody.tenant,'B');
  assert.deepEqual(bBody.snapshot.outcomes,[]);
  assert.deepEqual(bBody.snapshot.skills,[]);

  const unauth=await fetch(origin+'/api/learning/outcomes/status');
  assert.equal(unauth.status,401);

  service.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(dir,{recursive:true,force:true});
});
