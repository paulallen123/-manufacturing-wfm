import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const PATH = '/api/integrations/gusto/webhooks';
const HOSTS = {sandbox:'https://api.gusto-demo.com',production:'https://api.gusto.com'};
const API_VERSION = '2026-06-15';
const MAX_BODY = 262144;
const verificationInFlight = new Set();
const clean = (value, max=4096) => typeof value==='string' && value.length>0 && value.length<=max && !/[\x00-\x1f\x7f]/.test(value);
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const failure = (status, code) => Object.assign(new Error(code), {statusCode:status, publicCode:code});

function configuration() {
  const environment = process.env.WFM_GUSTO_ENVIRONMENT || 'sandbox';
  if(!Object.hasOwn(HOSTS,environment)) throw failure(503,'GUSTO_ENVIRONMENT_INVALID');
  const origin = new URL(process.env.WFM_PUBLIC_ORIGIN || '');
  if(origin.protocol!=='https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname!=='/') throw failure(503,'GUSTO_ORIGIN_INVALID');
  if(!process.env.WFM_DB) throw failure(503,'GUSTO_DATABASE_MISSING');
  return {environment,host:HOSTS[environment],endpoint:origin.origin+PATH,dbPath:process.env.WFM_DB};
}

function database(config) {
  const db = new DatabaseSync(config.dbPath);
  try {
    db.exec('PRAGMA busy_timeout=1500;CREATE TABLE IF NOT EXISTS gusto_webhook_subscriptions(endpoint_url TEXT PRIMARY KEY,subscription_uuid TEXT,environment TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT);CREATE TABLE IF NOT EXISTS gusto_webhook_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT,endpoint_url TEXT NOT NULL,subscription_uuid TEXT,token TEXT NOT NULL,token_hash TEXT NOT NULL,received_at TEXT NOT NULL,verified_at TEXT);CREATE TABLE IF NOT EXISTS gusto_webhook_events(event_uuid TEXT PRIMARY KEY,event_type TEXT,resource_type TEXT,resource_uuid TEXT,payload_hash TEXT NOT NULL,received_at TEXT NOT NULL,status TEXT NOT NULL);');
    return db;
  } catch(error) {db.close();throw error;}
}

function subscription(db,config) {
  const row = db.prepare('SELECT * FROM gusto_webhook_subscriptions WHERE endpoint_url=?').get(config.endpoint);
  return row && uuid(row.subscription_uuid) && row.environment===config.environment && ['pending','verified'].includes(row.status) ? row : null;
}

function verifiedToken(db,config,sub) {
  if(!sub || sub.status!=='verified') return null;
  return db.prepare('SELECT token,token_hash FROM gusto_webhook_tokens WHERE endpoint_url=? AND subscription_uuid=? AND verified_at IS NOT NULL ORDER BY id DESC LIMIT 1').get(config.endpoint,sub.subscription_uuid);
}

function send(res,status,body) {
  if(res.headersSent || res.writableEnded) return true;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
  return true;
}

async function boundedBytes(stream,limit) {
  const chunks=[];let size=0;
  for await(const chunk of stream) {
    const bytes=Buffer.from(chunk);size+=bytes.length;
    if(size>limit) throw failure(413,'GUSTO_BODY_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function provider(config,path,options,signal) {
  let response;
  try {
    response=await fetch(config.host+path,{...options,redirect:'error',signal});
    if(!response.ok) {
      await response.body?.cancel();
      throw failure(response.status===422?401:503,response.status===422?'GUSTO_VERIFICATION_REJECTED':'GUSTO_PROVIDER_UNAVAILABLE');
    }
    const bytes=response.body?await boundedBytes(response.body,65536):Buffer.alloc(0);
    return bytes.length?JSON.parse(bytes.toString('utf8')):{};
  } catch(error) {
    if(error.publicCode) throw error;
    throw failure(503,'GUSTO_PROVIDER_UNAVAILABLE');
  }
}

async function verifyCandidate(config,sub,candidate) {
  const client_id=process.env.WFM_GUSTO_CLIENT_ID,client_secret=process.env.WFM_GUSTO_CLIENT_SECRET;
  if(!clean(client_id,512)||!clean(client_secret)) throw failure(503,'GUSTO_CLIENT_CONFIG_MISSING');
  // One deadline covers token acquisition, verification and both response bodies.
  const signal=AbortSignal.timeout(7000);
  const credentials=await provider(config,'/oauth/token',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({client_id,client_secret,grant_type:'system_access'})},signal);
  if(!clean(credentials.access_token)) throw failure(503,'GUSTO_PROVIDER_UNAVAILABLE');
  await provider(config,'/v1/webhook_subscriptions/'+sub.subscription_uuid+'/verify',{method:'PUT',headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':'Bearer '+credentials.access_token,'X-Gusto-API-Version':API_VERSION},body:JSON.stringify({verification_token:candidate})},signal);
}

async function verification(config,body,res) {
  const candidate=body.verification_token;
  if(!clean(candidate)) throw failure(400,'GUSTO_VERIFICATION_TOKEN_INVALID');
  let sub,current;
  let db=database(config);
  try {sub=subscription(db,config);current=verifiedToken(db,config,sub);} finally {db.close();}
  if(!sub) throw failure(409,'GUSTO_SUBSCRIPTION_NOT_REGISTERED');
  for(const field of ['webhook_subscription_uuid','subscription_uuid','uuid']) {
    if(Object.hasOwn(body,field) && body[field]!==sub.subscription_uuid) throw failure(409,'GUSTO_SUBSCRIPTION_MISMATCH');
  }
  if(current?.token_hash===sha(candidate)) return send(res,202,{received:true,verified:true});
  const lock=config.dbPath+'\0'+config.endpoint;
  if(verificationInFlight.has(lock)) throw failure(429,'GUSTO_VERIFICATION_IN_PROGRESS');
  verificationInFlight.add(lock);
  try {
    // The public callback is untrusted until Gusto accepts this token for our
    // already registered subscription. Never persist or use a pending token.
    await verifyCandidate(config,sub,candidate);
    db=database(config);
    try {
      db.exec('BEGIN IMMEDIATE');
      const latest=subscription(db,config);
      if(!latest || latest.subscription_uuid!==sub.subscription_uuid) throw failure(409,'GUSTO_SUBSCRIPTION_CHANGED');
      const at=new Date().toISOString();
      db.prepare('INSERT INTO gusto_webhook_tokens(endpoint_url,subscription_uuid,token,token_hash,received_at,verified_at) VALUES(?,?,?,?,?,?)').run(config.endpoint,sub.subscription_uuid,candidate,sha(candidate),at,at);
      db.prepare('UPDATE gusto_webhook_subscriptions SET status=?,updated_at=?,last_error=NULL WHERE endpoint_url=? AND subscription_uuid=? AND environment=?').run('verified',at,config.endpoint,sub.subscription_uuid,config.environment);
      db.exec('COMMIT');
    } catch(error) {if(db.isTransaction)db.exec('ROLLBACK');throw error;} finally {db.close();}
    return send(res,202,{received:true,verified:true});
  } finally {verificationInFlight.delete(lock);}
}

function validSignature(bytes,signature,token) {
  if(!clean(signature,80)||!clean(token)) return false;
  const supplied=signature.replace(/^sha256=/i,'');
  if(!/^[0-9a-f]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(createHmac('sha256',token).update(bytes).digest(),Buffer.from(supplied,'hex'));
}

function receiveEvent(config,body,bytes,req,res) {
  const db=database(config);
  try {
    db.exec('BEGIN IMMEDIATE');
    const sub=subscription(db,config),token=verifiedToken(db,config,sub);
    if(!token) throw failure(412,'GUSTO_SUBSCRIPTION_NOT_VERIFIED');
    if(!validSignature(bytes,req.headers['x-gusto-signature'],token.token)) throw failure(401,'GUSTO_SIGNATURE_INVALID');
    if(!clean(body.event_type,120)) throw failure(400,'GUSTO_EVENT_INVALID');
    const digest=sha(bytes),id=uuid(body.uuid)?body.uuid:digest.slice(0,36);
    const existing=db.prepare('SELECT payload_hash FROM gusto_webhook_events WHERE event_uuid=?').get(id);
    if(existing && existing.payload_hash!==digest) throw failure(409,'GUSTO_EVENT_ID_CONFLICT');
    const result=db.prepare('INSERT OR IGNORE INTO gusto_webhook_events(event_uuid,event_type,resource_type,resource_uuid,payload_hash,received_at,status) VALUES(?,?,?,?,?,?,?)').run(id,String(body.event_type).slice(0,120),String(body.resource_type||body.entity_type||'').slice(0,80),String(body.resource_uuid||body.entity_uuid||'').slice(0,120),digest,new Date().toISOString(),'received');
    db.exec('COMMIT');
    return send(res,200,{received:true,duplicate:Number(result.changes)===0});
  } catch(error) {if(db.isTransaction)db.exec('ROLLBACK');throw error;} finally {db.close();}
}

export async function handle(req,res) {
  let pathname;
  try {pathname=new URL(String(req.url||'/'),'https://vector.invalid').pathname;} catch {return false;}
  if(pathname!==PATH) return false;
  try {
    const config=configuration();
    const method=String(req.method||'GET').toUpperCase();
    // Detailed provider state belongs in the authenticated integration UI.
    if(method==='GET'||method==='HEAD') return send(res,200,{status:'ready'});
    if(method!=='POST') {res.setHeader('Allow','GET, HEAD, POST');return send(res,405,{error:'METHOD_NOT_ALLOWED'});}
    let bytes,body;
    try {
      bytes=await boundedBytes(req,MAX_BODY);body=JSON.parse(bytes.toString('utf8'));
      if(!body||typeof body!=='object'||Array.isArray(body)) throw Error('not an object');
    } catch(error) {throw error.publicCode?error:failure(400,'GUSTO_JSON_INVALID');}
    if(Object.hasOwn(body,'verification_token')) return await verification(config,body,res);
    return receiveEvent(config,body,bytes,req,res);
  } catch(error) {
    return send(res,error.statusCode||503,{error:error.publicCode||'GUSTO_WEBHOOK_UNAVAILABLE'});
  }
}
