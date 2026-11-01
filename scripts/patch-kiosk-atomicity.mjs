import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const marker='VECTOR_KIOSK_EVENT_ATOMICITY_V1';
function replaceOnce(source,before,after,name){
 if(source.split(before).length!==2)throw Error('KIOSK_ATOMICITY_ANCHOR_CHANGED:'+name);
 return source.replace(before,after);
}

// Explicit transformation of the sealed native files. The caller must assemble
// the reviewed runtime first; this module performs no database or network work.
export function patchKioskAtomicitySources(server,personalStore){
 if(server.includes(marker)||personalStore.includes(marker))throw Error('KIOSK_ATOMICITY_ALREADY_PATCHED');
 personalStore=replaceOnce(personalStore,
  "const digest=hash({cmd,x});db.exec('BEGIN IMMEDIATE');try{",
  "const digest=hash({cmd,x}),nestedTransaction=db.isTransaction;/* "+marker+" */db.exec(nestedTransaction?'SAVEPOINT personal_command':'BEGIN IMMEDIATE');try{",
  'personal-begin');
 personalStore=replaceOnce(personalStore,
  "db.exec('COMMIT');return {...parse(receipt.result),replayed:true};",
  "db.exec(nestedTransaction?'RELEASE SAVEPOINT personal_command':'COMMIT');return {...parse(receipt.result),replayed:true};",
  'personal-replay');
 personalStore=replaceOnce(personalStore,
  "db.exec('COMMIT');return result;\n  }catch(e){db.exec('ROLLBACK');throw e;}",
  "db.exec(nestedTransaction?'RELEASE SAVEPOINT personal_command':'COMMIT');return result;\n  }catch(e){if(nestedTransaction){db.exec('ROLLBACK TO SAVEPOINT personal_command');db.exec('RELEASE SAVEPOINT personal_command');}else db.exec('ROLLBACK');throw e;}",
  'personal-end');

 const routeStart="if(url.pathname==='/api/kiosk/sync'&&req.method==='POST'){";
 const routeEnd="if(url.pathname==='/api/onboarding/accept'";
 const start=server.indexOf(routeStart),end=server.indexOf(routeEnd,start);
 if(start<0||end<0||server.indexOf(routeStart,start+1)!==-1)throw Error('KIOSK_ATOMICITY_ANCHOR_CHANGED:kiosk-route');
 let route=server.slice(start,end);
 route=replaceOnce(route,
  'for(const x of input.events){if(stopped)break;try{',
  'for(const x of input.events){if(stopped)break;let transactionOpen=false;try{/* '+marker+' */',
  'event-begin');
 route=replaceOnce(route,
  "const digest=kioskDigest(x),prior=db.prepare(",
  "const digest=kioskDigest(x);db.exec('BEGIN IMMEDIATE');transactionOpen=true;const prior=db.prepare(",
  'event-transaction');
 route=replaceOnce(route,
  "E.assert(prior.digest===digest,'Queued event ID was reused for different content.',409);results.push(",
  "E.assert(prior.digest===digest,'Queued event ID was reused for different content.',409);db.exec('COMMIT');transactionOpen=false;results.push(",
  'event-replay');
 route=replaceOnce(route,
  "last=x.sequence;db.prepare('UPDATE kiosk_devices SET last_sequence=?,last_seen=? WHERE id=?').run(last,serverAt,device.id);results.push(",
  "db.prepare('UPDATE kiosk_devices SET last_sequence=?,last_seen=? WHERE id=?').run(x.sequence,serverAt,device.id);db.exec('COMMIT');transactionOpen=false;last=x.sequence;results.push(",
  'event-commit');
 route=replaceOnce(route,
  '}catch(err){results.push({eventId:x?.eventId||null,',
  "}catch(err){if(transactionOpen)db.exec('ROLLBACK');results.push({eventId:x?.eventId||null,",
  'event-rollback');
 server=server.slice(0,start)+route+server.slice(end);
 return {server,personalStore};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('KIOSK_ATOMICITY_RUNTIME_REQUIRED');
 const runtime=path.resolve(process.argv[2]),serverFile=path.join(runtime,'server.cjs'),
  personalFile=path.join(runtime,'lib/personal-store.cjs');
 const result=patchKioskAtomicitySources(fs.readFileSync(serverFile,'utf8'),fs.readFileSync(personalFile,'utf8'));
 fs.writeFileSync(serverFile,result.server);fs.writeFileSync(personalFile,result.personalStore);
 console.log('VECTOR_KIOSK_EVENT_ATOMICITY=PASS');
}

