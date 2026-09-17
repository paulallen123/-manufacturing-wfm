import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require=createRequire(import.meta.url);
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'DEPLOYMENT_MANIFEST.json'),'utf8'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-provider-contracts-v2-'));
const src=(fn,n=4500)=>typeof fn==='function'?String(fn).slice(0,n):null;
try {
  execFileSync('tar',['-xzf',path.join(root,manifest.runtime_artifact),'-C',tmp]);
  const load=n=>require(path.join(tmp,'lib',n));
  const PJ=load('provider-job-store.cjs');
  const PI=load('provider-investigation.cjs');
  const VW=load('disposable-verification-worker.cjs');
  const ATA=load('agent-tool-authority.cjs');
  const PRA=load('provider-recovery-authority.cjs');
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
    buildIdentity,
    attestationPolicyConfigured:verificationWorkers.attestationPolicyConfigured,
    contracts:{
      scanTenant:src(investigations.scanTenant),
      requestVerification:src(investigations.requestVerification),
      attachReadyForTenant:src(investigations.attachReadyForTenant),
      verificationRequest:src(verificationWorkers.request),
      acquireInternal:src(verificationWorkers.acquireInternal),
      completeInternal:src(verificationWorkers.completeInternal),
      acquireAttested:src(verificationWorkers.acquireAttested),
      completeAttested:src(verificationWorkers.completeAttested),
      passedProof:src(verificationWorkers.passedProof),
      authorityAttestToolOutput:src(authority.attestToolOutput),
      authorityVerifyToolOutput:src(authority.verifyToolOutput),
      authorityIssueActionToken:src(authority.issueActionToken),
      authorityConsumeActionToken:src(authority.consumeActionToken),
      issuePermit:src(recovery.issuePermit),
      executePermit:src(recovery.executePermit)
    }
  };
  console.log(JSON.stringify(out,null,2));
  db.close();
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
