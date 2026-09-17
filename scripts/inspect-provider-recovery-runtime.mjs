import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require=createRequire(import.meta.url);
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'DEPLOYMENT_MANIFEST.json'),'utf8'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-provider-api-'));
const describeObject=o=>Object.fromEntries(Object.entries(o||{}).map(([k,v])=>[k,typeof v==='function'?{type:'function',arity:v.length}:typeof v]));
const sourceHead=(fn,n=1800)=>typeof fn==='function'?String(fn).slice(0,n):null;
try {
  execFileSync('tar',['-xzf',path.join(root,manifest.runtime_artifact),'-C',tmp]);
  const load=n=>require(path.join(tmp,'lib',n));
  const PJ=load('provider-job-store.cjs');
  const PI=load('provider-investigation.cjs');
  const VW=load('disposable-verification-worker.cjs');
  const ATA=load('agent-tool-authority.cjs');
  const PRA=load('provider-recovery-authority.cjs');
  const BI=load('build-identity.cjs');
  const db=new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE tenants(id TEXT PRIMARY KEY); INSERT INTO tenants(id) VALUES ('proof-tenant-a');");
  const providerJobs=PJ.createStore(db);
  const buildIdentity=VW.readBuildIdentity(tmp);
  const verificationWorkers=VW.createStore(db,{buildIdentity});
  const investigations=PI.createStore(db,{providerJobs,verificationWorkers});
  const authority=ATA.createAuthority({key:'proof-authority-key-that-is-long-enough-0123456789',db,toolPolicy:{[PRA.TOOL_ID]:[...PRA.ACTIONS]}});
  const recovery=PRA.createExecutor({db,providerJobs,investigations,authority});
  investigations.connectBoundedExecutor(recovery);
  const out={
    candidate:manifest.candidate,
    exports:{providerJobStore:describeObject(PJ),providerInvestigation:describeObject(PI),verificationWorker:describeObject(VW),agentAuthority:describeObject(ATA),providerRecovery:describeObject(PRA),buildIdentity:describeObject(BI)},
    stores:{providerJobs:describeObject(providerJobs),verificationWorkers:describeObject(verificationWorkers),investigations:describeObject(investigations),authority:describeObject(authority),recovery:describeObject(recovery)},
    constants:{toolId:PRA.TOOL_ID,agentScope:PRA.AGENT_SCOPE,actions:[...PRA.ACTIONS],suites:VW.SUITES,workerClasses:[...VW.WORKER_CLASSES],remoteWorkerClasses:[...VW.REMOTE_WORKER_CLASSES]},
    buildIdentity,
    sourceHeads:{
      providerEnsure:sourceHead(providerJobs.ensure),
      providerAcquire:sourceHead(providerJobs.acquire),
      providerCheckpoint:sourceHead(providerJobs.checkpoint),
      providerFail:sourceHead(providerJobs.fail),
      providerRequeue:sourceHead(providerJobs.requeue),
      investigationCreateFromRun:sourceHead(investigations.createFromRun),
      investigationScan:sourceHead(investigations.scan),
      investigationDetail:sourceHead(investigations.detail),
      verificationCreate:sourceHead(verificationWorkers.create),
      verificationPass:sourceHead(verificationWorkers.pass),
      verificationPassedFor:sourceHead(verificationWorkers.passedFor),
      authorityIssueToolToken:sourceHead(authority.issueToolToken),
      authoritySignToolOutput:sourceHead(authority.signToolOutput),
      recoveryIssuePermit:sourceHead(recovery.issuePermit),
      recoveryExecutePermit:sourceHead(recovery.executePermit)
    }
  };
  console.log(JSON.stringify(out,null,2));
  db.close();
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
