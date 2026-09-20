import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require=createRequire(import.meta.url);
const ROOT=process.cwd();
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
  const providerJobs=PJ.createStore(db);
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
    providerJobs.acquire(run.id,`original-worker-${runKey}`,{leaseMs:60_000});
    const nowIso=new Date().toISOString();
    providerJobs.checkpoint(run.id,`original-worker-${runKey}`,{
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
      freshnessSloSeconds:3600
    });
    providerJobs.fail(run.id,`original-worker-${runKey}`,new Error('Proof transient provider timeout'),{retryDelayMs:0});
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

  const tamperError=expectThrow(()=>investigations.issueRecoveryPermit(admin,primary.inv.id,{providerObservation:{...providerObservation,content:observationContent+' tampered'}}),{code:'WFM_AGENT_PROVENANCE_CONTENT_CHANGED'});
  const issued=investigations.issueRecoveryPermit(admin,primary.inv.id,{providerObservation,ttlMs:60_000});
  assert(issued.grant.actionType==='integration.retry','Signed permit granted wrong action.');
  assert(issued.providerObservation.authorityGranted===false&&issued.providerObservation.ignoredForAuthority===true,'External provider observation influenced action authority.');
  assert(issued.providerObservation.trust==='untrusted-external-data','Provider observation trust boundary changed.');

  const executeStarted=process.hrtime.bigint();
  const executed=investigations.executeRecoveryPermit(admin,primary.inv.id,{permit:issued.permit,workerId:'bounded-provider-recovery-main',leaseMs:60_000});
  const executeMicros=elapsedMicros(executeStarted);
  assert(executed.executed===true&&executed.action==='integration.retry','Real bounded provider executor did not execute expected recovery.');
  assert(executed.providerNetworkCall===false&&executed.businessMutation===false,'Bounded executor exceeded lease-recovery authority.');
  assert(executed.leaseOwner==='bounded-provider-recovery-main'&&executed.state==='running','Provider retry lease was not reacquired by bounded executor.');
  const recoveredRun=providerJobs.detail(admin,primary.run.id);
  assert(recoveredRun.state==='running'&&recoveredRun.leaseOwner==='bounded-provider-recovery-main','Durable provider job does not show bounded recovery lease.');

  const replayError=expectThrow(()=>authority.consumeActionToken({
    token:issued.permit,
    tenant,
    agentScope:PRA.AGENT_SCOPE,
    toolId:PRA.TOOL_ID,
    actionType:issued.grant.actionType,
    targetDigest:issued.grant.targetDigest,
    decisionDigest:issued.grant.decisionDigest,
    executorId:'bounded-provider-recovery-replay'
  }),{code:'WFM_AGENT_ACTION_REPLAY'});
  const secondExecutionError=expectThrow(()=>investigations.executeRecoveryPermit(admin,primary.inv.id,{permit:issued.permit,workerId:'bounded-provider-recovery-replay'}),{code:'WFM_PROVIDER_RECOVERY_STALE_EVIDENCE'});
  const crossTenantError=expectThrow(()=>investigations.detail(otherAdmin,primary.inv.id),{status:404});

  // Separate scenario: after attested verification, legitimate provider state changes. The
  // previously verified evidence must become unusable before any permit can be issued.
  const stale=createRetryInvestigation('provider-recovery-authority-stale');
  const staleAttested=attestInvestigation(stale.inv,'stale');
  providerJobs.acquire(stale.run.id,'normal-provider-worker-after-proof',{leaseMs:60_000});
  const staleObservationContent='Provider observation for stale-evidence proof.';
  const staleInputDigest=sha({providerRunId:stale.run.id,evidenceDigest:staleAttested.ready.evidenceDigest,purpose:'stale-evidence'});
  const staleObservationAttested=authority.attestToolOutput({tenant,agentScope:PRA.AGENT_SCOPE,toolId:'provider-health-observer',requestId:'provider-observation-stale',inputDigest:staleInputDigest,content:staleObservationContent,sourceType:'provider-payload',ttlMs:60_000});
  const staleError=expectThrow(()=>investigations.issueRecoveryPermit(admin,stale.inv.id,{providerObservation:{token:staleObservationAttested.token,content:staleObservationContent,sourceType:'provider-payload',toolId:'provider-health-observer',requestId:'provider-observation-stale',inputDigest:staleInputDigest}}),{code:'WFM_PROVIDER_RECOVERY_STALE_EVIDENCE'});

  const negativeEvidence=sha({test:'provider-authority-negative',candidate:manifest.candidate});
  const negativeVerification=sha({test:'provider-authority-negative-verification',candidate:manifest.candidate});
  const payrollDenied=Safety.evaluate({type:'payroll.write',actorType:'deterministic-runbook',tenant,targetTenant:tenant,reversible:true,dryRunVerified:true,independentChecks:[negativeEvidence,negativeVerification],confidence:1});
  const llmDenied=Safety.evaluate({type:'integration.retry',actorType:'language-model',tenant,targetTenant:tenant,reversible:true,dryRunVerified:true,independentChecks:[negativeEvidence,negativeVerification],confidence:1});
  const crossTenantSafetyDenied=Safety.evaluate({type:'integration.retry',actorType:'deterministic-runbook',tenant,targetTenant:otherTenant,reversible:true,dryRunVerified:true,independentChecks:[negativeEvidence,negativeVerification],confidence:1});
  assert(!payrollDenied.allowed&&payrollDenied.reasons.includes('prohibited-high-impact-action'),'Payroll write escaped provider recovery authority.');
  assert(!llmDenied.allowed&&llmDenied.reasons.includes('language-model-is-proposal-only'),'LLM gained provider recovery execution authority.');
  assert(!crossTenantSafetyDenied.allowed&&crossTenantSafetyDenied.reasons.includes('tenant-boundary'),'Cross-tenant provider recovery gained safety authority.');
  assert(Remediation.plan({tenant,runbook:'unknown-provider-repair',evidenceDigest:negativeEvidence,verificationDigest:negativeVerification,dryRunVerified:true,confidence:1}).status==='unsupported','Unknown provider repair did not fail closed.');

  const supportSystemFindings=db.prepare("SELECT code,severity FROM support_incidents WHERE tenant=? AND area='integrations' AND code LIKE 'provider-%'").all(tenant);
  assert(supportSystemFindings.some(x=>x.code==='provider-retry-ready'),'Provider investigation did not feed deterministic system evidence into support control plane.');
  const customerCases=db.prepare('SELECT COUNT(*) n FROM support_cases WHERE tenant=?').get(tenant).n;
  assert(customerCases>=1,'Customer report disappeared from support control plane.');

  const recoveryEvents=investigations.recoveryEvents(admin,primary.inv.id);
  assert(recoveryEvents.some(x=>x.type==='permit-issued')&&recoveryEvents.some(x=>x.type==='bounded-recovery-lease-acquired'),'Provider recovery audit events incomplete.');

  const receipt={
    schemaVersion:1,
    proof:'attested-signed-provider-recovery-authority',
    status:'PASS',
    candidate:manifest.candidate,
    runtimeSha256:manifest.runtime_sha256,
    buildIdentity,
    humanInteractionRequired:false,
    productionMutation:false,
    customerReportRetained:true,
    providerSystemFindingLinkedToSupport:true,
    realProviderJobStore:true,
    realProviderInvestigation:true,
    attestedIndependentVerification:true,
    attestationPolicy:{predicateType:BAP.PREDICATE_TYPE,keyType:'ephemeral-ed25519-ci-only',repository:attestationIdentity.repository,workflowRef:attestationIdentity.workflowRef},
    signedExternalObservationVerified:true,
    externalObservationTrust:'untrusted-external-data',
    externalObservationIgnoredForAuthority:true,
    realDurableOneShotActionGrant:true,
    realBoundedProviderExecutor:true,
    selectedRunbook:'integration-transient',
    selectedAction:'integration.retry',
    providerNetworkCall:false,
    businessMutation:false,
    leaseReacquired:true,
    actionGrantReplayDenied:replayError.code==='WFM_AGENT_ACTION_REPLAY',
    secondExecutionDeniedAfterStateChange:Boolean(secondExecutionError),
    providerObservationTamperDenied:tamperError.code==='WFM_AGENT_PROVENANCE_CONTENT_CHANGED',
    crossTenantDenied:Boolean(crossTenantError),
    staleEvidenceDenied:staleError.code==='WFM_PROVIDER_RECOVERY_STALE_EVIDENCE',
    directLlmExecutionDenied:true,
    payrollWriteDenied:true,
    unknownRepairFailsClosed:true,
    verificationProofDigest:attested.proof.proofDigest,
    attestationStatementDigest:attested.proof.attestation.statementDigest,
    actionGrantJti:issued.grant.jti,
    safetyDecisionDigest:attested.ready.remediation.safety.decisionDigest,
    executorMicros:executeMicros,
    fullProofMicros:elapsedMicros(started),
    auditEventTypes:recoveryEvents.map(x=>x.type),
    learning:{
      machineReflex:'provider retry/replay authority is selected only from retained same-tenant provider state plus exact-build attested verification; external provider text is audit evidence only.',
      oneShotAuthority:'signed action grants are durable and consumable exactly once.',
      stateChangeRule:'any provider-run evidence change after verification invalidates the recovery proof and blocks permit issuance.',
      nextProof:'run this exact chain against the hosted staging service once Railway deployment authorization is available; then connect successful lease recovery to the normal provider adapter and reconciliation without widening executor authority.'
    },
    claimBoundary:'Disposable CI proof using the exact sealed 0.6.76 provider job, investigation, attestation, authority and recovery modules. The executor only reacquires durable provider work; no external provider call, customer business mutation or production deployment occurs.',
    generatedAt:new Date().toISOString()
  };
  fs.writeFileSync(outPath,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
}finally{
  try{db?.close();}catch{}
  fs.rmSync(temp,{recursive:true,force:true});
}
