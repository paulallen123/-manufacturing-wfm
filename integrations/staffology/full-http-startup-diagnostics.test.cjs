'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {EventEmitter}=require('node:events');
const vm=require('node:vm');
const source=readFileSync(process.env.STAFFOLOGY_STARTUP_SOURCE||join(__dirname,'independent/full-http-employee-journey.test.cjs'),'utf8');
const startSource=source.slice(source.indexOf('async function start('),source.indexOf('\nasync function stop('));
assert.match(startSource,/^async function start\(/);
async function exercise(probe){
 const child={stdout:new EventEmitter(),stderr:new EventEmitter(),exitCode:null,signalCode:null,kills:[],kill(signal){this.kills.push(signal);}};
 let probes=0,sleeps=[];
 const context={assert,join,runtime:'/synthetic/runtime',candidateSha:'a'.repeat(40),configuration:'[]',privateEvidenceDirectory:'/synthetic/evidence',profile:()=>('{}'),process:{execPath:process.execPath,env:{}},spawn:()=>child,fetch:async()=>{probes++;return probe(child);},sleep:async ms=>{sleeps.push(ms);},Date};
 const start=vm.runInNewContext('('+startSource+')',context);
 let error;try{await start('/synthetic/db',4700,'/synthetic/preload','/synthetic/requests');}catch(e){error=e;}
 return {child,probes,sleeps,error};
}
test('startup diagnostics distinguish 503 while retaining the existing poll budget',async()=>{
 const r=await exercise(()=>({status:503,ok:false}));
 assert.match(r.error?.message||'',/phase=unhealthy-response; attempts=400; elapsedMs=\d+; lastHealthStatus=503; lastProbeError=none/);
 assert.equal(r.probes,400);assert.equal(r.sleeps.length,400);assert.equal(r.sleeps.every(ms=>ms===25),true);assert.deepEqual(r.child.kills,['SIGKILL']);
});
test('startup diagnostics distinguish connection refusal without printing transport message secrets',async()=>{
 const r=await exercise(()=>{throw Object.assign(Error('secret-invalid-url'),{cause:{code:'ECONNREFUSED'}});});
 assert.match(r.error?.message||'',/phase=no-health-response; attempts=400; elapsedMs=\d+; lastHealthStatus=none; lastProbeError=ECONNREFUSED/);
 assert.equal(r.error.message.includes('secret-invalid-url'),false);assert.equal(r.probes,400);
});
test('startup diagnostic output retains a bounded tail',async()=>{
 const r=await exercise(child=>{child.stderr.emit('data','x'.repeat(20000)+'END');return {status:503,ok:false};});
 assert.equal(r.error.message.split('; output=')[1]?.length,16384);assert.match(r.error.message,/END$/);
});
test('successful health still returns immediately without killing child or spending poll budget',async()=>{
 const r=await exercise(()=>({status:200,ok:true}));assert.equal(r.error,undefined);assert.equal(r.probes,1);assert.equal(r.sleeps.length,0);assert.deepEqual(r.child.kills,[]);
});
