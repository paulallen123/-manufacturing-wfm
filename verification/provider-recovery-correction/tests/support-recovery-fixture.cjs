'use strict';
// Disposable synthetic fixture using the actual authority, attestation, job and support stores.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {generateKeyPairSync,sign,createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'../../..');
const defaultActor={tenant:'support-test-a',email:'reviewer@example.invalid',permissions:['company.configure']};
function fixture(t,{connected=true,databasePath,principal=defaultActor}={}){
 const actor=principal;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-support-repair-')),runtime=path.join(dir,'runtime'),database=databasePath||path.join(dir,'state.sqlite');fs.mkdirSync(runtime);
 execFileSync('tar',['--no-same-owner','-xzf',path.join(root,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'),'-C',runtime]);
 for(const file of fs.readdirSync(path.join(__dirname,'../operations/runtime')))if(file.endsWith('.cjs'))fs.copyFileSync(path.join(__dirname,'../operations/runtime',file),path.join(runtime,'lib',file));
 const load=n=>require(path.join(runtime,'lib',n+'.cjs'));
 const Support=load('support-operations'),PJ=load('provider-job-store'),PI=load('provider-investigation'),PRA=load('provider-recovery-authority'),ATA=load('agent-tool-authority'),VW=load('disposable-verification-worker'),BAP=load('build-attestation-policy');
 let clock=Date.now();const now=()=>clock;
 // Ephemeral test verifier only; no deployed credential or trust root is created.
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const identity={keyId:'test-verifier',issuer:'synthetic-ci',subject:'synthetic-verifier',builderId:'synthetic-builder',repository:'synthetic/repository',workflowRef:'synthetic-support-test'};
 const attestationVerifier=BAP.createVerifier({trustedKeys:{[identity.keyId]:publicKey.export({type:'spki',format:'pem'})},policies:[identity],now});
 const f={dir,runtime,database,actor,foreign:{...actor,tenant:'support-test-b'},now,advance:ms=>{clock+=ms;}};
 function open(){
  f.db=new DatabaseSync(database);
  // The HTTP fixture shares this file with a separate live application process.
  // Wait for short writer transactions; never replace the asserted audit fault.
  f.db.exec("PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY);");
  if(!databasePath)f.db.exec("INSERT OR IGNORE INTO tenants VALUES('support-test-a'),('support-test-b');");
  f.support=Support.createStore(f.db,{clock:now});f.jobs=PJ.createStore(f.db,{now});
  f.verifier=VW.createStore(f.db,{now,buildIdentity:VW.readBuildIdentity(runtime),attestationVerifier});
  f.investigations=PI.createStore(f.db,{providerJobs:f.jobs,support:f.support,verificationWorkers:f.verifier,now});
  f.authority=ATA.createAuthority({key:'ci-only-agent-authority-key-0123456789abcdef0123456789abcdef',clock:now,db:f.db,toolPolicy:{[PRA.TOOL_ID]:[...PRA.ACTIONS]}});
  f.executor=PRA.createExecutor({db:f.db,providerJobs:f.jobs,investigations:f.investigations,authority:f.authority,now});
  if(connected)f.investigations.connectBoundedExecutor(f.executor);
 }
 open();f.reopen=()=>{f.db.close();open();};
 t.after(()=>{try{f.db.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
 f.retry=(key='one')=>{
  const run=f.jobs.ensure({tenant:actor.tenant,connectorId:'synthetic',provider:'synthetic',objectType:'employee',adapterName:'synthetic',providerVersion:'1',fixtureContract:'synthetic-support',runKey:key,startRequest:{page:1}});
  const lease=f.jobs.acquire(run.id,'original-worker');
  f.jobs.checkpoint(run.id,'original-worker',{leaseGeneration:lease.leaseGeneration,nextRequest:{page:2},pages:1,sourceRecords:2,stagedRecords:2,sourceAt:new Date(now()-1000).toISOString(),ingestedAt:new Date(now()).toISOString(),freshnessSloSeconds:3600});
  f.jobs.fail(run.id,'original-worker',Error('synthetic transient failure'),{leaseGeneration:lease.leaseGeneration});
  f.investigations.scanTenant(actor);
  return f.investigations.report(actor).investigations.find(x=>x.providerRunId===run.id);
 };
 f.attest=(inv,{passed=true}={})=>{
  const job=f.investigations.requestVerification(actor,inv.id,{}).job;
  const statement={schemaVersion:1,predicateType:BAP.PREDICATE_TYPE,...identity,jobId:job.id,evidenceDigest:job.evidenceDigest,sourceContentSha256:job.sourceContentSha256,artifactManifestSha256:job.artifactManifestSha256,nonce:'synthetic-'+job.id,issuedAt:new Date(now()).toISOString(),expiresAt:new Date(now()+300000).toISOString()};delete statement.keyId;
  const attestation={keyId:identity.keyId,statement,signature:sign(null,Buffer.from(BAP.canonical(statement)),privateKey).toString('base64')};
  const worker={workerId:'independent-synthetic-verifier',workerClass:'remote-ci-verifier',attestation};f.verifier.acquireAttested(job.id,worker);
  f.verifier.completeAttested(job.id,{...worker,checks:VW.SUITES[job.suiteId].requiredChecks.map(id=>({id,passed,detail:'Synthetic fixture contract receipt; not external provider proof.'}))});
  f.investigations.attachReadyForTenant(actor);return f.investigations.detail(actor,inv.id);
 };
 f.permit=inv=>{
  const observation={tenant:actor.tenant,agentScope:PRA.AGENT_SCOPE,toolId:'synthetic-observer',requestId:'request-'+inv.id,inputDigest:createHash('sha256').update(inv.id).digest('hex'),content:'Synthetic provider observation; untrusted data only.',sourceType:'provider-payload'};
  const signed=f.authority.attestToolOutput(observation);
  return f.investigations.issueRecoveryPermit(actor,inv.id,{providerObservation:{...observation,token:signed.token}}).permit;
 };
 f.execute=(inv,permit,extra={})=>f.investigations.executeRecoveryPermit(actor,inv.id,{permit,workerId:'bounded-synthetic-worker',...extra});
 f.incident=inv=>f.support.report(actor).incidents.find(x=>x.evidence.investigationId===inv.id);
 f.finish=(inv,result,{held=0}={})=>{
  f.jobs.checkpoint(inv.providerRunId,'bounded-synthetic-worker',{leaseGeneration:result.leaseGeneration,nextRequest:null,pages:1,sourceRecords:1,stagedRecords:1-held,heldRecords:held,sourceAt:new Date(now()).toISOString(),ingestedAt:new Date(now()).toISOString(),freshnessSloSeconds:3600});
  f.jobs.complete(inv.providerRunId,'bounded-synthetic-worker',{leaseGeneration:result.leaseGeneration});
  f.investigations.scanTenant(actor);
 };
 return f;
}
module.exports={fixture};
