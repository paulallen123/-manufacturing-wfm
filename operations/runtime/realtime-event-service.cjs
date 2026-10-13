'use strict';

const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = '/api/realtime';
const MAX_PAYLOAD_BYTES = 16 * 1024;
const KNOWN_ROLES = new Set(['employee','manager','director','supervisor','company-admin','payroll_admin','admin','superuser','operations','finance']);

function sha256(v){ return createHash('sha256').update(String(v)).digest('hex'); }
function compact(v,max=120){ return String(v??'').trim().slice(0,max); }
function cookieToken(req){
  for(const part of String(req?.headers?.cookie||'').split(';')){
    const p=part.trim();
    if(p.startsWith('wfm_session=')) return p.slice(12);
  }
  return '';
}
function pathOf(req){ return String(req?.url||'/').split('?')[0]||'/'; }
function writeJson(res,status,body){
  if(res.headersSent||res.writableEnded) return true;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
  return true;
}
function normaliseAudience(value){
  const v=compact(value||'manager',24).toLowerCase();
  if(!['all','employee','manager','admin'].includes(v)) throw new Error('Invalid realtime audience.');
  return v;
}
function roleAllowed(role,audience){
  const r=compact(role,40).toLowerCase();
  if(!KNOWN_ROLES.has(r)) return false;
  if(audience==='all') return true;
  if(audience==='employee') return r==='employee';
  if(audience==='manager') return r && r!=='employee';
  if(audience==='admin') return r==='admin'||r==='superuser';
  return false;
}
function parseAfter(req){
  let after=Number(req?.headers?.['last-event-id']||0);
  try{
    const u=new URL(String(req?.url||'/'),'https://vector.invalid');
    if(u.searchParams.has('after')) after=Number(u.searchParams.get('after'));
  }catch{}
  return Number.isSafeInteger(after)&&after>=0?after:0;
}

function createRealtimeEventService(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  if(!dbPath) throw new Error('Realtime event service requires WFM_DB.');
  const db=new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;'+
    'CREATE TABLE IF NOT EXISTS vector_realtime_events('+
      'seq INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,topic TEXT NOT NULL,audience TEXT NOT NULL,'+
      'payload_json TEXT NOT NULL,created_at TEXT NOT NULL);'+
    'CREATE INDEX IF NOT EXISTS vector_realtime_tenant_seq ON vector_realtime_events(tenant,seq);'+
    'CREATE TRIGGER IF NOT EXISTS no_vector_realtime_event_update BEFORE UPDATE ON vector_realtime_events '+
      "BEGIN SELECT RAISE(ABORT,'Realtime events are append only.'); END;"+
    'CREATE TRIGGER IF NOT EXISTS no_vector_realtime_event_delete BEFORE DELETE ON vector_realtime_events '+
      "BEGIN SELECT RAISE(ABORT,'Realtime events are append only.'); END;"
  );
  const auth=db.prepare('SELECT u.email,u.tenant,u.role,s.expires FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const insert=db.prepare('INSERT INTO vector_realtime_events(tenant,topic,audience,payload_json,created_at) VALUES(?,?,?,?,?)');
  const list=db.prepare('SELECT seq,topic,audience,payload_json,created_at FROM vector_realtime_events WHERE tenant=? AND seq>? ORDER BY seq ASC LIMIT ?');
  const subscribers=new Set();
  const schedulingEventVisible=typeof options.schedulingEventVisible==='function'?options.schedulingEventVisible:null;
  function visible(c,event){
    if(!roleAllowed(c?.role,event.audience))return false;
    if(!event.topic.startsWith('scheduling.'))return true;
    try{return !!c?.email&&schedulingEventVisible?.(c,event)===true;}catch{return false;}
  }

  function context(req){
    const token=cookieToken(req);
    return token?auth.get(sha256(token),Date.now())||null:null;
  }
  function rowToEvent(row){
    return {seq:Number(row.seq),topic:row.topic,audience:row.audience,payload:JSON.parse(row.payload_json),createdAt:row.created_at};
  }
  function eventsForTenant(tenant,role,after=0,limit=100,principal=null){
    const safeAfter=Number.isSafeInteger(Number(after))&&Number(after)>=0?Number(after):0;
    const safeLimit=Math.max(1,Math.min(250,Number(limit)||100));
    const current=principal?.tenant===tenant&&principal.role===role?principal:{role};
    return list.all(compact(tenant,120),safeAfter,safeLimit).map(rowToEvent).filter(e=>visible(current,e));
  }
  function writeEvent(res,event){
    if(res.writableEnded) return false;
    try{
      res.write('id: '+event.seq+'\n');
      res.write('event: vector-change\n');
      res.write('data: '+JSON.stringify(event)+'\n\n');
      return true;
    }catch{return false;}
  }
  function publish(input={}){
    const tenant=compact(input.tenant,120);
    const topic=compact(input.topic,80);
    if(!tenant) throw new Error('Realtime event tenant is required.');
    if(!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(topic)) throw new Error('Invalid realtime event topic.');
    const audience=normaliseAudience(input.audience);
    let payloadJson;
    try{ payloadJson=JSON.stringify(input.payload??{}); }catch{ throw new Error('Realtime event payload must be JSON serialisable.'); }
    if(Buffer.byteLength(payloadJson,'utf8')>MAX_PAYLOAD_BYTES) throw new Error('Realtime event payload is too large.');
    const createdAt=new Date().toISOString();
    const result=insert.run(tenant,topic,audience,payloadJson,createdAt);
    const event={seq:Number(result.lastInsertRowid),topic,audience,payload:JSON.parse(payloadJson),createdAt};
    for(const sub of [...subscribers]){
      const current=context(sub.req);
      if(!current||current.email!==sub.email||current.tenant!==sub.tenant||sub.res.writableEnded){try{sub.res.end();}catch{} subscribers.delete(sub);continue;}
      if(current.tenant===tenant&&visible(current,event)&&!writeEvent(sub.res,event)) subscribers.delete(sub);
    }
    return event;
  }
  function stream(req,res,c){
    res.statusCode=200;
    res.setHeader('Content-Type','text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
    res.setHeader('Connection','keep-alive');
    res.setHeader('X-Accel-Buffering','no');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(typeof res.flushHeaders==='function') res.flushHeaders();
    const after=parseAfter(req);
    for(const event of eventsForTenant(c.tenant,c.role,after,250,c)) writeEvent(res,event);
    try{res.write(': connected\n\n');}catch{}
    const sub={tenant:c.tenant,email:c.email,req,res};
    subscribers.add(sub);
    const close=()=>subscribers.delete(sub);
    if(typeof req.on==='function') req.on('close',close);
    if(typeof res.on==='function') res.on('close',close);
    return true;
  }
  async function handleRequest(req,res){
    const path=pathOf(req);
    if(!path.startsWith(PREFIX)) return false;
    if(String(req.method||'GET').toUpperCase()!=='GET'){
      res.setHeader('Allow','GET');
      return writeJson(res,405,{error:'Realtime endpoints are read-only.'});
    }
    const c=context(req);
    if(!c) return writeJson(res,401,{error:'Sign in is required.'});
    if(path===PREFIX+'/stream') return stream(req,res,c);
    if(path===PREFIX+'/events'){
      const after=parseAfter(req);
      const events=eventsForTenant(c.tenant,c.role,after,100,c);
      return writeJson(res,200,{contractVersion:'VECTOR_REALTIME_EVENTS_V1',tenant:c.tenant,after,events});
    }
    return writeJson(res,404,{error:'Realtime endpoint not found.'});
  }
  const heartbeat=setInterval(()=>{
    for(const sub of [...subscribers]){
      const current=context(sub.req);
      if(!current||current.email!==sub.email||current.tenant!==sub.tenant||sub.res.writableEnded){try{sub.res.end();}catch{} subscribers.delete(sub);continue;}
      try{sub.res.write(': heartbeat\n\n');}catch{subscribers.delete(sub);}
    }
  },20000);
  if(typeof heartbeat.unref==='function') heartbeat.unref();

  return {
    handleRequest,
    publish,
    eventsForTenant,
    close(){
      clearInterval(heartbeat);
      for(const sub of subscribers){try{sub.res.end();}catch{}}
      subscribers.clear();
      try{db.close();}catch{}
    }
  };
}

module.exports={createRealtimeEventService,roleAllowed};
