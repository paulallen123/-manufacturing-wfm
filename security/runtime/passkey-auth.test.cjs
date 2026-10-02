'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, createHash, generateKeyPairSync, sign } = require('node:crypto');
const { encodeCBOR } = require('@levischuck/tiny-cbor');
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');
let moduleUnderTest;
try { moduleUnderTest = require('./passkey-auth.cjs'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
const hash = value => createHash('sha256').update(value).digest();
const b64 = value => Buffer.from(value).toString('base64url');

function fixture(t, extra = {}) {
  assert.ok(moduleUnderTest, 'Customer passkey authentication boundary is missing');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-passkey-'));
  const dbPath = path.join(dir, 'db.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);
    CREATE TABLE implementation_invitations(id TEXT PRIMARY KEY,tenant TEXT,recipient_hash TEXT,token_hash TEXT,status TEXT,expires_at_ms INTEGER);`);
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('manager@fixture.example','fixture','manager');
  const guard = createIdentitySurvivalGuard({dbPath});
  const token = randomBytes(32).toString('base64url');
  const digest = hash(token).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest,'manager@fixture.example',Date.now()+600000);
  db.prepare('INSERT INTO proof_runner_sessions VALUES(?,?,?,?,?,?)').run(digest,'manager@fixture.example','fixture','manager',Date.now(),Date.now()+600000);
  const origin = 'https://vector.test';
  const auth = moduleUnderTest.createPasskeyAuth({dbPath,publicOrigin:origin,hosted:true,nodeEnv:'staging',...extra});
  const f = {db,auth,guard,origin,token,session:'wfm_session='+token};
  t.after(()=>{auth.close();guard.securityControlForTests().db.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
  f.call = async (route, body = {}, cookie = '', headers = {}) => {
    const req = Readable.from([JSON.stringify(body)]);
    req.method='POST';req.url='/api/passkeys/'+route;
    req.headers={origin,'x-forwarded-proto':'https','content-type':'application/json',cookie,...headers};
    req.socket={};
    const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(v){this.text=String(v);this.writableEnded=true;}};
    await auth.handleRequest(req,res);
    res.body=JSON.parse(res.text||'{}');
    res.cookies=[res.headers['set-cookie']||[]].flat().map(v=>v.split(';')[0]).filter(v=>!v.endsWith('=')).join('; ');
    return res;
  };
  return f;
}

// Independent test authenticator signs real WebAuthn transcripts. Production verification is never mocked.
function authenticator(options, overrides={}) {
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const jwk=keys.publicKey.export({format:'jwk'});
  const id=randomBytes(32);
  const cose=encodeCBOR(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
  const rp=overrides.rp||'vector.test';
  const client=(type,challenge,origin='https://vector.test')=>Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false}));
  const data=(flags,counter)=>{const n=Buffer.alloc(4);n.writeUInt32BE(counter);return Buffer.concat([hash(rp),Buffer.from([flags]),n]);};
  const length=Buffer.alloc(2);length.writeUInt16BE(id.length);
  const authData=Buffer.concat([data(overrides.flags??0x45,0),Buffer.alloc(16),length,id,cose]);
  const attestation=encodeCBOR(new Map([['fmt','none'],['attStmt',new Map()],['authData',authData]]));
  return {id:b64(id),registration:{id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{credProps:{rk:true}},
    response:{attestationObject:b64(attestation),clientDataJSON:b64(client('webauthn.create',overrides.challenge||options.challenge,overrides.origin)),transports:['internal']}},
    assertion(authOptions, change={}) {
      const cd=client('webauthn.get',change.challenge||authOptions.challenge,change.origin);
      const ad=data(change.flags??0x05,change.counter??1);
      const signature=sign('sha256',Buffer.concat([ad,hash(cd)]),change.privateKey||keys.privateKey);
      return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(cd),authenticatorData:b64(ad),signature:b64(signature),userHandle:change.userHandle??options.user.id}};
    }};
}
async function enroll(f, options={}) {
  const started=await f.call('register/options',{},f.session);
  assert.equal(started.statusCode,200,started.text);
  assert.equal(started.body.authenticatorSelection.userVerification,'required');
  assert.equal(started.body.authenticatorSelection.residentKey,'required');
  const device=authenticator(started.body,options);
  const finished=await f.call('register/verify',{response:device.registration},f.session+'; '+started.cookies);
  return {device,started,finished};
}
test('customer enrolment and discoverable passkey sign-in issue identity-bound secure sessions',async t=>{
  const f=fixture(t);const {device,finished}=await enroll(f);
  assert.equal(finished.statusCode,200,finished.text);
  const start=await f.call('authenticate/options');
  assert.equal(start.statusCode,200);assert.equal(start.body.userVerification,'required');
  assert.ok(!start.body.allowCredentials?.length);
  const result=await f.call('authenticate/verify',{response:device.assertion(start.body)},start.cookies);
  assert.equal(result.statusCode,200,result.text);
  assert.match(String(result.headers['set-cookie']),/HttpOnly/);assert.match(String(result.headers['set-cookie']),/Secure/);
  const guardRes={setHeader(){},end(value){this.body=value;}};
  assert.equal(f.guard.beforeRequest({method:'GET',url:'/api/bootstrap',headers:{cookie:result.cookies}},guardRes),false);
  assert.equal(f.db.prepare("SELECT issuer FROM identity_session_bindings ORDER BY bound_at DESC LIMIT 1").get().issuer,'wfm-passkey');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM passkey_events').get().n,2);
});
test('bare email and password-only sessions cannot bootstrap a passkey',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('register/options',{email:'manager@fixture.example'})).statusCode,400);
  f.db.exec('DELETE FROM proof_runner_sessions');
  assert.equal((await f.call('register/options',{},f.session)).statusCode,401);
});
test('fixture proof enrolment is refused outside staging',async t=>{
  const f=fixture(t,{hosted:false,nodeEnv:'production'});
  assert.equal((await f.call('register/options',{},f.session)).statusCode,401);
});
for (const change of [{origin:'https://attacker.test'},{challenge:'forged'},{flags:0x41},{rp:'attacker.test'}]) {
  test('registration rejects invalid origin, challenge, UV or RP '+JSON.stringify(change),async t=>{
    const f=fixture(t);const {finished}=await enroll(f,change);
    assert.equal(finished.statusCode,401);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM passkey_credentials').get().n,0);
  });
}
test('registration challenge is browser bound, one use, and expires',async t=>{
  const f=fixture(t);const {device,started,finished}=await enroll(f);
  assert.equal(finished.statusCode,200);
  assert.equal((await f.call('register/verify',{response:device.registration},f.session+'; '+started.cookies)).statusCode,401);
  const next=await f.call('register/options',{},finished.cookies);
  f.db.exec('UPDATE passkey_challenges SET expires=0');
  assert.equal((await f.call('register/verify',{response:authenticator(next.body).registration},finished.cookies+'; '+next.cookies)).statusCode,401);
});
test('account scope changes during enrolment are contained',async t=>{
  const f=fixture(t);const started=await f.call('register/options',{},f.session);
  const device=authenticator(started.body);
  f.db.exec("UPDATE users SET role='director'");
  assert.equal((await f.call('register/verify',{response:device.registration},f.session+'; '+started.cookies)).statusCode,401);
});
for (const change of [{origin:'https://attacker.test'},{challenge:'forged'},{flags:0x01},{userHandle:'wrong'},{counter:0}]) {
  test('authentication rejects invalid signed assertion '+JSON.stringify(change),async t=>{
    const f=fixture(t);const {device,finished}=await enroll(f);assert.equal(finished.statusCode,200);
    const first=await f.call('authenticate/options');
    assert.equal((await f.call('authenticate/verify',{response:device.assertion(first.body)},first.cookies)).statusCode,200);
    const start=await f.call('authenticate/options');
    const result=await f.call('authenticate/verify',{response:device.assertion(start.body,{counter:2,...change})},start.cookies);
    assert.equal(result.statusCode,401);
  });
}
test('concurrent replay issues exactly one session and tampered signatures fail',async t=>{
  const f=fixture(t);const {device}=await enroll(f);const start=await f.call('authenticate/options');
  const body={response:device.assertion(start.body)};
  const results=await Promise.all([f.call('authenticate/verify',body,start.cookies),f.call('authenticate/verify',body,start.cookies)]);
  assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,401]);
  const next=await f.call('authenticate/options');const forged=device.assertion(next.body,{counter:2});
  forged.response.signature=b64(randomBytes(64));
  assert.equal((await f.call('authenticate/verify',{response:forged},next.cookies)).statusCode,401);
});
test('passkey session is contained on role drift and credential revocation',async t=>{
  const f=fixture(t);const {finished,device}=await enroll(f);assert.equal(finished.statusCode,200);
  f.db.exec("UPDATE users SET role='director'");
  const res={setHeader(){},end(){}};
  assert.equal(f.guard.beforeRequest({method:'GET',url:'/api/bootstrap',headers:{cookie:finished.cookies}},res),true);
  assert.equal(res.statusCode,401);
  f.db.prepare('UPDATE passkey_credentials SET revoked_at=? WHERE id=?').run(Date.now(),device.id);
  const start=await f.call('authenticate/options');
  assert.equal((await f.call('authenticate/verify',{response:device.assertion(start.body)},start.cookies)).statusCode,401);
});
test('origin, transport and body authority injection are denied before enrolment',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('register/options',{},f.session,{origin:'https://evil.test'})).statusCode,403);
  assert.equal((await f.call('register/options',{},f.session,{'x-forwarded-proto':'http'})).statusCode,403);
  assert.equal((await f.call('register/options',{tenant:'other',role:'director'},f.session)).statusCode,400);
});
test('secure invitation enrols only its existing recipient once',async t=>{
  const f=fixture(t);const invitation=randomBytes(32).toString('base64url');
  f.db.prepare('INSERT INTO implementation_invitations VALUES(?,?,?,?,?,?)').run('i1','fixture',hash('manager@fixture.example').toString('hex'),hash(invitation).toString('hex'),'PENDING',Date.now()+600000);
  const started=await f.call('register/options',{invitation});assert.equal(started.statusCode,200,started.text);
  const device=authenticator(started.body);
  const done=await f.call('register/verify',{response:device.registration,invitation},started.cookies);
  assert.equal(done.statusCode,200,done.text);
  assert.equal((await f.call('register/options',{invitation})).statusCode,401);
});
test('last remaining passkey cannot be removed',async t=>{
  const f=fixture(t);const {device,finished}=await enroll(f);
  const result=await f.call('revoke',{credentialId:device.id},finished.cookies);
  assert.equal(result.statusCode,409);
});
test('fresh authentication replaces a stale cookie and entry removes invalid session authority',async t=>{
  const f=fixture(t);const {device,finished}=await enroll(f);
  f.db.exec("UPDATE users SET role='director'");
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.text=String(v);}};
  assert.equal(f.auth.serveEntry({method:'GET',url:'/',headers:{cookie:finished.cookies}},res),true);
  assert.match(res.text,/Sign in with a passkey/);assert.doesNotMatch(res.text,/type=["']password/);
  assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
  const start=await f.call('authenticate/options',{},finished.cookies);
  const done=await f.call('authenticate/verify',{response:device.assertion(start.body)},finished.cookies+'; '+start.cookies);
  assert.equal(done.statusCode,200);
});
test('audit failure cannot leave a credential or a granted session',async t=>{
  const f=fixture(t);const start=await f.call('register/options',{},f.session);
  const device=authenticator(start.body);
  f.db.exec("CREATE TRIGGER fail_passkey_audit BEFORE INSERT ON passkey_events BEGIN SELECT RAISE(ABORT,'readonly audit'); END");
  const done=await f.call('register/verify',{response:device.registration},f.session+'; '+start.cookies);
  assert.equal(done.statusCode,401);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM passkey_credentials').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM passkey_sessions').get().n,0);
});
test('second device can be enrolled and a revoked key loses its sessions',async t=>{
  const f=fixture(t);const first=await enroll(f);f.session=first.finished.cookies;
  const second=await enroll(f);assert.equal(second.finished.statusCode,200);
  const revoke=await f.call('revoke',{credentialId:first.device.id},second.finished.cookies);
  assert.equal(revoke.statusCode,200);
  assert.ok(f.db.prepare('SELECT revoked_at FROM passkey_credentials WHERE id=?').get(first.device.id).revoked_at);
  const next=await f.call('authenticate/options');
  assert.equal((await f.call('authenticate/verify',{response:first.device.assertion(next.body)},next.cookies)).statusCode,401);
});


function firstOwnerFixture(t) {
  const env = {};
  const f = fixture(t, { ownerRecoveryEnv: env });
  const dbPath = f.db.prepare('PRAGMA database_list').get().file;
  f.db.exec('ALTER TABLE users ADD COLUMN person_id TEXT; ALTER TABLE users ADD COLUMN password_hash TEXT; ALTER TABLE users ADD COLUMN permissions TEXT; CREATE TABLE audit_events(id INTEGER PRIMARY KEY,tenant TEXT,actor TEXT,action TEXT,detail TEXT,created_at TEXT);');
  f.db.prepare('INSERT INTO users(email,tenant,role,person_id,password_hash,permissions) VALUES(?,?,?,?,?,?)').run('superuser@northstar.example','northstar-demo','director','d1','unchanged-password','["company.configure"]');
  f.guard.securityControlForTests().setFreeze('northstar-demo',false);
  const token = randomBytes(32).toString('base64url');
  const grant = {id:randomBytes(16).toString('hex'),tokenHash:hash(token).toString('hex'),issuedAt:Date.now()-1000,expiresAt:Date.now()+600000,sessionEpoch:1,policyVersion:1,purpose:'first-passkey'};
  Object.assign(env,{NODE_ENV:'staging',WFM_HOSTED_STAGING:'true',WFM_DB:dbPath,WFM_PUBLIC_ORIGIN:f.origin,WFM_OWNER_RECOVERY_JSON:JSON.stringify(grant)});
  return {...f,env,grant,recoveryToken:token,dbPath};
}
async function firstOwnerOptions(f) { return f.call('register/options',{ownerRecovery:f.recoveryToken}); }
async function firstOwnerRegister(f, started) {
  const device=authenticator(started.body);
  const finished=await f.call('register/verify',{ownerRecovery:f.recoveryToken,response:device.registration},started.cookies);
  return {device,finished};
}
test('first owner passkey setup produces a real verified credential and fresh sign-in without changing existing authority',async t=>{
  const f=firstOwnerFixture(t);
  const before=f.db.prepare('SELECT * FROM users WHERE email=?').get('superuser@northstar.example');
  const started=await firstOwnerOptions(f);assert.equal(started.statusCode,200,started.text);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM owner_recovery_ledger').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM passkey_credentials').get().n,0);
  const {device,finished}=await firstOwnerRegister(f,started);assert.equal(finished.statusCode,200,finished.text);
  assert.deepEqual(f.db.prepare('SELECT * FROM users WHERE email=?').get(before.email),before);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM owner_recovery_ledger').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM passkey_credentials WHERE tenant=? AND email=?').get(before.tenant,before.email).n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions WHERE email=?').get('manager@fixture.example').n,1);
  const fresh=await f.call('authenticate/options');
  const result=await f.call('authenticate/verify',{response:device.assertion(fresh.body)},fresh.cookies);
  assert.equal(result.statusCode,200,result.text);
  const guarded={setHeader(){},end(value){this.body=value;}};
  assert.equal(f.guard.beforeRequest({method:'GET',url:'/api/bootstrap',headers:{cookie:result.cookies}},guarded),false);
  const binding=f.db.prepare('SELECT u.tenant,u.role,b.issuer FROM sessions s JOIN users u ON u.email=s.email JOIN identity_session_bindings b ON b.token_hash=s.token_hash ORDER BY b.bound_at DESC LIMIT 1').get();
  assert.deepEqual({...binding},{tenant:'northstar-demo',role:'director',issuer:'wfm-passkey'});
  assert.equal((await firstOwnerOptions(f)).statusCode,401);
  const restarted=moduleUnderTest.createPasskeyAuth({dbPath:f.dbPath,publicOrigin:f.origin,hosted:true,nodeEnv:'staging',ownerRecoveryEnv:f.env});
  
  const req=Readable.from([JSON.stringify({ownerRecovery:f.recoveryToken})]);req.method='POST';req.url='/api/passkeys/register/options';req.headers={origin:f.origin,'x-forwarded-proto':'https','content-type':'application/json'};req.socket={};
  const res={setHeader(){},end(v){this.text=v;}};try {await restarted.handleRequest(req,res);assert.equal(res.statusCode,401);} finally {restarted.close();}
  const audit=JSON.stringify(f.db.prepare('SELECT * FROM audit_events').all());
  assert.ok(!audit.includes(f.recoveryToken));assert.match(audit,/owner-first-passkey-enrolled/);
});
test('first-passkey grant is not consumed by cancellation or invalid attestation',async t=>{
  const f=firstOwnerFixture(t);const first=await firstOwnerOptions(f);assert.equal(first.statusCode,200);
  const second=await firstOwnerOptions(f);assert.equal(second.statusCode,200);
  const bad=authenticator(second.body,{origin:'https://attacker.test'});
  assert.equal((await f.call('register/verify',{ownerRecovery:f.recoveryToken,response:bad.registration},second.cookies)).statusCode,401);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM owner_recovery_ledger').get().n,0);
  const retry=await firstOwnerOptions(f);assert.equal(retry.statusCode,200);
  assert.equal((await firstOwnerRegister(f,retry)).finished.statusCode,200);
});
for(const changed of ['disabled','expired','wrong-token','wrong-person','wrong-tenant','wrong-role','freeze','epoch','policy','password-purpose','origin']) {
  test('first-passkey setup refuses '+changed+' without creating credentials or sessions',async t=>{
    const f=firstOwnerFixture(t);
    if(changed==='disabled')delete f.env.WFM_OWNER_RECOVERY_JSON;
    if(changed==='expired'){f.grant.issuedAt=Date.now()-600000;f.grant.expiresAt=Date.now()-1;f.env.WFM_OWNER_RECOVERY_JSON=JSON.stringify(f.grant);}
    if(changed==='wrong-token')f.recoveryToken=randomBytes(32).toString('base64url');
    if(changed==='wrong-person')f.db.prepare('UPDATE users SET person_id=? WHERE email=?').run('d2','superuser@northstar.example');
    if(changed==='wrong-tenant')f.db.prepare('UPDATE users SET tenant=? WHERE email=?').run('other-tenant','superuser@northstar.example');
    if(changed==='wrong-role')f.db.prepare('UPDATE users SET role=? WHERE email=?').run('manager','superuser@northstar.example');
    if(changed==='freeze')f.guard.securityControlForTests().setFreeze('northstar-demo',true);
    if(changed==='epoch')f.db.prepare('UPDATE identity_tenant_control SET session_epoch=2 WHERE tenant=?').run('northstar-demo');
    if(changed==='policy')f.db.prepare('UPDATE identity_tenant_control SET policy_version=2 WHERE tenant=?').run('northstar-demo');
    if(changed==='password-purpose'){delete f.grant.purpose;f.env.WFM_OWNER_RECOVERY_JSON=JSON.stringify(f.grant);}
    if(changed==='origin')f.env.WFM_PUBLIC_ORIGIN='https://different.test';
    assert.equal((await firstOwnerOptions(f)).statusCode,401);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM passkey_credentials').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
  });
}
for(const changed of ['revoked','expired','epoch','policy','freeze','account','grant-renewed']) {
  test('first-passkey authority is rechecked at final verification after '+changed,async t=>{
    const f=firstOwnerFixture(t);const start=await firstOwnerOptions(f);assert.equal(start.statusCode,200);
    if(changed==='revoked')delete f.env.WFM_OWNER_RECOVERY_JSON;
    if(changed==='expired'){f.grant.expiresAt=Date.now()-1;f.env.WFM_OWNER_RECOVERY_JSON=JSON.stringify(f.grant);}
    if(changed==='epoch')f.db.prepare('UPDATE identity_tenant_control SET session_epoch=2 WHERE tenant=?').run('northstar-demo');
    if(changed==='policy')f.db.prepare('UPDATE identity_tenant_control SET policy_version=2 WHERE tenant=?').run('northstar-demo');
    if(changed==='freeze')f.guard.securityControlForTests().setFreeze('northstar-demo',true);
    if(changed==='account')f.db.prepare('UPDATE users SET person_id=? WHERE email=?').run('d2','superuser@northstar.example');
    if(changed==='grant-renewed'){f.grant.expiresAt+=1000;f.env.WFM_OWNER_RECOVERY_JSON=JSON.stringify(f.grant);}
    assert.equal((await firstOwnerRegister(f,start)).finished.statusCode,401);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM passkey_credentials').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM owner_recovery_ledger').get().n,0);
  });
}
test('two real owner setup challenges allow only one credential and one consumed grant',async t=>{
  const f=firstOwnerFixture(t);const a=await firstOwnerOptions(f);const b=await firstOwnerOptions(f);
  assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);
  assert.equal((await firstOwnerRegister(f,a)).finished.statusCode,200);
  assert.equal((await firstOwnerRegister(f,b)).finished.statusCode,401);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM passkey_credentials').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM owner_recovery_ledger').get().n,1);
});
test('owner setup audit failure rolls back credential, grant consumption and session together',async t=>{
  const f=firstOwnerFixture(t);const start=await firstOwnerOptions(f);assert.equal(start.statusCode,200);
  f.db.exec("CREATE TRIGGER fail_owner_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit unavailable'); END;");
  assert.equal((await firstOwnerRegister(f,start)).finished.statusCode,401);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM passkey_credentials').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM owner_recovery_ledger').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
});


function ownerSetupUi(t, {cancel=false,code='A'.repeat(43)}={}) {
  const vm=require('node:vm');const calls=[],navigations=[];
  const elements=Object.fromEntries(['status','sign-in','enroll','heading','intro','continue','owner-recovery-code'].map(id=>[id,{hidden:id==='enroll',disabled:false,value:id==='owner-recovery-code'?code:'',textContent:'',events:{},addEventListener(event,fn){this.events[event]=fn;}}]));
  const context={document:{getElementById(id){return elements[id];}},location:{search:'',hash:'',pathname:'/access-recovery',replace(url){navigations.push(url);}},history:{replaceState(){throw Error('Recovery code must not enter the URL');}},URLSearchParams,window:{PublicKeyCredential:{}},SimpleWebAuthnBrowser:{async startRegistration(){if(cancel){const e=Error('cancelled');e.name='NotAllowedError';throw e;}return {id:'synthetic-browser-ui-only'};}},fetch:async(url,init)=>{calls.push({url,body:init?.body?JSON.parse(init.body):null});return{ok:true,async json(){return url.includes('status')?{canEnroll:false}:{challenge:'browser-ui-test'};}};}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'passkey-ui.js'),'utf8'),context);
  return{elements,calls,navigations};
}
test('shared owner setup UI sends the privately typed code only to same-origin enrolment and clears it on success',async t=>{
  const u=ownerSetupUi(t);assert.equal(u.elements['sign-in'].hidden,true);assert.equal(u.elements.enroll.hidden,false);
  await u.elements.enroll.events.click();
  assert.deepEqual(u.calls.map(x=>x.url),['/api/passkeys/register/options','/api/passkeys/register/verify']);
  assert.equal(u.calls[0].body.ownerRecovery,'A'.repeat(43));assert.equal(u.calls[1].body.ownerRecovery,'A'.repeat(43));
  assert.equal(u.elements['owner-recovery-code'].value,'');assert.deepEqual(u.navigations,['/']);
});
test('shared owner setup UI contains cancellation without a verification request or false success',async t=>{
  const u=ownerSetupUi(t,{cancel:true});await u.elements.enroll.events.click();
  assert.equal(u.calls.length,1);assert.equal(u.navigations.length,0);
  assert.match(u.elements.status.textContent,/Passkey setup was cancelled/);assert.equal(u.elements.enroll.disabled,false);
});
test('shared owner setup UI rejects missing setup code before any request',async t=>{
  const u=ownerSetupUi(t,{code:''});await u.elements.enroll.events.click();
  assert.equal(u.calls.length,0);assert.equal(u.navigations.length,0);assert.match(u.elements.status.textContent,/setup code/);
});


test('four independent SQLite workers can redeem first-passkey authority only once',async t=>{
  const {Worker}=require('node:worker_threads');const f=firstOwnerFixture(t);f.db.exec('PRAGMA journal_mode=WAL');
  const attempts=[];for(let i=0;i<4;i++){const started=await firstOwnerOptions(f);assert.equal(started.statusCode,200);attempts.push({body:{ownerRecovery:f.recoveryToken,response:authenticator(started.body).registration},cookie:started.cookies});}
  const gate=new SharedArrayBuffer(4);
  const workerCode=String.raw`const{workerData,parentPort}=require('node:worker_threads');const{Readable}=require('node:stream');const{createPasskeyAuth}=require(workerData.module);const auth=createPasskeyAuth(workerData.options);parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.gate),0,0);const req=Readable.from([JSON.stringify(workerData.attempt.body)]);req.method='POST';req.url='/api/passkeys/register/verify';req.headers={origin:workerData.options.publicOrigin,'x-forwarded-proto':'https','content-type':'application/json',cookie:workerData.attempt.cookie};req.socket={};const res={setHeader(){},end(){}};auth.handleRequest(req,res).then(()=>{auth.close();parentPort.postMessage(res.statusCode);}).catch(e=>{auth.close();throw e;});`;
  const workers=attempts.map(attempt=>new Worker(workerCode,{eval:true,workerData:{module:require.resolve('./passkey-auth.cjs'),options:{dbPath:f.dbPath,publicOrigin:f.origin,hosted:true,nodeEnv:'staging',ownerRecoveryEnv:f.env},attempt,gate}}));
  t.after(async()=>{await Promise.all(workers.map(w=>w.terminate()));});
  await Promise.all(workers.map(w=>new Promise((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);}))); 
  const results=workers.map(w=>new Promise((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);}));
  Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0);
  assert.deepEqual((await Promise.all(results)).sort(),[200,401,401,401]);await Promise.all(workers.map(w=>w.terminate()));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM passkey_credentials').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM owner_recovery_ledger').get().n,1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='owner-first-passkey-enrolled'").get().n,1);
});
test('first-passkey purpose refuses replacement credentials and durably revoked authority',async t=>{
  const f=firstOwnerFixture(t);const start=await firstOwnerOptions(f);assert.equal(start.statusCode,200);
  f.db.prepare('INSERT INTO owner_recovery_ledger VALUES(?,?,?,?)').run(f.grant.tokenHash,f.grant.id,'revoked',new Date().toISOString());
  assert.equal((await firstOwnerRegister(f,start)).finished.statusCode,401);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM passkey_credentials').get().n,0);
  const token=randomBytes(32).toString('base64url');f.recoveryToken=token;f.grant={...f.grant,id:randomBytes(16).toString('hex'),tokenHash:hash(token).toString('hex')};f.env.WFM_OWNER_RECOVERY_JSON=JSON.stringify(f.grant);
  const second=await firstOwnerOptions(f);assert.equal(second.statusCode,200);assert.equal((await firstOwnerRegister(f,second)).finished.statusCode,200);
  const replacement=randomBytes(32).toString('base64url');f.recoveryToken=replacement;f.grant={...f.grant,id:randomBytes(16).toString('hex'),tokenHash:hash(replacement).toString('hex')};f.env.WFM_OWNER_RECOVERY_JSON=JSON.stringify(f.grant);
  assert.equal((await firstOwnerOptions(f)).statusCode,401);
  f.db.prepare('UPDATE passkey_credentials SET revoked_at=? WHERE tenant=?').run(Date.now(),'northstar-demo');
  assert.equal((await firstOwnerOptions(f)).statusCode,401);
});
