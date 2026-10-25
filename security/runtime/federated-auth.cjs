'use strict';

// Authorization-code login only. Provider email/name claims NEVER link accounts.
// Subjects must be explicitly provisioned to an existing local tenant/user.
const {createHash, randomBytes, createPublicKey, verify} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const PREFIX = '/api/auth/federated';
const ISSUER = 'wfm-federated';
const PROVIDERS = Object.freeze({
  google: Object.freeze({issuer:'https://accounts.google.com', authorization:'https://accounts.google.com/o/oauth2/v2/auth', token:'https://oauth2.googleapis.com/token', keys:'https://www.googleapis.com/oauth2/v3/certs'}),
  apple: Object.freeze({issuer:'https://appleid.apple.com', authorization:'https://appleid.apple.com/auth/authorize', token:'https://appleid.apple.com/auth/token', keys:'https://appleid.apple.com/auth/keys'})
});
const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const cookieName = provider => '__Host-vector_oidc_' + provider;
function cookies(req, name) {
  const values = String(req.headers?.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}
function respond(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [name,value] of Object.entries({'Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...headers})) res.setHeader(name,value);
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(body));
  return true;
}
async function boundedText(response, max = 65536) {
  let size=0; const chunks=[];
  for await (const chunk of response.body) {
    const bytes=Buffer.from(chunk); size+=bytes.length;
    if(size>max) throw Error('response-too-large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function decode(segment) {
  if(!/^[A-Za-z0-9_-]+$/.test(segment)) throw Error('invalid-jwt');
  return JSON.parse(Buffer.from(segment,'base64url').toString('utf8'));
}
function validateIdToken(token, keys, provider, clientId, nonce, now = Date.now()) {
  if(typeof token!=='string'||token.length>16384) throw Error('invalid-id-token');
  const parts=token.split('.'); if(parts.length!==3) throw Error('invalid-id-token');
  const header=decode(parts[0]), claims=decode(parts[1]);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.crit!==undefined) throw Error('invalid-algorithm');
  const matches=Array.isArray(keys?.keys)?keys.keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig')&&(!k.key_ops||(Array.isArray(k.key_ops)&&k.key_ops.includes('verify')))):[];
  if(matches.length!==1) throw Error('ambiguous-signing-key');
  const key=createPublicKey({key:matches[0],format:'jwk'});
  if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<2048||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url'))) throw Error('invalid-signature');
  const expected=PROVIDERS[provider]?.issuer;
  if(!expected||(claims.iss!==expected&&!(provider==='google'&&claims.iss==='accounts.google.com'))) throw Error('invalid-issuer');
  // A single audience is deliberately required; multi-client tokens are not accepted.
  if(claims.aud!==clientId||(claims.azp!==undefined&&claims.azp!==clientId)) throw Error('invalid-audience');
  const seconds=Math.floor(now/1000);
  if(!Number.isSafeInteger(claims.exp)||claims.exp<=seconds||!Number.isSafeInteger(claims.iat)||claims.iat>seconds+30||claims.iat>claims.exp||(claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>seconds))) throw Error('invalid-time');
  if(typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255||claims.nonce!==nonce) throw Error('invalid-subject-or-nonce');
  return {issuer:expected,subject:claims.sub};
}

function createFederatedAuth(options = {}) {
  const env=options.env||process.env;
  const origin=String(options.publicOrigin||env.WFM_PUBLIC_ORIGIN||'');
  const originURL=origin?new URL(origin):null;
  if(originURL&&(originURL.protocol!=='https:'||originURL.origin!==origin||originURL.username||originURL.password)) throw Error('Federated auth requires an exact HTTPS origin.');
  const configs={google:options.google||{clientId:env.WFM_GOOGLE_CLIENT_ID,clientSecret:env.WFM_GOOGLE_CLIENT_SECRET},apple:options.apple||{clientId:env.WFM_APPLE_CLIENT_ID,clientSecret:env.WFM_APPLE_CLIENT_SECRET}};
  // Capture reviewed configuration, never an object that callers can mutate later.
  const config=JSON.parse(JSON.stringify(configs));
  const mappings=JSON.parse(JSON.stringify(options.identities??JSON.parse(env.WFM_FEDERATED_IDENTITIES_JSON||'[]')));
  if(!Array.isArray(mappings)) throw Error('Federated identity map must be an array.');
  const seen=new Set();
  for(const m of mappings){
    if(!PROVIDERS[m.provider]||!['subject','email','tenant'].every(k=>typeof m[k]==='string'&&m[k].trim()===m[k]&&m[k].length>0&&m[k].length<=255)||Object.keys(m).some(k=>!['provider','subject','email','tenant'].includes(k))) throw Error('Invalid federated identity mapping.');
    const key=JSON.stringify([m.provider,m.subject]);if(seen.has(key)) throw Error('Ambiguous federated subject mapping.');seen.add(key);
  }
  const configured=name=>{
    const c=config[name];
    if(!(origin&&typeof c?.clientId==='string'&&c.clientId.trim()===c.clientId&&c.clientId&&typeof c?.clientSecret==='string'&&c.clientSecret&&mappings.some(m=>m.provider===name)))return false;
    if(name==='apple'){
      try{const parts=c.clientSecret.split('.'),h=decode(parts[0]),p=decode(parts[1]),now=Math.floor(Date.now()/1000);
        if(parts.length!==3||h.alg!=='ES256'||typeof h.kid!=='string'||!h.kid||typeof p.iss!=='string'||!p.iss||p.sub!==c.clientId||p.aud!=='https://appleid.apple.com'||!Number.isSafeInteger(p.exp)||p.exp<=now||!Number.isSafeInteger(p.iat)||p.iat>now+30||p.exp-p.iat>15777000)return false;
      }catch{return false;}
    }
    return true;
  };
  const db=new DatabaseSync(options.dbPath||env.WFM_DB);
  db.exec(`PRAGMA busy_timeout=1500;
    CREATE TABLE IF NOT EXISTS federated_auth_states(state_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,browser_hash TEXT NOT NULL,nonce TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS federated_auth_limits(key TEXT PRIMARY KEY,bucket INTEGER NOT NULL,count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS federated_sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,tenant TEXT NOT NULL,role TEXT NOT NULL,provider TEXT NOT NULL,subject TEXT NOT NULL,issued_at INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS federated_auth_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,tenant TEXT,created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS federated_events_no_update BEFORE UPDATE ON federated_auth_events BEGIN SELECT RAISE(ABORT,'Append only'); END;
    CREATE TRIGGER IF NOT EXISTS federated_events_no_delete BEFORE DELETE ON federated_auth_events BEGIN SELECT RAISE(ABORT,'Append only'); END;`);
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  const bodyTimeoutMs=options.bodyTimeoutMs??10000;
  if(!Number.isInteger(bodyTimeoutMs)||bodyTimeoutMs<1||bodyTimeoutMs>10000)throw Error('Invalid federated body deadline.');
  const mapping=(provider,subject)=>mappings.find(m=>m.provider===provider&&m.subject===subject);
  const userFor=m=>{const rows=db.prepare('SELECT email,tenant,role FROM users WHERE lower(email)=lower(?)').all(m.email);return rows.length===1&&rows[0].tenant===m.tenant?rows[0]:null;};
  function getSession(tokenHash){return db.prepare('SELECT * FROM federated_sessions WHERE token_hash=?').get(tokenHash)||null;}
  function validateSession(tokenHash,row){
    try{
      const s=getSession(tokenHash),m=s&&mapping(s.provider,s.subject),u=m&&configured(s.provider)&&userFor(m);
      if(!s||!u||s.expires<=Date.now()||!row||s.email!==row.email||s.tenant!==row.tenant||s.role!==row.role||u.email!==s.email||u.role!==s.role) return false;
      const control=db.prepare('SELECT * FROM identity_tenant_control WHERE tenant=?').get(s.tenant);
      const bind=db.prepare('SELECT * FROM identity_session_bindings WHERE token_hash=?').get(tokenHash);
      return Boolean(control&&bind&&control.privileged_freeze===0&&bind.tenant===s.tenant&&bind.issuer===ISSUER&&bind.audience==='wfm-api'&&bind.session_epoch===control.session_epoch&&bind.policy_version===control.policy_version);
    }catch{return false;}
  }
  async function requestJSON(url,init={}){
    const response=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw Error('provider-unavailable');
    return JSON.parse(await boundedText(response));
  }
  function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
  function rateAllowed(req){return transaction(()=>{
    const bucket=Math.floor(Date.now()/60000);
    db.prepare('DELETE FROM federated_auth_limits WHERE bucket<?').run(bucket-1);
    for(const [key,limit] of [['global',600],['peer:'+hash(String(req.socket?.remoteAddress||'unknown')),60]]){
      const row=db.prepare('SELECT bucket,count FROM federated_auth_limits WHERE key=?').get(key);
      if(row?.bucket===bucket&&row.count>=limit)return false;
    }
    for(const key of ['global','peer:'+hash(String(req.socket?.remoteAddress||'unknown'))])db.prepare('INSERT INTO federated_auth_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET bucket=excluded.bucket,count=CASE WHEN federated_auth_limits.bucket=excluded.bucket THEN federated_auth_limits.count+1 ELSE 1 END').run(key,bucket);
    return true;
  });}
  function clearCookie(provider){return cookieName(provider)+'=; Path=/; Secure; HttpOnly; SameSite='+(provider==='apple'?'None':'Lax')+'; Max-Age=0';}
  async function handleRequest(req,res){
    const url=new URL(req.url||'/',origin||'https://invalid.example');
    if(!url.pathname.startsWith(PREFIX+'/')) return false;
    if(url.pathname===PREFIX+'/providers') return respond(res,req.method==='GET'?200:405,{providers:Object.keys(PROVIDERS).filter(configured)});
    const match=url.pathname.match(/^\/api\/auth\/federated\/(google|apple)\/(start|callback)$/);
    if(!match)return respond(res,404,{error:'Not found.'});
    const [,provider,step]=match;
    if(!configured(provider))return respond(res,503,{error:'This sign-in provider is not configured.'});
    const secure=req.socket?.encrypted===true||String(req.headers?.['x-forwarded-proto']||'')==='https';
    if(!secure)return respond(res,403,{error:'Secure transport is required.'});
    try{if(!rateAllowed(req))return respond(res,429,{error:'Too many sign-in attempts.'},{'Retry-After':'60'});}catch{return respond(res,503,{error:'Sign-in temporarily unavailable.'});}
    // This deployment must strip and set forwarded headers at its trusted edge.
    if(cookies(req,'wfm_session'))return respond(res,409,{error:'Sign out before choosing another identity.'});
    const callback=origin+PREFIX+'/'+provider+'/callback';
    if(step==='start'){
      if(req.method!=='GET')return respond(res,405,{error:'Method not allowed.'});
      if((req.headers?.origin&&req.headers.origin!==origin)||req.headers?.['sec-fetch-site']==='cross-site')return respond(res,403,{error:'Sign-in must start on this site.'});
      const state=random(),browser=random(),nonce=random(),verifier=random();
      try{transaction(()=>{db.prepare('DELETE FROM federated_auth_states WHERE expires<=?').run(Date.now());db.prepare('INSERT INTO federated_auth_states VALUES(?,?,?,?,?,?,0)').run(hash(state),provider,hash(browser),nonce,verifier,Date.now()+300000);});}catch{return respond(res,503,{error:'Sign-in temporarily unavailable.'});}
      const target=new URL(PROVIDERS[provider].authorization);
      for(const [k,v]of Object.entries({client_id:config[provider].clientId,redirect_uri:callback,response_type:'code',scope:provider==='google'?'openid email':'email',state,nonce}))target.searchParams.set(k,v);
      if(provider==='google'){target.searchParams.set('code_challenge',createHash('sha256').update(verifier).digest('base64url'));target.searchParams.set('code_challenge_method','S256');}
      else target.searchParams.set('response_mode','form_post');
      return respond(res,302,{redirect:true},{Location:target.href,'Set-Cookie':cookieName(provider)+'='+browser+'; Path=/; Secure; HttpOnly; SameSite='+(provider==='apple'?'None':'Lax')+'; Max-Age=300'});
    }
    if(req.method!==(provider==='apple'?'POST':'GET'))return respond(res,405,{error:'Method not allowed.'});
    try{
      let params=url.searchParams;
      if(provider==='apple'){
        if(String(req.headers?.['content-type']||'').split(';')[0]!=='application/x-www-form-urlencoded')throw Error('invalid-form');
        let timer;
        try{
          const timeout=new Promise((resolve,reject)=>{timer=setTimeout(()=>{reject(Error('body-timeout'));req.destroy?.();},bodyTimeoutMs);});
          params=new URLSearchParams(await Promise.race([boundedText({body:req},16384),timeout]));
        }finally{clearTimeout(timer);}
      }
      if(params.getAll('state').length!==1||params.getAll('code').length!==1||params.has('error'))throw Error('invalid-response');
      const state=params.get('state'),code=params.get('code'),browser=cookies(req,cookieName(provider));
      if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!browser||!code||code.length>4096)throw Error('invalid-state');
      // Claim before any external exchange: failures are one-use and require fresh login.
      const pending=transaction(()=>{
        const row=db.prepare('SELECT * FROM federated_auth_states WHERE state_hash=?').get(hash(state));
        if(!row||row.provider!==provider||row.browser_hash!==hash(browser)||row.expires<=Date.now()||row.consumed)throw Error('invalid-state');
        db.prepare('UPDATE federated_auth_states SET consumed=1 WHERE state_hash=?').run(hash(state));return row;
      });
      const body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:callback,client_id:config[provider].clientId,client_secret:config[provider].clientSecret});
      if(provider==='google')body.set('code_verifier',pending.verifier);
      const tokens=await requestJSON(PROVIDERS[provider].token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
      const keys=await requestJSON(PROVIDERS[provider].keys);
      const identity=validateIdToken(tokens.id_token,keys,provider,config[provider].clientId,pending.nonce);
      const m=mapping(provider,identity.subject);if(!m)throw Error('unlinked-identity');
      const token=randomBytes(32).toString('hex'),tokenHash=hash(token),now=Date.now(),expires=now+30*60000;
      transaction(()=>{
        if(pending.expires<=Date.now())throw Error('expired-flow');
        const user=userFor(m);if(!user)throw Error('missing-or-ambiguous-user');
        const control=db.prepare('SELECT * FROM identity_tenant_control WHERE tenant=?').get(user.tenant);
        if(!control||control.privileged_freeze!==0)throw Error('tenant-not-ready');
        db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(tokenHash,user.email,expires);
        db.prepare('INSERT INTO federated_sessions VALUES(?,?,?,?,?,?,?,?)').run(tokenHash,user.email,user.tenant,user.role,provider,identity.subject,now,expires);
        db.prepare('INSERT INTO identity_session_bindings VALUES(?,?,?,?,?,?,?)').run(tokenHash,user.tenant,ISSUER,'wfm-api',control.session_epoch,control.policy_version,new Date(now).toISOString());
        db.prepare('INSERT INTO federated_auth_events(event,tenant,created_at) VALUES(?,?,?)').run('session-issued',user.tenant,new Date(now).toISOString());
      });
      // Render a first-party document before navigating: a redirect chain from
      // the provider can withhold a Strict cookie on its final request.
      res.statusCode=200;
      for(const [name,value]of Object.entries({
        'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',Pragma:'no-cache',
        'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
        'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        'Set-Cookie':[clearCookie(provider),'wfm_session='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800']
      }))res.setHeader(name,value);
      res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in complete</title><body><h1>Sign-in complete</h1><p><a href="/">Continue to VECTOR</a></p></body></html>');
      return true;
    }catch{
      return respond(res,401,{error:'Sign-in could not be verified. Start again or contact your administrator.'},{'Set-Cookie':clearCookie(provider)});
    }
  }
  return {handleRequest,getSession,validateSession,providers:()=>Object.keys(PROVIDERS).filter(configured),close:()=>db.close()};
}
module.exports={createFederatedAuth,validateIdToken,PROVIDERS,FEDERATED_ISSUER:ISSUER};
