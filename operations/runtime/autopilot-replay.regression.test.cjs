'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createWorkforceLifecycleGuard}=require('./workforce-lifecycle-guard.cjs');
const {createDecisionEpisode}=require('./decision-episode.cjs');
const {createAutopilotExecutionEngine}=require('./autopilot-execution-engine.cjs');
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-replay-')),dbPath=path.join(dir,'proof.db'),db=new DatabaseSync(dbPath);
 db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);CREATE TABLE vector_decision_episodes(tenant TEXT,episode_id TEXT,episode_json TEXT);');
 const guard=createWorkforceLifecycleGuard({dbPath,internalToken:'isolated-regression-worker'});
 const starter={kind:'STARTER',employeeId:'E1',effectiveAt:'2026-09-01T06:00:00Z',payload:{location:'S1',department:'LINE1'}};
 assert.equal(guard.applyTrustedEvent({tenant:'A',eventKey:'occupied-key',event:starter}).decision.status,'ACCEPTED');
 t.after(()=>{guard.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});return {guard,starter,db,dbPath};
}
test('a reused event key cannot turn a different event into verified Autopilot execution',async t=>{
 const {guard,db,dbPath}=setup(t);
 const episode=createDecisionEpisode({tenant:'A',site:'S1',decisionType:'absence-recovery',triggerId:'proof',triggeredAt:'2026-09-26T09:00:00Z',contextRevision:'r1',mode:'SHADOW',sourceEvidence:['attendance:1'],objective:{labourCost:1},options:[{id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:500}},{id:'overtime',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:300}}]});
 db.prepare('INSERT INTO vector_decision_episodes VALUES(?,?,?)').run('A',episode.episodeId,JSON.stringify(episode));
 const engine=createAutopilotExecutionEngine({dbPath,lifecycleAdapter:guard});t.after(()=>engine.close());
 const permit=engine.issueHumanPermit({tenant:'A',episodeId:episode.episodeId,optionId:'overtime',actorRef:'manager',contextRevision:'r1',plan:{adapter:'workforce-lifecycle',reversible:true,action:{eventKey:'occupied-key',kind:'OVERTIME_OVERRIDE',employeeId:'E1',effectiveAt:'2026-09-26T12:00:00Z',payload:{minutes:60}},rollback:{eventKey:'rollback-proof',reason:'restore'}}});
 const result=await engine.executePermit({tenant:'A',permitId:permit.permitId,currentContextRevision:'r1'});
 assert.equal(result.state,'CONTAINED','an existing STARTER must not verify an OVERTIME action');
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workforce_lifecycle_events WHERE kind='OVERTIME_OVERRIDE'").get().n,0);
 assert.equal(guard.getTrustedEvent({tenant:'A',eventKey:'occupied-key'}).kind,'STARTER');
 assert.ok(!engine.statusForTenant('A').some(e=>e.state==='VERIFIED'));
});
test('idempotency accepts equivalent payload ordering but rejects changed content',t=>{
 const {guard,starter}=setup(t);
 assert.equal(guard.applyTrustedEvent({tenant:'A',eventKey:'occupied-key',event:{...starter,payload:{department:'LINE1',location:'S1'}}}).idempotent,true);
 assert.throws(()=>guard.applyTrustedEvent({tenant:'A',eventKey:'occupied-key',event:{...starter,payload:{location:'S2',department:'LINE1'}}}),e=>e.statusCode===409);
});
test('HTTP retry with changed content returns 409 and preserves the first persisted event',async t=>{
 const {guard,starter,db}=setup(t),http=require('node:http');
 const server=http.createServer(async(req,res)=>{if(!await guard.handleRequest(req,res)){res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const before=db.prepare('SELECT * FROM workforce_lifecycle_events WHERE tenant=? AND event_key=?').get('A','occupied-key');
 const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/workforce/lifecycle/event',{method:'POST',headers:{'content-type':'application/json','x-wfm-integration-internal':'isolated-regression-worker'},body:JSON.stringify({tenant:'A',eventKey:'occupied-key',...starter,employeeId:'E2'})});
 assert.equal(r.status,409);assert.deepEqual(db.prepare('SELECT * FROM workforce_lifecycle_events WHERE tenant=? AND event_key=?').get('A','occupied-key'),before);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workforce_lifecycle_events').get().n,1);
});
