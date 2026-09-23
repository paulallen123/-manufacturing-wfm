'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createDecisionEpisode}=require('./decision-episode.cjs'),{createAutopilotExecutionEngine,isAutopilotApproverRole}=require('./autopilot-execution-engine.cjs');
function ep(){return createDecisionEpisode({tenant:'A',site:'S1',decisionType:'absence-recovery',triggerId:'a1',triggeredAt:'2026-09-22T09:00:00Z',contextRevision:'r7',mode:'SHADOW',sourceEvidence:['a','b'],objective:{labourCost:1,planAttainmentPct:1,uncertaintyPenalty:.1},options:[{id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,prediction:{labourCost:500,planAttainmentPct:80}},{id:'overtime',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,prediction:{labourCost:300,planAttainmentPct:95}}]});}
function setup(adapter){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ap-')),dbPath=path.join(dir,'x.db'),db=new DatabaseSync(dbPath);db.exec('CREATE TABLE vector_decision_episodes(tenant TEXT,episode_id TEXT,decision_type TEXT,episode_json TEXT,created_at TEXT,PRIMARY KEY(tenant,episode_id));CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');const e=ep();db.prepare('INSERT INTO vector_decision_episodes VALUES(?,?,?,?,?)').run('A',e.episodeId,e.decisionType,JSON.stringify(e),new Date().toISOString());db.close();return{dir,dbPath,e,engine:createAutopilotExecutionEngine({dbPath,lifecycleAdapter:adapter})};}
function plan(){return{adapter:'workforce-lifecycle',reversible:true,action:{eventKey:'ot',kind:'OVERTIME_OVERRIDE',employeeId:'E1',effectiveAt:'2026-09-22T12:00:00Z',payload:{minutes:60}},rollback:{eventKey:'rb',reason:'restore'}};}
test('Autopilot approver roles are an explicit fail-closed allowlist',()=>{
 assert.equal(isAutopilotApproverRole('manager'),true);
 assert.equal(isAutopilotApproverRole('director'),true);
 assert.equal(isAutopilotApproverRole('superuser'),true);
 for(const role of ['employee','payroll_admin','viewer','contractor','',null]) assert.equal(isAutopilotApproverRole(role),false);
});
test('requires current context and reversible plan',()=>{const s=setup({});assert.throws(()=>s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'old',plan:plan()}),/context changed/i);assert.throws(()=>s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:{...plan(),reversible:false}}),/reversible/);s.engine.close();fs.rmSync(s.dir,{recursive:true,force:true});});
test('executes verifies and is idempotent',async()=>{const m=new Map(),a={applyTrustedEvent({eventKey}){const x={event:{id:'wf-'+eventKey,eventKey,status:'ACCEPTED'},decision:{status:'ACCEPTED',reasonCode:'OK'}};m.set(eventKey,x.event);return x;},getTrustedEvent({eventKey}){return m.get(eventKey)||null;}};const s=setup(a),p=s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:plan()}),r=await s.engine.executePermit({tenant:'A',permitId:p.permitId,currentContextRevision:'r7'}),r2=await s.engine.executePermit({tenant:'A',permitId:p.permitId,currentContextRevision:'r7'});assert.equal(r.state,'VERIFIED');assert.equal(r2.idempotent,true);s.engine.close();fs.rmSync(s.dir,{recursive:true,force:true});});
test('failed verification rolls back or contains',async()=>{const m=new Map();let fail=true;const a={applyTrustedEvent({eventKey,event}){const x={event:{id:'wf-'+eventKey,eventKey,status:'ACCEPTED'},decision:{status:'ACCEPTED',reasonCode:'OK'}};m.set(eventKey,x.event);return x;},getTrustedEvent({eventKey}){if(eventKey==='ot'&&fail){fail=false;return null;}return m.get(eventKey)||null;}};const s=setup(a),p=s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:plan()}),r=await s.engine.executePermit({tenant:'A',permitId:p.permitId,currentContextRevision:'r7'});assert.equal(r.state,'ROLLED_BACK');s.engine.close();fs.rmSync(s.dir,{recursive:true,force:true});});

test('restart keeps terminal execution idempotent and does not repeat the business write',async()=>{
 const m=new Map();let writes=0;
 const a={
  applyTrustedEvent({eventKey}){writes+=1;const x={event:{id:'wf-'+eventKey,eventKey,status:'ACCEPTED'},decision:{status:'ACCEPTED',reasonCode:'OK'}};m.set(eventKey,x.event);return x;},
  getTrustedEvent({eventKey}){return m.get(eventKey)||null;}
 };
 const s=setup(a);
 const p=s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:plan()});
 const first=await s.engine.executePermit({tenant:'A',permitId:p.permitId,currentContextRevision:'r7'});
 assert.equal(first.state,'VERIFIED');
 assert.equal(writes,1);
 s.engine.close();
 const restarted=createAutopilotExecutionEngine({dbPath:s.dbPath,lifecycleAdapter:a});
 const replay=await restarted.executePermit({tenant:'A',permitId:p.permitId,currentContextRevision:'r7'});
 assert.equal(replay.idempotent,true);
 assert.equal(replay.state,'VERIFIED');
 assert.equal(writes,1);
 restarted.close();fs.rmSync(s.dir,{recursive:true,force:true});
});
