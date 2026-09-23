#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function arg(name,fallback=null){
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback;
}
function git(args){
  const r=spawnSync('git',args,{encoding:'utf8'});
  if(r.status!==0) throw new Error((r.stderr||r.stdout||'git failed').trim());
  return String(r.stdout||'').trim();
}

const base=arg('--base',process.env.VECTOR_DRIFT_BASE||'origin/feature/vector-eow-convergence-20260925');
const head=arg('--head','HEAD');
const maxBehind=Number(arg('--max-behind',process.env.VECTOR_MAX_BEHIND_COMMITS||'10'));
const warnBehind=Number(arg('--warn-behind',process.env.VECTOR_WARN_BEHIND_COMMITS||'5'));

let counts;
try{
  counts=git(['rev-list','--left-right','--count',base+'...'+head]).split(/\s+/).map(Number);
}catch(error){
  console.error(JSON.stringify({
    contract:'VECTOR_BRANCH_DRIFT_GUARD_V1',
    result:'NO_PROOF',
    base,head,
    reason:'BASE_OR_HEAD_UNAVAILABLE',
    detail:String(error.message||error)
  }));
  process.exit(2);
}
const [behind,ahead]=counts;
const mergeBase=git(['merge-base',base,head]);
const result=behind>maxBehind?'FAIL':behind>warnBehind?'WARN':'PASS';
const report={
  contract:'VECTOR_BRANCH_DRIFT_GUARD_V1',
  result,base,head,mergeBase,behind,ahead,
  warnBehind,maxBehind,
  action:result==='FAIL'?'SYNC_THEN_REPROVE':result==='WARN'?'SYNC_SOON':'CONTINUE'
};
console.log('VECTOR_BRANCH_DRIFT='+JSON.stringify(report));
if(result==='FAIL') process.exit(1);
