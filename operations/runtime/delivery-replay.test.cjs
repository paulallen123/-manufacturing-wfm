'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fork}=require('node:child_process');const path=require('node:path');
const {input,fixture,verifierFor,serviceFor,rows}=require('./delivery-replay-fixture.cjs');
function observe(child,type){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Child did not report '+type)),5000);
 const listener=message=>{if(message.type===type){clearTimeout(timer);child.off('message',listener);resolve(message);}};
 child.on('message',listener);child.once('error',error=>{clearTimeout(timer);reject(error);});
});}
test('REGRESSION: concurrent exact replay commits once and returns one creation plus one idempotent result',async()=>{
 const f=fixture(),snapshot=input(),setup=serviceFor(f,verifierFor(snapshot));setup.close();
 const children=[0,1].map(()=>fork(path.join(__dirname,'delivery-replay-worker.cjs'),[],{stdio:['ignore','pipe','pipe','ipc']}));
 const outputs=children.map(child=>{const stdout=[],stderr=[];child.stdout.on('data',b=>stdout.push(b));child.stderr.on('data',b=>stderr.push(b));return {stdout,stderr};});
 try{
  const ready=children.map(c=>observe(c,'ready'));children.forEach(c=>c.send({type:'init',dbPath:f.dbPath,snapshot}));await Promise.all(ready);
  const entered=children.map(c=>observe(c,'verifier-entered'));children.forEach(c=>c.send({type:'start'}));await Promise.all(entered);
  // A real SQLite writer lock lets both services perform their cache lookup
  // before either transaction can commit. No production instrumentation/mocks.
  f.db.exec('BEGIN IMMEDIATE');
  const completed=children.map(c=>observe(c,'result'));children.forEach(c=>c.send({type:'release-verifier'}));
  await new Promise(r=>setTimeout(r,250));f.db.exec('COMMIT');
  const responses=await Promise.all(completed),statuses=responses.map(r=>r.response?.status).sort();
  assert.equal(rows(f).length,1);
  assert.deepEqual(statuses,[200,201],`Concurrent responses: ${JSON.stringify(responses.map(r=>r.response||r.error))}`);
 }finally{children.forEach(c=>{if(!c.killed)c.kill();});f.close();}
});
test('locked writer returns retryable 503 without a partial wrapper or episode',async()=>{
 const f=fixture(),snapshot=input(),service=serviceFor(f,verifierFor(snapshot));
 try{
  f.db.exec('BEGIN IMMEDIATE');
  const response=await require('./delivery-replay-fixture.cjs').post(service,snapshot);
  assert.equal(response.status,503);
  f.db.exec('ROLLBACK');
  assert.equal(rows(f).length,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM vector_decision_episodes').get().n,0);
 }finally{try{f.db.exec('ROLLBACK');}catch{}service.close();f.close();}
});
