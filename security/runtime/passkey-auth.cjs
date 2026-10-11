'use strict';
const { createHash, randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { ensurePasskeySchema } = require('./passkey-schema.cjs');
const { authorizeFirstOwnerPasskey, consumeFirstOwnerPasskey } = require('./owner-access-recovery.cjs');
const { FORBIDDEN_IDENTITY_HEADERS } = require('./identity-survival-guard.cjs');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const TTL=5*60_000;
function cookie(req,name) { return String(req.headers?.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||''; }
function json(res,status,body,headers={}) {
  res.statusCode=status;
  for(const [key,value] of Object.entries({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}))res.setHeader(key,value);
  res.end(JSON.stringify(body));return true;
}
function denied(status=401) { const e=new Error('Passkey verification refused. Start again or use another registered device.');e.status=status;return e; }
async function readJson(req) {
  let body='';let size=0;
  for await(const chunk of req) {size+=Buffer.byteLength(chunk);if(size>65536)throw denied(413);body+=chunk;}
  try {const result=JSON.parse(body||'{}');if(!result||typeof result!=='object'||Array.isArray(result))throw new Error();return result;}catch{throw denied(400);}
}
function createPasskeyAuth(options={}) {
  const origin=String(options.publicOrigin||process.env.WFM_PUBLIC_ORIGIN||'').replace(/\/$/,'');
  const originURL=new URL(origin);
  if(originURL.origin!==origin||originURL.protocol!=='https:')throw new Error('Passkeys require a canonical HTTPS origin.');
  const rpID=originURL.hostname;
  const fixtureProof=(options.hosted??process.env.WFM_HOSTED_STAGING==='true')&&(options.nodeEnv||process.env.NODE_ENV)==='staging';
  const db=new DatabaseSync(options.dbPath||process.env.WFM_DB);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;');ensurePasskeySchema(db);
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  function transaction(fn) {db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
  function user(email){return get('SELECT email,tenant,role FROM users WHERE email=?',email);}
  function scope(u) {
    const control=get('SELECT * FROM identity_tenant_control WHERE tenant=?',u.tenant);
    return {epoch:Number(control?.session_epoch||1),policy:Number(control?.policy_version||1),frozen:Number(control?.privileged_freeze||0)};
  }
  function session(req) {
    const tokenHash=hash(cookie(req,'wfm_session'));
    const row=get('SELECT s.*,u.tenant,u.role FROM sessions s JOIN users u ON s.email=u.email WHERE s.token_hash=? AND s.expires>?',tokenHash,Date.now());
    if(!row)return null;
    const passkey=get('SELECT * FROM passkey_sessions WHERE token_hash=?',tokenHash);
    const proof=fixtureProof?get('SELECT * FROM proof_runner_sessions WHERE token_hash=?',tokenHash):null;
    const metadata=passkey||proof;
    if(!metadata||metadata.email!==row.email||metadata.tenant!==row.tenant||metadata.role!==row.role||metadata.expires<=Date.now()||metadata.issued_at<Date.now()-TTL)return null;
    if(passkey&&!get('SELECT id FROM passkey_credentials WHERE id=? AND tenant=? AND email=? AND revoked_at IS NULL',passkey.credential_id,row.tenant,row.email))return null;
    const control=scope(row);const binding=get('SELECT * FROM identity_session_bindings WHERE token_hash=?',tokenHash);
    if(control.frozen||binding&&(binding.tenant!==row.tenant||binding.audience!=='wfm-api'||binding.session_epoch!==control.epoch||binding.policy_version!==control.policy||binding.issuer!==(passkey?'wfm-passkey':'wfm-proof-runner')))return null;
    return {email:row.email,tenant:row.tenant,role:row.role,kind:passkey?'passkey':'proof',source:tokenHash,...control};
  }
  function authorize(req,body) {
    if (Object.hasOwn(body,'ownerRecovery')) {
      if (Object.hasOwn(body,'invitation')) throw denied();
      try { return authorizeFirstOwnerPasskey({env:options.ownerRecoveryEnv||process.env,db,token:body.ownerRecovery,origin,dbPath:options.dbPath||process.env.WFM_DB}); } catch { throw denied(); }
    }
    if(body.invitation) {
      if(typeof body.invitation!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(body.invitation))throw denied();
      const tokenHash=hash(body.invitation);
      if(get('SELECT 1 FROM passkey_invitation_uses WHERE token_hash=?',tokenHash))throw denied();
      let invite;try{invite=get("SELECT * FROM implementation_invitations WHERE token_hash=? AND status='PENDING' AND expires_at_ms>?",tokenHash,Date.now());}catch{throw denied();}
      if(!invite)throw denied();
      const users=db.prepare('SELECT email,tenant,role FROM users WHERE tenant=?').all(invite.tenant).filter(u=>hash(u.email.trim().toLowerCase())===invite.recipient_hash);
      if(users.length!==1)throw denied();const u=users[0];
      // Signing invitations authorize initial enrolment only. Historical credentials
      // require authenticated device addition or separately authorised recovery.
      if(get('SELECT id FROM passkey_credentials WHERE tenant=? AND email=?',u.tenant,u.email))throw denied();
      if(get("SELECT name FROM sqlite_master WHERE type='table' AND name='organisation_access_initial_authority'")&&
        get("SELECT 1 FROM organisation_access_initial_authority WHERE tenant=? AND lower(owner_email)=lower(?) AND state='REVOKED'",u.tenant,u.email))throw denied();
      const control=scope(u);if(control.frozen)throw denied();
      return {...u,kind:'invitation',source:tokenHash,...control};
    }
    const result=session(req);if(!result)throw denied();return result;
  }
  function sameAuthorization(req,body,expected) {
    const current=authorize(req,body);
    if(JSON.stringify(current)!==JSON.stringify(expected))throw denied();
    return current;
  }
  function rateLimit(req) {
    // Proxy client address is only an abuse signal, never identity authority.
    const ip=String(req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim().slice(0,128);
    const bucket=hash(ip);const now=Date.now();const row=get('SELECT * FROM passkey_rate_limits WHERE bucket=?',bucket);
    if(!row||row.window_start<now-60_000)run('INSERT OR REPLACE INTO passkey_rate_limits VALUES(?,?,?)',bucket,now,1);
    else {if(row.attempts>=120)throw denied(429);run('UPDATE passkey_rate_limits SET attempts=attempts+1 WHERE bucket=?',bucket);}
    run('DELETE FROM passkey_rate_limits WHERE window_start<?',now-120_000);
  }
  function challenge(res,kind,options,authorization=null) {
    const nonce=random();run('DELETE FROM passkey_challenges WHERE expires<?',Date.now()-TTL);
    run('INSERT INTO passkey_challenges(nonce_hash,kind,challenge,authorization,expires) VALUES(?,?,?,?,?)',hash(nonce),kind,options.challenge,authorization?JSON.stringify(authorization):null,Date.now()+TTL);
    return json(res,200,options,{'Set-Cookie':`wfm_passkey_ceremony=${nonce}; Path=/api/passkeys; Max-Age=300; HttpOnly; Secure; SameSite=Strict`});
  }
  function consume(req,kind) {
    return transaction(()=>{
      const nonce=hash(cookie(req,'wfm_passkey_ceremony'));
      const row=get('SELECT * FROM passkey_challenges WHERE nonce_hash=? AND kind=? AND used=0 AND expires>?',nonce,kind,Date.now());
      if(!row)throw denied();run('UPDATE passkey_challenges SET used=1 WHERE nonce_hash=?',nonce);return row;
    });
  }
  function record(u,event,id){run('INSERT INTO passkey_events(email,tenant,event,credential_id,created_at) VALUES(?,?,?,?,?)',u.email,u.tenant,event,id,Date.now());}
  function mint(u,id,req) {
    const token=random();const tokenHash=hash(token);const now=Date.now();const expires=now+30*60_000;
    run('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)',tokenHash,u.email,expires);
    run('INSERT INTO passkey_sessions VALUES(?,?,?,?,?,?,?)',tokenHash,u.email,u.tenant,u.role,id,now,expires);
    const control=scope(u);
    run('INSERT INTO identity_session_bindings VALUES(?,?,?,?,?,?,?)',tokenHash,u.tenant,'wfm-passkey','wfm-api',control.epoch,control.policy,new Date().toISOString());
    const previous=cookie(req,'wfm_session');if(previous)run('DELETE FROM sessions WHERE token_hash=?',hash(previous));
    return [`wfm_session=${token}; Path=/; Max-Age=1800; HttpOnly; Secure; SameSite=Strict`,'wfm_passkey_ceremony=; Path=/api/passkeys; Max-Age=0; HttpOnly; Secure; SameSite=Strict'];
  }
  async function handleRequest(req,res) {
    const route=String(req.url||'').split('?')[0];
    if(!route.startsWith('/api/passkeys/'))return false;
    try {
      if(FORBIDDEN_IDENTITY_HEADERS.some(h=>req.headers?.[h]!==undefined))throw denied(400);
      if(req.method==='GET'&&route==='/api/passkeys/status') {
        const u=session(req);return json(res,200,{canEnroll:!!u,credentialCount:u?get('SELECT COUNT(*) AS n FROM passkey_credentials WHERE tenant=? AND email=? AND revoked_at IS NULL',u.tenant,u.email).n:0});
      }
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed.'},{Allow:'POST'});
      if(req.headers?.origin!==origin||!(req.socket?.encrypted||String(req.headers?.['x-forwarded-proto']||'').split(',')[0].trim()==='https'))throw denied(403);
      if(!/^application\/json(?:;|$)/i.test(String(req.headers?.['content-type']||'')))throw denied(415);
      rateLimit(req);const body=await readJson(req);
      if(['email','tenant','role','permissions','userId'].some(k=>Object.hasOwn(body,k)))throw denied(400);
      if(route==='/api/passkeys/register/options') {
        const u=authorize(req,body);
        const keys=db.prepare('SELECT id,transports FROM passkey_credentials WHERE tenant=? AND email=? AND revoked_at IS NULL').all(u.tenant,u.email);
        if(keys.length>=8)throw denied(409);
        run('INSERT OR IGNORE INTO passkey_users VALUES(?,?,?)',u.tenant,u.email,random());
        const identity=get('SELECT user_handle FROM passkey_users WHERE tenant=? AND email=?',u.tenant,u.email);
        const registration=await generateRegistrationOptions({rpName:'VECTOR',rpID,userName:u.email,userID:Buffer.from(identity.user_handle,'base64url'),attestationType:'none',timeout:TTL,supportedAlgorithmIDs:[-7,-257],authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials:keys.map(k=>({id:k.id,transports:JSON.parse(k.transports)}))});
        sameAuthorization(req,body,u);return challenge(res,'register',registration,u);
      }
      if(route==='/api/passkeys/register/verify') {
        const attempt=consume(req,'register');const u=JSON.parse(attempt.authorization);sameAuthorization(req,body,u);
        const result=await verifyRegistrationResponse({response:body.response,expectedChallenge:attempt.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserPresence:true,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});
        if(!result.verified)throw denied();
        const info=result.registrationInfo;const credential=info.credential;
        const cookies=transaction(()=>{
          if(attempt.expires<=Date.now())throw denied();
          sameAuthorization(req,body,u);
          if(get('SELECT COUNT(*) AS n FROM passkey_credentials WHERE tenant=? AND email=? AND revoked_at IS NULL',u.tenant,u.email).n>=8)throw denied(409);
          const identity=get('SELECT user_handle FROM passkey_users WHERE tenant=? AND email=?',u.tenant,u.email);
          run('INSERT INTO passkey_credentials VALUES(?,?,?,?,?,?,?,?,?,?,NULL)',credential.id,u.tenant,u.email,identity.user_handle,credential.publicKey,credential.counter,JSON.stringify(credential.transports||[]),info.credentialDeviceType,info.credentialBackedUp?1:0,Date.now());
          if(u.kind==='invitation')run('INSERT INTO passkey_invitation_uses VALUES(?,?)',u.source,Date.now());
          if(u.kind==='owner-recovery')consumeFirstOwnerPasskey(db,u,credential.id);
          record(u,'passkey-registered',credential.id);return mint(u,credential.id,req);
        });return json(res,200,{ok:true}, {'Set-Cookie':cookies});
      }
      if(route==='/api/passkeys/authenticate/options') {
        return challenge(res,'authenticate',await generateAuthenticationOptions({rpID,userVerification:'required',timeout:TTL}));
      }
      if(route==='/api/passkeys/authenticate/verify') {
        const attempt=consume(req,'authenticate');
        const credential=get('SELECT * FROM passkey_credentials WHERE id=? AND revoked_at IS NULL',String(body.response?.id||''));
        if(!credential||body.response?.response?.userHandle!==credential.user_handle)throw denied();
        const u=user(credential.email);if(!u||u.tenant!==credential.tenant)throw denied();const priorScope=JSON.stringify(scope(u));
        const result=await verifyAuthenticationResponse({response:body.response,expectedChallenge:attempt.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:credential.id,publicKey:credential.public_key,counter:credential.counter,transports:JSON.parse(credential.transports)}});
        if(!result.verified)throw denied();
        const cookies=transaction(()=>{
          if(attempt.expires<=Date.now())throw denied();
          if(JSON.stringify(user(u.email))!==JSON.stringify(u)||JSON.stringify(scope(u))!==priorScope)throw denied();
          const update=run('UPDATE passkey_credentials SET counter=?,backed_up=? WHERE id=? AND counter=? AND revoked_at IS NULL',result.authenticationInfo.newCounter,result.authenticationInfo.credentialBackedUp?1:0,credential.id,credential.counter);
          if(update.changes!==1)throw denied();record(u,'passkey-authenticated',credential.id);return mint(u,credential.id,req);
        });return json(res,200,{ok:true},{'Set-Cookie':cookies});
      }
      if(route==='/api/passkeys/revoke') {
        const u=session(req);if(!u||u.kind!=='passkey')throw denied();
        transaction(()=>{
          const target=get('SELECT id FROM passkey_credentials WHERE id=? AND tenant=? AND email=? AND revoked_at IS NULL',String(body.credentialId||''),u.tenant,u.email);
          if(!target)throw denied(404);
          if(get('SELECT COUNT(*) AS n FROM passkey_credentials WHERE tenant=? AND email=? AND revoked_at IS NULL',u.tenant,u.email).n<=1)throw denied(409);
          run('UPDATE passkey_credentials SET revoked_at=? WHERE id=?',Date.now(),target.id);
          run('DELETE FROM sessions WHERE token_hash IN(SELECT token_hash FROM passkey_sessions WHERE credential_id=?)',target.id);
          record(u,'passkey-revoked',target.id);
        });return json(res,200,{ok:true});
      }
      return json(res,404,{error:'Unknown passkey operation.'});
    }catch(e){return json(res,e.status||401,{error:e.status===409?'Keep at least one working passkey, and no more than eight.':e.status===429?'Too many attempts. Try again in a minute.':'Passkey verification refused. Start again or use another registered device.'});}
  }
  function serveEntry(req,res) {
    if(req.method!=='GET')return false;
    const route=String(req.url||'').split('?')[0];
    const assets={'/passkey-ui.js':['passkey-ui.js','text/javascript; charset=utf-8'],'/passkey-ui.css':['passkey-ui.css','text/css; charset=utf-8'],'/passkey-browser.js':['node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js','text/javascript; charset=utf-8']};
    let asset=assets[route];
    if(!asset&&!['/','/index.html','/passkeys'].includes(route))return false;
    const tokenHash=hash(cookie(req,'wfm_session'));
    const current=get('SELECT s.token_hash,u.email,u.tenant,u.role FROM sessions s JOIN users u ON s.email=u.email WHERE s.token_hash=? AND s.expires>?',tokenHash,Date.now());
    const metadata=get('SELECT * FROM passkey_sessions WHERE token_hash=?',tokenHash)||get('SELECT * FROM proof_runner_sessions WHERE token_hash=?',tokenHash);
    const binding=get('SELECT * FROM identity_session_bindings WHERE token_hash=?',tokenHash);
    const validSession=current&&metadata&&metadata.email===current.email&&metadata.tenant===current.tenant&&metadata.role===current.role&&metadata.expires>Date.now()&&
      (!metadata.credential_id||get('SELECT id FROM passkey_credentials WHERE id=? AND tenant=? AND email=? AND revoked_at IS NULL',metadata.credential_id,current.tenant,current.email))&&
      (!binding||binding.tenant===current.tenant&&binding.audience==='wfm-api'&&binding.issuer===(metadata.credential_id?'wfm-passkey':'wfm-proof-runner')&&binding.session_epoch===scope(current).epoch&&binding.policy_version===scope(current).policy);
    if(route==='/passkeys'||route==='/'||route==='/index.html') {
      if(route!=='/passkeys'&&validSession)return false;
      asset=['passkey-entry.html','text/html; charset=utf-8'];
    }
    if(!asset)return false;
    res.statusCode=200;res.setHeader('Content-Type',asset[1]);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(!validSession)res.setHeader('Set-Cookie','wfm_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
    res.end(fs.readFileSync(path.join(__dirname,asset[0])));return true;
  }
  return {handleRequest,serveEntry,close:()=>db.close()};
}
module.exports={createPasskeyAuth};
