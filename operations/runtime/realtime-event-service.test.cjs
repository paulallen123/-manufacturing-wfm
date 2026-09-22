'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createRealtimeEventService,roleAllowed}=require('./realtime-event-service.cjs');

test('realtime events are tenant isolated, audience filtered, ordered and replayable',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-realtime-'));
  const dbPath=path.join(dir,'wfm.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);'+
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);'
  );
  db.close();

  const service=createRealtimeEventService({dbPath});
  const first=service.publish({tenant:'A',topic:'demand.updated',audience:'manager',payload:{kind:'demand'}});
  const second=service.publish({tenant:'A',topic:'workspace.updated',audience:'all',payload:{kind:'workspace'}});
  service.publish({tenant:'B',topic:'workspace.updated',audience:'all',payload:{kind:'other'}});

  assert.deepEqual(service.eventsForTenant('A','manager',0).map(x=>x.topic),['demand.updated','workspace.updated']);
  assert.deepEqual(service.eventsForTenant('A','employee',0).map(x=>x.topic),['workspace.updated']);
  assert.deepEqual(service.eventsForTenant('B','manager',0).map(x=>x.topic),['workspace.updated']);
  assert.deepEqual(service.eventsForTenant('A','manager',first.seq).map(x=>x.seq),[second.seq]);
  assert.ok(second.seq>first.seq);
  assert.equal(roleAllowed('employee','manager'),false);
  assert.equal(roleAllowed('admin','manager'),true);

  assert.throws(()=>service.publish({tenant:'A',topic:'bad topic',payload:{}}),/Invalid realtime event topic/);
  assert.throws(()=>service.publish({tenant:'A',topic:'x',payload:{x:'x'.repeat(20000)}}),/too large/);

  const verify=new DatabaseSync(dbPath);
  assert.throws(()=>verify.prepare('UPDATE vector_realtime_events SET topic=? WHERE seq=?').run('x',first.seq),/append only/);
  verify.close();
  service.close();
  fs.rmSync(dir,{recursive:true,force:true});
});
