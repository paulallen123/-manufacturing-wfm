'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
const {randomBytes,createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const authModule=require('./owner-access-recovery.cjs');
const {createIdentitySurvivalGuard,FORBIDDEN_IDENTITY_HEADERS}=require('./identity-survival-guard.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
const ORIGIN='https://vector.company.test';
function fixture(t,options={}) {
  assert.equal(typeof authModule.createEmailSignIn,'function','email sign-in must be implemented in the existing authentication boundary');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-email-test-')),dbPath=path.join(dir,'state.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');
  CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT REFERENCES users(email),expires INTEGER NOT NULL);
  CREATE TABLE audit_events(id INTEGER PRIMARY KEY,tenant TEXT,actor TEXT,action TEXT,detail TEXT,created_at TEXT);`);
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('superuser@northstar.example','northstar-demo','d1','director',1,'salt','hash','[]');
  const guard=createIdentitySurvivalGuard({dbPath});guard.securityControlForTests().setFreeze('northstar-demo',false);
  const env={WFM_DB:dbPath,WFM_PUBLIC_ORIGIN:ORIGIN,WFM_EMAIL_SIGNIN_ENABLED:'true',WFM_EMAIL_SIGNIN_KEY:randomBytes(32).toString('hex'),RESEND_API_KEY:'isolated-provider-test-key',WFM_EMAIL_SIGNIN_CONFIG_JSON:JSON.stringify({sender:'access@company.test',accounts:[{recipient:'owner@company.test',email:'superuser@northstar.example',tenant:'northstar-demo',personId:'d1',role:'director'}]})};
  let now=Date.now(),messages=[],fail=false;
  const make=()=>authModule.createEmailSignIn({env,clock:()=>now,autoSend:false,deliver:async m=>{messages.push(m);if(fail)throw Error('private provider diagnostic');return{id:'provider-receipt'};}});
  let auth=make();
  t.after(()=>{auth.close();guard.securityControlForTests().db.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {db,guard,env,messages,get auth(){return auth;},restart(){auth.close();auth=make();},advance(n){now+=n;},failDelivery(v){fail=v;}};
}
function res(){return{statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(v=''){this.body=String(v);this.writableEnded=true;}};}
async function call(f,url,input,options={}){
  const text=typeof input==='string'?input:JSON.stringify(input||{}),req=Readable.from([text]);
  req.url=url;req.method=options.method||'POST';req.socket={remoteAddress:'127.0.0.1'};
  req.headers={host:'vector.company.test','x-forwarded-proto':'https',origin:ORIGIN,'sec-fetch-site':'same-origin','content-type':'application/json',...options.headers};
  const r=res();r.handled=await f.auth.handleRequest(req,r);return r;
}
function cookie(r){const v=r.headers['set-cookie'];return(Array.isArray(v)?v:[v]).find(x=>x&&x.startsWith('__Host-vector_login='))?.split(';')[0];}
async function begin(f,remember=false){const r=await call(f,'/api/auth/email/request',{email:'owner@company.test',remember});assert.equal(r.statusCode,202);await f.auth.processOutbox();const message=f.messages.at(-1);assert.ok(message);return{r,cookie:cookie(r),message,code:message.text.match(/\b\d{8}\b/)[0],token:message.text.match(/#token=([A-Za-z0-9_-]{43})/)[1]};}
async function verify(f,start,input){return call(f,'/api/auth/email/verify',input||{code:start.code},{headers:{cookie:start.cookie}});}
test('disabled email sign-in leaves existing authentication alone',async t=>{const f=fixture(t);delete f.env.WFM_EMAIL_SIGNIN_ENABLED;const r=await call(f,'/api/auth/email/request',{email:'owner@company.test'});assert.equal(r.statusCode,404);assert.equal(f.messages.length,0);const root=await call(f,'/',{}, {method:'GET'});assert.equal(root.handled,false);});
test('email code creates the existing session with unchanged tenant, role and audit',async t=>{const f=fixture(t),s=await begin(f),r=await verify(f,s);assert.equal(r.statusCode,200);const value=r.headers['set-cookie'].find(x=>x.startsWith('wfm_session='));assert.match(value,/HttpOnly; Secure; SameSite=Lax/);const token=value.split(';')[0].slice('wfm_session='.length);const row=f.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash(token));assert.equal(row.email,'superuser@northstar.example');assert.equal(f.guard.beforeRequest({method:'GET',url:'/api/state',headers:{cookie:'wfm_session='+token}},res()),false);const bind=f.db.prepare('SELECT * FROM identity_session_bindings WHERE token_hash=?').get(hash(token));assert.equal(bind.tenant,'northstar-demo');assert.equal(bind.session_epoch,1);assert.equal(f.db.prepare('SELECT role FROM users').get().role,'director');assert.equal(f.db.prepare('SELECT count(*) n FROM audit_events').get().n,1);});
test('magic link and code are single-use alternatives, including after restart',async t=>{const f=fixture(t),s=await begin(f);f.restart();assert.equal((await verify(f,s,{token:s.token})).statusCode,200);f.restart();assert.equal((await verify(f,s)).statusCode,403);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,1);});
test('racing verifications create exactly one session',async t=>{const f=fixture(t),s=await begin(f);const rs=await Promise.all([verify(f,s),verify(f,s)]);assert.deepEqual(rs.map(x=>x.statusCode).sort(),[200,403]);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,1);});
test('link scanners cannot create or consume an authenticated session',async t=>{const f=fixture(t),s=await begin(f);const r=await call(f,'/sign-in',{}, {method:'GET',headers:{cookie:s.cookie}});assert.equal(r.statusCode,200);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.equal((await verify(f,s)).statusCode,200);});
test('code or forwarded link fails in a browser that did not request it',async t=>{const f=fixture(t),s=await begin(f);for(const input of [{code:s.code},{token:s.token}])assert.equal((await call(f,'/api/auth/email/verify',input,{headers:{cookie:'__Host-vector_login='+randomBytes(32).toString('base64url')}})).statusCode,403);assert.equal((await verify(f,s)).statusCode,200);});
test('expired codes fail after a restart',async t=>{const f=fixture(t),s=await begin(f);f.advance(600001);f.restart();assert.equal((await verify(f,s)).statusCode,403);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);});
test('five wrong codes invalidate the challenge without locking the account',async t=>{const f=fixture(t),s=await begin(f);for(let i=0;i<5;i++)assert.equal((await verify(f,s,{code:s.code==='00000000'?'11111111':'00000000'})).statusCode,403);assert.equal((await verify(f,s)).statusCode,403);assert.equal(f.db.prepare('SELECT password_hash FROM users').get().password_hash,'hash');});
for(const mutation of ['role','tenant','person_id','password_hash','permissions','policy','epoch','freeze']) test(`changed ${mutation} invalidates an outstanding sign-in`,async t=>{const f=fixture(t),s=await begin(f);if(mutation==='policy')f.guard.securityControlForTests().bumpPolicy('northstar-demo');else if(mutation==='epoch')f.guard.securityControlForTests().bumpEpoch('northstar-demo');else if(mutation==='freeze')f.guard.securityControlForTests().setFreeze('northstar-demo',true);else f.db.exec(`UPDATE users SET ${mutation}='changed'`);assert.equal((await verify(f,s)).statusCode,403);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);});
test('unknown addresses return the same public result but get no email or user account',async t=>{const f=fixture(t);const a=await call(f,'/api/auth/email/request',{email:'owner@company.test',remember:false}),b=await call(f,'/api/auth/email/request',{email:'absent@company.test',remember:false});assert.equal(a.statusCode,b.statusCode);assert.equal(a.body,b.body);await f.auth.processOutbox();assert.equal(f.messages.length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,1);});
test('rate limits persist across restart and do not invalidate an earlier valid code',async t=>{const f=fixture(t),s=await begin(f);for(let i=0;i<8;i++){f.restart();await call(f,'/api/auth/email/request',{email:'owner@company.test',remember:false});await f.auth.processOutbox();}assert.ok(f.messages.length<=5);assert.equal((await verify(f,s)).statusCode,200);});
test('encrypted pending emails survive restart and no raw credential enters storage',async t=>{const f=fixture(t);const r=await call(f,'/api/auth/email/request',{email:'owner@company.test',remember:false});f.restart();await f.auth.processOutbox();const m=f.messages[0];assert.ok(m);const code=m.text.match(/\b\d{8}\b/)[0],token=m.text.match(/#token=([A-Za-z0-9_-]{43})/)[1];const serialized=JSON.stringify(f.db.prepare('SELECT * FROM email_signin_challenges').all())+JSON.stringify(f.db.prepare('SELECT * FROM email_signin_outbox').all());assert.ok(!serialized.includes(token));assert.ok(!serialized.includes(code));assert.equal((await call(f,'/api/auth/email/verify',{code},{headers:{cookie:cookie(r)}})).statusCode,200);});
test('delivery retries retain one idempotency key and do not disclose provider errors',async t=>{const f=fixture(t);f.failDelivery(true);const r=await call(f,'/api/auth/email/request',{email:'owner@company.test',remember:false});assert.equal(r.statusCode,202);await f.auth.processOutbox();f.advance(60000);f.failDelivery(false);await f.auth.processOutbox();assert.equal(f.messages.length,2);assert.equal(f.messages[0].idempotencyKey,f.messages[1].idempotencyKey);assert.equal(f.messages[0].text,f.messages[1].text);assert.ok(!r.body.includes('provider'));});
test('configuration or encryption-key rotation invalidates outstanding challenges',async t=>{const f=fixture(t),s=await begin(f);f.env.WFM_EMAIL_SIGNIN_KEY=randomBytes(32).toString('hex');assert.equal((await verify(f,s)).statusCode,403);});
test('origin, host, content-type, injected identity and query credentials are refused',async t=>{const f=fixture(t),s=await begin(f);for(const headers of [{origin:'https://evil.test'},{host:'evil.test'},{'x-forwarded-proto':'http'},{'sec-fetch-site':'cross-site'},{'content-type':'text/plain'},...FORBIDDEN_IDENTITY_HEADERS.map(k=>({[k]:'forged'}))]){const r=await call(f,'/api/auth/email/verify',{code:s.code},{headers:{cookie:s.cookie,...headers}});assert.ok([403,415].includes(r.statusCode));}const q=await call(f,'/api/auth/email/verify?token='+s.token,{}, {method:'GET'});assert.notEqual(q.statusCode,200);assert.equal((await verify(f,s)).statusCode,200);});
test('audit failure rolls back session creation and code consumption together',async t=>{const f=fixture(t),s=await begin(f);f.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'disk failure'); END;");assert.equal((await verify(f,s)).statusCode,503);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);f.db.exec('DROP TRIGGER fail_audit');assert.equal((await verify(f,s)).statusCode,200);});
test('remembered access is explicitly bounded and still revocable by the existing guard',async t=>{const f=fixture(t),s=await begin(f,true),r=await verify(f,s);const c=r.headers['set-cookie'].find(x=>x.startsWith('wfm_session='));assert.match(c,/Max-Age=43200/);f.guard.securityControlForTests().bumpEpoch('northstar-demo');const response=res();assert.equal(f.guard.beforeRequest({url:'/api/state',method:'GET',headers:{cookie:c.split(';')[0]}},response),true);assert.equal(response.statusCode,401);});
test('malformed and oversized input cannot create sessions',async t=>{const f=fixture(t);for(const body of ['{','"scalar"',JSON.stringify({email:'owner@company.test',remember:false,role:'director'}),'x'.repeat(4097)]){const r=await call(f,'/api/auth/email/request',body);assert.ok([400,413].includes(r.statusCode));}assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);});

test('changing the configured database cannot authenticate against the cached original database',async t=>{
  const f=fixture(t),s=await begin(f);
  f.env.WFM_DB=f.env.WFM_DB+'.different';
  assert.equal((await verify(f,s)).statusCode,503);
  assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
});
test('the root redirects an expired session to email sign-in while password fallback stays unauthenticated',async t=>{
  const f=fixture(t),root=await call(f,'/',{}, {method:'GET',headers:{cookie:'wfm_session=expired'}});
  assert.equal(root.statusCode,303);assert.equal(root.headers.location,'/sign-in');
  assert.match(root.headers['set-cookie'],/Max-Age=0/);
  const fallback=await call(f,'/?password=1',{}, {method:'GET',headers:{cookie:'wfm_session=expired'}});
  assert.equal(fallback.handled,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
});
test('the passwordless page uses a strict nonce policy, explicit confirmation and no third-party scripts',async t=>{
  const f=fixture(t),r=await call(f,'/sign-in',{}, {method:'GET'});
  assert.equal(r.statusCode,200);assert.equal(r.headers['referrer-policy'],'no-referrer');
  assert.match(r.headers['content-security-policy'],/frame-ancestors 'none'/);
  assert.match(r.body,/Continue securely/);assert.match(r.body,/history.replaceState/);
  assert.doesNotMatch(r.body,/<script[^>]+src=/);
});
test('pending delivery ciphertext contains neither recipient nor bearer credentials',async t=>{
  const f=fixture(t);await call(f,'/api/auth/email/request',{email:'owner@company.test',remember:false});
  const pending=f.db.prepare('SELECT payload FROM email_signin_outbox').get().payload;
  assert.ok(pending.length>100);assert.ok(!pending.includes('owner@company.test'));
  await f.auth.processOutbox();const m=f.messages[0];
  assert.ok(!pending.includes(m.text.match(/\b\d{8}\b/)[0]));
  assert.ok(!pending.includes(m.text.match(/#token=([A-Za-z0-9_-]{43})/)[1]));
});

test('existing recovery wrapper routes the new authentication page without enabling owner recovery',async t=>{
  const f=fixture(t);f.env.WFM_EMAIL_SIGNIN_ENABLED='false';
  const wrapper=authModule.createOwnerAccessRecovery({env:f.env});
  f.env.WFM_EMAIL_SIGNIN_ENABLED='true';
  const wrapped={auth:wrapper};
  assert.equal((await call(wrapped,'/sign-in',{}, {method:'GET'})).statusCode,200);
  assert.equal((await call(wrapped,'/api/owner-access-recovery',{})).statusCode,404);
  assert.equal((await call(wrapped,'/api/login',{})).handled,false);
});
test('independent workers can consume an email code only once',async t=>{
  const {Worker}=require('node:worker_threads');
  const f=fixture(t),s=await begin(f),gate=new SharedArrayBuffer(4);
  const source=`const {workerData,parentPort}=require('node:worker_threads');const {Readable}=require('node:stream');const {createEmailSignIn}=require(workerData.module);const a=createEmailSignIn({env:workerData.env,autoSend:false});parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.gate),0,0);const r=Readable.from([JSON.stringify({code:workerData.code})]);Object.assign(r,{url:'/api/auth/email/verify',method:'POST',headers:{host:'vector.company.test',origin:'https://vector.company.test','x-forwarded-proto':'https','content-type':'application/json',cookie:workerData.cookie}});const response={setHeader(){},end(){}};a.handleRequest(r,response).then(()=>{parentPort.postMessage(response.statusCode);a.close();});`;
  const workers=Array.from({length:4},()=>new Worker(source,{eval:true,workerData:{module:require.resolve('./owner-access-recovery.cjs'),env:f.env,gate,code:s.code,cookie:s.cookie}}));
  t.after(async()=>{await Promise.all(workers.map(w=>w.terminate()));});
  await Promise.all(workers.map(w=>new Promise((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);}))); 
  const results=workers.map(w=>new Promise((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);}));
  Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0);
  assert.deepEqual((await Promise.all(results)).sort(),[200,403,403,403]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM audit_events').get().n,1);
});

test('a rate-limited resend preserves the existing browser challenge cookie',async t=>{
  const f=fixture(t),s=await begin(f);
  for(let i=1;i<5;i++)await call(f,'/api/auth/email/request',{email:'owner@company.test',remember:false});
  const limited=await call(f,'/api/auth/email/request',{email:'owner@company.test',remember:false},{headers:{cookie:s.cookie}});
  assert.equal(limited.statusCode,202);assert.equal(limited.headers['set-cookie'],undefined);
  assert.equal((await verify(f,s)).statusCode,200);
});
test('global and network request limits bound new per-address counters',async t=>{
  const f=fixture(t);
  for(let i=0;i<240;i++)await call(f,'/api/auth/email/request',{email:'unknown'+i+'@company.test',remember:false});
  assert.ok(f.db.prepare('SELECT count(*) n FROM email_signin_rates').get().n<=52);
});
