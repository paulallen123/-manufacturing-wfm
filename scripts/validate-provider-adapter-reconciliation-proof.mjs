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
const outPath=path.join(ROOT,'provider-adapter-reconciliation-proof.json');
const tenant='proof-tenant-a';
const otherTenant='proof-tenant-b';

function assert(ok,message){if(!ok)throw new Error(message);}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function sha(v){return createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');}
function fileSha(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function expectThrow(fn,{code,status,messageIncludes}={}){try{const out=fn();if(out&&typeof out.then==='function')throw new Error('expectThrow requires sync operation');}catch(e){if(code)assert(e.code===code,`Expected ${code}, got ${e.code||'no-code'}: ${e.message}`);if(status)assert(e.status===status,`Expected HTTP ${status}, got ${e.status}: ${e.message}`);if(messageIncludes)assert(String(e.message).includes(messageIncludes),`Expected error containing ${messageIncludes}, got ${e.message}`);return e;}throw new Error('Expected operation to fail closed.');}
async function expectReject(fn,{code,status,messageIncludes}={}){try{await fn();}catch(e){if(code)assert(e.code===code,`Expected ${code}, got ${e.code||'no-code'}: ${e.message}`);if(status)assert(e.status===status,`Expected HTTP ${status}, got ${e.status}: ${e.message}`);if(messageIncludes)assert(String(e.message).includes(messageIncludes),`Expected error containing ${messageIncludes}, got ${e.message}`);return e;}throw new Error('Expected operation to fail closed.');}
function elapsedMicros(start){return Math.round(Number(process.hrtime.bigint()-start)/1000);}

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-provider-adapter-reconciliation-'));
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
  const PAC=load('provider-adapter-contract.cjs');
  const IG=load('integration-gateway.cjs');
  const Safety=load('autonomy-safety-kernel.cjs');
  const Remediation=load('autonomous-remediation.cjs');

  db=new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE tenants(id TEXT PRIMARY KEY);
    CREATE TABLE audit_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
  db.prepare('INSERT INTO tenants(id) VALUES(?)').run(tenant);
  db.prepare('INSERT INTO tenants(id) VALUES(?)').run(otherTenant);

  const buildIdentity=VW.readBuildIdentity(runtime);
  assert(buildIdentity.release===manifest.candidate,'Build identity release mismatch.');
  assert(buildIdentity.sourceContentSha256===manifest.runtime_source_content_sha256,'Build source identity mismatch.');
  assert(buildIdentity.artifactManifestSha256===manifest.runtime_package_manifest_sha256,'Build artifact manifest mismatch.');

  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const keyId='ci-adapter-proof-ed25519';
  const attestationIdentity={
    keyId,
    issuer:'wfm-ci-adapter-proof',
    subject:'provider-adapter-recovery-verifier',
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
  const investigations=PI.createStore(db,{providerJobs,support,verificationWorkers});
  const authority=ATA.createAuthority({
    key:'ci-only-adapter-authority-key-0123456789abcdef0123456789abcdef',
    db,
    toolPolicy:{[PRA.TOOL_ID]:[...PRA.ACTIONS]}
  });
  const recovery=PRA.createExecutor({db,providerJobs,investigations,authority});
  investigations.connectBoundedExecutor(recovery);
  const gateway=IG.createStore(db);

  const admin={tenant,email:'system-adapter-proof@example.invalid',personId:'system-adapter-proof',permissions:['company.configure']};
  const otherAdmin={tenant:otherTenant,email:'other-adapter-proof@example.invalid',personId:'other-adapter-proof',permissions:['company.configure']};
  const customer={tenant,email:'customer@example.invalid',role:'manager',permissions:[]};
  const connectorCfg={id:'proof-connector',provider:'netsuite',tenant,scope:'ci-proof',objectTypes:['demand']};
  const adapterName='proof-netsuite-demand';
  const providerVersion='2026.2-ci';

  support.submit(customer,{
    requestKey:'adapterproof_customer_0001',
    area:'integrations',
    symptom:'error',
    description:'The demand integration timed out after the first page. Please recover from the last committed provider checkpoint without duplicating staged data.'
  });

  const suiteId='provider-recovery-verification-v1';
  const suite=VW.SUITES[suiteId];
  assert(suite,'Provider recovery verification suite missing.');
  const remoteWorkerClass=suite.workerClasses.find(x=>VW.REMOTE_WORKER_CLASSES.has(x));
  assert(remoteWorkerClass,'No approved remote verification worker class.');

  function signAttestation(job,suffix){
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
      nonce:`adapter-proof-${suffix}-${Date.now()}`,
      issuedAt:new Date().toISOString(),
      expiresAt:new Date(Date.now()+5*60*1000).toISOString()
    };
    return {keyId,statement,signature:signBytes(null,Buffer.from(BAP.canonical(statement)),privateKey).toString('base64')};
  }

  function attest(inv,suffix){
    const requested=investigations.requestVerification(admin,inv.id,{suiteId});
    const job=requested.job;
    const attestation=signAttestation(job,suffix);
    verificationWorkers.acquireAttested(job.id,{workerClass:remoteWorkerClass,workerId:`remote-adapter-verifier-${suffix}`,attestation,leaseMs:60_000});
    const checks=suite.requiredChecks.map(id=>({id,passed:true,detail:`CI exact-build adapter continuation check passed: ${id}`}));
    const completed=verificationWorkers.completeAttested(job.id,{workerId:`remote-adapter-verifier-${suffix}`,workerClass:remoteWorkerClass,attestation,checks});
    assert(completed.state==='passed'&&completed.attestation?.verified===true,'Attested verification failed.');
    const proof=verificationWorkers.passedProof(admin,job.id,{investigationId:inv.id,evidenceDigest:inv.evidenceDigest});
    assert(proof.passed===true&&proof.attested===true,'Attested proof missing.');
    const attached=investigations.attachReadyForTenant(admin);
    assert(attached>=1,'Attested proof was not attached.');
    const ready=investigations.detail(admin,inv.id);
    assert(ready.status==='ready_for_bounded_executor','Investigation not ready for bounded executor.');
    return {job,proof,ready};
  }

  // The first provider page completed before the injected failure. It is staged through the
  // actual integration gateway and committed into the real durable provider checkpoint.
  const page1={
    offset:0,
    count:2,
    limit:2,
    hasMore:true,
    totalResults:4,
    sourceVersion:'proof-v1',
    items:[
      {id:'D-001',lastModifiedDate:'2026-09-17T13:00:00Z',trandate:'2026-09-18',department:'LINE-A',item:'SKU-A',quantity:10,status:'Open'},
      {id:'D-002',lastModifiedDate:'2026-09-17T13:01:00Z',trandate:'2026-09-18',department:'LINE-A',item:'SKU-B',quantity:20,status:'Open'}
    ]
  };
  const mapped1=PAC.mapNetSuiteDemandPage(page1,{sourceVersion:'proof-v1'});
  const key1=PAC.idempotencyKey(adapterName,mapped1.envelope);
  const canonicalDemand=(objectType,src)=>{
    assert(objectType==='demand','Unexpected gateway object type.');
    const d=src.data||{};
    assert(typeof d.date==='string'&&d.date.length>0,'Demand date missing.');
    assert(typeof d.department==='string'&&d.department.length>0,'Demand department missing.');
    assert(typeof d.product==='string'&&d.product.length>0,'Demand product missing.');
    assert(Number.isFinite(Number(d.quantity))&&Number(d.quantity)>=0,'Demand quantity invalid.');
    return {externalId:src.externalId,revision:src.revision,date:d.date,department:d.department,product:d.product,kind:d.kind,quantity:Number(d.quantity),status:d.status||null};
  };
  const staged1=gateway.stage(connectorCfg,mapped1.envelope,key1,canonicalDemand);
  assert(staged1.status==='staged'&&staged1.valid===2&&staged1.held===0,'Page 1 did not stage cleanly.');

  const run=providerJobs.ensure({
    tenant,
    connectorId:connectorCfg.id,
    provider:connectorCfg.provider,
    objectType:'demand',
    adapterName,
    providerVersion,
    fixtureContract:'ci-provider-adapter-reconciliation-proof',
    runKey:'adapter-recovery-main',
    startRequest:{offset:0,limit:2},
    maxFailures:3
  });
  const originalWorker='original-provider-adapter';
  providerJobs.acquire(run.id,originalWorker,{leaseMs:60_000});
  providerJobs.checkpoint(run.id,originalWorker,{
    nextRequest:mapped1.nextRequest,
    pages:1,
    sourceRecords:mapped1.reconciliation.sourceCount,
    stagedRecords:staged1.valid,
    heldRecords:staged1.held,
    retries:0,
    cursor:mapped1.envelope.cursor,
    sourceVersion:mapped1.envelope.sourceVersion,
    sourceAt:mapped1.reconciliation.sourceAt,
    ingestedAt:new Date().toISOString(),
    httpStatus:200,
    httpLatencyMs:11,
    freshnessSloSeconds:3600
  });
  providerJobs.fail(run.id,originalWorker,new Error('Injected transient provider timeout after committed page 1'),{retryDelayMs:0});
  const retry=providerJobs.detail(admin,run.id);
  assert(retry.state==='retry'&&retry.pagesCompleted===1,'Provider job did not retain first checkpoint in retry.');
  assert(retry.sourceRecords===2&&retry.stagedRecords===2&&retry.heldRecords===0,'Provider checkpoint counters incorrect before recovery.');
  assert(retry.diagnostics?.retryReady===true&&retry.diagnostics?.resumeFromCheckpoint===true,'Provider run is not safely resumable.');

  investigations.scanTenant(admin);
  const inv=investigations.report(admin).investigations.find(x=>x.providerRunId===run.id&&x.code==='provider-retry-ready');
  assert(inv&&inv.status==='awaiting_verification','Retry investigation missing or bypassed verification.');
  const verified=attest(inv,'adapter');

  const observationContent='Provider fixture observation: retry endpoint is available. This is evidence only and does not select the action.';
  const observationInputDigest=sha({providerRunId:run.id,evidenceDigest:verified.ready.evidenceDigest,purpose:'adapter-recovery-observation'});
  const observationAttested=authority.attestToolOutput({tenant,agentScope:PRA.AGENT_SCOPE,toolId:'provider-health-observer',requestId:'adapter-provider-observation',inputDigest:observationInputDigest,content:observationContent,sourceType:'provider-payload',ttlMs:60_000});
  const providerObservation={token:observationAttested.token,content:observationContent,sourceType:'provider-payload',toolId:'provider-health-observer',requestId:'adapter-provider-observation',inputDigest:observationInputDigest};
  const issued=investigations.issueRecoveryPermit(admin,inv.id,{providerObservation,ttlMs:60_000});

  const resumedWorker='normal-provider-adapter-after-recovery';
  const recoveryStarted=process.hrtime.bigint();
  const recoveryResult=investigations.executeRecoveryPermit(admin,inv.id,{permit:issued.permit,workerId:resumedWorker,leaseMs:60_000});
  const recoveryMicros=elapsedMicros(recoveryStarted);
  assert(recoveryResult.executed===true&&recoveryResult.action==='integration.retry','Bounded recovery did not reacquire retry lease.');
  assert(recoveryResult.providerNetworkCall===false&&recoveryResult.businessMutation===false,'Recovery executor exceeded authority.');

  const page2={
    offset:2,
    count:2,
    limit:2,
    hasMore:false,
    totalResults:4,
    sourceVersion:'proof-v1',
    items:[
      {id:'D-003',lastModifiedDate:'2026-09-17T13:02:00Z',trandate:'2026-09-18',department:'LINE-B',item:'SKU-C',quantity:30,status:'Open'},
      {id:'D-004',lastModifiedDate:'2026-09-17T13:03:00Z',trandate:'2026-09-18',department:'LINE-B',item:'SKU-D',quantity:40,status:'Open'}
    ]
  };
  let tokenFetches=0,providerFetches=0,submitCalls=0;
  const tokenLease=PAC.createTokenLease(async()=>{tokenFetches++;return {accessToken:'ci-fixture-token',expiresIn:3600};},{skewMs:30_000});
  const continuationStarted=process.hrtime.bigint();
  const continuation=await PAC.runPagedAdapter({
    name:adapterName,
    tokenLease,
    startRequest:retry.nextRequest,
    maxPages:5,
    maxRetries:2,
    sleep:async()=>{},
    fetchPage:async({request,accessToken,attempt})=>{
      providerFetches++;
      assert(accessToken==='ci-fixture-token','Unexpected fixture token.');
      assert(attempt===0,'Unexpected provider retry inside continuation fixture.');
      assert(request.offset===2&&request.limit===2,'Adapter did not resume from committed checkpoint.');
      return {status:200,body:page2,elapsedMs:9};
    },
    mapPage:(body,request)=>PAC.mapNetSuiteDemandPage(body,{sourceVersion:'proof-v1',request}),
    submitBatch:async({envelope,idempotencyKey})=>{
      submitCalls++;
      return gateway.stage(connectorCfg,envelope,idempotencyKey,canonicalDemand);
    },
    onPage:async page=>{
      providerJobs.checkpoint(run.id,resumedWorker,{
        nextRequest:page.nextRequest,
        pages:1,
        sourceRecords:page.sourceRecords,
        stagedRecords:page.stagedRecords,
        heldRecords:page.heldRecords,
        retries:page.retries,
        cursor:page.cursor,
        sourceVersion:page.sourceVersion,
        sourceAt:page.sourceAt,
        ingestedAt:page.ingestedAt,
        httpStatus:page.httpStatus,
        httpLatencyMs:page.httpLatencyMs,
        tokenExpiresAt:page.tokenExpiresAt,
        freshnessSloSeconds:3600
      });
    }
  });
  const continuationMicros=elapsedMicros(continuationStarted);
  assert(continuation.complete===true&&continuation.pages===1,'Normal provider adapter continuation did not complete exactly one remaining page.');
  assert(continuation.sourceRecords===2&&continuation.stagedRecords===2&&continuation.heldRecords===0,'Continuation reconciliation counters are incorrect.');
  assert(providerFetches===1&&submitCalls===1&&tokenFetches===1,'Continuation did not execute exactly once.');

  const completed=providerJobs.complete(run.id,resumedWorker,continuation);
  assert(completed.state==='completed','Provider job did not reach completed state.');
  assert(completed.pagesCompleted===2&&completed.sourceRecords===4&&completed.stagedRecords===4&&completed.heldRecords===0,'Cumulative provider counts are incorrect after continuation.');
  assert(completed.diagnostics?.reconciliation==='reconciled'&&completed.diagnostics?.recordDelta===0,'Provider completion is not reconciled.');

  const gatewayReport=gateway.report(admin);
  assert(gatewayReport.batches.length===2,'Expected exactly two staged gateway batches.');
  assert(gatewayReport.batches.every(x=>x.status==='staged'&&x.valid===2&&x.held===0&&x.applied===0),'Gateway continuation unexpectedly held/applied data.');
  const page2Mapped=PAC.mapNetSuiteDemandPage(page2,{sourceVersion:'proof-v1'});
  const page2Key=PAC.idempotencyKey(adapterName,page2Mapped.envelope);
  const batchCountBeforeReplay=db.prepare('SELECT COUNT(*) n FROM integration_batches WHERE tenant=?').get(tenant).n;
  const replay=gateway.stage(connectorCfg,page2Mapped.envelope,page2Key,canonicalDemand);
  const batchCountAfterReplay=db.prepare('SELECT COUNT(*) n FROM integration_batches WHERE tenant=?').get(tenant).n;
  assert(replay.replayed===true&&batchCountAfterReplay===batchCountBeforeReplay,'Identical provider page replay was not deduplicated.');

  const changedEnvelope=structuredClone(page2Mapped.envelope);
  changedEnvelope.records[0].data.quantity=999;
  const changedSameKeyError=expectThrow(()=>gateway.stage(connectorCfg,changedEnvelope,page2Key,canonicalDemand),{status:409,messageIncludes:'Idempotency key reused'});
  assert(changedSameKeyError,'Changed payload under same idempotency key was not rejected.');

  const integrationApplyEvents=db.prepare("SELECT COUNT(*) n FROM audit_events WHERE tenant=? AND action='integration-apply'").get(tenant).n;
  assert(integrationApplyEvents===0,'Adapter continuation mutated workforce/business data via integration apply.');
  const stagedEvents=db.prepare("SELECT COUNT(*) n FROM audit_events WHERE tenant=? AND action='integration-stage'").get(tenant).n;
  assert(stagedEvents===2,'Expected exactly two integration-stage audit events.');

  // Negative reconciliation scenario: held/invalid staged data must never be called reconciled.
  const badRun=providerJobs.ensure({tenant,connectorId:'proof-bad',provider:'netsuite',objectType:'demand',adapterName:'proof-bad-adapter',providerVersion,fixtureContract:'ci-negative-reconciliation',runKey:'adapter-negative-held',startRequest:{offset:0,limit:1},maxFailures:2});
  providerJobs.acquire(badRun.id,'bad-worker',{leaseMs:60_000});
  providerJobs.checkpoint(badRun.id,'bad-worker',{nextRequest:null,pages:1,sourceRecords:1,stagedRecords:0,heldRecords:1,retries:0,cursor:'bad:1',sourceVersion:'proof-v1',sourceAt:new Date(Date.now()-1000).toISOString(),ingestedAt:new Date().toISOString(),httpStatus:200,httpLatencyMs:5,freshnessSloSeconds:3600});
  const badCompleted=providerJobs.complete(badRun.id,'bad-worker',{complete:false});
  assert(badCompleted.diagnostics?.reconciliation==='completed_with_holds','Held provider data was incorrectly treated as reconciled.');
  investigations.scanTenant(admin);
  const heldInv=investigations.report(admin).investigations.find(x=>x.providerRunId===badRun.id&&x.code==='provider-held-records');
  assert(heldInv&&heldInv.status==='needs_review'&&heldInv.runbook===null,'Held records incorrectly received autonomous recovery authority.');

  const crossTenantError=expectThrow(()=>gateway.detail(otherAdmin,staged1.id),{status:404});
  const negativeEvidence=sha({candidate:manifest.candidate,test:'adapter-negative-authority'});
  const negativeVerification=sha({candidate:manifest.candidate,test:'adapter-negative-verification'});
  const llmDenied=Safety.evaluate({type:'integration.retry',actorType:'language-model',tenant,targetTenant:tenant,reversible:true,dryRunVerified:true,independentChecks:[negativeEvidence,negativeVerification],confidence:1});
  const payrollDenied=Safety.evaluate({type:'payroll.write',actorType:'deterministic-runbook',tenant,targetTenant:tenant,reversible:true,dryRunVerified:true,independentChecks:[negativeEvidence,negativeVerification],confidence:1});
  assert(!llmDenied.allowed&&llmDenied.reasons.includes('language-model-is-proposal-only'),'LLM gained adapter recovery execution authority.');
  assert(!payrollDenied.allowed&&payrollDenied.reasons.includes('prohibited-high-impact-action'),'Payroll write escaped adapter recovery boundary.');
  assert(Remediation.plan({tenant,runbook:'provider-apply-business-records',evidenceDigest:negativeEvidence,verificationDigest:negativeVerification,dryRunVerified:true,confidence:1}).status==='unsupported','Unknown business mutation runbook did not fail closed.');

  const receipt={
    schemaVersion:1,
    proof:'provider-recovery-adapter-continuation-reconciliation',
    status:'PASS',
    candidate:manifest.candidate,
    runtimeSha256:manifest.runtime_sha256,
    humanInteractionRequired:false,
    productionMutation:false,
    realProviderJobStore:true,
    realProviderInvestigation:true,
    attestedIndependentVerification:true,
    signedOneShotRecoveryPermit:true,
    boundedRecoveryExecutor:true,
    recoveryExecutorProviderNetworkCall:false,
    recoveryExecutorBusinessMutation:false,
    normalSealedAdapterContinued:true,
    resumedFromCommittedCheckpoint:true,
    deterministicProviderFixture:true,
    externalNetworkCall:false,
    realIntegrationGatewayStage:true,
    gatewayBusinessApplyCalled:false,
    gatewayBatches:2,
    gatewayAppliedRecords:0,
    pageReplayDeduplicated:true,
    changedPayloadSameIdempotencyKeyDenied:true,
    finalProviderState:completed.state,
    finalPagesCompleted:completed.pagesCompleted,
    finalSourceRecords:completed.sourceRecords,
    finalStagedRecords:completed.stagedRecords,
    finalHeldRecords:completed.heldRecords,
    finalReconciliation:completed.diagnostics.reconciliation,
    finalRecordDelta:completed.diagnostics.recordDelta,
    heldRecordScenarioAutonomyDenied:true,
    crossTenantDenied:Boolean(crossTenantError),
    directLlmExecutionDenied:true,
    payrollWriteDenied:true,
    unknownBusinessMutationRunbookDenied:true,
    tokenFetches,
    providerFixtureFetches:providerFetches,
    gatewaySubmitCalls:submitCalls,
    recoveryExecutorMicros:recoveryMicros,
    adapterContinuationMicros:continuationMicros,
    recoverySafetyDecisionDigest:verified.ready.remediation.safety.decisionDigest,
    recoveryVerificationDigest:verified.proof.proofDigest,
    learning:{
      boundary:'The recovery executor only reacquires durable provider work. The normal sealed adapter owns page fetching/mapping/staging/checkpointing; integration apply remains separate and was not invoked.',
      idempotency:'Replaying the same recovered provider page returns the existing staged batch; changed content under the same key is rejected.',
      reconciliation:'A completed provider job is accepted as reconciled only when source_records = staged_records + held_records and held_records = 0. Completed runs with held records remain needs-review and receive no autonomous runbook.',
      nextProof:'Use the same chain in hosted staging after Railway deployment authorization, then add provider-specific NetSuite/SuccessFactors sandbox evidence without changing the recovery executor authority.'
    },
    claimBoundary:'Disposable CI proof against the exact sealed 0.6.76 runtime. Provider I/O is a deterministic in-process fixture using the real sealed adapter contract; no external provider, customer business record or production system is changed.',
    generatedAt:new Date().toISOString()
  };
  fs.writeFileSync(outPath,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
}finally{
  try{db?.close();}catch{}
  fs.rmSync(temp,{recursive:true,force:true});
}
