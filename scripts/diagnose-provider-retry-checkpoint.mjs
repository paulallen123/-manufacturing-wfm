import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require=createRequire(import.meta.url);
const root=process.cwd();
const manifest=JSON.parse(fs.readFileSync(path.join(root,'DEPLOYMENT_MANIFEST.json'),'utf8'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-provider-retry-diagnostic-'));
let db;
try{
  execFileSync('tar',['-xzf',path.join(root,manifest.runtime_artifact),'-C',tmp]);
  const PJ=require(path.join(tmp,'lib','provider-job-store.cjs'));
  db=new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE tenants(id TEXT PRIMARY KEY); INSERT INTO tenants(id) VALUES ('proof-tenant-a');");
  const jobs=PJ.createStore(db);
  const actor={tenant:'proof-tenant-a',email:'proof@example.invalid',permissions:['company.configure']};
  const mappedNext={offset:2,limit:2};
  const run=jobs.ensure({tenant:'proof-tenant-a',connectorId:'proof',provider:'netsuite',objectType:'demand',adapterName:'proof-adapter',providerVersion:'1',fixtureContract:'checkpoint-diagnostic',runKey:'checkpoint-diagnostic',startRequest:{offset:0,limit:2},maxFailures:3});
  jobs.acquire(run.id,'diagnostic-worker',{leaseMs:60000});
  jobs.checkpoint(run.id,'diagnostic-worker',{nextRequest:mappedNext,pages:1,sourceRecords:2,stagedRecords:2,heldRecords:0,retries:0,cursor:'proof:2',sourceVersion:'v1',sourceAt:new Date(Date.now()-1000).toISOString(),ingestedAt:new Date().toISOString(),httpStatus:200,httpLatencyMs:5,freshnessSloSeconds:3600});
  jobs.fail(run.id,'diagnostic-worker',new Error('diagnostic transient failure'),{retryDelayMs:0});
  const detail=jobs.detail(actor,run.id);
  const columns=db.prepare('PRAGMA table_info(provider_jobs)').all().map(x=>x.name);
  const raw=db.prepare('SELECT * FROM provider_jobs WHERE id=?').get(run.id);
  const safeRaw=Object.fromEntries(Object.entries(raw||{}).map(([k,v])=>[k,/token|secret|authorization/i.test(k)?'<redacted>':v]));
  console.log(JSON.stringify({mappedNext,detail,detailKeys:Object.keys(detail),rawColumns:columns,raw:safeRaw},null,2));
}finally{try{db?.close();}catch{}fs.rmSync(tmp,{recursive:true,force:true});}
