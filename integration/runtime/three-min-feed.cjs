'use strict';
const {createHash, randomUUID, timingSafeEqual} = require('node:crypto');
const PREFIX = '/api/integrations/autonomous/feeds/3min';
const DOMAINS = Object.freeze(['people','organisation','skills','absence','time','production','quality','maintenance','finance','payroll','access-control']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_BYTES = 256 * 1024;
// Public source IDs must begin with an alphanumeric character. Rejections are
// transport events, so their internal identities must never occupy that space.
const rejectedEventId = recordId => '!rejected:' + recordId;
const fields = ['schemaVersion','tenant','site','source','domain','environment','eventId','occurredAt','records'];
const webhookFields = ['id','operation','status','endpoint_slug','payload','processed_at'];
const digest = value => createHash('sha256').update(value).digest('hex');
const sameSecret = (a,b) => typeof a==='string' && a.length<=512 && timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
function json(res,status,body) {res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(body));return true;}
function failure(status,code) {return Object.assign(new Error(code),{status,code});}
function safeData(value,depth=0) {
 if(depth>12) return false;
 if(value===null||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(!value||typeof value!=='object')return false;
 return Object.keys(value).every(k=>!['__proto__','prototype','constructor'].includes(k)&&safeData(value[k],depth+1));
}
function bindingsFrom(env) {
 try {
  const list=JSON.parse(env.WFM_3MIN_FEEDS_JSON||'[]');
  if(!Array.isArray(list)||list.length>100)throw Error();
  const result=new Map();
  for(const item of list){
   if(!item||Array.isArray(item)||Object.keys(item).sort().join('|')!==['id','tenant','site','source','domain','environment','endpointSlug','secretEnv'].sort().join('|')||
    !['id','tenant','site','source'].every(k=>typeof item[k]==='string'&&ID.test(item[k]))||
    typeof item.endpointSlug!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(item.endpointSlug)||
    !DOMAINS.includes(item.domain)||!['sandbox','production'].includes(item.environment)||
    typeof item.secretEnv!=='string'||!/^WFM_3MIN_[A-Z0-9_]+_TOKEN$/.test(item.secretEnv)||result.has(item.id))throw Error();
   const binding=Object.freeze({...item,fingerprint:digest(JSON.stringify([item.id,item.tenant,item.site,item.source,item.domain,item.environment,item.endpointSlug]))});
   result.set(item.id,binding);
  }
  return result;
 }catch{return new Map();}
}
// An authenticated transport is not evidence that the original provider data is
// authorised, current, mapped or reconciled. This inbox cannot grant readiness.
function createThreeMinFeed({db,env=process.env,now=Date.now,assertEffect=()=>{}}) {
 const bindings=bindingsFrom(env);
 db.exec(`CREATE TABLE IF NOT EXISTS integration_feed_inbox(
  id TEXT PRIMARY KEY,binding_id TEXT NOT NULL,binding_fingerprint TEXT NOT NULL,
  tenant TEXT NOT NULL,site TEXT NOT NULL,source TEXT NOT NULL,domain TEXT NOT NULL,
  environment TEXT NOT NULL,event_id TEXT NOT NULL,record_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,payload_json TEXT NOT NULL,record_count INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,received_at TEXT NOT NULL,status TEXT NOT NULL,validation_error TEXT,
  UNIQUE(binding_id,event_id),UNIQUE(binding_id,record_id));
  CREATE TABLE IF NOT EXISTS integration_feed_deliveries(
   binding_id TEXT NOT NULL,record_id TEXT NOT NULL,receipt_id TEXT NOT NULL REFERENCES integration_feed_inbox(id),
   PRIMARY KEY(binding_id,record_id));
  CREATE INDEX IF NOT EXISTS integration_feed_tenant_received ON integration_feed_inbox(tenant,received_at);`);
 const byRecord=db.prepare('SELECT i.* FROM integration_feed_deliveries d JOIN integration_feed_inbox i ON i.id=d.receipt_id WHERE d.binding_id=? AND d.record_id=?');
 const delivery=db.prepare('INSERT INTO integration_feed_deliveries VALUES(?,?,?)');
 const byEvent=db.prepare('SELECT * FROM integration_feed_inbox WHERE binding_id=? AND event_id=?');
 const insert=db.prepare('INSERT INTO integration_feed_inbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 const audit=db.prepare('INSERT INTO integration_events(tenant,connection_id,event,detail_json,created_at) VALUES(?,NULL,?,?,?)');
 const recent=db.prepare('SELECT id,binding_id,site,source,domain,environment,event_id,record_count,payload_sha256,occurred_at,received_at,status,validation_error FROM integration_feed_inbox WHERE tenant=? ORDER BY rowid DESC LIMIT 50');
 // Preserve original receipts and delivery aliases while moving only the old
 // derived rejection IDs out of the public source-event namespace. Old binaries
 // cannot replay these migrated IDs: keep feeds disabled on a pre-fix rollback.
 const migrationSavepoint=db.isTransaction?'feed_rejections_'+randomUUID().replaceAll('-',''):null;
 db.exec(migrationSavepoint?'SAVEPOINT '+migrationSavepoint:'BEGIN IMMEDIATE');
 try{
  const legacy=db.prepare("SELECT id,binding_id,tenant,record_id,event_id FROM integration_feed_inbox WHERE status='REJECTED_VALIDATION' AND event_id='rejected.' || record_id").all();
  const migrate=db.prepare("UPDATE integration_feed_inbox SET event_id=? WHERE id=? AND status='REJECTED_VALIDATION' AND event_id=?");
  for(const row of legacy){
   if(!UUID.test(row.record_id))throw Error('Invalid legacy feed rejection identity.');
   const eventId=rejectedEventId(row.record_id);
   if(Number(migrate.run(eventId,row.id,row.event_id).changes)!==1)throw Error('Feed rejection identity changed during migration.');
   audit.run(row.tenant,'three-min-feed-rejection-identity-migrated',JSON.stringify({receiptId:row.id,bindingId:row.binding_id,previousEventId:row.event_id,eventId}),new Date(now()).toISOString());
  }
  db.exec(migrationSavepoint?'RELEASE '+migrationSavepoint:'COMMIT');
 }catch(error){
  try{db.exec(migrationSavepoint?'ROLLBACK TO '+migrationSavepoint+'; RELEASE '+migrationSavepoint:'ROLLBACK');}catch{}
  throw error;
 }
 function receipt(row,replayed){return {receiptId:row.id,status:row.status,replayed,transportAuthenticated:true,sourceAuthenticated:false,executionAuthority:false};}
 function statusForTenant(tenant){return {transport:'3min-api',schemaVersion:'vector-feed-v1',sourceAuthenticated:false,executionAuthority:false,
  bindings:[...bindings.values()].filter(b=>b.tenant===tenant).map(b=>({id:b.id,site:b.site,source:b.source,domain:b.domain,environment:b.environment,endpointSlug:b.endpointSlug,configured:validToken(env[b.secretEnv])})),
  receipts:recent.all(tenant).map(r=>({receiptId:r.id,bindingId:r.binding_id,site:r.site,source:r.source,domain:r.domain,environment:r.environment,eventId:r.event_id,recordCount:r.record_count,checksum:r.payload_sha256,occurredAt:r.occurred_at,receivedAt:r.received_at,status:r.status,validationError:r.validation_error}))};}
 function requireCurrentToken(binding,providedToken){
  const currentToken=env[binding.secretEnv];
  if(!validToken(currentToken))throw failure(503,'FEED_NOT_CONFIGURED');
  if(!sameSecret(providedToken,currentToken))throw failure(401,'FEED_AUTH_REQUIRED');
 }
 function persist(binding,recordId,body,raw,res,providedToken,validationError=null){
  // Body reads yield control. Revoked or superseded transport credentials cannot
  // create receipts, reserve replay aliases or retain validation-rejection data.
  requireCurrentToken(binding,providedToken);
  assertEffect(binding.tenant);
  const checksum=digest(raw); const id=binding.id;
   db.exec('BEGIN IMMEDIATE');
   try{
    const existingRecord=byRecord.get(id,recordId);const existingEvent=byEvent.get(id,body.eventId);
    const existing=existingRecord||existingEvent;
    if(existing){
     if((existingRecord&&existingEvent&&existingRecord.id!==existingEvent.id)||existing.binding_fingerprint!==binding.fingerprint||existing.event_id!==body.eventId||existing.payload_sha256!==checksum)throw failure(409,'FEED_REPLAY_CONFLICT');
     if(!existingRecord)delivery.run(id,recordId,existing.id);
     db.exec('COMMIT');return json(res,200,receipt(existing,true));
    }
    const receiptId=randomUUID(),stamp=new Date(now()).toISOString();
    insert.run(receiptId,id,binding.fingerprint,binding.tenant,binding.site,binding.source,binding.domain,binding.environment,body.eventId,recordId,checksum,validationError?'{}':raw.toString('utf8'),body.records.length,body.occurredAt,stamp,validationError?'REJECTED_VALIDATION':'RECEIVED_UNVALIDATED',validationError);
    delivery.run(id,recordId,receiptId);
    audit.run(binding.tenant,'three-min-feed-received',JSON.stringify({receiptId,bindingId:id,domain:binding.domain,recordCount:body.records.length,checksum,validationError}),stamp);
    db.exec('COMMIT');return json(res,202,receipt({id:receiptId,status:validationError?'REJECTED_VALIDATION':'RECEIVED_UNVALIDATED'},false));
   }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
 }
 async function handleRequest(req,res){
  const route=String(req.url||'').split('?')[0];
  if(!route.startsWith(PREFIX+'/'))return false;
  if(req.method!=='POST')return json(res,405,{code:'METHOD_NOT_ALLOWED'});
  const id=route.slice(PREFIX.length+1); const binding=bindings.get(id);
  if(!binding||!validToken(env[binding.secretEnv]))return json(res,503,{code:'FEED_NOT_CONFIGURED'});
  const providedToken=req.headers['x-vector-feed-token'];
  if(!sameSecret(providedToken,env[binding.secretEnv]))return json(res,401,{code:'FEED_AUTH_REQUIRED'});
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')||req.headers['content-encoding'])return json(res,415,{code:'JSON_REQUIRED'});
  const recordId=req.headers['x-3minapi-record-id'];
  if(typeof recordId!=='string'||!UUID.test(recordId))return json(res,400,{code:'INVALID_DELIVERY_ID'});
  let raw;
  try{
   const chunks=[];let size=0;
   for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>MAX_BYTES)throw failure(413,'FEED_TOO_LARGE');chunks.push(b);}
   requireCurrentToken(binding,providedToken);
   raw=Buffer.concat(chunks);
   let notification;try{notification=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw failure(400,'INVALID_JSON');}
   if(!notification||Array.isArray(notification)||typeof notification!=='object'||!safeData(notification)||
    !webhookFields.every(k=>Object.hasOwn(notification,k))||Object.keys(notification).some(k=>!webhookFields.includes(k)&&k!=='target_record_id'))throw failure(400,'INVALID_WEBHOOK');
   if(notification.id!==recordId)throw failure(403,'FEED_DELIVERY_MISMATCH');
   if(notification.endpoint_slug!==binding.endpointSlug)throw failure(403,'FEED_ENDPOINT_MISMATCH');
   // Feed ingestion is append-only. Provider updates/deletes or failed processing
   // must never be interpreted as new workforce data or operational mutations.
   if(notification.operation!=='create'||notification.status!=='success'||notification.target_record_id!=null)throw failure(400,'UNSUPPORTED_WEBHOOK_RESULT');
   if(typeof notification.processed_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(notification.processed_at)||!Number.isFinite(Date.parse(notification.processed_at)))throw failure(400,'INVALID_WEBHOOK');
   const body=notification.payload;
   if(!body||Array.isArray(body)||Object.keys(body).sort().join('|')!==fields.slice().sort().join('|')||body.schemaVersion!=='vector-feed-v1'||!safeData(body))throw failure(400,'INVALID_ENVELOPE');
   for(const key of ['tenant','site','source','domain','environment'])if(body[key]!==binding[key])throw failure(403,'FEED_SCOPE_MISMATCH');
   const occurred=typeof body.occurredAt==='string'?Date.parse(body.occurredAt):NaN;
   if(typeof body.eventId!=='string'||!ID.test(body.eventId)||!Number.isFinite(occurred)||new Date(occurred).toISOString()!==body.occurredAt||occurred>now()+300000||
    !Array.isArray(body.records)||body.records.length<1||body.records.length>500||body.records.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw failure(400,'INVALID_FEED_RECORDS');
   // Wrapper IDs and processing timestamps vary between separate deliveries of
   // one source event. Dedupe accepted events on the serialized original payload.
   return persist(binding,recordId,body,Buffer.from(JSON.stringify(body)),res,providedToken);
  }catch(error){
   if(raw && ['INVALID_JSON','INVALID_WEBHOOK','UNSUPPORTED_WEBHOOK_RESULT','INVALID_ENVELOPE','INVALID_FEED_RECORDS'].includes(error.code)) {
    // Valid transport credentials bind the rejection to this configured scope.
    // Retain metadata/digest only, never invalid or unbounded source payloads.
    try{return persist(binding,recordId,{eventId:rejectedEventId(recordId),records:[],occurredAt:new Date(now()).toISOString()},raw,res,providedToken,error.code);}catch(storageError){error=storageError;}
   }
   return json(res,error.status||error.statusCode||503,{code:error.code&&(error.status||error.statusCode)?error.code:'FEED_STORAGE_UNAVAILABLE'});
  }
 }
 return {handleRequest,statusForTenant};
}
function validToken(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{43,256}$/.test(value);}
module.exports={createThreeMinFeed,DOMAINS};
