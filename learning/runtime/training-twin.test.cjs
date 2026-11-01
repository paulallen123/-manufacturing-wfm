'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createTrainingTwin,recommendation}=require('./training-twin.cjs');

function dbFixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'training-twin-')),dbPath=path.join(dir,'x.db'),db=new DatabaseSync(dbPath);
  db.exec("CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);CREATE TABLE learning_assignments(id TEXT PRIMARY KEY,tenant TEXT,email TEXT,role TEXT,competency_key TEXT,status TEXT,score INTEGER,due_at_ms INTEGER,mastered_at_ms INTEGER,source TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE learning_help(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT,email TEXT,competency_key TEXT,event TEXT,created_at_ms INTEGER,created_at TEXT);");
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


// The public profile is workflow learning, never manufacturing qualification authority.
for (const role of ['manager', 'employee']) {
  for (const [field, expected] of [['purpose', 'VECTOR_WORKFLOW_LEARNING'], ['productionQualificationAuthority', false]]) {
    test('training twin '+role+' profile declares '+field+' without changing learning state',()=>{
      const f=dbFixture(), twin=createTrainingTwin({dbPath:f.dbPath});
      try {
        const user={tenant:'T',email:'m@t',role};
        const first=twin.profileForUser(user), second=twin.profileForUser(user);
        assert.equal(first[field],expected);
        assert.equal(second[field],expected);
        assert.equal(first.contractVersion,'VECTOR_TRAINING_TWIN_V1');
        assert.deepEqual(first.preferences,second.preferences);
        // Existing DUE profiles refresh dueAt with the current clock on each read.
        const learningValues=rows=>rows.map(({dueAt,...value})=>value);
        for (const item of [...first.competencies,...second.competencies]) assert.ok(Number.isFinite(Date.parse(item.dueAt)));
        assert.deepEqual(learningValues(first.competencies),learningValues(second.competencies));
        assert.deepEqual(learningValues(first.due),learningValues(second.due));
      } finally {twin.close();fs.rmSync(f.dir,{recursive:true,force:true});}
    });
  }
}
