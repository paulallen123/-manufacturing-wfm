import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'DEPLOYMENT_MANIFEST.json'),'utf8'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-provider-handoff-diagnostic-'));
try{
  execFileSync('tar',['-xzf',path.join(root,manifest.runtime_artifact),'-C',tmp]);
  const PRA=require(path.join(tmp,'lib','provider-recovery-authority.cjs'));
  const server=fs.readFileSync(path.join(tmp,'server.cjs'),'utf8');
  const recoverySource=fs.readFileSync(path.join(tmp,'lib','provider-recovery-authority.cjs'),'utf8');
  const investigationSource=fs.readFileSync(path.join(tmp,'lib','provider-investigation.cjs'),'utf8');
  const snippets=[];
  for(const needle of ['issueRecoveryPermit','executeRecoveryPermit','recoveryEvents','provider-recovery']){
    let at=0;
    while((at=server.indexOf(needle,at))!==-1){snippets.push({needle,source:server.slice(Math.max(0,at-900),Math.min(server.length,at+1800))});at+=needle.length;}
  }
  const execAt=recoverySource.indexOf('function executePermit');
  const connectAt=investigationSource.indexOf('function executeRecoveryPermit');
  console.log(JSON.stringify({
    toolId:PRA.TOOL_ID,
    actions:[...PRA.ACTIONS],
    serverReferences:snippets,
    executePermitSource:execAt>=0?recoverySource.slice(execAt,execAt+6500):null,
    investigationExecuteSource:connectAt>=0?investigationSource.slice(connectAt,connectAt+1800):null
  },null,2));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
