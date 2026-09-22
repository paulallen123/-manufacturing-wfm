'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createTrainingDeliveryService}=require('./training-delivery-service.cjs');

test('delivery service builds assigned role training without changing mastery',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'training-service-')),dbPath=path.join(dir,'x.db'),db=new DatabaseSync(dbPath);
  db.exec("CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);CREATE TABLE learning_assignments(id TEXT PRIMARY KEY,tenant TEXT,email TEXT,role TEXT,competency_key TEXT,status TEXT,score INTEGER,due_at_ms INTEGER,mastered_at_ms INTEGER,source TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE learning_help(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT,email TEXT,competency_key TEXT,event TEXT,created_at_ms INTEGER,created_at TEXT);");
  db.prepare('INSERT INTO learning_assignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('1','T','m@t','manager','schedule.recover','DUE',0,Date.now(),null,'role','x','x');db.close();
  const s=createTrainingDeliveryService({dbPath});
  const module=s.moduleForUser({tenant:'T',email:'m@t',role:'manager'},'schedule.recover','PRACTISE');
  assert.equal(module.mode,'PRACTISE');assert.ok(module.scenario);assert.equal(module.scenario.episode.mode,'SHADOW');
  s.close();fs.rmSync(dir,{recursive:true,force:true});
});
