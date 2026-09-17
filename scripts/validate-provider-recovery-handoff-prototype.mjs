import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

const require=createRequire(import.meta.url);
const ROOT=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'DEPLOYMENT_MANIFEST.json'),'utf8'));
const artifact=path.join(ROOT,manifest.runtime_artifact);
const Prototype=require(path.join(ROOT,'resilience/prototypes/provider-recovery-handoff.cjs'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-handoff-prototype-'));
const runtime=path.join(tmp,'runtime');
fs.mkdirSync(runtime);
const sha=v=>createHash('sha256').update(typeof v==='string'?v:Prototype.canonical(v)).digest('hex');
function assert(ok,msg){if(!ok)throw new Error(msg);}
function expect(fn,code){try{fn();}catch(e){assert(e.code===code,`Expected ${code}, got ${e.code||'none'}: ${e.message}`);return;}throw new Error(`Expected ${code}`);}

try{
  execFileSync('tar',['-xzf',artifact,'-C',runtime],{stdio:'pipe'});
  const Remediation=require(path.join(runtime,'lib','autonomous-remediation.cjs'));
  const tenant='proof-tenant-a',otherTenant='proof-tenant-b',runId='provider-run-42',workerId='bounded-provider-recovery-42';
  const evidenceDigest=sha({runId,state:'retry',resumeFromCheckpoint:true});
  const verificationDigest=sha({worker:'attested-verifier',result:'pass'});
  const approved=Remediation.plan({tenant,runbook:'integration-transient',evidenceDigest,verificationDigest,dryRunVerified:true,confidence:1});
  assert(approved.status==='approved-for-bounded-executor'&&approved.action==='integration.retry'&&approved.safety?.allowed===true,'Sealed safety kernel did not approve expected bounded action.');
  const targetDigest=sha({tenant,runId,action:approved.action,evidenceDigest,verificationDigest});
  const initialState={state:'running',leaseOwner:workerId,leaseExpiresAt:'2026-09-17T16:00:00Z',nextRequestDigest:sha({offset:2,limit:2})};
  const stateDigest=sha(initialState),nextRequest={offset:2,limit:2};
  let now=1_800_000_000_000;
  const db=new DatabaseSync(':memory:');
  const store=Prototype.createStore(db,{key:'ci-provider-handoff-reference-key-0123456789abcdef',now:()=>now,maxTtlMs:120000});

  const issued=store.issueInternal({
    actorType:'deterministic-recovery-executor',tenant,providerRunId:runId,workerId,actionType:approved.action,
    targetDigest,evidenceDigest,verificationDigest,safetyDecision:approved.safety,actionGrantJti:'grant-main-001',
    nextRequest,stateDigest,ttlMs:60000
  });
  assert(typeof issued.internalToken==='string'&&issued.internalToken.length>20,'Internal handoff token missing.');
  assert(issued.publicReceipt.status==='ready','Public receipt is not ready.');
  const publicText=JSON.stringify(issued.publicReceipt);
  assert(!publicText.includes('offset')&&!publicText.includes('limit')&&!publicText.includes('internalToken'),'Public receipt leaked continuation/token.');
  const tokenPayload=JSON.parse(Buffer.from(issued.internalToken.split('.')[0],'base64url').toString());
  assert(!Object.hasOwn(tokenPayload,'nextRequest')&&!JSON.stringify(tokenPayload).includes('offset'),'Opaque capability token leaked raw continuation.');
  const status=store.publicStatus({tenant,handoffId:issued.publicReceipt.handoffId});
  assert(status.status==='ready'&&!Object.hasOwn(status,'nextRequest'),'Public status leaked continuation.');

  expect(()=>store.consumeInternal({token:issued.internalToken,tenant:otherTenant,providerRunId:runId,workerId,currentStateDigest:stateDigest}),'WFM_PROVIDER_HANDOFF_SCOPE');
  expect(()=>store.consumeInternal({token:issued.internalToken,tenant,providerRunId:'wrong-run',workerId,currentStateDigest:stateDigest}),'WFM_PROVIDER_HANDOFF_SCOPE');
  expect(()=>store.consumeInternal({token:issued.internalToken,tenant,providerRunId:runId,workerId:'wrong-worker',currentStateDigest:stateDigest}),'WFM_PROVIDER_HANDOFF_SCOPE');
  expect(()=>store.consumeInternal({token:issued.internalToken+'x',tenant,providerRunId:runId,workerId,currentStateDigest:stateDigest}),'WFM_PROVIDER_HANDOFF_SIGNATURE');
  expect(()=>store.consumeInternal({token:issued.internalToken,tenant,providerRunId:runId,workerId,currentStateDigest:sha({...initialState,leaseExpiresAt:'changed'})}),'WFM_PROVIDER_HANDOFF_STALE');

  const consumed=store.consumeInternal({token:issued.internalToken,tenant,providerRunId:runId,workerId,currentStateDigest:stateDigest});
  assert(consumed.action==='integration.retry'&&consumed.providerRunId===runId&&consumed.workerId===workerId,'Consumed handoff scope/action mismatch.');
  assert(JSON.stringify(consumed.nextRequest)===JSON.stringify(nextRequest),'Authorised internal worker did not receive exact continuation.');
  expect(()=>store.consumeInternal({token:issued.internalToken,tenant,providerRunId:runId,workerId,currentStateDigest:stateDigest}),'WFM_PROVIDER_HANDOFF_REPLAY');
  assert(store.publicStatus({tenant,handoffId:issued.publicReceipt.handoffId}).status==='consumed','Consumed public status incorrect.');
  const events=store.events({tenant,handoffId:issued.publicReceipt.handoffId});
  assert(events.map(x=>x.type).join(',')==='handoff-issued,handoff-consumed','Handoff audit events incomplete.');
  const eventText=JSON.stringify(events);
  assert(!eventText.includes('offset')&&!eventText.includes('limit'),'Audit events leaked raw continuation.');

  expect(()=>store.issueInternal({actorType:'language-model',tenant,providerRunId:'llm-run',workerId:'llm',actionType:'integration.retry',targetDigest,evidenceDigest,verificationDigest,safetyDecision:approved.safety,actionGrantJti:'llm-grant',nextRequest,stateDigest}),'WFM_PROVIDER_HANDOFF_ACTOR');
  expect(()=>store.issueInternal({actorType:'deterministic-recovery-executor',tenant,providerRunId:'bad-action',workerId,actionType:'payroll.write',targetDigest,evidenceDigest,verificationDigest,safetyDecision:approved.safety,actionGrantJti:'bad-action-grant',nextRequest,stateDigest}),'WFM_PROVIDER_HANDOFF_ACTION');
  expect(()=>store.issueInternal({actorType:'deterministic-recovery-executor',tenant,providerRunId:'cross-tenant',workerId,actionType:'integration.retry',targetDigest,evidenceDigest,verificationDigest,safetyDecision:{...approved.safety,targetTenant:otherTenant},actionGrantJti:'cross-grant',nextRequest,stateDigest}),'WFM_PROVIDER_HANDOFF_SAFETY');

  const exp=store.issueInternal({actorType:'deterministic-recovery-executor',tenant,providerRunId:'expiry-run',workerId:'expiry-worker',actionType:'integration.retry',targetDigest,evidenceDigest,verificationDigest,safetyDecision:approved.safety,actionGrantJti:'grant-expiry-001',nextRequest,stateDigest,ttlMs:1000});
  now+=1001;
  expect(()=>store.consumeInternal({token:exp.internalToken,tenant,providerRunId:'expiry-run',workerId:'expiry-worker',currentStateDigest:stateDigest}),'WFM_PROVIDER_HANDOFF_EXPIRED');
  now-=1001;

  let duplicateGrantDenied=false;
  try{
    store.issueInternal({actorType:'deterministic-recovery-executor',tenant,providerRunId:'duplicate-grant-run',workerId:'duplicate-worker',actionType:'integration.retry',targetDigest,evidenceDigest,verificationDigest,safetyDecision:approved.safety,actionGrantJti:'grant-main-001',nextRequest,stateDigest});
  }catch(e){duplicateGrantDenied=/UNIQUE constraint failed/.test(String(e.message));}
  assert(duplicateGrantDenied,'Action grant JTI reuse was not denied by durable uniqueness.');

  const receipt={
    schemaVersion:1,proof:'provider-recovery-internal-handoff-reference',status:'PASS',candidate:manifest.candidate,runtimeSha256:manifest.runtime_sha256,
    runtimeMutation:false,productionMutation:false,referenceImplementationOnly:true,
    exactSealedSafetyDecisionUsed:true,allowedAction:'integration.retry',rawContinuationServerSideOnly:true,
    publicReceiptNoContinuation:true,publicStatusNoContinuation:true,capabilityTokenNoContinuation:true,auditEventsNoContinuation:true,
    correctWorkerReceivesExactContinuation:true,wrongTenantDenied:true,wrongRunDenied:true,wrongWorkerDenied:true,signatureTamperDenied:true,
    stateChangeDenied:true,replayDenied:true,expiryDenied:true,duplicateActionGrantDenied:true,directLlmIssuanceDenied:true,payrollActionDenied:true,crossTenantSafetyDenied:true,
    oneShot:true,shortLived:true,stateBound:true,evidenceBound:true,verificationBound:true,safetyDecisionBound:true,actionGrantBound:true,
    eventTypes:events.map(x=>x.type),continuationDigest:consumed.continuationDigest,safetyDecisionDigest:approved.safety.decisionDigest,
    learning:{
      design:'Keep the continuation payload in server-side storage; pass only an opaque signed capability internally. Bind consumption to tenant, run, worker, current provider state, evidence, verification, safety decision and the consumed recovery action grant.',
      integrationRule:'The browser/admin recovery endpoint must continue returning only the existing sanitised recovery result. An internal provider orchestrator consumes the capability and passes nextRequest into the normal sealed adapter runner.',
      nextStep:'Port this contract into canonical WFM source as a derived staging candidate, add an internal provider runner, and prove recovered checkpoint continuation/reconciliation before any hosted or production claim.'
    },
    claimBoundary:'Security/reference proof only. This module is not imported by the sealed 0.6.76 runtime and does not repair the currently deployed handoff gap.'
  };
  fs.writeFileSync(path.join(ROOT,'provider-recovery-handoff-prototype-proof.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
  db.close();
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
