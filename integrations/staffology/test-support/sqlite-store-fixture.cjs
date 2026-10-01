'use strict';
// TEST FIXTURE ONLY. Demonstrates the adapter's durable-store interface using
// disposable SQLite files. This is NOT VECTOR's canonical store or a migration.
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
function openFixtureStore(filename){
 const db=new DatabaseSync(filename);
 db.exec(`PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS fixture_deliveries(
 id TEXT PRIMARY KEY,digest TEXT NOT NULL,binding_digest TEXT NOT NULL,
 payload TEXT NOT NULL,status TEXT NOT NULL,token TEXT NOT NULL,receipt TEXT,details TEXT);
 CREATE TABLE IF NOT EXISTS fixture_evidence(
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,delivery_id TEXT NOT NULL,evidence TEXT NOT NULL);`);
 const get=id=>{const row=db.prepare('SELECT * FROM fixture_deliveries WHERE id=?').get(id);if(!row)return null;return {deliveryId:row.id,digest:row.digest,bindingDigest:row.binding_digest,payload:JSON.parse(row.payload),status:row.status,token:row.token,receipt:row.receipt?JSON.parse(row.receipt):null,details:row.details?JSON.parse(row.details):null,dispatchAttempt:db.prepare('SELECT evidence FROM fixture_evidence WHERE delivery_id=? ORDER BY sequence').all(id).map(r=>JSON.parse(r.evidence)).find(e=>e.phase==='dispatchAttempt')?.attempt||null,baseline:db.prepare('SELECT evidence FROM fixture_evidence WHERE delivery_id=? ORDER BY sequence').all(id).map(r=>JSON.parse(r.evidence)).find(e=>e.phase==='baseline')||null};};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const requireOwner=(id,token)=>{const row=get(id);if(!row||row.token!==token)throw Error('FIXTURE_OWNER_MISMATCH');return row;};
 return {
  db,get:async id=>get(id),
  begin:async row=>transaction(()=>{if(get(row.deliveryId))return {acquired:false};const token='fixture-'+randomUUID();db.prepare('INSERT INTO fixture_deliveries(id,digest,binding_digest,payload,status,token) VALUES(?,?,?,?,?,?)').run(row.deliveryId,row.digest,row.bindingDigest,JSON.stringify(row.payload),row.status,token);return {acquired:true,token};}),
  assertOwned:async({deliveryId,token,digest,bindingDigest,dispatch,permit,request})=>transaction(()=>{const r=get(deliveryId);if(!r||r.token!==token||r.digest!==digest||r.bindingDigest!==bindingDigest)return false;if(dispatch){if(r.dispatchAttempt)return false;const attempt={deliveryId,digest,bindingDigest,baselineSha256:permit.baselineSha256,baselineRunSha256:permit.baselineRunSha256,request};db.prepare('INSERT INTO fixture_evidence(delivery_id,evidence) VALUES(?,?)').run(deliveryId,JSON.stringify({phase:'dispatchAttempt',attempt}));dispatch();}return true;}),
  recordEvidence:async(id,evidence,token)=>transaction(()=>{requireOwner(id,token);db.prepare('INSERT INTO fixture_evidence(delivery_id,evidence) VALUES(?,?)').run(id,JSON.stringify(evidence));return true;}),
  acknowledge:async(id,receipt,token)=>transaction(()=>{requireOwner(id,token);db.prepare("UPDATE fixture_deliveries SET status='acknowledged',receipt=? WHERE id=?").run(JSON.stringify(receipt),id);return true;}),
  markUncertain:async(id,details,token)=>transaction(()=>{requireOwner(id,token);db.prepare("UPDATE fixture_deliveries SET status='uncertain',details=? WHERE id=?").run(JSON.stringify(details),id);}),
  evidence:()=>db.prepare('SELECT evidence FROM fixture_evidence ORDER BY sequence').all().map(r=>JSON.parse(r.evidence)),
  close:()=>db.close()
 };
}
module.exports={openFixtureStore};
