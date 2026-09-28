import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const WORKER=String.raw`
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [modulePath,id,statePath,anchorPath,barrierDir,sizeText]=process.argv.slice(1);
const {AtomicSupervisorStateStore}=await import(pathToFileURL(modulePath).href);
const sleep=(ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
const waitFor=(predicate,label)=>{const deadline=Date.now()+10000;while(!predicate()){if(Date.now()>deadline)throw new Error('timeout '+label);sleep(2);}};
const lockPath=anchorPath+'.lock';
const anchor={
  current(){
    const value=Number(fs.readFileSync(anchorPath,'utf8'));
    fs.writeFileSync(path.join(barrierDir,'ready-'+id),'');
    waitFor(()=>fs.existsSync(path.join(barrierDir,'go')),'go');
    return value;
  },
  advance(expected){
    fs.writeFileSync(path.join(barrierDir,'advance-'+id),'');
    waitFor(()=>fs.existsSync(path.join(barrierDir,'advance-A'))&&fs.existsSync(path.join(barrierDir,'advance-B')),'advance barrier');
    if(id==='B') sleep(100);
    waitFor(()=>{try{fs.mkdirSync(lockPath);return true;}catch(e){if(e.code==='EEXIST')return false;throw e;}},'anchor lock');
    try{
      const current=Number(fs.readFileSync(anchorPath,'utf8'));
      if(current!==expected) throw new Error('rollback anchor compare-and-set mismatch');
      const tmp=anchorPath+'.'+process.pid+'.tmp';
      fs.writeFileSync(tmp,String(current+1));
      fs.renameSync(tmp,anchorPath);
      return current+1;
    }finally{fs.rmdirSync(lockPath);}
  }
};
const key=Buffer.alloc(32,0x41);
const store=new AtomicSupervisorStateStore({filePath:statePath,integrityKeys:{k1:key},activeKeyId:'k1',rollbackAnchor:anchor});
const payloadSize=Number(sizeText);
try{
  store.save({writer:id,padding:'x'.repeat(payloadSize)});
  process.stdout.write(JSON.stringify({ok:true,id}));
}catch(error){
  process.stdout.write(JSON.stringify({ok:false,id,error:error.message,recovery:store.requiresRecovery()}));
  process.exitCode=2;
}
`;

function child(modulePath,id,statePath,anchorPath,barrierDir,payloadSize){
  const cp=spawn(process.execPath,['--input-type=module','-e',WORKER,modulePath,id,statePath,anchorPath,barrierDir,String(payloadSize)],{stdio:['ignore','pipe','pipe']});
  let out='',err='';
  cp.stdout.on('data',c=>out+=c); cp.stderr.on('data',c=>err+=c);
  return {cp,result:new Promise(resolve=>cp.on('close',code=>resolve({code,out,err})))};
}
function waitUntil(predicate,timeoutMs=10000){
  return new Promise((resolve,reject)=>{const start=Date.now();const poll=()=>{if(predicate())return resolve();if(Date.now()-start>timeoutMs)return reject(new Error('barrier timeout'));setTimeout(poll,2);};poll();});
}

test('cross-process stale writer cannot publish after losing rollback-anchor CAS',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-source-race-'));
  const statePath=path.join(dir,'supervisor.json');
  const anchorPath=path.join(dir,'anchor.txt');
  const barrierDir=path.join(dir,'barrier'); fs.mkdirSync(barrierDir); fs.writeFileSync(anchorPath,'0');
  const modulePath=fileURLToPath(new URL('./durable-source-supervisor.mjs',import.meta.url));
  const a=child(modulePath,'A',statePath,anchorPath,barrierDir,0);
  const b=child(modulePath,'B',statePath,anchorPath,barrierDir,2*1024*1024);
  await waitUntil(()=>fs.existsSync(path.join(barrierDir,'ready-A'))&&fs.existsSync(path.join(barrierDir,'ready-B')));
  fs.writeFileSync(path.join(barrierDir,'go'),'');
  const [ra,rb]=await Promise.all([a.result,b.result]);
  const parsed=[ra,rb].map(r=>({raw:r,...JSON.parse(r.out)}));
  const winners=parsed.filter(r=>r.ok); const losers=parsed.filter(r=>!r.ok);
  assert.equal(winners.length,1,JSON.stringify(parsed));
  assert.equal(losers.length,1,JSON.stringify(parsed));
  assert.equal(winners[0].id,'A',JSON.stringify(parsed));
  assert.match(losers[0].error,/compare-and-set mismatch/);
  assert.equal(losers[0].recovery,true);
  assert.equal(fs.readFileSync(anchorPath,'utf8'),'1');
  const canonical=JSON.parse(fs.readFileSync(statePath,'utf8'));
  assert.equal(canonical.rollbackGeneration,1);
  assert.equal(canonical.state.writer,'A','losing writer must never replace canonical state');
});
