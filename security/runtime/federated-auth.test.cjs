'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {DatabaseSync}=require('node:sqlite');
const {generateKeyPairSync,sign,createHash}=require('node:crypto');
const {createFederatedAuth,validateIdToken,PROVIDERS}=require('./federated-auth.cjs');
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...pair.publicKey.export({format:'jwk'}),kid:'fixture-key',alg:'RS256',use:'sig'};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(claims,header={alg:'RS256',kid:'fixture-key'}){const raw=b64(header)+'.'+b64(claims);return raw+'.'+sign('RSA-SHA256',Buffer.from(raw),pair.privateKey).toString('base64url');}
const now=()=>Math.floor(Date.now()/1000);
function claims(provider,nonce){return {iss:PROVIDERS[provider].issuer,aud:provider+'-client',sub:'subject-1',nonce,iat:now(),exp:now()+300,email:'untrusted@attacker.example',role:'admin',tenant:'other'};}
function appleSecret(exp=now()+3600){return b64({alg:'ES256',kid:'synthetic'})+'.'+b64({iss:'synthetic-team',sub:'apple-client',aud:'https://appleid.apple.com',iat:now(),exp})+'.synthetic';}
function response(){return{headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(body){this.rawBody=body;this.body=this.headers['content-type']?.startsWith('application/json')?JSON.parse(body):body;}};}
function request(url,method='GET',cookie='',body='',headers={}){const r=Readable.from(body?[Buffer.from(body)]:[]);r.url=url;r.method=method;r.headers={cookie,...headers};r.socket={encrypted:true,remoteAddress:'127.0.0.1'};return r;}
function fixture(t,overrides={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'federated-auth-')),dbPath=path.join(dir,'state.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);INSERT INTO users VALUES('person@factory.example','factory','employee');
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);
    CREATE TABLE identity_tenant_control(tenant TEXT PRIMARY KEY,session_epoch INTEGER,policy_version INTEGER,privileged_freeze INTEGER,updated_at TEXT);
    INSERT INTO identity_tenant_control VALUES('factory',2,3,0,'now');
    CREATE TABLE identity_session_bindings(token_hash TEXT PRIMARY KEY,tenant TEXT,issuer TEXT,audience TEXT,session_epoch INTEGER,policy_version INTEGER,bound_at TEXT);`);
  const f={dir,db,dbPath,calls:[],nonce:null,provider:'google',mutate:c=>c};
  const options={dbPath,publicOrigin:'https://vector.example',env:{},google:{clientId:'google-client',clientSecret:'synthetic-google'},apple:{clientId:'apple-client',clientSecret:appleSecret()},identities:['google','apple'].map(provider=>({provider,subject:'subject-1',email:'person@factory.example',tenant:'factory'})),fetchImpl:async(url,init)=>{
    f.calls.push({url,init});
    if(url===PROVIDERS[f.provider].token)return new Response(JSON.stringify({id_token:jwt(f.mutate(claims(f.provider,f.nonce)))}));
    assert.equal(url,PROVIDERS[f.provider].keys);return new Response(JSON.stringify({keys:[jwk]}));
  },...overrides};
  f.options=options;f.auth=createFederatedAuth(options);
  t.after(()=>{f.auth.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
  f.begin=async(provider='google')=>{f.provider=provider;const res=response();await f.auth.handleRequest(request('/api/auth/federated/'+provider+'/start'),res);assert.equal(res.statusCode,302);const u=new URL(res.headers.location);f.nonce=u.searchParams.get('nonce');return {url:u,state:u.searchParams.get('state'),cookie:res.headers['set-cookie'].split(';')[0],res};};
  f.finish=async(flow,changes={})=>{const p=new URLSearchParams({state:flow.state,code:'synthetic-code',...(changes.params||{})});const apple=f.provider==='apple';const req=request('/api/auth/federated/'+f.provider+'/callback'+(apple?'':'?'+p),apple?'POST':'GET',changes.cookie??flow.cookie,apple?p.toString():'',apple?{'content-type':'application/x-www-form-urlencoded'}:{});const res=response();await f.auth.handleRequest(req,res);return res;};
  return f;
}
for(const provider of ['google','apple'])test(provider+' code login mints only mapped local authority with secure cookies and atomic binding',async t=>{
  const f=fixture(t),flow=await f.begin(provider),res=await f.finish(flow);
  assert.equal(res.statusCode,200);assert.equal(res.headers.location,undefined);
  assert.equal(res.headers['content-type'],'text/html; charset=utf-8');
  assert.equal(res.headers['cache-control'],'no-store');assert.equal(res.headers['referrer-policy'],'no-referrer');
  assert.equal(res.headers['content-security-policy'],"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  assert.match(res.rawBody,/<a href="\/">Continue to VECTOR<\/a>/);assert.doesNotMatch(res.rawBody,/<script|<style|http-equiv|https?:/i);
  for(const secret of ['synthetic-code',flow.state,f.nonce,res.headers['set-cookie'][1].split(';')[0].slice('wfm_session='.length)])assert.equal(res.rawBody.includes(secret),false);
  const s=f.db.prepare('SELECT * FROM federated_sessions').get(),b=f.db.prepare('SELECT * FROM identity_session_bindings').get();
  assert.equal(s.email,'person@factory.example');assert.equal(s.tenant,'factory');assert.equal(s.role,'employee');assert.equal(b.issuer,'wfm-federated');assert.equal(b.audience,'wfm-api');assert.equal(b.session_epoch,2);assert.equal(b.policy_version,3);
  assert.equal(f.auth.validateSession(s.token_hash,s),true);assert.equal(f.db.prepare('SELECT count(*) n FROM federated_auth_events').get().n,1);
  assert.match(res.headers['set-cookie'][1],/Secure; HttpOnly; SameSite=Strict/);
  assert.equal(f.calls[0].init.redirect,'error');assert.equal(f.calls[1].init.redirect,'error');
  const sent=new URLSearchParams(f.calls[0].init.body);assert.equal(sent.get('redirect_uri'),'https://vector.example/api/auth/federated/'+provider+'/callback');
  if(provider==='google'){assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');assert.equal(createHash('sha256').update(sent.get('code_verifier')).digest('base64url'),flow.url.searchParams.get('code_challenge'));}
  else {assert.equal(flow.url.searchParams.get('response_mode'),'form_post');assert.match(flow.res.headers['set-cookie'],/SameSite=None/);assert.equal(sent.has('code_verifier'),false);}
});
for(const [name,patch] of Object.entries({issuer:{iss:'https://evil.example'},audience:{aud:'other'},authorizedParty:{azp:'other'},expired:{exp:now()-1},future:{iat:now()+900},nonce:{nonce:'wrong'},unlinked:{sub:'another-subject'},missingSubject:{sub:null}}))test('refuses '+name+' without issuing a session',async t=>{
  const f=fixture(t),flow=await f.begin();f.mutate=c=>({...c,...patch});const res=await f.finish(flow);assert.equal(res.statusCode,401);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM identity_session_bindings').get().n,0);
});
test('state binding prevents login CSRF and durable consumption prevents duplicate exchanges',async t=>{
  const f=fixture(t),flow=await f.begin();assert.equal((await f.finish(flow,{cookie:'__Host-vector_oidc_google=wrong'})).statusCode,401);assert.equal(f.calls.length,0);
  const results=await Promise.all([f.finish(flow),f.finish(flow)]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,401]);assert.equal(f.calls.filter(c=>c.url===PROVIDERS.google.token).length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,1);
});
test('pending login survives process-local module restart and refuses expired state',async t=>{
  const f=fixture(t),flow=await f.begin();f.auth.close();f.auth=createFederatedAuth(f.options);assert.equal((await f.finish(flow)).statusCode,200);
  const next=await f.begin();f.db.exec('UPDATE federated_auth_states SET expires=0');assert.equal((await f.finish(next)).statusCode,401);
});
for(const [name,sql]of Object.entries({ambiguous:"INSERT INTO users VALUES('PERSON@FACTORY.EXAMPLE','factory','admin')",wrongTenant:"UPDATE users SET tenant='other'",missing:"DELETE FROM users",freeze:'UPDATE identity_tenant_control SET privileged_freeze=1',controlMissing:'DELETE FROM identity_tenant_control',auditFailure:"CREATE TRIGGER block_federated_audit BEFORE INSERT ON federated_auth_events BEGIN SELECT RAISE(ABORT,'fixture'); END"}))test('issuance fails atomically for '+name,async t=>{
  const f=fixture(t),flow=await f.begin();f.db.exec(sql);assert.equal((await f.finish(flow)).statusCode,401);
  for(const table of ['sessions','federated_sessions','identity_session_bindings'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
});
test('sessions reject current role, epoch, policy, freeze, subject-map and metadata changes',async t=>{
  const f=fixture(t);await f.finish(await f.begin());const s=f.db.prepare('SELECT * FROM federated_sessions').get();
  for(const [mutate,undo]of [["UPDATE users SET role='admin'","UPDATE users SET role='employee'"],['UPDATE identity_tenant_control SET session_epoch=4','UPDATE identity_tenant_control SET session_epoch=2'],['UPDATE identity_tenant_control SET policy_version=4','UPDATE identity_tenant_control SET policy_version=3'],['UPDATE identity_tenant_control SET privileged_freeze=1','UPDATE identity_tenant_control SET privileged_freeze=0']]){f.db.exec(mutate);assert.equal(f.auth.validateSession(s.token_hash,s),false);f.db.exec(undo);assert.equal(f.auth.validateSession(s.token_hash,s),true);}
  f.auth.close();f.auth=createFederatedAuth({...f.options,identities:[]});assert.equal(f.auth.validateSession(s.token_hash,s),false);f.db.exec('DELETE FROM federated_sessions');assert.equal(f.auth.validateSession(s.token_hash,s),false);
});
test('provider outage consumes state and cannot trigger blind retry or session mint',async t=>{
  const f=fixture(t,{fetchImpl:async()=>{throw Error('untrusted provider body must not leak');}}),flow=await f.begin();const res=await f.finish(flow);assert.equal(res.statusCode,401);assert.equal(JSON.stringify(res.body).includes('untrusted'),false);assert.equal((await f.finish(flow)).statusCode,401);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
});
test('unconfigured providers and expired Apple client secret fail closed without network',async t=>{
  const f=fixture(t,{google:{},apple:{clientId:'apple-client',clientSecret:appleSecret(now()-1)}});assert.deepEqual(f.auth.providers(),[]);const res=response();await f.auth.handleRequest(request('/api/auth/federated/google/start'),res);assert.equal(res.statusCode,503);assert.equal(f.calls.length,0);
});
test('durable rate limit survives restart and refuses additional sign-in work',async t=>{
  const f=fixture(t);for(let i=0;i<60;i++)await f.begin();f.auth.close();f.auth=createFederatedAuth(f.options);const res=response();await f.auth.handleRequest(request('/api/auth/federated/google/start'),res);assert.equal(res.statusCode,429);assert.equal(f.db.prepare('SELECT count(*) n FROM federated_auth_states').get().n,60);assert.equal(f.calls.length,0);
});
test('JWT signature, algorithm and duplicate key negatives cannot authenticate',()=>{
  const c=claims('google','nonce'),token=jwt(c);
  assert.throws(()=>validateIdToken(token,{keys:[jwk,jwk]},'google','google-client','nonce'));
  assert.throws(()=>validateIdToken(jwt(c,{alg:'HS256',kid:'fixture-key'}),{keys:[jwk]},'google','google-client','nonce'));
  const p=token.split('.');p[1]=b64({...c,sub:'forged'});assert.throws(()=>validateIdToken(p.join('.'),{keys:[jwk]},'google','google-client','nonce'));
});
test('cross-site starts, existing sessions and duplicate callback parameters are refused',async t=>{
  const f=fixture(t);for(const req of [request('/api/auth/federated/google/start','GET','','',{'sec-fetch-site':'cross-site'}),request('/api/auth/federated/google/start','GET','wfm_session=existing')]){const res=response();await f.auth.handleRequest(req,res);assert.ok([403,409].includes(res.statusCode));}
  const flow=await f.begin(),res=response();await f.auth.handleRequest(request('/api/auth/federated/google/callback?state='+flow.state+'&state='+flow.state+'&code=x','GET',flow.cookie),res);assert.equal(res.statusCode,401);assert.equal(f.calls.length,0);
});
test('Apple callback body is bounded by size and time before any provider exchange',async t=>{
  const f=fixture(t,{bodyTimeoutMs:25}),flow=await f.begin('apple');
  const large=request('/api/auth/federated/apple/callback','POST',flow.cookie,'x'.repeat(16385),{'content-type':'application/x-www-form-urlencoded'}),a=response();
  await f.auth.handleRequest(large,a);assert.equal(a.statusCode,401);
  const stalled=new Readable({read(){}});stalled.url='/api/auth/federated/apple/callback';stalled.method='POST';stalled.headers={cookie:flow.cookie,'content-type':'application/x-www-form-urlencoded'};stalled.socket={encrypted:true};
  const b=response();await f.auth.handleRequest(stalled,b);assert.equal(b.statusCode,401);assert.equal(stalled.destroyed,true);assert.equal(f.calls.length,0);
});
