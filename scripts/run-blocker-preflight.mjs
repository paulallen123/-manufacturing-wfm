#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const checks=[
  {id:'proof-lane-policy',command:process.execPath,args:['scripts/validate-proof-lane-policy.mjs']},
  {id:'blocker-autopilot',command:process.execPath,args:['--test','resilience/blocker-autopilot.test.cjs']},
  {id:'integration-catalog',command:process.execPath,args:['integration-fabric/scripts/validate.mjs']},
  {id:'integration-evidence-continuity',command:process.execPath,args:['scripts/validate-integration-evidence-continuity.mjs']},
  {id:'deployment-contract',command:process.execPath,args:['scripts/validate-deployment.mjs']},
  {id:'vector-ui-contract',command:process.execPath,args:['scripts/validate-vector-only-ui.mjs']},
  {id:'asset-provenance-fixture',command:process.execPath,args:['--test','scripts/prove-vector-built-asset-provenance.test.mjs']},
  {id:'training-manifest-syntax',command:process.execPath,args:['--check','learning/runtime/training-workflow-manifest.cjs']}
];

function run(check){
  return new Promise(resolve=>{
    const started=Date.now();
    const child=spawn(check.command,check.args,{env:process.env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',d=>{stdout+=d.toString(); if(stdout.length>12000) stdout=stdout.slice(-12000);});
    child.stderr.on('data',d=>{stderr+=d.toString(); if(stderr.length>12000) stderr=stderr.slice(-12000);});
    child.on('error',error=>resolve({...check,status:'ERROR',code:null,durationMs:Date.now()-started,stdout,stderr:String(error.message||error)}));
    child.on('close',code=>resolve({...check,status:code===0?'PASS':'FAIL',code,durationMs:Date.now()-started,stdout,stderr}));
  });
}

const results=await Promise.all(checks.map(run));
const failed=results.filter(r=>r.status!=='PASS');
const report={
  contract:'VECTOR_FAST_BLOCKER_PREFLIGHT_V1',
  result:failed.length?'FAIL':'PASS',
  checks:results.map(({id,status,code,durationMs,stdout,stderr})=>({
    id,status,code,durationMs,
    outputDigestInput:(stdout+'\n'+stderr).slice(-4000)
  })),
  failedChecks:failed.map(r=>r.id),
  productionMutation:false,
  productionAuthorityGranted:false
};
fs.writeFileSync('blocker-preflight-report.json',JSON.stringify(report,null,2)+'\n');
for(const r of results){
  console.log('\n=== PREFLIGHT '+r.id+' '+r.status+' '+r.durationMs+'ms ===');
  if(r.status!=='PASS'){
    if(r.stdout) console.log(r.stdout.slice(-4000));
    if(r.stderr) console.error(r.stderr.slice(-4000));
  }
}
console.log('\nVECTOR_FAST_BLOCKER_PREFLIGHT='+report.result+' failed='+report.failedChecks.join(','));
if(failed.length) process.exit(1);
