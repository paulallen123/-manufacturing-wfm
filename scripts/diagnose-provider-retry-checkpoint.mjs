import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'DEPLOYMENT_MANIFEST.json'),'utf8'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-provider-handoff-diagnostic-'));
try{
  execFileSync('tar',['-xzf',path.join(root,manifest.runtime_artifact),'-C',tmp]);
  const server=fs.readFileSync(path.join(tmp,'server.cjs'),'utf8');
  const targets=['runPagedAdapter','providerJobs.acquire','providerJobs.checkpoint','providerJobs.complete','providerJobs.fail','providerMetadataBroker','providerCollectionPermitRuntime','collection-control','collect-provider','provider-collect'];
  const hits=[];
  for(const needle of targets){
    let at=0;
    while((at=server.indexOf(needle,at))!==-1){
      hits.push({needle,source:server.slice(Math.max(0,at-1800),Math.min(server.length,at+4200))});
      at+=needle.length;
    }
  }
  console.log(JSON.stringify({candidate:manifest.candidate,hits},null,2));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
