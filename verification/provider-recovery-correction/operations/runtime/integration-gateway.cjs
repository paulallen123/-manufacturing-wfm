'use strict';
const providerReceivers=new WeakMap();
function isProviderReceiver(receiver,jobStore){return providerReceivers.get(receiver)===jobStore;}
const {createHash,timingSafeEqual}=require('node:crypto');

function fail(message,status=400){const e=Error(message);e.status=status;throw e;}
function clean(v,max=120){return String(v??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,max);}
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
function canonical(value){return JSON.stringify(stable(value));}
function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function parseConfigs(raw){
 let rows=[];try{rows=raw?JSON.parse(raw):[];}catch{fail('Integration connector configuration is invalid.',503);}
 if(!Array.isArray(rows))fail('Integration connector configuration is invalid.',503);
 const ids=new Set();return rows.map(x=>{
  const id=clean(x?.id,60),provider=clean(x?.provider,60),tenant=clean(x?.tenant,80),scope=clean(x?.scope,80),token=String(x?.token||''),objectTypes=Array.isArray(x?.objectTypes)?x.objectTypes.map(v=>clean(v,40)):[];
  if(!/^[A-Za-z0-9_.:-]{3,60}$/.test(id)||ids.has(id)||!provider||!tenant||!scope||token.length<32||!objectTypes.length)fail('Integration connector configuration is incomplete.',503);
  if(objectTypes.some(v=>!['demand','people','identity'].includes(v)))fail('Integration connector object type is unsupported.',503);
  ids.add(id);return {id,provider,tenant,scope,token,objectTypes:[...new Set(objectTypes)]};
 });
}
function authenticate(rawConfig,headers){
 const configs=parseConfigs(rawConfig),id=clean(headers['x-connector-id'],60),auth=String(headers.authorization||'').replace(/^Bearer\s+/i,'');
 const cfg=configs.find(x=>x.id===id);if(!cfg)fail('Integration connector is not configured.',401);
 if(Buffer.byteLength(auth)!==Buffer.byteLength(cfg.token)||!timingSafeEqual(Buffer.from(auth),Buffer.from(cfg.token)))fail('Integration connector credential rejected.',401);
 return {...cfg,token:undefined};
}
function envelope(input,cfg){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Integration payload must be an object.');
 const allowed=['objectType','cursor','sourceVersion','records'];if(Object.keys(input).some(k=>!allowed.includes(k)))fail('Only objectType, cursor, sourceVersion and records are accepted. Tenant and authority come from the connector identity.');
 const objectType=clean(input.objectType,40);if(!cfg.objectTypes.includes(objectType))fail('Connector is not authorised for this object type.',403);
 const cursor=input.cursor===null||input.cursor===undefined?null:clean(input.cursor,240),sourceVersion=input.sourceVersion===null||input.sourceVersion===undefined?null:clean(input.sourceVersion,120);
 if(!Array.isArray(input.records)||input.records.length<1||input.records.length>1000)fail('Provide 1–1,000 integration records.');
 const seen=new Set(),records=input.records.map((x,i)=>{
  if(!x||typeof x!=='object'||Array.isArray(x))fail(`Record ${i+1} must be an object.`);
  const keys=['externalId','revision','operation','data'];if(Object.keys(x).some(k=>!keys.includes(k)))fail(`Record ${i+1} has unsupported fields.`);
  const externalId=clean(x.externalId,128);if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,127}$/.test(externalId))fail(`Record ${i+1} externalId is invalid.`);
  if(seen.has(externalId))fail(`Duplicate externalId ${externalId} in one batch.`);seen.add(externalId);
  const revision=x.revision===undefined||x.revision===null?'1':clean(x.revision,100);if(!revision)fail(`Record ${i+1} revision is required.`);
  const operation=clean(x.operation||'upsert',20);if(!['upsert','delete'].includes(operation))fail(`Record ${i+1} operation must be upsert or delete.`);
  if(!x.data||typeof x.data!=='object'||Array.isArray(x.data))fail(`Record ${i+1} data must be an object.`);
  return {externalId,revision,operation,data:x.data};
 });
 return {objectType,cursor,sourceVersion,records};
}
function createStore(db){
 db.exec(`
 CREATE TABLE IF NOT EXISTS integration_batches(
  id TEXT PRIMARY KEY,tenant TEXT NOT NULL,connector_id TEXT NOT NULL,provider TEXT NOT NULL,object_type TEXT NOT NULL,idempotency_key TEXT NOT NULL,payload_digest TEXT NOT NULL,cursor TEXT,source_version TEXT,status TEXT NOT NULL,record_count INTEGER NOT NULL,valid_count INTEGER NOT NULL,held_count INTEGER NOT NULL,applied_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,reviewed_by TEXT,reviewed_at TEXT,result_json TEXT,UNIQUE(tenant,connector_id,idempotency_key));
 CREATE TABLE IF NOT EXISTS integration_records(
  batch_id TEXT NOT NULL REFERENCES integration_batches(id),record_no INTEGER NOT NULL,external_id TEXT NOT NULL,source_revision TEXT NOT NULL,operation TEXT NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL,reason TEXT,canonical_json TEXT,applied_ref TEXT,PRIMARY KEY(batch_id,record_no),UNIQUE(batch_id,external_id));
 CREATE TABLE IF NOT EXISTS integration_checkpoints(
  tenant TEXT NOT NULL,connector_id TEXT NOT NULL,object_type TEXT NOT NULL,cursor TEXT,source_version TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(tenant,connector_id,object_type));
 CREATE INDEX IF NOT EXISTS integration_batches_tenant_time ON integration_batches(tenant,created_at DESC);
 CREATE INDEX IF NOT EXISTS integration_records_external ON integration_records(external_id);
 `);
 function transaction(write){db.exec('BEGIN IMMEDIATE');try{const result=write();db.exec('COMMIT');return result;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
 function stage(cfg,input,key,prepare,receivingTransaction=transaction){
  return receivingTransaction(()=>{
  if(!/^[A-Za-z0-9_.:-]{8,100}$/.test(String(key||'')))fail('Idempotency-Key required.',400);
  const env=envelope(input,cfg),payloadDigest=digest(env),prior=db.prepare('SELECT * FROM integration_batches WHERE tenant=? AND connector_id=? AND idempotency_key=?').get(cfg.tenant,cfg.id,String(key));
  if(prior){if(prior.payload_digest!==payloadDigest)fail('Idempotency key reused for a different integration payload.',409);return {...JSON.parse(prior.result_json),replayed:true};}
  const id='IG-'+Date.now().toString(36)+'-'+createHash('sha256').update(cfg.id+'|'+key).digest('hex').slice(0,12),at=new Date().toISOString(),rows=[];
  for(let i=0;i<env.records.length;i++){
   const src=env.records[i];try{const canonicalRecord=prepare(env.objectType,src,cfg);rows.push({n:i+1,...src,digest:digest(src),status:'valid',reason:null,canonical:canonicalRecord});}
   catch(e){rows.push({n:i+1,...src,digest:digest(src),status:'held',reason:clean(e.message,500),canonical:null});}
  }
  const valid=rows.filter(x=>x.status==='valid').length,held=rows.length-valid,status=held?'review_required':'staged',result={id,connectorId:cfg.id,provider:cfg.provider,objectType:env.objectType,status,records:rows.length,valid,held,cursor:env.cursor,sourceVersion:env.sourceVersion,replayed:false};
   db.prepare('INSERT INTO integration_batches(id,tenant,connector_id,provider,object_type,idempotency_key,payload_digest,cursor,source_version,status,record_count,valid_count,held_count,created_at,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,cfg.tenant,cfg.id,cfg.provider,env.objectType,String(key),payloadDigest,env.cursor,env.sourceVersion,status,rows.length,valid,held,at,JSON.stringify(result));
   const ins=db.prepare('INSERT INTO integration_records(batch_id,record_no,external_id,source_revision,operation,digest,status,reason,canonical_json) VALUES(?,?,?,?,?,?,?,?,?)');
   for(const r of rows)ins.run(id,r.n,r.externalId,r.revision,r.operation,r.digest,r.status,r.reason,r.canonical===null?null:JSON.stringify(r.canonical));
   db.prepare('INSERT INTO audit_events(tenant,actor,action,detail,created_at) VALUES(?,?,?,?,?)').run(cfg.tenant,'integration:'+cfg.id,'integration-stage',JSON.stringify({id,provider:cfg.provider,objectType:env.objectType,records:rows.length,valid,held,cursor:env.cursor,sourceVersion:env.sourceVersion}),at);
   return result;
  });
 }
 function report(actor){
  if(!(actor.permissions||[]).includes('company.configure'))fail('Company configuration permission required.',403);
  const batches=db.prepare('SELECT id,connector_id,provider,object_type,cursor,source_version,status,record_count,valid_count,held_count,applied_count,created_at,reviewed_by,reviewed_at,result_json FROM integration_batches WHERE tenant=? ORDER BY created_at DESC LIMIT 100').all(actor.tenant).map(x=>({id:x.id,connectorId:x.connector_id,provider:x.provider,objectType:x.object_type,cursor:x.cursor,sourceVersion:x.source_version,status:x.status,records:x.record_count,valid:x.valid_count,held:x.held_count,applied:x.applied_count,createdAt:x.created_at,reviewedBy:x.reviewed_by,reviewedAt:x.reviewed_at}));
  const checkpoint=db.prepare('SELECT connector_id,object_type,cursor,source_version,updated_at FROM integration_checkpoints WHERE tenant=? ORDER BY connector_id,object_type').all(actor.tenant).map(x=>({connectorId:x.connector_id,objectType:x.object_type,cursor:x.cursor,sourceVersion:x.source_version,updatedAt:x.updated_at}));
  return {batches,checkpoints:checkpoint,limitations:['Connector credentials remain server-side and are never returned here.','A staged batch does not change workforce records.','Held records block application; fix the source and submit a new idempotent batch.','Provider-specific OAuth, pagination, throttling and sandbox acceptance remain adapter responsibilities.']};
 }
 function detail(actor,id){
  if(!(actor.permissions||[]).includes('company.configure'))fail('Company configuration permission required.',403);
  const b=db.prepare('SELECT * FROM integration_batches WHERE id=? AND tenant=?').get(String(id||''),actor.tenant);if(!b)fail('Integration batch not found.',404);
  const rows=db.prepare('SELECT record_no,external_id,source_revision,operation,status,reason,applied_ref FROM integration_records WHERE batch_id=? ORDER BY record_no').all(b.id).map(x=>({record:x.record_no,externalId:x.external_id,revision:x.source_revision,operation:x.operation,status:x.status,reason:x.reason,appliedRef:x.applied_ref}));
  return {id:b.id,connectorId:b.connector_id,provider:b.provider,objectType:b.object_type,status:b.status,cursor:b.cursor,sourceVersion:b.source_version,records:rows,createdAt:b.created_at,reviewedBy:b.reviewed_by,reviewedAt:b.reviewed_at};
 }
 function apply(actor,id,reviewed,handlers){
  if(!(actor.permissions||[]).includes('company.configure'))fail('Company configuration permission required.',403);if(reviewed!==true)fail('Review the staged integration batch before applying.');
  const b=db.prepare('SELECT * FROM integration_batches WHERE id=? AND tenant=?').get(String(id||''),actor.tenant);if(!b)fail('Integration batch not found.',404);if(b.status==='applied')return {...JSON.parse(b.result_json),replayed:true};
  if(b.held_count>0)fail('Held integration records must be corrected at source and restaged before application.',409);if(b.status!=='staged')fail('Integration batch is not ready to apply.',409);
  const rows=db.prepare("SELECT record_no,external_id,source_revision,operation,canonical_json FROM integration_records WHERE batch_id=? AND status='valid' ORDER BY record_no").all(b.id).map(x=>({...x,canonical:JSON.parse(x.canonical_json)}));
  const handler=handlers[b.object_type];if(typeof handler!=='function')fail('No application handler exists for this integration object type.',501);
  const outcome=handler(rows,b);const at=new Date().toISOString();
  db.prepare("UPDATE integration_batches SET status='applied',applied_count=?,reviewed_by=?,reviewed_at=? WHERE id=?").run(rows.length,actor.email||actor.personId,at,b.id);
  const ref=outcome?.id||outcome?.batchId||null;db.prepare("UPDATE integration_records SET status='applied',applied_ref=? WHERE batch_id=? AND status='valid'").run(ref,b.id);
  db.prepare(`INSERT INTO integration_checkpoints(tenant,connector_id,object_type,cursor,source_version,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant,connector_id,object_type) DO UPDATE SET cursor=excluded.cursor,source_version=excluded.source_version,updated_at=excluded.updated_at`).run(b.tenant,b.connector_id,b.object_type,b.cursor,b.source_version,at);
  const result={id:b.id,connectorId:b.connector_id,provider:b.provider,objectType:b.object_type,status:'applied',records:b.record_count,valid:b.valid_count,held:0,applied:rows.length,cursor:b.cursor,sourceVersion:b.source_version,outcome};
  db.prepare('UPDATE integration_batches SET result_json=? WHERE id=?').run(JSON.stringify(result),b.id);
  db.prepare('INSERT INTO audit_events(tenant,actor,action,detail,created_at) VALUES(?,?,?,?,?)').run(b.tenant,actor.personId,'integration-apply',JSON.stringify({id:b.id,connectorId:b.connector_id,provider:b.provider,objectType:b.object_type,records:rows.length,outcomeId:ref}),at);
  return result;
 }
 function createProviderReceiver(jobStore,config,prepare){
  if(typeof jobStore?.stageTransaction!=='function'||typeof prepare!=='function')fail('Fenced provider receiver dependencies are required.',500);
  const cfg=structuredClone(config);
  const receiver=(batch,scope)=>stage(cfg,batch.envelope,batch.idempotencyKey,prepare,write=>jobStore.stageTransaction(db,{...scope,objectType:batch.envelope.objectType},cfg,write));
  providerReceivers.set(receiver,jobStore);return receiver;
 }
 return {stage,createProviderReceiver,report,detail,apply};
}
module.exports={isProviderReceiver,createStore,parseConfigs,authenticate,envelope,canonical,digest};
