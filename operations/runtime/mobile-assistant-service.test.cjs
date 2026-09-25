'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createMobileAssistantService}=require('./mobile-assistant-service.cjs');

function sha(v){return createHash('sha256').update(String(v)).digest('hex');}
function request(body){
  const r=Readable.from([Buffer.from(JSON.stringify(body))]);
  r.method='POST';r.url='/api/mobile/assistant';r.headers={cookie:'wfm_session=session-token'};return r;
}
function response(){
  return {statusCode:200,headers:{},body:'',setHeader(k,v){this.headers[k]=v;},end(v=''){this.body+=String(v);this.writableEnded=true;},get headersSent(){return false;}};
}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vecta-assistant-'));
  const dbPath=path.join(dir,'db.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('manager@example.test','alpha','manager');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha('session-token'),'manager@example.test',Date.now()+60000);
  db.close();
  return {dir,dbPath};
}
const episode={
  episodeId:'ep-1',decisionType:'absence-recovery',site:'Line 1',triggeredAt:'2026-09-25T12:00:00.000Z',contextRevision:'ctx-1',
  recommendation:{optionId:'agency-1',reason:'RANKED'},
  options:[
    {id:'do-nothing',label:'Do nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.1,prediction:{},reasonCodes:[],evidenceRefs:[]},
    {id:'agency-1',label:'Use approved agency cover',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.1,prediction:{},reasonCodes:['coverage'],evidenceRefs:['e1']}
  ],
  sourceEvidence:['absence:a']
};

test('assistant cannot turn a model tool call into execution authority',async()=>{
  const {dir,dbPath}=fixture();
  const fakeFetch=async()=>({
    ok:true,status:200,
    async text(){return JSON.stringify({output:[{type:'function_call',name:'prepare_recommendation_action',arguments:JSON.stringify({episodeId:'ep-1',optionId:'agency-1'})}]});}
  });
  const service=createMobileAssistantService({
    dbPath,apiKey:'test-key',fetchImpl:fakeFetch,
    decisionService:{recentEpisodes(){return [episode];}}
  });
  const res=response();
  await service.handleRequest(request({message:'Yes, do that',language:'en-GB'}),res);
  assert.equal(res.statusCode,200);
  const body=JSON.parse(res.body);
  assert.equal(body.actionProposal.episodeId,'ep-1');
  assert.equal(body.actionProposal.requiresDeviceConfirmation,true);
  assert.equal(body.actionProposal.execute,true);
  assert.equal(body.actionProposal.decision,'APPROVE');
  assert.equal(body.execution,undefined);
  service.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('assistant rejects provider action ids outside live Vecta context',async()=>{
  const {dir,dbPath}=fixture();
  const fakeFetch=async()=>({
    ok:true,status:200,
    async text(){return JSON.stringify({output:[{type:'function_call',name:'prepare_recommendation_action',arguments:JSON.stringify({episodeId:'made-up',optionId:'agency-1'})}]});}
  });
  const service=createMobileAssistantService({
    dbPath,apiKey:'test-key',fetchImpl:fakeFetch,
    decisionService:{recentEpisodes(){return [episode];}}
  });
  const res=response();
  await service.handleRequest(request({message:'Do it',language:'en-GB'}),res);
  assert.equal(res.statusCode,409);
  assert.match(JSON.parse(res.body).error,/not valid/i);
  service.close();fs.rmSync(dir,{recursive:true,force:true});
});
