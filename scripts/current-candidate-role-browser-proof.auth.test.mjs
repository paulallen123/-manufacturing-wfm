import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import proofRunnerAuth from '../security/runtime/proof-runner-auth.cjs';
import identityGuard from '../security/runtime/identity-survival-guard.cjs';
import runtimeModule from '../security/runtime/runtime-identity.cjs';
import { roleProofResult } from './vector-proof-result.mjs';

const source=fs.readFileSync(new URL('./current-candidate-role-browser-proof.mjs',import.meta.url),'utf8');
function loadFactory(){
  if(source.includes('export function createProofClient')){
    const end=source.indexOf('// VECTOR_PROOF_CLIENT_RUNNER_START');assert.ok(end>0);
    const prefix=source.slice(0,end).replace(/^import .*?;\r?\n/gm,'').replaceAll('export function ','function ');
    return vm.runInNewContext(prefix+'\n;createProofClient',{assert,crypto,proofRunnerAuth,URL,process:{env:{}},Buffer});
  }
  // Baseline control executes the real original login helper, not a fake repair.
  const helper=source.slice(source.indexOf('async function loginRole(page, email) {'),source.indexOf('async function openLeaveRoute('));
  return env=>({origin:env.VECTOR_PROOF_URL,actors:env.VECTOR_PROOF_ACTORS_JSON?JSON.parse(env.VECTOR_PROOF_ACTORS_JSON):[],authenticate:vm.runInNewContext('('+helper+')',{assert,origin:env.VECTOR_PROOF_URL,password:'synthetic-local-fixture-password'})});
}
const createProofClient=loadFactory(),sha='a'.repeat(40),deployment='synthetic-deployment',runId='synthetic-run',digest='b'.repeat(64),origin='https://proof.vector.test';
const actors=[{slug:'manager',email:'manager@fixture.invalid',role:'manager',tenant:'fixture'},{slug:'employee',email:'employee@fixture.invalid',role:'employee',tenant:'fixture'},{slug:'payroll',email:'payroll@fixture.invalid',role:'payroll_admin',tenant:'fixture'},{slug:'company-admin',email:'admin@fixture.invalid',role:'director',tenant:'fixture'},{slug:'isolation-manager',email:'isolation@fixture.invalid',role:'manager',tenant:'other'}];
function env(privateKey){return{VECTOR_PROOF_AUTH_PROFILE:'signed',VECTOR_PROOF_URL:origin,WFM_EXPECTED_CANDIDATE_SHA:sha,EXPECTED_DEPLOYMENT_ID:deployment,EXPECTED_IMPLEMENTATION_TENANT:'fixture',EXPECTED_IMPLEMENTATION_RUN_ID:runId,EXPECTED_CONFIGURATION_DIGEST:digest,VECTOR_PROOF_ACTORS_JSON:JSON.stringify(actors),PROOF_PRIVATE_KEY_B64:Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64')};}
function fixture(t,mutate={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auth-client-')),dbPath=path.join(dir,'test.sqlite'),db=new DatabaseSync(dbPath);
  db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER,state TEXT); CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,person_id TEXT,role TEXT,costs INTEGER,salt TEXT,password_hash TEXT,permissions TEXT); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);");
  for(const tenant of ['fixture','other'])db.prepare('INSERT INTO tenants VALUES(?,1,?)').run(tenant,'{}');
  for(const a of actors)db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(a.email,a.tenant,a.slug,a.role,0,'s','00','[]');
  const keys=crypto.generateKeyPairSync('ed25519'),auth=proofRunnerAuth.createProofRunnerAuth({dbPath,hosted:true,nodeEnv:'staging',enabled:true,publicOrigin:origin,publicKey:keys.publicKey,allowedEmails:actors.map(a=>a.email)}),guard=identityGuard.createIdentitySurvivalGuard({dbPath}),control=guard.securityControlForTests();
  const runtime=runtimeModule.createRuntimeIdentity({hosted:true,env:{WFM_CANDIDATE_SHA:sha},readFileSync:()=>sha});
  const calls=[],bodies=[];let firstBody;
  const status={tenant:'fixture',runId,tenantEnvironment:{runId,isolation:{tenant:'fixture'},configurationDigest:digest},requirements:[{key:'tenant-environment',evidenceBinding:{status:'REVALIDATION_REQUIRED',expected:{candidateSha:sha,deploymentId:deployment,tenant:'fixture',runId},observed:{candidateSha:'c'.repeat(40),deploymentId:'OLD'}}}]};
  function page(){let cookie='';return{goto:async()=>({status:()=>200}),reload:async()=>{},waitForFunction:async()=>{},cookie:()=>cookie,evaluate:async(fn,payload)=>vm.runInNewContext('('+fn.toString()+')(payload)',{payload,fetch:async(url,options={})=>{
    calls.push({url,method:options.method||'GET',headers:options.headers||{},payloadKeys:options.body?Object.keys(JSON.parse(options.body)):[]});
    let body=options.body?JSON.parse(options.body):null;
    if(url==='/api/proof-runner/session'){bodies.push(body);if(mutate.replay&&firstBody)body=firstBody;firstBody??=body;if(mutate.signature)body.signature=Buffer.alloc(64,7).toString('base64url');if(mutate.origin)body.origin='https://wrong.invalid';if(mutate.expired){body.issuedAt=Date.now()-180000;body.expiresAt=body.issuedAt+45000;body.signature=crypto.sign(null,Buffer.from(proofRunnerAuth.canonicalAssertion(body)),keys.privateKey).toString('base64url');}}
    const req=Readable.from(body?[JSON.stringify(body)]:[]);req.method=options.method||'GET';req.url=url;req.headers={origin,'content-type':'application/json',...(cookie?{cookie}:{})};req.socket={encrypted:true};
    const headers={},res={setHeader(k,v){headers[k.toLowerCase()]=v;},removeHeader(k){delete headers[k.toLowerCase()];},end(text){this.body=text?JSON.parse(text):null;},statusCode:200};runtime.applyResponseHeaders(res);
    if(!runtime.handleRequest(req,res)&&!guard.beforeRequest(req,res)&&!await auth.handleRequest(req,res)){
      if(url==='/api/login'){res.statusCode=410;res.end(JSON.stringify({error:'Use your passkey to sign in.'}));}
      else if(url==='/api/bootstrap'){const row=cookie?db.prepare('SELECT u.email,u.role,u.tenant FROM sessions s JOIN users u ON s.email=u.email WHERE token_hash=?').get(crypto.createHash('sha256').update(cookie.split('=')[1]).digest('hex')):null;res.statusCode=row?200:401;res.end(JSON.stringify(row?{actor:row}:{error:'unauthenticated'}));}
      else if(url==='/api/implementation/autonomous/status'){res.end(JSON.stringify(mutate.context?mutate.context(structuredClone(status)):status));}
      else throw Error('Unexpected local test path '+url);
    }
    if(headers['set-cookie']){cookie=String(headers['set-cookie']).split(';')[0];if(mutate.roleDrift)db.prepare('UPDATE users SET role=? WHERE email=?').run('employee',body.email);if(mutate.tenantDrift)db.prepare('UPDATE users SET tenant=? WHERE email=?').run('other',body.email);}
    if(url==='/api/proof-runner/session'&&mutate.actor&&res.statusCode===200)res.body.actor.role='employee';
    if(url==='/api/runtime-identity'&&mutate.source)res.body.candidateSha='d'.repeat(40);
    if(mutate.header)headers['x-wfm-source-sha']='d'.repeat(40);
    return{status:res.statusCode,json:async()=>res.body,headers:{get:name=>headers[name.toLowerCase()]??null}};
  }})};}
  t.after(()=>{control.db.close();auth.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});return{keys,db,calls,bodies,page,status,config:env(keys.privateKey)};
}
test('signed client uses actual handler cookie and persisted actor rather than password login',async t=>{
  const f=fixture(t),client=createProofClient(f.config),p=f.page();await client.authenticate(p,actors[0].email);
  assert.match(p.cookie(),/^wfm_session=/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM proof_runner_sessions').get().n,1);
  assert.ok(f.calls.some(x=>x.url==='/api/proof-runner/session'));assert.ok(!f.calls.some(x=>x.url==='/api/login'));
  for(const c of f.calls)assert.ok(!Object.keys(c.headers).some(h=>/cookie|origin|x-wfm/i.test(h)));
  assert.deepEqual(f.bodies[0]&&Object.keys(f.bodies[0]).sort(),['email','expiresAt','issuedAt','nonce','origin','signature']);
});
test('all explicit roles and every fresh same-role context receive separate signed assertions',async t=>{
  const f=fixture(t),client=createProofClient(f.config);for(const a of [...actors,actors[0]])await client.authenticate(f.page(),a.email);
  assert.equal(f.bodies.length,6);assert.equal(new Set(f.bodies.map(x=>x.nonce)).size,6);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM proof_runner_sessions').get().n,6);
});
for(const change of ['signature','origin','expired','actor','roleDrift','tenantDrift','source','header'])test('signed client refuses '+change+' and never falls back to password',async t=>{
  const f=fixture(t,{[change]:true}),client=createProofClient(f.config);await assert.rejects(()=>client.authenticate(f.page(),actors[0].email));assert.ok(!f.calls.some(x=>x.url==='/api/login'));
});
test('actual nonce replay is rejected on a fresh page without password fallback',async t=>{
  const f=fixture(t,{replay:true}),client=createProofClient(f.config);await client.authenticate(f.page(),actors[0].email);await assert.rejects(()=>client.authenticate(f.page(),actors[0].email));assert.ok(!f.calls.some(x=>x.url==='/api/login'));
});
test('a previously authenticated page is refused rather than clearing or replacing its cookie',async t=>{
  const f=fixture(t),client=createProofClient(f.config),p=f.page();await client.authenticate(p,actors[0].email);const cookie=p.cookie();
  await assert.rejects(()=>client.authenticate(p,actors[0].email));assert.equal(p.cookie(),cookie);assert.equal(f.bodies.length,1);assert.ok(!f.calls.some(x=>x.url==='/api/login'));
});
test('an explicitly requested actor outside the existing server allowlist cannot mint a session',async t=>{
  const f=fixture(t),requested=actors.map(a=>a.slug==='manager'?{...a,email:'unallowlisted@fixture.invalid'}:a),client=createProofClient({...f.config,VECTOR_PROOF_ACTORS_JSON:JSON.stringify(requested)});
  await assert.rejects(()=>client.authenticate(f.page(),requested[0].email));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM proof_runner_sessions').get().n,0);assert.ok(!f.calls.some(x=>x.url==='/api/login'));
});
for(const change of ['deployment','run','tenant','configuration','absent'])test('current manager context '+change+' mismatch stops auth/navigation proof',async t=>{
  const f=fixture(t,{context:status=>{if(change==='deployment')status.requirements[0].evidenceBinding.expected.deploymentId='wrong';if(change==='run')status.runId='wrong';if(change==='tenant')status.tenant='wrong';if(change==='configuration')status.tenantEnvironment.configurationDigest='c'.repeat(64);if(change==='absent')delete status.requirements[0].evidenceBinding;return status;}}),client=createProofClient(f.config);await assert.rejects(()=>client.authenticate(f.page(),actors[0].email));
});
test('historical evidence observed identity is never treated as current deployment authority',async t=>{
  const f=fixture(t),client=createProofClient(f.config);await client.authenticate(f.page(),actors[0].email);
  const partial=client.partialEvidence();assert.equal(partial.authCompatibility.status,'PARTIAL');assert.equal(partial.leaveJourney,null);assert.equal(partial.attendanceJourney,null);assert.equal(partial.payrollJourney,null);
  const result=roleProofResult({status:'BOUND'},partial.leaveJourney,partial.attendanceJourney,partial.payrollJourney);assert.equal(result.status,'PARTIAL');assert.equal(result.scopedLeaveJourneyVerified,false);assert.equal(result.scopedAttendanceJourneyVerified,false);assert.equal(result.scopedPayrollJourneyVerified,false);assert.equal(result.endToEndVerified,false);assert.equal(result.productReady,false);
});
for(const key of ['VECTOR_PROOF_AUTH_PROFILE','VECTOR_PROOF_ACTORS_JSON','EXPECTED_DEPLOYMENT_ID','EXPECTED_IMPLEMENTATION_TENANT','EXPECTED_IMPLEMENTATION_RUN_ID','EXPECTED_CONFIGURATION_DIGEST','PROOF_PRIVATE_KEY_B64'])test('signed constructor fails before transport when '+key+' is absent',t=>{const f=fixture(t),config={...f.config};delete config[key];assert.throws(()=>createProofClient(config));});
test('malformed actor JSON, missing roles, duplicate emails and wrong isolation tenant reject',t=>{
  const f=fixture(t);for(const value of ['{',JSON.stringify(actors.slice(0,4)),JSON.stringify(actors.map((a,i)=>({...a,email:i===1?actors[0].email:a.email}))),JSON.stringify(actors.map(a=>({...a,tenant:'fixture'})))])assert.throws(()=>createProofClient({...f.config,VECTOR_PROOF_ACTORS_JSON:value}));
});
test('signer accepts declared base64 PEM Ed25519 only and never appears in returned profile',t=>{
  const f=fixture(t);assert.throws(()=>createProofClient({...f.config,PROOF_PRIVATE_KEY_B64:'not-a-key'}));const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;assert.throws(()=>createProofClient({...f.config,PROOF_PRIVATE_KEY_B64:Buffer.from(rsa.export({type:'pkcs8',format:'pem'})).toString('base64')}));const client=createProofClient(f.config);assert.ok(!JSON.stringify(client).includes(f.config.PROOF_PRIVATE_KEY_B64));
});

test('signed runner emits distinct partial receipt and excludes the fixed business branch',async t=>{
  const f=fixture(t),proofClient=createProofClient(f.config);await proofClient.authenticate(f.page(),actors[0].email);
  const start=source.indexOf("  if (proofClient.mode === 'signed') {");assert.ok(start>=0);
  const end=source.indexOf('  } else {\n  const leaveJourney',start);assert.ok(end>start);
  const body=source.slice(start,end)+'\n  }\n;browserProofEvidence;',output=[];
  const evidence=vm.runInNewContext(body,{assert,proofClient,receipts:Array(5).fill({}),specs:actors,navigationClicks:3,browserProofEvidence:{},console:{log:value=>output.push(value)}});
  assert.equal(evidence.leaveJourney,null);assert.equal(evidence.attendanceJourney,null);assert.equal(evidence.payrollJourney,null);
  assert.equal(output.length,1);assert.match(output[0],/^CURRENT_SIGNED_AUTH_NAVIGATION=PARTIAL\|/);assert.ok(!output.some(line=>/BROWSER_MATRIX=PASS|BUSINESS|CURRENT_LEAVE|CURRENT_ATTENDANCE|CURRENT_PAYROLL/.test(line)));
});

test('faithful source-layout image files load the same canonical serializer without duplicate authority',t=>{
  const f=fixture(t),imageDir=fs.mkdtempSync(path.join(os.tmpdir(),'auth-image-layout-'));t.after(()=>fs.rmSync(imageDir,{recursive:true,force:true}));
  const docker=fs.readFileSync(new URL('../Dockerfile.current-candidate-role-browser-proof',import.meta.url),'utf8');
  for(const line of docker.split(/\r?\n/).filter(line=>line.startsWith('COPY '))){const [,src,dest]=line.split(/\s+/);const b=fs.readFileSync(new URL('../'+src,import.meta.url)),to=path.join(imageDir,dest);fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,b);}
  const packagedClient=path.join(imageDir,'scripts/current-candidate-role-browser-proof.mjs');assert.ok(fs.existsSync(packagedClient));
  const authURL=new URL('../security/runtime/proof-runner-auth.cjs','file:///'+packagedClient.replaceAll('\\','/'));
  assert.equal(fs.readFileSync(authURL).compare(fs.readFileSync(new URL('../security/runtime/proof-runner-auth.cjs',import.meta.url))),0);
  const packagedAuth=createRequire(packagedClient)('../security/runtime/proof-runner-auth.cjs');
  assert.equal(packagedAuth.canonicalAssertion({email:'fixture@fixture.invalid',origin,nonce:'n',issuedAt:1,expiresAt:2}),proofRunnerAuth.canonicalAssertion({email:'fixture@fixture.invalid',origin,nonce:'n',issuedAt:1,expiresAt:2}));
  assert.ok(createProofClient(f.config));
});

test('actual unchanged wrapper keeps partial auth child business checks false and readiness503',async t=>{
  const f=fixture(t),client=createProofClient(f.config);await client.authenticate(f.page(),actors[0].email);const partial=client.partialEvidence();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auth-partial-wrapper-'));let child;
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  for(const file of ['current-candidate-role-browser-proof-server.mjs','vector-proof-result.mjs'])fs.copyFileSync(new URL(file,import.meta.url),path.join(dir,file));
  fs.writeFileSync(path.join(dir,'current-candidate-role-browser-proof.mjs'),'export const browserProofEvidence='+JSON.stringify(partial)+';\n');
  // Existing isolated loopback guard; external/TLS requests remain blocked.
  const existingTests=fs.readFileSync(new URL('./current-candidate-role-browser-proof-server.test.mjs',import.meta.url),'utf8');
  const guardSource=existingTests.match(/const loopbackGuard = String.raw`([\s\S]*?)`;/);assert.ok(guardSource);
  const guard=path.join(dir,'loopback-only.cjs');fs.writeFileSync(guard,guardSource[1]);
  let output='';child=spawn(process.execPath,['--require',guard,path.join(dir,'current-candidate-role-browser-proof-server.mjs')],{windowsHide:true,cwd:dir,env:{PORT:String(port),NODE_OPTIONS:'',WFM_EXPECTED_CANDIDATE_SHA:sha,WFM_REQUIRE_VECTOR_ASSET_DIGESTS:'false'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  t.after(async()=>{child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));fs.rmSync(dir,{recursive:true,force:true});});
  async function read(route){return new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port,path:route},r=>{let body='';r.on('data',b=>body+=b);r.on('end',()=>resolve({status:r.statusCode,body:JSON.parse(body)}));}).on('error',reject));}
  let result;const deadline=Date.now()+10000;while(Date.now()<deadline){try{result=await read('/');if(result.body.status==='PARTIAL')break;}catch{}if(child.exitCode!==null)throw Error('Synthetic wrapper failed: '+output);await new Promise(resolve=>setTimeout(resolve,40));}
  assert.equal(result?.body.status,'PARTIAL');assert.equal(result.body.scopedLeaveActionVerified,false);assert.equal(result.body.scopedLeaveJourneyVerified,false);assert.equal(result.body.scopedAttendanceCorrectionVerified,false);assert.equal(result.body.scopedAttendanceJourneyVerified,false);assert.equal(result.body.scopedPayrollJourneyVerified,false);assert.equal(result.body.endToEndVerified,false);assert.equal(result.body.productReady,false);assert.equal((await read('/ready')).status,503);assert.ok(!output.includes('BROWSER_PROOF_SERVER=PASS'));
});
test('legacy password profile requires explicit loopback origin and retains fixture actor expectations',()=>{
  const config={VECTOR_PROOF_AUTH_PROFILE:'fixture-password',VECTOR_PROOF_URL:'http://127.0.0.1:3000',WFM_EXPECTED_CANDIDATE_SHA:sha,WFM_STAGING_PASSWORD:'synthetic-local-password-at-least20'};
  const client=createProofClient(config);assert.equal(client.mode,'fixture-password');assert.equal(client.actors.length,5);
  for(const url of ['https://remote.invalid','http://127.0.0.1.attacker.invalid','http://user:pass@localhost:3000'])assert.throws(()=>createProofClient({...config,VECTOR_PROOF_URL:url}));
});
