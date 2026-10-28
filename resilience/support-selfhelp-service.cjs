'use strict';
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { answer } = require('./support-selfhelp.cjs');
const PATH = '/api/support/self-help';
const ROLES = Object.freeze({ employee:'employee', manager:'manager', payroll_admin:'payroll', director:'company-admin', admin:'company-admin', superuser:'company-admin' });
const MAX_BYTES = 8192;
function send(res, status, value) {
  if (res.writableEnded) return;
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(value));
}
function readBody(req) {
  return new Promise((resolve,reject) => {
    let size=0, chunks=[], done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);req.removeListener('data',data);req.removeListener('end',end);req.removeListener('aborted',abort);req.removeListener('error',abort);if(error){req.resume();reject(error);}else resolve(value);};
    const data=chunk=>{size+=chunk.length;if(size>MAX_BYTES)return finish(413);chunks.push(chunk);};
    const end=()=>{try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(400);}};
    const abort=()=>finish(400);
    const timer=setTimeout(()=>finish(408),5000);timer.unref?.();
    req.on('data',data);req.once('end',end);req.once('aborted',abort);req.once('error',abort);
  });
}
function createSupportSelfHelpService({dbPath, publicOrigin, authorizeRequest, fixtureOnly=false, version='support-tier0-v1'}={}) {
  if(typeof authorizeRequest!=='function')throw new Error('SUPPORT_IDENTITY_GUARD_REQUIRED');
  let origin;
  try { const url=new URL(publicOrigin); if(url.origin!==publicOrigin || url.protocol!=='https:' || url.username || url.password)throw Error(); origin=url.origin; }
  catch { throw new Error('SUPPORT_CANONICAL_HTTPS_ORIGIN_REQUIRED'); }
  // Deliberately read-only: this endpoint cannot create sessions, log questions or change customer records.
  const db=new DatabaseSync(dbPath,{readOnly:true});
  const session=db.prepare('SELECT s.email,s.expires,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  function principal(req) {
    const cookies=String(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('wfm_session='));
    if(cookies.length!==1)return null;
    const token=cookies[0].slice(12);if(!token || token.length>4096)return null;
    const row=session.get(createHash('sha256').update(token).digest('hex'),Date.now());
    return row && typeof row.tenant==='string' && row.tenant.trim() && Object.hasOwn(ROLES,row.role) ? row : null;
  }
  async function handleRequest(req,res) {
    if(String(req.url||'').split('?')[0]!==PATH)return false;
    if(!authorizeRequest(req,res)){send(res,401,{error:'Sign in again to use Help.'});return true;}
    const actor=principal(req);
    if(!actor){send(res,401,{error:'Sign in again to use Help.'});return true;}
    if(req.method!=='POST'){res.setHeader('Allow','POST');send(res,405,{error:'Use POST.'});return true;}
    if(req.headers.origin!==origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site']!=='same-origin')) {send(res,403,{error:'Same-origin request required.'});return true;}
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')){send(res,415,{error:'JSON required.'});return true;}
    if(req.headers['content-encoding'] || (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length'])>MAX_BYTES))){send(res,413,{error:'Question exceeds request limits.'});return true;}
    let body;
    try{body=await readBody(req);}catch(status){send(res,status,{error:'Invalid or incomplete question.'});return true;}
    if(!body || Array.isArray(body) || typeof body!=='object' || Object.keys(body).length!==1 || typeof body.text!=='string' || !body.text.trim() || body.text.length>4000){send(res,400,{error:'Provide only a nonempty text question up to 4000 characters.'});return true;}
    if(!authorizeRequest(req,res)){send(res,401,{error:'Sign in again to use Help.'});return true;}
    const current=principal(req);
    if(!current || current.email!==actor.email || current.tenant!==actor.tenant || current.role!==actor.role){send(res,401,{error:'Sign-in context changed. Sign in again.'});return true;}
    let result=answer({text:body.text,role:ROLES[current.role],version});
    if(result.intent==='environment-production-status' && fixtureOnly!==true)result={status:'abstain',reason:'environment-status-not-verified',version,actionAuthority:false,sources:[]};
    send(res,200,result);return true;
  }
  return Object.freeze({handleRequest,close:()=>db.close()});
}
module.exports={createSupportSelfHelpService,PATH};
