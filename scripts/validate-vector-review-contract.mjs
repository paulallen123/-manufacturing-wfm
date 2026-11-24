#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawn,spawnSync} from 'node:child_process';

const root=process.cwd();
const artifact=path.join(root,'artifact','wfm-0.6.76-hosted-staging-rc1.tar.gz');
const overlay=fs.readFileSync(path.join(root,'ux-overlay','vector-review-contract.js'),'utf8');
const company=spawnSync('tar',['-xOf',artifact,'public/company-ui.js'],{encoding:'utf8'});
const intelligence=spawnSync('tar',['-xOf',artifact,'public/payroll-intelligence-ui.js'],{encoding:'utf8'});
assert.equal(company.status,0,company.stderr);
assert.equal(intelligence.status,0,intelligence.stderr);
for(const name of ['payrollActor','payrollReport','payrollPageV4','payrollShell','issueDialog','amendDialog'])assert.match(overlay,new RegExp(`function\\s+${name}\\b`),`missing ${name}`);
const retiredPresentationTokens=[
  ['Payroll','review','due','today'].join(' '),
  ['review','callout'].join('-'),
  ['review','layout'].join('-'),
  ['AUTOMATED','VALUE','DESK'].join(' ')
];
for(const forbidden of retiredPresentationTokens)assert.equal(overlay.includes(forbidden),false,`retired presentation token: ${forbidden}`);

const listeners=[];
const context={console,window:null,globalThis:null,location:{protocol:'http:'},identities:{manager:{id:'m2',name:'Manager',permissions:[]}},ui:{role:'manager',page:'overview'},F:{actor:{personId:'m2',role:'manager',permissions:[],costs:true},ready:false},OFFLINE:false,WFMPayroll:{has:(actor,permission)=>actor.permissions.includes(permission)},WFMWorkRules:{has:()=>false},WFMPayrollIntelligence:{},sampleActor:()=>({personId:'m2',role:'manager',permissions:[]}),me:()=>({permissions:[]}),request:async()=>({}),command:async()=>({}),render:async()=>{},shell:value=>value,heading:()=>'',esc:value=>String(value),button:()=>'',toast:()=>{},nav:()=>{},modal:()=>{},modalActions:()=>'',document:{addEventListener:(...args)=>listeners.push(args),getElementById:()=>({innerHTML:'',close(){}})},setTimeout:()=>0,clearTimeout:()=>{},URLSearchParams};
context.window=context;context.globalThis=context;
vm.createContext(context);
vm.runInContext(overlay,context,{filename:'vector-review-contract.js'});
assert.equal(vm.runInContext('payrollActor().personId',context),'m2');
vm.runInContext(company.stdout,context,{filename:'company-ui.js'});
vm.runInContext(intelligence.stdout,context,{filename:'payroll-intelligence-ui.js'});
assert.equal(vm.runInContext('configActor().personId',context),'m2');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vector-review-contract-'));
const unpack=spawnSync('tar',['--no-same-owner','-xzf',artifact,'-C',temp],{encoding:'utf8'});
assert.equal(unpack.status,0,unpack.stderr);
const db=path.join(temp,'state','review.sqlite');fs.mkdirSync(path.dirname(db),{recursive:true});
const port=37000+(process.pid%1000),origin=`http://127.0.0.1:${port}`,serverFile=path.join(temp,'server.cjs');
let server;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){server=spawn(process.execPath,[serverFile],{cwd:temp,env:{...process.env,PORT:String(port),WFM_DB:db},stdio:['ignore','pipe','pipe']});for(let i=0;i<80;i+=1){try{const response=await fetch(origin+'/api/health');if(response.ok)return;}catch{}await delay(100);}throw Error('runtime server did not become healthy');}
async function stop(){if(!server)return;server.kill('SIGTERM');await Promise.race([new Promise(resolve=>server.once('exit',resolve)),delay(2000)]);server=null;}
async function login(email){const response=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json','user-agent':'vector-review-contract'},body:JSON.stringify({email,password:'Factory-local-demo-2026!'})});assert.equal(response.status,200,await response.text());return response.headers.get('set-cookie').split(';')[0];}
async function api(cookie,url,options={}){const response=await fetch(origin+url,{...options,headers:{...(options.headers||{}),cookie,'user-agent':'vector-review-contract',...(options.method==='POST'?{origin,'content-type':'application/json'}:{})}});const body=await response.json();return {status:response.status,body};}
async function send(cookie,name,payload,version){return api(cookie,'/api/command',{method:'POST',body:JSON.stringify({command:name,payload,version})});}
async function stateVersion(cookie){return (await api(cookie,'/api/bootstrap')).body.state.version;}

try{
  await start();
  const manager=await login('leeds@northstar.example');
  const employee=await login('leeds-employee@northstar.example');
  let report=(await api(manager,'/api/weekly-review?period=2026-09-07')).body,team=report.teams[0];
  assert.equal(team.id,'s4');assert.equal(team.blockers.length,0);assert.equal(team.canSign,false);
  const rawBefore=JSON.stringify(team.records.map(row=>row.raw));
  const denied=await send(employee,'review-check',{period:report.period,team:team.id,revision:team.revision,category:'clocking',checked:true},await stateVersion(employee));
  assert.equal(denied.status,403);
  const firstVersion=await stateVersion(manager);
  let result=await send(manager,'review-check',{period:report.period,team:team.id,revision:team.revision,category:team.categories[0].id,checked:true},firstVersion);
  assert.equal(result.status,200,JSON.stringify(result.body));
  const stale=await send(manager,'review-check',{period:report.period,team:team.id,revision:team.revision,category:team.categories[1].id,checked:true},firstVersion);
  assert.equal(stale.status,409);
  report=(await api(manager,'/api/weekly-review?period=2026-09-07')).body;team=report.teams[0];
  for(const category of team.categories.filter(row=>!row.confirmed)){
    result=await send(manager,'review-check',{period:report.period,team:team.id,revision:team.revision,category:category.id,checked:true},await stateVersion(manager));
    assert.equal(result.status,200,JSON.stringify(result.body));
  }
  report=(await api(manager,'/api/weekly-review?period=2026-09-07')).body;team=report.teams[0];
  for(const person of team.employees){
    result=await send(manager,'review-check',{period:report.period,team:team.id,revision:team.revision,employee:person.id,checked:true},await stateVersion(manager));
    assert.equal(result.status,200,JSON.stringify(result.body));
  }
  report=(await api(manager,'/api/weekly-review?period=2026-09-07')).body;team=report.teams[0];assert.equal(team.canSign,true);
  result=await send(manager,'review-sign',{period:report.period,team:team.id,revision:team.revision,checked:true,attestation:'confirmed'},await stateVersion(manager));
  assert.equal(result.status,200,JSON.stringify(result.body));
  report=(await api(manager,'/api/weekly-review?period=2026-09-07')).body;team=report.teams[0];
  assert.equal(team.status,'signed');assert.ok(team.signature);assert.equal(JSON.stringify(team.records.map(row=>row.raw)),rawBefore);assert.ok(report.audit.some(row=>row.type==='team-signed'&&row.team===team.id));
  await stop();await start();
  const afterRestart=await login('leeds@northstar.example');
  report=(await api(afterRestart,'/api/weekly-review?period=2026-09-07')).body;team=report.teams[0];
  assert.equal(team.status,'signed');assert.ok(team.signature);assert.ok(report.audit.some(row=>row.type==='team-signed'&&row.team===team.id));
  console.log(JSON.stringify({status:'PASS',contract:'vector-review-contract-v1',runtimeArtifact:'3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d',authenticatedJourney:{team:team.id,categories:team.categories.length,employees:team.employees.length,state:team.status,restartPersistence:true,audit:true,rawEvidencePreserved:true},negativeChecks:{employeeAuthority:403,staleState:409},claimBoundary:'Authenticated local synthetic proof only; not rendered-browser, customer, provider-import, jurisdiction or production evidence.'},null,2));
}finally{await stop();fs.rmSync(temp,{recursive:true,force:true});}
