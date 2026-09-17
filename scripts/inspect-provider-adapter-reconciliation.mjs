import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'DEPLOYMENT_MANIFEST.json'),'utf8'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-provider-adapter-inspect-'));
const src=(fn,n=14000)=>typeof fn==='function'?String(fn).slice(0,n):null;
const describe=m=>Object.fromEntries(Object.entries(m||{}).map(([k,v])=>[k,typeof v==='function'?{type:'function',arity:v.length,source:src(v)}:v]));
try{
  execFileSync('tar',['-xzf',path.join(root,manifest.runtime_artifact),'-C',tmp]);
  const load=n=>require(path.join(tmp,'lib',n));
  const names=['provider-adapter-contract.cjs','provider-live-acceptance.cjs','provider-extraction-plan.cjs','integration-gateway.cjs','provider-job-store.cjs','provider-investigation.cjs'];
  const modules=Object.fromEntries(names.map(n=>[n,load(n)]));
  const out={candidate:manifest.candidate,modules:{}};
  for(const [name,m] of Object.entries(modules))out.modules[name]=describe(m);
  console.log(JSON.stringify(out,null,2));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
