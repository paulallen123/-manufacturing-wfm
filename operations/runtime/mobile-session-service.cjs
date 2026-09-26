'use strict';

const { createHash, randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX='/api/mobile/session';
function sha256(v){return createHash('sha256').update(String(v)).digest('hex');}
function cookieToken(req){
  for(const part of String(req?.headers?.cookie||'').split(';')){
    const item=part.trim();
    if(item.startsWith('wfm_session=')) return item.slice(12);
  }
  return '';
}
function bearerToken(req){
  const raw=String(req?.headers?.authorization||'').trim();
  const m=/^Bearer\s+(vmb_[A-Za-z0-9_-]{32,})$/i.exec(raw);
  return m?m[1]:'';
}
function pathOf(req){return String(req?.url||'/').split('?')[0]||'/';}
function writeJson(res,status,body){
  if(res.headersSent||res.writableEnded) return true;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
  return true;
}
function createMobileSessionService(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  const ttlMs=Math.max(15*60*1000,Math.min(Number(options.ttlMs||process.env.WFM_MOBILE_SESSION_MS||12*60*60*1000),7*24*60*60*1000));
  if(!dbPath) throw new Error('Mobile session service requires WFM_DB.');
  const db=new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;
    CREATE TABLE IF NOT EXISTS mobile_device_sessions(
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      tenant TEXT NOT NULL,
      expires INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TRIGGER IF NOT EXISTS no_mobile_device_session_delete
      BEFORE DELETE ON mobile_device_sessions BEGIN SELECT RAISE(ABORT,'Mobile device sessions are retained for audit.'); END;
  `);
  const webSession=db.prepare('SELECT s.email,s.expires,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const mobileMeta=db.prepare('SELECT * FROM mobile_device_sessions WHERE token_hash=?');
  const insertSession=db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)');
  const deleteSession=db.prepare('DELETE FROM sessions WHERE token_hash=?');
  const insertMobile=db.prepare('INSERT INTO mobile_device_sessions(token_hash,email,tenant,expires,created_at,revoked_at) VALUES(?,?,?,?,?,NULL)');
  const revokeMobile=db.prepare('UPDATE mobile_device_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE token_hash=?');
  const revokeSession=db.prepare('DELETE FROM sessions WHERE token_hash=?');

  function issue(req,res){
    if(String(req?.headers?.authorization||'').trim()) return writeJson(res,400,{error:'Mobile session minting requires a fresh browser-authenticated login, not an existing bearer token.'});
    const cookie=cookieToken(req);
    if(!cookie||cookie.startsWith('vmb_')) return writeJson(res,401,{error:'Fresh Vecta sign-in is required.'});
    const actor=webSession.get(sha256(cookie),Date.now());
    if(!actor) return writeJson(res,401,{error:'Fresh Vecta sign-in is required.'});
    const token='vmb_'+randomBytes(32).toString('base64url');
    const tokenHash=sha256(token);
    const expires=Date.now()+ttlMs;
    const createdAt=new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try{
      insertSession.run(tokenHash,actor.email,expires);
      insertMobile.run(tokenHash,actor.email,actor.tenant,expires,createdAt);
      deleteSession.run(sha256(cookie));
      db.exec('COMMIT;');
    }catch(error){
      try{db.exec('ROLLBACK;');}catch{}
      throw error;
    }
    res.setHeader('Set-Cookie','wfm_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
    return writeJson(res,201,{
      tokenType:'Bearer',
      accessToken:token,
      expiresAt:new Date(expires).toISOString(),
      actor:{email:actor.email,tenant:actor.tenant,role:actor.role}
    });
  }

  function revoke(req,res){
    const token=bearerToken(req);
    if(!token) return writeJson(res,401,{error:'Valid mobile bearer session is required.'});
    const hash=sha256(token);
    const meta=mobileMeta.get(hash);
    if(!meta) return writeJson(res,204,{});
    db.exec('BEGIN IMMEDIATE;');
    try{
      revokeMobile.run(new Date().toISOString(),hash);
      revokeSession.run(hash);
      db.exec('COMMIT;');
    }catch(error){
      try{db.exec('ROLLBACK;');}catch{}
      throw error;
    }
    res.statusCode=204;res.end();return true;
  }

  async function handleRequest(req,res){
    const path=pathOf(req);
    if(path!==PREFIX) return false;
    try{
      if(req.method==='POST') return issue(req,res);
      if(req.method==='DELETE') return revoke(req,res);
      return writeJson(res,405,{error:'Method not allowed.'});
    }catch{
      return writeJson(res,503,{error:'Mobile session service failed safely.'});
    }
  }
  return {handleRequest,close(){try{db.close();}catch{}}};
}
module.exports={createMobileSessionService,cookieToken,bearerToken,PREFIX};
