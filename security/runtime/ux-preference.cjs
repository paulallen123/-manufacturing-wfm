'use strict';

const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { URL } = require('node:url');

const MODES = Object.freeze(['site_default','decision_first','operational_visual','compact']);
const BODY_LIMIT = 16 * 1024;

function sha256(value){return createHash('sha256').update(String(value)).digest('hex');}
function fail(message,status=400){const err=new Error(message);err.status=status;throw err;}
function cookie(req,name){
  const raw=String(req?.headers?.cookie||'');
  for(const part of raw.split(';')){const item=part.trim(),prefix=name+'=';if(item.startsWith(prefix))return item.slice(prefix.length);}
  return '';
}
function pathOf(req){return String(req?.url||'/').split('?')[0]||'/';}
function json(res,status,body){
  if(res.headersSent||res.writableEnded)return true;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
  return true;
}
async function body(req){
  const type=String(req.headers?.['content-type']||'');
  if(!type.startsWith('application/json'))fail('JSON required.',415);
  let size=0;const chunks=[];
  for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>BODY_LIMIT)fail('Request body too large.',413);chunks.push(b);}
  if(!chunks.length)return {};
  try{const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('JSON object required.');return parsed;}
  catch(err){if(err?.status)throw err;fail('Invalid JSON.');}
}
function createUxPreferenceStore(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  if(!dbPath)throw new Error('UX preference store requires WFM_DB.');
  const publicOrigin=String(options.publicOrigin||process.env.WFM_PUBLIC_ORIGIN||'').replace(/\/$/,'');
  const db=new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;" +
    "CREATE TABLE IF NOT EXISTS ux_preferences(" +
      "email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE," +
      "scope TEXT NOT NULL," +
      "mode TEXT NOT NULL CHECK(mode IN ('site_default','decision_first','operational_visual','compact'))," +
      "updated_at TEXT NOT NULL," +
      "PRIMARY KEY(email,scope));");
  const sessionStmt=db.prepare("SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?");
  const getStmt=db.prepare('SELECT mode,updated_at FROM ux_preferences WHERE email=? AND scope=?');
  const upsertStmt=db.prepare("INSERT INTO ux_preferences(email,scope,mode,updated_at) VALUES(?,?,?,?) ON CONFLICT(email,scope) DO UPDATE SET mode=excluded.mode,updated_at=excluded.updated_at");
  const auditStmt=db.prepare('INSERT INTO audit_events(tenant,actor,action,detail,created_at) VALUES(?,?,?,?,?)');

  function actor(req){
    const token=cookie(req,'wfm_session');
    if(!token)fail('Sign in is required.',401);
    const row=sessionStmt.get(sha256(token),Date.now());
    if(!row)fail('Session expired. Sign in again.',401);
    return row;
  }
  function sameOrigin(req){
    if(!publicOrigin)return process.env.WFM_HOSTED_STAGING!=='true';
    const origin=String(req.headers?.origin||'').replace(/\/$/,'');
    if(origin)return origin===publicOrigin;
    const referer=String(req.headers?.referer||'');
    return referer===publicOrigin||referer.startsWith(publicOrigin+'/');
  }
  function scopeFrom(req,input){
    let raw=String(input?.scope||'site:default');
    try{
      if(req?.url){
        const base=publicOrigin||'http://localhost';
        const url=new URL(req.url,base);
        raw=String(url.searchParams.get('scope')||raw);
      }
    }catch{}
    raw=raw.trim().slice(0,120);
    if(!/^[A-Za-z0-9_.:-]{3,120}$/.test(raw))fail('Invalid UX preference scope.');
    return raw;
  }
  function record(a,action,detail){
    try{auditStmt.run(a.tenant,a.email,action,JSON.stringify(detail),new Date().toISOString());}catch{}
  }
  async function beforeRequest(req,res){
    if(pathOf(req)!=='/api/ux-preference')return false;
    try{
      const a=actor(req);
      if(req.method==='GET'){
        const scope=scopeFrom(req,{});
        const row=getStmt.get(a.email,scope);
        return json(res,200,{scope,mode:row?.mode||'site_default',updatedAt:row?.updated_at||null,allowedModes:MODES});
      }
      if(req.method==='POST'){
        if(!sameOrigin(req))fail('Same-origin preference update required.',403);
        const input=await body(req),scope=scopeFrom(req,input),mode=String(input.mode||'');
        if(!MODES.includes(mode))fail('Invalid UX preference mode.');
        const now=new Date().toISOString();
        upsertStmt.run(a.email,scope,mode,now);
        record(a,'ux.preference.changed',{scope,mode});
        return json(res,200,{ok:true,scope,mode,updatedAt:now});
      }
      return json(res,405,{error:'Method not allowed.'});
    }catch(err){
      const status=Number(err?.status)||500;
      return json(res,status,{error:status>=500?'UX preference service unavailable.':String(err?.message||'UX preference request failed.')});
    }
  }
  return {beforeRequest,MODES};
}
module.exports={createUxPreferenceStore,MODES};
