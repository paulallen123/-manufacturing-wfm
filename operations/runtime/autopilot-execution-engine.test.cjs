'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createDecisionEpisode}=require('./decision-episode.cjs'),{createAutopilotExecutionEngine,safePlan}=require('./autopilot-execution-engine.cjs');
function ep(){return createDecisionEpisode({tenant:'A',site:'S1',decisionType:'absence-recovery',triggerId:'a1',triggeredAt:'2026-09-22T09:00:00Z',contextRevision:'r7',mode:'SHADOW',sourceEvidence:['a','b'],objective:{labourCost:1,planAttainmentPct:1,uncertaintyPenalty:.1},options:[{id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,prediction:{labourCost:500,planAttainmentPct:80}},{id:'overtime',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,prediction:{labourCost:300,planAttainmentPct:95}}]});}
function setup(adapter){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ap-')),dbPath=path.join(dir,'x.db'),db=new DatabaseSync(dbPath);db.exec('CREATE TABLE vector_decision_episodes(tenant TEXT,episode_id TEXT,decision_type TEXT,episode_json TEXT,created_at TEXT,PRIMARY KEY(tenant,episode_id));CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');const e=ep();db.prepare('INSERT INTO vector_decision_episodes VALUES(?,?,?,?,?)').run('A',e.episodeId,e.decisionType,JSON.stringify(e),new Date().toISOString());db.close();return{dir,e,engine:createAutopilotExecutionEngine({dbPath,lifecycleAdapter:adapter})};}
function plan(){return{adapter:'workforce-lifecycle',reversible:true,action:{eventKey:'ot',kind:'OVERTIME_OVERRIDE',employeeId:'E1',effectiveAt:'2026-09-22T12:00:00Z',payload:{minutes:60}},rollback:{eventKey:'rb',reason:'restore'}};}
test('rejects nonstring operational identifiers and rollback reason before issuing a permit',()=>{
 const changes=[
  p=>{p.action.employeeId={id:'E1'};},
  p=>{p.action.eventKey=['ot'];},
  p=>{p.rollback.eventKey=['rb'];},
  p=>{p.rollback.reason={text:'restore'};}
 ];
 const s=setup({});try{
  for(const change of changes){
   const p=plan();change(p);
   assert.throws(()=>safePlan(p),/string/i);
   assert.throws(()=>s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:p}),/string/i);
  }
  const db=new DatabaseSync(path.join(s.dir,'x.db'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM vector_autopilot_permits').get().n,0);
  db.close();
 }finally{s.engine.close();fs.rmSync(s.dir,{recursive:true,force:true});}
});
test('cold-starts on a fresh database without pre-created decision tables',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ap-cold-')),dbPath=path.join(dir,'x.db'),db=new DatabaseSync(dbPath);db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');db.close();const engine=createAutopilotExecutionEngine({dbPath,lifecycleAdapter:{}});const verify=new DatabaseSync(dbPath);const row=verify.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vector_decision_episodes'").get();assert.equal(row?.name,'vector_decision_episodes');verify.close();engine.close();fs.rmSync(dir,{recursive:true,force:true});});
test('requires current context and reversible plan',()=>{const s=setup({});assert.throws(()=>s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'old',plan:plan()}),/context changed/i);assert.throws(()=>s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:{...plan(),reversible:false}}),/reversible/);s.engine.close();fs.rmSync(s.dir,{recursive:true,force:true});});
test('executes verifies and is idempotent',async()=>{const m=new Map(),a={applyTrustedEvent({eventKey}){const x={event:{id:'wf-'+eventKey,eventKey,status:'ACCEPTED'},decision:{status:'ACCEPTED',reasonCode:'OK'}};m.set(eventKey,x.event);return x;},getTrustedEvent({eventKey}){return m.get(eventKey)||null;}};const s=setup(a),p=s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:plan()}),r=await s.engine.executePermit({tenant:'A',permitId:p.permitId,currentContextRevision:'r7'}),r2=await s.engine.executePermit({tenant:'A',permitId:p.permitId,currentContextRevision:'r7'});assert.equal(r.state,'VERIFIED');assert.equal(r2.idempotent,true);s.engine.close();fs.rmSync(s.dir,{recursive:true,force:true});});
test('failed verification rolls back or contains',async()=>{const m=new Map();let fail=true;const a={applyTrustedEvent({eventKey,event}){const x={event:{id:'wf-'+eventKey,eventKey,status:'ACCEPTED'},decision:{status:'ACCEPTED',reasonCode:'OK'}};m.set(eventKey,x.event);return x;},getTrustedEvent({eventKey}){if(eventKey==='ot'&&fail){fail=false;return null;}return m.get(eventKey)||null;}};const s=setup(a),p=s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:plan()}),r=await s.engine.executePermit({tenant:'A',permitId:p.permitId,currentContextRevision:'r7'});assert.equal(r.state,'ROLLED_BACK');s.engine.close();fs.rmSync(s.dir,{recursive:true,force:true});});
