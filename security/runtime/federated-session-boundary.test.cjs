'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
const {createHash}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {createIdentitySurvivalGuard}=require('./identity-survival-guard.cjs');
const {createPasskeyAuth}=require('./passkey-auth.cjs');
const {createFederatedAuth}=require('./federated-auth.cjs');
function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'vector-fed-boundary-')),dbPath=join(dir,'test.sqlite'),db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('owner@example.test','fixture','director');
  let fed;
  const guard=createIdentitySurvivalGuard({dbPath,getFederatedAuth:()=>fed});
  fed=createFederatedAuth({dbPath,publicOrigin:'https://vector.test',google:{clientId:'synthetic-client',clientSecret:'synthetic-secret'},identities:[{provider:'google',subject:'synthetic-subject',email:'owner@example.test',tenant:'fixture'}]});
  const token='synthetic-session-'.repeat(3),digest=createHash('sha256').update(token).digest('hex'),now=Date.now();
  db.prepare('INSERT INTO identity_tenant_control VALUES(?,?,?,?,?)').run('fixture',1,1,0,new Date().toISOString());
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest,'owner@example.test',now+60000);
  db.prepare('INSERT INTO federated_sessions VALUES(?,?,?,?,?,?,?,?)').run(digest,'owner@example.test','fixture','director','google','synthetic-subject',now,now+60000);
  db.prepare('INSERT INTO identity_session_bindings VALUES(?,?,?,?,?,?,?)').run(digest,'fixture','wfm-federated','wfm-api',1,1,new Date().toISOString());
  const passkey=createPasskeyAuth({dbPath,publicOrigin:'https://vector.test',hosted:true,nodeEnv:'staging',federatedAuth:fed});
  const federatedHandle=fed;
  t.after(()=>{passkey.close();federatedHandle.close();guard.securityControlForTests().db.close();db.close();rmSync(dir,{recursive:true,force:true});});
  return {db,digest,guard,passkey,fed,disableVerifier(){fed=undefined;},request:{method:'GET',url:'/',headers:{cookie:'wfm_session='+token}}};
}
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}});
test('valid bound federated session reaches existing customer UI and identity guard',t=>{
  const f=fixture(t);assert.equal(f.passkey.serveEntry(f.request,response()),false);assert.equal(f.guard.beforeRequest(f.request,response()),false);
});
for(const mutation of ['role','epoch','freeze','missing-metadata','missing-binding','expired'])test('federated session refuses '+mutation+' rather than legacy rebinding',t=>{
  const f=fixture(t);
  if(mutation==='role')f.db.exec("UPDATE users SET role='employee'");
  if(mutation==='epoch')f.db.exec('UPDATE identity_tenant_control SET session_epoch=2');
  if(mutation==='freeze')f.db.exec('UPDATE identity_tenant_control SET privileged_freeze=1');
  if(mutation==='missing-metadata')f.db.exec('DELETE FROM federated_sessions');
  if(mutation==='missing-binding')f.db.exec('DELETE FROM identity_session_bindings');
  if(mutation==='expired')f.db.exec('UPDATE federated_sessions SET expires=1');
  assert.equal(f.passkey.serveEntry(f.request,response()),true);
  const res=response();assert.equal(f.guard.beforeRequest(f.request,res),true);assert.equal(res.statusCode,401);
});
test('missing federated verifier refuses a federated binding',t=>{
  const f=fixture(t);f.disableVerifier();const res=response();assert.equal(f.guard.beforeRequest(f.request,res),true);assert.equal(res.statusCode,401);
});

for(const mutation of ['revoked','expired','role','epoch','missing-metadata']) test('logout clears '+mutation+' cookie and permits a fresh federated flow', async t=>{
  const f=fixture(t);
  if(mutation==='revoked')f.db.exec('DELETE FROM sessions');
  if(mutation==='expired')f.db.exec('UPDATE sessions SET expires=1');
  if(mutation==='role')f.db.exec("UPDATE users SET role='employee'");
  if(mutation==='epoch')f.db.exec('UPDATE identity_tenant_control SET session_epoch=2');
  if(mutation==='missing-metadata')f.db.exec('DELETE FROM federated_sessions');
  const start={...f.request,url:'/api/auth/federated/google/start',socket:{encrypted:true}};
  const blocked=response();await f.fed.handleRequest(start,blocked);assert.equal(blocked.statusCode,409);
  const logout=response();assert.equal(f.guard.beforeRequest({...f.request,method:'POST',url:'/api/logout'},logout),true);
  assert.equal(logout.statusCode,401); // No protected operation is admitted.
  assert.equal(logout.headers['Set-Cookie'],'wfm_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
  // Model the browser applying the explicit deletion receipt, not bypassing auth.
  const next=response();await f.fed.handleRequest({...start,headers:{}},next);
  assert.equal(next.statusCode,302);assert.match(next.headers.Location,/^https:\/\/accounts.google.com\//);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions WHERE expires>?').get(Date.now()).n,0);
});
test('valid session still blocks identity switching and is not cleared by the guard',async t=>{
  const f=fixture(t),start=response();
  await f.fed.handleRequest({...f.request,url:'/api/auth/federated/google/start',socket:{encrypted:true}},start);
  assert.equal(start.statusCode,409);assert.equal(start.headers['Set-Cookie'],undefined);
  const normal=response();assert.equal(f.guard.beforeRequest(f.request,normal),false);
  assert.equal(normal.headers['Set-Cookie'],undefined);
});
