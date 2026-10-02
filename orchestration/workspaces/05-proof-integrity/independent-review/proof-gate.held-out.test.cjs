'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{DatabaseSync}=require('node:sqlite');
const root=process.env.TRUST_PROOF_ROOT||path.resolve(__dirname,'../proof-gate-repair/implementation/runtime'),contract=require(path.join(root,'readiness-evidence-contract.cjs')),engineFactory=require(path.join(root,'one-day-enterprise-engine.cjs'));
global.fetch=async()=>{throw Error('TRUST_NETWORK_FORBIDDEN');};
// Reuse database/authentication setup only, not repository assertions or datasets.
const fixtureSource=fs.readFileSync(path.join(root,'one-day-enterprise-engine.test.cjs'),'utf8'),cut=fixtureSource.indexOf('\ntest(');assert.ok(cut>0);
const context={require:createRequire(path.join(root,'one-day-enterprise-engine.test.cjs')),__dirname:root,process,Buffer,URL,setTimeout,clearTimeout,setInterval,clearInterval,console,api:null};
vm.runInNewContext(fixtureSource.slice(0,cut)+';api={fixture,call,startRun};',context);
const {fixture,call,startRun}=context.api,observations=[];test.after(()=>fs.writeFileSync(path.join(__dirname,'proof-gate.observations.json'),JSON.stringify({node:process.version,observations},null,2)));
const historical={dataClass:'synthetic-scale',independentCalculation:true,expectedTotal:152.25,calculatedTotal:152.25,unexplainedVariance:0};
const policy={fixtureOnly:false,evidenceClass:'customer-authorised',sourceAuthoritative:true,sourceRef:'independent-policy-fixture',effectiveDated:true,effectiveDate:'2026-09-30',unresolvedRules:0,unknownPolicyFields:0,breakRulesVerified:true,overtimeRulesVerified:true,workingTimeRulesVerified:true,timeZoneVerified:true};
test('strict historical totals require actual finite matching numbers and numeric zero variance',()=>{
 assert.equal(contract.validateStrictReadinessEvidence('historical-replay','PASS',historical),null);
 for(const field of ['expectedTotal','calculatedTotal'])for(const value of [null,'152.25',false,[],{},Infinity,-Infinity,NaN])assert.notEqual(contract.validateStrictReadinessEvidence('historical-replay','PASS',{...historical,[field]:value}),null);
 for(const value of [null,'0',false,[],{},NaN,Infinity,-Infinity,0.001])assert.notEqual(contract.validateStrictReadinessEvidence('historical-replay','PASS',{...historical,unexplainedVariance:value}),null);
 assert.notEqual(contract.validateStrictReadinessEvidence('historical-replay','PASS',{...historical,calculatedTotal:152.24}),null);
 for(const total of [0,-1.5,Number.MAX_VALUE,Number.MIN_VALUE])assert.equal(contract.validateStrictReadinessEvidence('historical-replay','PASS',{...historical,expectedTotal:total,calculatedTotal:total}),null);
});
test('policy date validation rejects nonexistent calendar and invalid time while preserving real dates',()=>{
 for(const value of ['2026-02-29','2026-09-31','2026-00-10','2026-10-00','2026-12-32','2026-09-30T25:00:00Z','2026-09-30T23:60:00Z','2026-09-30T12:01:00+99:00',true,20260930])assert.notEqual(contract.validateStrictReadinessEvidence('time-policies','PASS',{...policy,effectiveDate:value}),null,String(value));
 for(const value of ['2000-02-29','2026-09-30','2026-09-30T00:00:00.000Z','2026-09-30T23:59:59+02:00'])assert.equal(contract.validateStrictReadinessEvidence('time-policies','PASS',{...policy,effectiveDate:value}),null);
});
for(const kind of ['historical-replay','time-policies'])for(const invalid of [true,false])test('strict reopen '+(invalid?'invalidates malformed ':'retains valid ')+kind+' exact-current receipt without erasing audit',async()=>{
 const f=fixture({strictEvidence:true,requireCandidateBinding:true});let reopened=null;
 try{
  const run=await startRun(f),connection=new DatabaseSync(f.dbPath),detail={...(kind==='historical-replay'?(invalid?{...historical,expectedTotal:'152.25',calculatedTotal:'152.25'}:historical):{...policy,effectiveDate:invalid?'2026-09-31':'2026-09-30'}),exactCandidateSha:f.candidateSha,exactTargetDeploymentId:f.deploymentId};
  const encoded=JSON.stringify(detail),createdAt='2026-10-02T09:00:00.000Z';connection.prepare('INSERT INTO implementation_evidence(run_id,tenant,kind,status,confidence,source,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(run.runId,'alpha',kind,'PASS',1,'independent-malformed-legacy',encoded,createdAt);
  const beforeEvidence=connection.prepare('SELECT * FROM implementation_evidence WHERE run_id=? AND kind=? ORDER BY id').all(run.runId,kind),auditTable=connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('implementation_audit','implementation_audit_events','implementation_events')").all();
  const auditSnapshots=auditTable.map(({name})=>({name,rows:connection.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()}));assert.ok(auditSnapshots.length>0);assert.ok(auditSnapshots.some(x=>x.rows.length>0));connection.close();f.engine.close();
  reopened=engineFactory.createOneDayEnterpriseEngine({dbPath:f.dbPath,strictEvidence:true,requireCandidateBinding:true,candidateSha:f.candidateSha,deploymentId:f.deploymentId,agentsApiEnabled:false,internalToken:'implementation-worker-test-token',contractWebhookSecret:'contract-webhook-test-token',publicOrigin:'https://implementation.test',invitationRecoverySecret:'dedicated-invitation-recovery-test-secret',notificationRetryPollMs:0,sendInvitation:async()=>assert.fail('No invitation should dispatch during this reopen')});
  const response=await call(reopened,f.tokens.manager,'GET','/api/implementation/autonomous/status');assert.equal(response.status,200);const gate=response.body.requirements.find(x=>x.key===kind);assert.equal(gate.status,invalid?'REVALIDATION_REQUIRED':'PASS');assert.equal(gate.satisfied,!invalid);assert.equal(gate.evidenceBinding.status,'MATCHED');if(invalid)assert.ok(gate.evidenceValidation.reason);
  const after=new DatabaseSync(f.dbPath,{readOnly:true});assert.deepEqual(after.prepare('SELECT * FROM implementation_evidence WHERE run_id=? AND kind=? ORDER BY id').all(run.runId,kind),beforeEvidence);
  for(const snapshot of auditSnapshots){const rows=after.prepare('SELECT * FROM '+snapshot.name+' ORDER BY rowid').all();assert.deepEqual(rows.slice(0,snapshot.rows.length),snapshot.rows);}
  after.close();observations.push({kind,invalid,exactCandidateBindingMatched:true,status:gate.status,satisfied:gate.satisfied,originalReceiptRetained:true,auditTables:auditSnapshots.map(x=>({name:x.name,preservedRows:x.rows.length})),actualEngineClosedAndReopened:true});
 }finally{if(reopened)reopened.close();f.close();}
});
