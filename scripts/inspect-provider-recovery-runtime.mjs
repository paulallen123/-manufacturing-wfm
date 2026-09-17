import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require=createRequire(import.meta.url);
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'DEPLOYMENT_MANIFEST.json'),'utf8'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-provider-api-'));
try {
  execFileSync('tar',['-xzf',path.join(root,manifest.runtime_artifact),'-C',tmp]);
  const names=['provider-job-store.cjs','provider-investigation.cjs','disposable-verification-worker.cjs','agent-tool-authority.cjs','provider-recovery-authority.cjs','build-identity.cjs'];
  const modules=Object.fromEntries(names.map(n=>[n,require(path.join(tmp,'lib',n))]));
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE tenants(id TEXT PRIMARY KEY); INSERT INTO tenants(id) VALUES (\'proof-tenant-a\');');
  const out={candidate:manifest.candidate,exports:{}};
  for(const [name,m] of Object.entries(modules))out.exports[name]=Object.fromEntries(Object.entries(m).map(([k,v])=>[k,typeof v==='function'?{type:'function',arity:v.length}:typeof v]));
  const PJ=modules['provider-job-store.cjs'];
  if(typeof PJ.createStore==='function'){
    try{const store=PJ.createStore(db);out.providerJobStore=Object.fromEntries(Object.entries(store).map(([k,v])=>[k,typeof v==='function'?{type:'function',arity:v.length}:typeof v]));}catch(e){out.providerJobStoreError={message:String(e.message),stack:String(e.stack).split('\n').slice(0,5)};}
  }
  const VW=modules['disposable-verification-worker.cjs'];
  if(typeof VW.readBuildIdentity==='function'){try{out.buildIdentity=VW.readBuildIdentity(tmp);}catch(e){out.buildIdentityError=String(e.message);}}
  console.log(JSON.stringify(out,null,2));
  db.close();
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
