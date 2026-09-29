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
