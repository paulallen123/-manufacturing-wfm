import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';

const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'DEPLOYMENT_MANIFEST.json'),'utf8'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-auth-support-inspect-'));
const runtime=path.join(tmp,'runtime');
const dbPath=path.join(tmp,'wfm.sqlite');
fs.mkdirSync(runtime);
let child;
try{
  execFileSync('tar',['-xzf',path.join(root,manifest.runtime_artifact),'-C',runtime]);
  const serverSource=fs.readFileSync(path.join(runtime,'server.cjs'),'utf8');
  const routes=[...new Set([...serverSource.matchAll(/['"](\/api\/[^'"]*support[^'"]*)['"]/gi)].map(m=>m[1]))].sort();
  const password='CI-'+randomBytes(24).toString('hex');
  const port=31477;
  child=spawn(process.execPath,[path.join(runtime,'server.cjs')],{
    env:{...process.env,NODE_ENV:'staging',NODE_OPTIONS:'--experimental-sqlite',PORT:String(port),WFM_HOSTED_STAGING:'true',WFM_PUBLIC_ORIGIN:'https://wfm-ci.invalid',WFM_DB:dbPath,WFM_STAGING_PASSWORD:password,WFM_SUPPORT_ENABLED:'true'},
    stdio:['ignore','pipe','pipe']
  });
  let stderr=''; child.stderr.on('data',d=>stderr+=d.toString());
  const headers={Host:'wfm-ci.invalid','X-Forwarded-Proto':'https'};
  let health=null;
  for(let i=0;i<80;i++){
    try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{headers});if(r.ok){health=await r.json();break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  if(!health)throw new Error('Server did not become healthy: '+stderr.slice(-1000));
  const db=new DatabaseSync(dbPath,{readOnly:true});
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name);
  let users=[];
  if(tables.includes('users')) users=db.prepare('SELECT email, role, permissions FROM users ORDER BY email').all().map(x=>({email:x.email,role:x.role,permissions:typeof x.permissions==='string'?JSON.parse(x.permissions):x.permissions}));
  db.close();
  const loginRoute=[...serverSource.matchAll(/url\.pathname===['"](\/api\/login)['"]/g)].map(m=>m[1]);
  const supportSnippets=[];
  for(const needle of routes){const i=serverSource.indexOf(needle);if(i>=0)supportSnippets.push({route:needle,source:serverSource.slice(Math.max(0,i-500),Math.min(serverSource.length,i+1800)).replaceAll(password,'<redacted>')});}
  console.log(JSON.stringify({candidate:manifest.candidate,runtimeSha256:manifest.runtime_sha256,health,loginRoute:[...new Set(loginRoute)],supportRoutes:routes,fixtureUsers:users,supportSnippets},null,2));
}finally{
  if(child&&!child.killed)child.kill('SIGTERM');
  fs.rmSync(tmp,{recursive:true,force:true});
}
