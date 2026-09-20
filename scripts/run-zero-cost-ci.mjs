#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const checks = [
  'scripts/validate-deployment.mjs',
  'scripts/validate-resilience-scenarios.mjs',
  'scripts/validate-autonomous-recovery-proof.mjs',
  'scripts/validate-autonomous-recovery-matrix.mjs',
  'scripts/validate-support-incident-recovery-proof.mjs',
  'scripts/validate-provider-recovery-authority-proof.mjs',
  'scripts/validate-provider-recovery-handoff-prototype.mjs',
  'scripts/validate-vector-only-ui.mjs',
  'scripts/validate-onedrive-sync-guardian.mjs',
  'scripts/validate-release-policy.mjs',
  'scripts/validate-product-factory.mjs',
  'scripts/validate-self-evolution.mjs'
];

const requested=Number(process.env.WFM_CI_PARALLELISM||0);
const detected=typeof os.availableParallelism==='function'?os.availableParallelism():os.cpus().length;
const parallelism=Math.max(1,Math.min(checks.length,requested>0?requested:Math.min(4,Math.max(2,detected))));
const started=performance.now();
const results=new Array(checks.length);
let nextIndex=0;

function runCheck(check,index){
  return new Promise(resolve=>{
    const t0=performance.now();
    console.log(`\n=== START ${check} ===`);
    const child=spawn(process.execPath,[check],{env:process.env,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',chunk=>process.stdout.write(`[${index+1}/${checks.length} ${check}] ${chunk}`));
    child.stderr.on('data',chunk=>process.stderr.write(`[${index+1}/${checks.length} ${check}] ${chunk}`));
    child.on('error',error=>resolve({check,status:'ERROR',code:1,durationMs:Math.round(performance.now()-t0),error:String(error)}));
    child.on('close',(code,signal)=>resolve({check,status:code===0?'PASS':'FAIL',code:code??1,signal:signal||null,durationMs:Math.round(performance.now()-t0)}));
  });
}

async function worker(){
  while(true){
    const index=nextIndex++;
    if(index>=checks.length) return;
    results[index]=await runCheck(checks[index],index);
  }
}

await Promise.all(Array.from({length:parallelism},()=>worker()));
const elapsedMs=Math.round(performance.now()-started);
const summedMs=results.reduce((n,r)=>n+(r?.durationMs||0),0);
const failures=results.filter(r=>r?.status!=='PASS');
const metrics={
  schemaVersion:1,
  status:failures.length?'FAIL':'PASS',
  generatedAt:new Date().toISOString(),
  parallelism,
  detectedParallelism:detected,
  checkCount:checks.length,
  elapsedMs,
  summedCheckMs:summedMs,
  effectiveConcurrency:Number((summedMs/Math.max(1,elapsedMs)).toFixed(2)),
  checks:results
};
fs.writeFileSync('zero-cost-ci-metrics.json',JSON.stringify(metrics,null,2)+'\n');
console.log(`\nZERO_COST_CI_METRICS=elapsed_ms:${elapsedMs}|sum_ms:${summedMs}|parallelism:${parallelism}|effective_concurrency:${metrics.effectiveConcurrency}`);

if(failures.length){
  console.error('ZERO_COST_CORE_CI=FAIL');
  for(const failure of failures) console.error(`${failure.check}: ${failure.status} (code=${failure.code}, duration_ms=${failure.durationMs})`);
  process.exit(1);
}
console.log('ZERO_COST_CORE_CI=PASS');
