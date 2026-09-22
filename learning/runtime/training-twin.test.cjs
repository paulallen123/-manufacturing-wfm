'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createTrainingTwin,recommendation}=require('./training-twin.cjs');

function dbFixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'training-twin-')),dbPath=path.join(dir,'x.db'),db=new DatabaseSync(dbPath);
  db.exec("CREATE TABLE learning_assignments(id TEXT PRIMARY KEY,tenant TEXT,email TEXT,role TEXT,competency_key TEXT,status TEXT,score INTEGER,due_at_ms INTEGER,mastered_at_ms INTEGER,source TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE learning_help(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT,email TEXT,competency_key TEXT,event TEXT,created_at_ms INTEGER,created_at TEXT);");
  db.prepare('INSERT INTO learning_assignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('1','T','m@t','manager','schedule.recover','DUE',0,Date.now(),null,'role','x','x');
  db.close();return{dir,dbPath};
}
test('training twin recommends exposure first and never infers mastery',()=>{
  const f=dbFixture(),t=createTrainingTwin({dbPath:f.dbPath}),p=t.profileForUser({tenant:'T',email:'m@t',role:'manager'});
  assert.equal(p.due[0].recommendedMode,'SHOW_ME');
  assert.equal(p.due[0].score,0);
  t.close();fs.rmSync(f.dir,{recursive:true,force:true});
});
test('explicit skip explanation routes knowledgeable user toward proving competence, not auto-mastery',()=>{
  assert.equal(recommendation({score:85,status:'REFRESH_DUE',due_at_ms:Date.now()-1},0,true),'TEST_ME');
});
