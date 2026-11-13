'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createWorkforceLifecycleGuard}=require('./workforce-lifecycle-guard.cjs');
const {createDecisionEpisode}=require('./decision-episode.cjs');
const {createAutopilotExecutionEngine}=require('./autopilot-execution-engine.cjs');
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-replay-')),dbPath=path.join(dir,'proof.db'),db=new DatabaseSync(dbPath);
 db.exec('CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER,state TEXT);CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT,person_id TEXT,permissions TEXT,costs INTEGER);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);CREATE TABLE vector_decision_episodes(tenant TEXT,episode_id TEXT,episode_json TEXT);');
 const guard=createWorkforceLifecycleGuard({dbPath,internalToken:'isolated-regression-worker'});
 const starter={kind:'STARTER',employeeId:'E1',effectiveAt:'2026-09-01T06:00:00Z',payload:{location:'S1',department:'LINE1'}};
 assert.equal(guard.applyTrustedEvent({tenant:'A',eventKey:'occupied-key',event:starter}).decision.status,'ACCEPTED');
 const closeables=[guard];t.after(()=>{for(const closeable of closeables.reverse())closeable.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});return {guard,starter,db,dbPath,track:value=>(closeables.push(value),value)};
}
test('installed wrapper valid persisted readback verifies approved action',async t=>{
 const {guard,db,dbPath,track}=setup(t);
 const episode=createDecisionEpisode({tenant:'A',site:'S1',decisionType:'absence-recovery',triggerId:'outcome-proof',triggeredAt:'2026-09-26T09:00:00Z',contextRevision:'r1',mode:'SHADOW',sourceEvidence:['attendance:1'],objective:{labourCost:1},options:[{id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:500}},{id:'overtime',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:300}}]});
 db.prepare('INSERT INTO vector_decision_episodes VALUES(?,?,?)').run('A',episode.episodeId,JSON.stringify(episode));
 const engine=track(createAutopilotExecutionEngine({dbPath,lifecycleAdapter:guard}));
 const permit=engine.issueHumanPermit({tenant:'A',episodeId:episode.episodeId,optionId:'overtime',actorRef:'manager',contextRevision:'r1',plan:{adapter:'workforce-lifecycle',reversible:true,action:{eventKey:'actual-overtime',kind:'OVERTIME_OVERRIDE',employeeId:'E1',effectiveAt:'2026-09-26T12:00:00Z',payload:{minutes:60}},rollback:{eventKey:'outcome-rollback',reason:'restore'},expectedOutcome:{actual:{labourCost:0,planAttainmentPct:100},evidenceRefs:['caller-invented-savings']}}});
 const result=await engine.executePermit({tenant:'A',permitId:permit.permitId,currentContextRevision:'r1'});
 assert.equal(result.state,'VERIFIED');
 assert.equal(result.detail.outcomeDigest,null,'an approved forecast is not a measured outcome');
 assert.equal(result.detail.outcomeStatus,'UNPROVEN');
 assert.equal(engine.statusForTenant('A').find(x=>x.state==='VERIFIED').detail.outcomeDigest,null);
});
test('installed wrapper payload corruption injection stays unknown without compensation',async t=>{
 const {guard,db,dbPath,track}=setup(t);
 const episode=createDecisionEpisode({tenant:'A',site:'S1',decisionType:'absence-recovery',triggerId:'outcome-proof',triggeredAt:'2026-09-26T09:00:00Z',contextRevision:'r1',mode:'SHADOW',sourceEvidence:['attendance:1'],objective:{labourCost:1},options:[{id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:500}},{id:'overtime',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:300}}]});
 db.prepare('INSERT INTO vector_decision_episodes VALUES(?,?,?)').run('A',episode.episodeId,JSON.stringify(episode));
 const engine=track(createAutopilotExecutionEngine({dbPath,lifecycleAdapter:{applyTrustedEvent(input){return guard.applyTrustedEvent(input);},getTrustedEvent(input){const row=guard.getTrustedEvent(input);return row?{...row,payload:{...row.payload,minutes:999}}:row;}}}));
 const permit=engine.issueHumanPermit({tenant:'A',episodeId:episode.episodeId,optionId:'overtime',actorRef:'manager',contextRevision:'r1',plan:{adapter:'workforce-lifecycle',reversible:true,action:{eventKey:'actual-overtime',kind:'OVERTIME_OVERRIDE',employeeId:'E1',effectiveAt:'2026-09-26T12:00:00Z',payload:{minutes:60}},rollback:{eventKey:'outcome-rollback',reason:'restore'},expectedOutcome:{actual:{labourCost:0,planAttainmentPct:100},evidenceRefs:['caller-invented-savings']}}});
 const result=await engine.executePermit({tenant:'A',permitId:permit.permitId,currentContextRevision:'r1'});
 assert.equal(result.state,'RECONCILIATION_REQUIRED');assert.equal(result.detail.externalState,'UNKNOWN');assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workforce_lifecycle_events WHERE kind='RETRO_CHANGE'").get().n,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workforce_lifecycle_events WHERE kind='OVERTIME_OVERRIDE'").get().n,1);
});
