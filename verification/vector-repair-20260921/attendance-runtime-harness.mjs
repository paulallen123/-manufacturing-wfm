import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Test-only instrumentation reports the address of this child's actual listener
// over its private IPC channel. No reserve/close/rebind race or fixed port exists.
const childEntry = `
const http=require('node:http');
const listen=http.Server.prototype.listen;
http.Server.prototype.listen=function(...args){
  this.once('listening',()=>{
    if(process.send)process.send({type:'attendance-runtime-listening',pid:process.pid,address:this.address()});
  });
  return listen.apply(this,args);
};
require(process.argv[1]);
`;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,ms,message){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]);}
  finally{clearTimeout(timer);}
}

export function createAttendanceRuntime({runtime,database,startupBudgetMs=Number(process.env.WFM_PROOF_STARTUP_BUDGET_MS||30000)}){
  if(!Number.isFinite(startupBudgetMs)||startupBudgetMs<=0)throw Error('Invalid attendance startup deadline.');
  let current;
  async function stop(){
    const child=current;
    if(!child)return;
    if(!child.exited)child.process.kill('SIGTERM');
    try{await bounded(child.closed,2000,'Attendance runtime did not stop after SIGTERM.');}
    catch{
      if(!child.exited)child.process.kill('SIGKILL');
      await bounded(child.closed,2000,'Attendance runtime could not be reaped.');
    }
    if(current===child)current=undefined;
  }
  async function start(){
    if(current&&!current.exited)throw Error('An attendance test runtime is already active.');
    if(current)await stop();
    const loader=path.join(runtime,'local-paths.cjs');
    const args=[...(fs.existsSync(loader)?['--require',loader]:[]),'-e',childEntry,path.join(runtime,'security-runtime/bootstrap.cjs')];
    const child={process:spawn(process.execPath,args,{
      cwd:runtime,
      env:{...process.env,PORT:'0',WFM_DB:database,WFM_HOSTED_STAGING:'false',NODE_ENV:'test'},
      stdio:['ignore','pipe','pipe','ipc']
    }),exited:false,diagnostics:'',origin:'',failure:null};
    current=child;
    child.closed=new Promise(resolve=>child.process.once('close',resolve));
    child.process.once('exit',()=>{child.exited=true;});
    child.process.once('error',error=>{child.failure=error;});
    for(const [name,stream] of [['stdout',child.process.stdout],['stderr',child.process.stderr]]){
      stream.on('data',data=>{child.diagnostics=(child.diagnostics+'['+name+'] '+data).slice(-16384);});
    }
    child.process.on('message',message=>{
      if(message?.type!=='attendance-runtime-listening')return;
      const address=message.address;
      if(message.pid!==child.process.pid||address?.address!=='127.0.0.1'||!Number.isInteger(address.port)||address.port<=0){
        child.failure=Error('Attendance runtime reported an invalid owned loopback listener.');return;
      }
      child.origin='http://127.0.0.1:'+address.port;
    });
    const deadline=Date.now()+startupBudgetMs;
    try{
      while(Date.now()<deadline){
        if(child.failure)throw child.failure;
        if(child.exited)throw Error('Attendance runtime exited before readiness.');
        if(child.origin){
          try{
            const response=await fetch(child.origin+'/api/health',{signal:AbortSignal.timeout(Math.max(1,Math.min(1000,deadline-Date.now())))});
            const healthy=response.ok;
            await response.body?.cancel();
            if(healthy&&!child.exited&&!child.failure)return child.origin;
          }catch{}
        }
        const remaining=deadline-Date.now();
        if(remaining>0)await delay(Math.min(50,remaining));
      }
      throw Error('Attendance runtime did not become healthy within '+startupBudgetMs+'ms.');
    }catch(error){
      await stop();
      throw Error(error.message+'\n'+child.diagnostics);
    }
  }
  return {start,stop,get origin(){return current?.origin||'';},get pid(){return current?.process.pid;}};
}
