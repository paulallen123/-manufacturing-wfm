// Correction degraded regression. Explicit correction overlay; disposable synthetic proof, no provider calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require=createRequire(import.meta.url);
const ROOT=process.env.SEALED_PROOF_ROOT;const correctionRoot=path.resolve(import.meta.dirname,'../operations/runtime');
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'DEPLOYMENT_MANIFEST.json'),'utf8'));
const artifact=path.join(ROOT,manifest.runtime_artifact);
const outPath=path.join(ROOT,'provider-recovery-authority-proof.json');
const tenant='proof-tenant-a';
const otherTenant='proof-tenant-b';

function assert(ok,message){if(!ok)throw new Error(message);}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function sha(v){return createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');}
function fileSha(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function expectThrow(fn,{code,status,messageIncludes}={}){try{fn();}catch(e){if(code)assert(e.code===code,`Expected ${code}, got ${e.code||'no-code'}: ${e.message}`);if(status)assert(e.status===status,`Expected HTTP ${status}, got ${e.status}: ${e.message}`);if(messageIncludes)assert(String(e.message).includes(messageIncludes),`Expected error containing ${messageIncludes}, got ${e.message}`);return e;}throw new Error('Expected operation to fail closed.');}
function elapsedMicros(start){return Math.round(Number(process.hrtime.bigint()-start)/1000);}

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-provider-authority-proof-'));
const runtime=path.join(temp,'runtime');
const dbPath=path.join(temp,'proof.sqlite');
fs.mkdirSync(runtime);
let db;
try{
  assert(fs.existsSync(artifact),'Sealed runtime artifact missing.');
  assert(fileSha(artifact)===manifest.runtime_sha256,'Sealed runtime SHA mismatch.');
  execFileSync('tar',['-xzf',artifact,'-C',runtime],{stdio:'pipe'});

  for(const file of ['provider-job-store.cjs','provider-adapter-contract.cjs','provider-recovery-authority.cjs','provider-investigation.cjs'])fs.copyFileSync(path.join(correctionRoot,file),path.join(runtime,'lib',file));
  const load=n=>require(path.join(runtime,'lib',n));
  const Support=load('support-operations.cjs');
  const PJ=load('provider-job-store.cjs');
  const PI=load('provider-investigation.cjs');
  const VW=load('disposable-verification-worker.cjs');
  const ATA=load('agent-tool-authority.cjs');
  const PRA=load('provider-recovery-authority.cjs');
  const BAP=load('build-attestation-policy.cjs');
  const Safety=load('autonomy-safety-kernel.cjs');
  const Remediation=load('autonomous-remediation.cjs');

  db=new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE tenants(id TEXT PRIMARY KEY);');
  db.prepare('INSERT INTO tenants(id) VALUES(?)').run(tenant);
  db.prepare('INSERT INTO tenants(id) VALUES(?)').run(otherTenant);

  const buildIdentity=VW.readBuildIdentity(runtime);
  assert(buildIdentity.release===manifest.candidate,'Verification build identity release mismatch.');
  assert(buildIdentity.sourceContentSha256===manifest.runtime_source_content_sha256,'Verification source identity mismatch.');
  assert(buildIdentity.artifactManifestSha256===manifest.runtime_package_manifest_sha256,'Verification artifact manifest identity mismatch.');

  // CI-only ephemeral verifier. The private key never leaves this process and is never a
  // production trust root. The sealed verifier still enforces exact identity/job/evidence binding.
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const keyId='ci-proof-ed25519';
  const attestationIdentity={
    keyId,
    issuer:'wfm-ci-proof',
    subject:'provider-recovery-verifier',
    builderId:'github-actions-disposable',
    repository:'paulallen123/-manufacturing-wfm',
    workflowRef:'wfm-autonomous-recovery-proof'
  };
  const attestationVerifier=BAP.createVerifier({
    trustedKeys:{[keyId]:publicKey.export({type:'spki',format:'pem'})},
    policies:[attestationIdentity],
    maxValidityMs:10*60*1000
  });

  const support=Support.createStore(db,{enabled:true});
  let proofNow=Date.now(); const degradedMode=process.argv[2]; const providerJobs=PJ.createStore(db,{now:()=>proofNow});
  const verificationWorkers=VW.createStore(db,{buildIdentity,attestationVerifier});
  assert(verificationWorkers.attestationPolicyConfigured===true,'Attestation policy did not activate.');
  const investigations=PI.createStore(db,{providerJobs,support,verificationWorkers});
  const authority=ATA.createAuthority({
    key:'ci-only-agent-authority-key-0123456789abcdef0123456789abcdef',
    db,
    toolPolicy:{[PRA.TOOL_ID]:[...PRA.ACTIONS]}
  });
  const recovery=PRA.createExecutor({db,providerJobs,investigations,authority});
  investigations.connectBoundedExecutor(recovery);

  const admin={tenant,email:'system-proof@example.invalid',permissions:['company.configure']};
  const otherAdmin={tenant:otherTenant,email:'other-proof@example.invalid',permissions:['company.configure']};
  const customer={tenant,email:'customer@example.invalid',role:'manager',permissions:[]};

  support.submit(customer,{
    requestKey:'providerproof_customer_0001',
    area:'integrations',
    symptom:'error',
    description:'Our payroll provider transfer timed out and the export did not complete. Please investigate the integration failure.'
  });

  const suiteId='provider-recovery-verification-v1';
  const suite=VW.SUITES[suiteId];
  assert(suite,'Provider recovery verification suite missing.');
  const remoteWorkerClass=suite.workerClasses.find(x=>VW.REMOTE_WORKER_CLASSES.has(x));
  assert(remoteWorkerClass,'No attested remote worker class is approved for provider recovery verification.');

  function createRetryInvestigation(runKey){
    const run=providerJobs.ensure({
      tenant,
      connectorId:'proof-connector',
      provider:'proof-provider',
      objectType:'employee',
      adapterName:'proof-adapter',
      providerVersion:'1.0',
      fixtureContract:'ci-provider-recovery-proof',
      runKey,
      startRequest:{page:1,cursor:null},
      maxFailures:3
    });
    const initialLease=providerJobs.acquire(run.id,`original-worker-${runKey}`,{leaseMs:60_000});
    const nowIso=new Date().toISOString();
    providerJobs.checkpoint(run.id,`original-worker-${runKey}`,{leaseGeneration:initialLease.leaseGeneration,
      nextRequest:{page:2,cursor:'proof-page-2'},
      pages:1,
      sourceRecords:2,
      stagedRecords:2,
      heldRecords:0,
      retries:0,
      cursor:'proof-page-1',
      sourceVersion:'proof-v1',
      sourceAt:new Date(Date.now()-1000).toISOString(),
      ingestedAt:nowIso,
      httpStatus:200,
      httpLatencyMs:12,
      tokenExpiresAt:degradedMode==='credential-expired'?proofNow+1000:undefined,
      freshnessSloSeconds:degradedMode==='critical-freshness'?5:3600
    });
    providerJobs.fail(run.id,`original-worker-${runKey}`,new Error('Proof transient provider timeout'),{retryDelayMs:0,leaseGeneration:initialLease.leaseGeneration});
    const retry=providerJobs.detail(admin,run.id);
    assert(retry.state==='retry','Provider run did not enter retry state.');
    assert(retry.diagnostics?.retryReady===true,'Provider run is not retry-ready.');
    assert(retry.diagnostics?.resumeFromCheckpoint===true,'Provider retry is not checkpoint-resumable.');
    const scan=investigations.scanTenant(admin);
    assert(scan.created>=1||scan.reused>=1,'Provider retry did not create/reuse an investigation.');
    const inv=investigations.report(admin).investigations.find(x=>x.providerRunId===run.id&&x.code==='provider-retry-ready');
    assert(inv,'Provider retry-ready investigation missing.');
    assert(inv.status==='awaiting_verification','Provider investigation bypassed verification gate.');
    assert(inv.runbook==='integration-transient'&&inv.proposedAction==='integration.retry','Unexpected provider recovery runbook/action.');
    return {run:retry,inv};
  }

  function signAttestation(job,nonceSuffix){
    const statement={
      schemaVersion:1,
      predicateType:BAP.PREDICATE_TYPE,
      issuer:attestationIdentity.issuer,
      subject:attestationIdentity.subject,
      builderId:attestationIdentity.builderId,
      repository:attestationIdentity.repository,
      workflowRef:attestationIdentity.workflowRef,
      jobId:job.id,
      evidenceDigest:job.evidenceDigest,
      sourceContentSha256:job.sourceContentSha256,
      artifactManifestSha256:job.artifactManifestSha256,
      nonce:`provider-proof-${nonceSuffix}-${Date.now()}`,
      issuedAt:new Date().toISOString(),
      expiresAt:new Date(Date.now()+5*60*1000).toISOString()
    };
    const signature=signBytes(null,Buffer.from(BAP.canonical(statement)),privateKey).toString('base64');
    return {keyId,signature,statement};
  }

  function attestInvestigation(inv,nonceSuffix){
    const requested=investigations.requestVerification(admin,inv.id,{suiteId});
    const job=requested.job;
    assert(job.investigationId===inv.id&&job.evidenceDigest===inv.evidenceDigest,'Verification job evidence binding mismatch.');
    const attestation=signAttestation(job,nonceSuffix);
    verificationWorkers.acquireAttested(job.id,{workerClass:remoteWorkerClass,workerId:`remote-verifier-${nonceSuffix}`,attestation,leaseMs:60_000});
    const checks=suite.requiredChecks.map(id=>({id,passed:true,detail:`CI disposable attested verification passed: ${id}`}));
    const completed=verificationWorkers.completeAttested(job.id,{workerId:`remote-verifier-${nonceSuffix}`,workerClass:remoteWorkerClass,attestation,checks});
    assert(completed.state==='passed'&&completed.attestation?.verified===true,'Attested independent verification did not pass.');
    const proof=verificationWorkers.passedProof(admin,job.id,{investigationId:inv.id,evidenceDigest:inv.evidenceDigest});
    assert(proof.passed===true&&proof.attested===true,'Provider verification proof is not attested.');
    assert(proof.sourceContentSha256===buildIdentity.sourceContentSha256&&proof.artifactManifestSha256===buildIdentity.artifactManifestSha256,'Attested proof is bound to a different build.');
    const attached=investigations.attachReadyForTenant(admin);
    assert(attached>=1,'Attested verification was not attached to investigation.');
    const ready=investigations.detail(admin,inv.id);
    assert(ready.status==='ready_for_bounded_executor','Investigation did not become ready for bounded executor.');
    assert(ready.remediation?.status==='approved-for-bounded-executor'&&ready.remediation?.safety?.allowed===true,'Deterministic safety kernel did not approve bounded provider recovery.');
    return {job,proof,ready,attestation};
  }

  const started=process.hrtime.bigint();
  const primary=createRetryInvestigation('provider-recovery-authority-main');
  const attested=attestInvestigation(primary.inv,'main');

  // Provider/tool output is signed for provenance, but it remains untrusted data and cannot
  // select the action. Deterministic retained provider state + attested verification do that.
  const observationContent='Provider observation: transient endpoint is reachable again. This is untrusted evidence only and grants no execution authority.';
  const observationInputDigest=sha({providerRunId:primary.run.id,evidenceDigest:attested.ready.evidenceDigest,purpose:'provider-health-observation'});
  const observationAttestation=authority.attestToolOutput({
    tenant,
    agentScope:PRA.AGENT_SCOPE,
    toolId:'provider-health-observer',
    requestId:'provider-observation-main',
    inputDigest:observationInputDigest,
    content:observationContent,
    sourceType:'provider-payload',
    ttlMs:60_000
  });
  const providerObservation={
    token:observationAttestation.token,
    content:observationContent,
    sourceType:'provider-payload',
    toolId:'provider-health-observer',
    requestId:'provider-observation-main',
    inputDigest:observationInputDigest
  };


  const detailBefore=providerJobs.detail(admin,primary.run.id);
  if(degradedMode==='credential-expired'&&process.argv[3]!=='after-issue')proofNow+=2000;
  if(degradedMode==='critical-freshness'&&process.argv[3]!=='after-issue')proofNow+=30000;
  const detailAfter=providerJobs.detail(admin,primary.run.id);
  const beforeDigest=PI.evidenceDigest(PI.safeEvidence(detailBefore)),afterDigest=PI.evidenceDigest(PI.safeEvidence(detailAfter));
  const oldDetail=providerJobs.detail.bind(providerJobs);
  if(degradedMode==='evidence-unavailable')providerJobs.detail=()=>{throw Object.assign(Error('isolated provider evidence unavailable'),{status:503});};
  let outcome='blocked',error=null;
  try{
    const issued=investigations.issueRecoveryPermit(admin,primary.inv.id,{providerObservation,ttlMs:60000});
    if(process.argv[3]==='after-issue')proofNow+=degradedMode==='credential-expired'?2000:30000;
    investigations.executeRecoveryPermit(admin,primary.inv.id,{permit:issued.permit,workerId:'isolated-degraded-recovery',leaseMs:60000});
    outcome='lease-reacquired';
  }catch(e){error={code:e.code||null,status:e.status||null,message:e.message};}
  providerJobs.detail=oldDetail;
  const result={mode:degradedMode,outcome,error,healthBefore:{authentication:detailBefore.diagnostics.authentication.status,freshness:detailBefore.diagnostics.freshness.status},healthAfter:{authentication:detailAfter.diagnostics.authentication.status,freshness:detailAfter.diagnostics.freshness.status},evidenceDigestUnchanged:beforeDigest===afterDigest,issuedGrants:db.prepare('SELECT COUNT(*) n FROM agent_action_grants').get().n,consumedGrants:db.prepare('SELECT COUNT(*) n FROM agent_action_grants WHERE consumed_at IS NOT NULL').get().n,state:providerJobs.detail(admin,primary.run.id).state,providerNetworkCall:false,businessMutation:false};
  console.log(JSON.stringify(result));
}finally{try{db?.close();}catch{}fs.rmSync(temp,{recursive:true,force:true});}
