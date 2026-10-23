'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const root='/workspace/scratch/d82275fe8578/combined-review';
const inference=require(root+'/implementation/runtime/configuration-inference-engine.cjs');
const {createDecisionEpisode,digest}=require(root+'/operations/runtime/decision-episode.cjs');
const {createAutopilotExecutionEngine}=require(root+'/operations/runtime/autopilot-execution-engine.cjs');
const person=()=>({employeeId:'E1',location:'S1',department:'D1'});

test('revoked row and collection proxies never execute traps or infer population',()=>{
 for(const rowLevel of [false,true]){
  const p=Proxy.revocable(rowLevel?person():[person()],{});p.revoke();
  const result=inference.buildConfigurationProposal({people:rowLevel?[p.proxy]:p.proxy});
  assert.equal(result.organisation.peopleCount,0);assert.equal(result.organisation.autoApply,false);
  assert.equal(result.workforce.autoApply,false);assert.deepEqual(result.workforce.assignments,[]);
 }
});
test('null-prototype proposal stays valid and detached after caller mutation',()=>{
 const row=Object.assign(Object.create(null),person()),input=Object.assign(Object.create(null),{people:[row]});
 const result=inference.buildConfigurationProposal(input);row.employeeId='FOREIGN';row.department='SECRET';
 assert.equal(result.organisation.autoApply,true);assert.equal(result.workforce.assignments[0].employeeId,'E1');
 assert.equal(result.workforce.assignments[0].department,'D1');assert.equal(result.metrics.people,1);
});
test('array index accessor is rejected without executing the getter',()=>{
 let calls=0;const people=[person()];Object.defineProperty(people,'0',{get(){calls++;throw Error('active');}});
 const result=inference.buildConfigurationProposal({people});assert.equal(calls,0);
 assert.equal(result.organisation.autoApply,false);assert.equal(result.workforce.autoApply,false);
});
test('malformed evidence cannot produce partial mass assignments',()=>{
 for(const field of ['employeeId','managerId','location','department','wfmRole','jobTitle','employmentType']){
  let calls=0;const invalid=person();Object.defineProperty(invalid,field,{get(){calls++;return 'FORGED';}});
  const result=inference.buildConfigurationProposal({people:[person(),invalid]});
  assert.equal(calls,0);assert.equal(result.metrics.people,2);assert.equal(result.organisation.peopleCount,0);
  assert.deepEqual(result.workforce.assignments,[]);assert.equal(result.workforce.autoApply,false);
 }
});
test('unknown diagnostic accessors neither run nor suppress missing identity review',()=>{
 let calls=0;const row={location:'S',department:'D',get email(){calls++;return 'hidden';},get firstName(){calls++;return 'hidden';}};
 const result=inference.buildConfigurationProposal({people:[row]});assert.equal(calls,0);
 assert.equal(result.organisation.autoApply,false);assert.equal(result.workforce.autoApply,false);
 assert.equal(result.workforce.exceptions[0].source,'unknown');
});

function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-independent-')),dbPath=path.join(dir,'x.db');
 const db=new DatabaseSync(dbPath);db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');db.close();
 let calls=0,published=0;
 const engine=createAutopilotExecutionEngine({dbPath,lifecycleAdapter:{applyTrustedEvent(){calls++;throw Error('must not dispatch');}},publishEvent(){published++;}});
 const episode=createDecisionEpisode({tenant:'A',site:'S1',decisionType:'absence-recovery',triggerId:'review',triggeredAt:'2026-10-23T14:00:00Z',contextRevision:'r1',mode:'SHADOW',sourceEvidence:['synthetic'],objective:{labourCost:1},options:[{id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,prediction:{labourCost:2}},{id:'ot',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,prediction:{labourCost:1}}]});
 const store=new DatabaseSync(dbPath);store.prepare('INSERT INTO vector_decision_episodes VALUES(?,?,?,?,?)').run('A',episode.episodeId,episode.decisionType,JSON.stringify(episode),new Date().toISOString());
 const permit=engine.issueHumanPermit({tenant:'A',episodeId:episode.episodeId,optionId:'ot',actorRef:'reviewer',contextRevision:'r1',plan:{adapter:'workforce-lifecycle',reversible:true,action:{kind:'OVERTIME_OVERRIDE',employeeId:'E1',effectiveAt:'2026-10-23T14:30:00Z',eventKey:'review-event',payload:{minutes:30}},rollback:{eventKey:'review-rb',reason:'test'}}});
 const executionId='exec-'+digest({permitId:permit.permitId,tenant:'A',contextRevision:'r1'}).slice(0,40);
 const append=state=>store.prepare('INSERT INTO vector_autopilot_execution_events(execution_id,permit_id,tenant,state,detail_json,created_at) VALUES(?,?,?,?,?,?)').run(executionId,permit.permitId,'A',state,'{}',new Date().toISOString());
 t.after(()=>{engine.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dbPath,engine,store,append,permit,calls:()=>calls,published:()=>published,args:{tenant:'A',permitId:permit.permitId,currentContextRevision:'r1'},states:()=>store.prepare('SELECT state FROM vector_autopilot_execution_events ORDER BY id').all().map(x=>x.state)};
}
test('fresh-process retry preserves interrupted claim without adapter dispatch',t=>{
 const s=setup(t);s.append('PREPARED');s.engine.close();
 const script=`const {createAutopilotExecutionEngine}=require(${JSON.stringify(root+'/operations/runtime/autopilot-execution-engine.cjs')});let calls=0;const e=createAutopilotExecutionEngine({dbPath:${JSON.stringify(s.dbPath)},lifecycleAdapter:{applyTrustedEvent(){calls++;throw Error('unexpected dispatch')}}});e.executePermit(${JSON.stringify(s.args)}).then(r=>{console.log(JSON.stringify({state:r.state,calls}));e.close()})`;
 const child=cp.spawnSync(process.execPath,['-e',script],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 assert.deepEqual(JSON.parse(child.stdout),{state:'RECONCILIATION_REQUIRED',calls:0});
 assert.deepEqual(s.states(),['PREPARED','RECONCILIATION_REQUIRED']);
});
test('terminal receipt after commit is never superseded by retry evidence',async t=>{
 const s=setup(t);s.append('APPLIED');const original=DatabaseSync.prototype.exec;let injected=false;
 DatabaseSync.prototype.exec=function(sql){const r=original.call(this,sql);if(sql==='COMMIT'&&!injected){injected=true;s.append('VERIFIED');}return r;};
 try{const r=await s.engine.executePermit(s.args);assert.equal(r.state,'RECONCILIATION_REQUIRED');}
 finally{DatabaseSync.prototype.exec=original;}
 assert.deepEqual(s.states(),['APPLIED','RECONCILIATION_REQUIRED','VERIFIED']);assert.equal(s.calls(),0);
 assert.equal((await s.engine.executePermit(s.args)).state,'VERIFIED');
 assert.equal(s.states().length,3);
});
test('failed retry append leaves original evidence and permits safe later retry',async t=>{
 const s=setup(t);s.append('VERIFY_FAILED');s.store.exec("CREATE TRIGGER test_fail BEFORE INSERT ON vector_autopilot_execution_events WHEN NEW.state='RECONCILIATION_REQUIRED' BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 await assert.rejects(s.engine.executePermit(s.args),/test failure/);assert.deepEqual(s.states(),['VERIFY_FAILED']);
 assert.equal(s.published(),0);assert.equal(s.calls(),0);s.store.exec('BEGIN IMMEDIATE');s.store.exec('ROLLBACK');
 s.store.exec('DROP TRIGGER test_fail');assert.equal((await s.engine.executePermit(s.args)).state,'RECONCILIATION_REQUIRED');
 assert.deepEqual(s.states(),['VERIFY_FAILED','RECONCILIATION_REQUIRED']);assert.equal(s.calls(),0);
});
test('wrong tenant retry cannot read or mutate another tenant claim',async t=>{
 const s=setup(t);s.append('PREPARED');await assert.rejects(s.engine.executePermit({...s.args,tenant:'B'}),{statusCode:404});
 assert.deepEqual(s.states(),['PREPARED']);assert.equal(s.published(),0);assert.equal(s.calls(),0);
});
test('persisted reconciliation is returned after engine restart without duplicate receipt',async t=>{
 const s=setup(t);s.append('PREPARED');await s.engine.executePermit(s.args);s.engine.close();
 const fresh=createAutopilotExecutionEngine({dbPath:s.dbPath,lifecycleAdapter:{applyTrustedEvent(){throw Error('duplicate')}}});
 try{assert.equal((await fresh.executePermit(s.args)).state,'RECONCILIATION_REQUIRED');}
 finally{fresh.close();}
 assert.deepEqual(s.states(),['PREPARED','RECONCILIATION_REQUIRED']);
});
