'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildTrainingModule}=require('./training-workflow-manifest.cjs');
const {createVideoGenerationJob}=require('./training-video-contract.cjs');
const {createTrainingArtifactRegistry}=require('./training-artifact-registry.cjs');
const {DatabaseSync}=require('node:sqlite');
const http=require('node:http');
const {createTrainingDeliveryService}=require('./training-delivery-service.cjs');

test('artifact registry is append-only and exposes only durable READY URLs',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'training-artifact-')),dbPath=path.join(dir,'x.db');
  const registry=createTrainingArtifactRegistry({dbPath});
  const module=buildTrainingModule({competencyKey:'absence.request',role:'employee',mode:'SHOW_ME',locale:'en-GB',productSha:'1234567890abcdef1234567890abcdef12345678'});
  const job=createVideoGenerationJob(module,{targetOrigin:'https://vector.example'}),hex='b'.repeat(64);
  const receipt={contractVersion:'VECTOR_TRAINING_VIDEO_RECEIPT_V1',jobId:job.jobId,artifactFingerprint:job.artifactFingerprint,productSha:job.productSha,uiVersion:job.uiVersion,sourceClass:'SYNTHETIC',capture:{route:'leave',observedSelectors:job.capture.requiredSelectors,expectedTextObserved:true},scan:{pii:'PASS',secrets:'PASS'},consoleErrors:[],media:{videoSha256:hex,captionsSha256:hex,transcriptSha256:hex,durationMs:8000},narration:{status:'NOT_CONFIGURED'},publication:{durable:false,url:null}};
  const result=registry.recordReceipt(job,receipt);
  assert.equal(result.artifact.state,'PROOF_ONLY');assert.equal(result.artifact.videoUrl,null);assert.equal(result.artifact.captionsUrl,null);assert.equal(result.artifact.transcriptUrl,null);
  registry.close();fs.rmSync(dir,{recursive:true,force:true});
});

function evidencePair(){
  const module=buildTrainingModule({competencyKey:'absence.request',role:'employee',mode:'SHOW_ME',locale:'en-GB',productSha:'1234567890abcdef1234567890abcdef12345678'});
  const job=createVideoGenerationJob(module,{targetOrigin:'https://vector.example'}),hex='d'.repeat(64);
  return {job,receipt:{contractVersion:'VECTOR_TRAINING_VIDEO_RECEIPT_V1',jobId:job.jobId,
    artifactFingerprint:job.artifactFingerprint,productSha:job.productSha,uiVersion:job.uiVersion,sourceClass:'SYNTHETIC',
    capture:{route:job.capture.route,observedSelectors:[...job.capture.requiredSelectors],expectedTextObserved:true},
    scan:{pii:'PASS',secrets:'PASS'},consoleErrors:[],
    media:{videoSha256:hex,captionsSha256:hex,transcriptSha256:hex,durationMs:8000},
    narration:{status:'PRESENT',audioSha256:hex},
    publication:{durable:true,videoUrl:'https://media.example/video',captionsUrl:'https://media.example/captions',transcriptUrl:'https://media.example/transcript'}}};
}
function malformedPairs(){
  const transforms=[
    p=>({...p,job:null}),p=>({...p,receipt:null}),p=>({...p,job:[]}),p=>({...p,receipt:[]}),
    p=>({...p,job:{...p.job,script:'wrong'}}),
    p=>({...p,job:{...p.job,capture:{...p.job.capture,requiredSelectors:{}}}}),
    p=>({...p,job:{...p.job,capture:null}}),
    p=>({...p,job:{...p.job,artifactFingerprint:null}}),
    p=>({...p,receipt:{...p.receipt,capture:{...p.receipt.capture,observedSelectors:'wrong'}}}),
    p=>({...p,receipt:{...p.receipt,scan:null}}),
    p=>({...p,receipt:{...p.receipt,media:[]}}),
    p=>({...p,receipt:{...p.receipt,consoleErrors:{}}}),
    p=>({...p,receipt:{...p.receipt,publication:{...p.receipt.publication,videoUrl:{toString:null}}}})
  ];
  return transforms.map(fn=>fn(evidencePair()));
}
function rows(db){return db.prepare('SELECT id,fingerprint,state,job_json,receipt_json,created_at FROM training_artifact_events ORDER BY id').all();}

for(const state of ['READY','PROOF_ONLY']){
  test('structural rejection preserves '+state+' event bytes and survives database reopen',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'training-rejection-')),dbPath=path.join(dir,'proof.db');
    let registry=createTrainingArtifactRegistry({dbPath});const db=new DatabaseSync(dbPath);
    try{
      const {job,receipt}=evidencePair();
      if(state==='PROOF_ONLY'){delete receipt.narration;delete receipt.publication;}
      const accepted=registry.recordReceipt(job,receipt);assert.equal(accepted.artifact.state,state);
      const before=rows(db),view=registry.currentForFingerprint(job.artifactFingerprint);
      for(const malformed of malformedPairs()){
        let rejected;assert.doesNotThrow(()=>{rejected=registry.recordReceipt(malformed.job,malformed.receipt);});
        assert.equal(rejected.validation.ok,false);assert.equal(rejected.validation.state,'FAILED');assert.equal(rejected.artifact,null);
        assert.deepEqual(rows(db),before);assert.deepEqual(registry.currentForFingerprint(job.artifactFingerprint),view);
      }
      registry.close();registry=createTrainingArtifactRegistry({dbPath});
      assert.deepEqual(rows(db),before);assert.deepEqual(registry.currentForFingerprint(job.artifactFingerprint),view);
      assert.equal(view.videoUrl,state==='READY'?receipt.publication.videoUrl:null);
      assert.equal(view.captionsUrl,state==='READY'?receipt.publication.captionsUrl:null);
      assert.equal(view.transcriptUrl,state==='READY'?receipt.publication.transcriptUrl:null);
    }finally{registry.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
  });
}
test('well-formed failed evidence still appends and hides URLs without erasing history',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'training-failure-history-')),dbPath=path.join(dir,'proof.db');
  const registry=createTrainingArtifactRegistry({dbPath}),db=new DatabaseSync(dbPath);
  try{
    const {job,receipt}=evidencePair();registry.recordReceipt(job,receipt);const first=rows(db)[0];
    const failures=[r=>{r.scan.pii='FAIL';},r=>{r.capture.observedSelectors=[];},r=>{r.media.videoSha256='bad';},r=>{r.consoleErrors=['synthetic'];}];
    for(const change of failures){
      const failed=structuredClone(receipt);change(failed);const before=rows(db).length;
      const result=registry.recordReceipt(job,failed);assert.equal(result.validation.ok,false);assert.equal(result.artifact.state,'FAILED');
      assert.equal(rows(db).length,before+1);assert.deepEqual(rows(db)[0],first);
      for(const key of ['videoUrl','captionsUrl','transcriptUrl'])assert.equal(result.artifact[key],null);
    }
    assert.throws(()=>db.exec("UPDATE training_artifact_events SET state='READY'"),/append only/);
    assert.throws(()=>db.exec('DELETE FROM training_artifact_events'),/append only/);
  }finally{registry.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('repeated admitted receipts preserve current append behavior',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'training-append-')),dbPath=path.join(dir,'proof.db');
  const registry=createTrainingArtifactRegistry({dbPath}),db=new DatabaseSync(dbPath);
  try{
    const {job,receipt}=evidencePair();registry.recordReceipt(job,receipt);registry.recordReceipt(job,receipt);
    assert.equal(rows(db).length,2);assert.deepEqual(rows(db).map(x=>x.state),['READY','READY']);
    assert.equal(rows(db)[0].receipt_json,rows(db)[1].receipt_json);
  }finally{registry.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

async function withReceiptService(configured,run){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'training-http-')),dbPath=path.join(dir,'proof.db');
  const db=new DatabaseSync(dbPath),token='SYNTHETIC-V062-TEST-ONLY';
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT); CREATE TABLE sessions(token_hash TEXT,email TEXT,expires INTEGER);');
  let service,server;
  try{
    const prior=process.env.WFM_TRAINING_FACTORY_INTERNAL_TOKEN;
    try{
      if(!configured)delete process.env.WFM_TRAINING_FACTORY_INTERNAL_TOKEN;
      service=createTrainingDeliveryService({dbPath,internalToken:configured?token:''});
    }finally{
      if(prior===undefined)delete process.env.WFM_TRAINING_FACTORY_INTERNAL_TOKEN;
      else process.env.WFM_TRAINING_FACTORY_INTERNAL_TOKEN=prior;
    }
    server=http.createServer((req,res)=>{
      service.handleRequest(req,res).then(handled=>{if(!handled){res.statusCode=404;res.end();}}).catch(error=>res.destroy(error));
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const url='http://127.0.0.1:'+server.address().port+'/api/learning/training/artifact-receipt';
    const post=async(body,credential=token)=>{
      const headers={'Content-Type':'application/json'};
      if(credential!==null)headers['x-wfm-training-factory-internal']=credential;
      const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    };
    await run({db,post});
  }finally{
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    if(service)service.close();db.close();fs.rmSync(dir,{recursive:true,force:true});
  }
}
test('actual receipt HTTP route preserves READY across malformed inputs and retains semantic FAILED',async()=>{
  await withReceiptService(true,async({db,post})=>{
    const pair=evidencePair();const accepted=await post(pair);assert.equal(accepted.status,200);assert.equal(accepted.body.artifact.state,'READY');
    const before=rows(db);
    for(const malformed of malformedPairs().filter(x=>x.job&&x.receipt)){
      const result=await post(malformed);assert.equal(result.status,422);assert.equal(result.body.validation.ok,false);assert.equal(result.body.artifact,null);
      assert.deepEqual(rows(db),before);
    }
    const failed=structuredClone(pair);failed.receipt.scan.pii='FAIL';
    const denied=await post(failed);assert.equal(denied.status,422);assert.equal(denied.body.artifact.state,'FAILED');assert.equal(denied.body.artifact.videoUrl,null);
    assert.equal(rows(db).length,2);assert.deepEqual(rows(db)[0],before[0]);
    const pending=evidencePair();delete pending.receipt.narration;delete pending.receipt.publication;
    const proof=await post(pending);assert.equal(proof.status,200);assert.equal(proof.body.artifact.state,'PROOF_ONLY');assert.equal(proof.body.artifact.videoUrl,null);
    assert.equal(rows(db).length,3);
  });
});
test('actual HTTP route retains required-field and configured-credential refusal without writes',async()=>{
  await withReceiptService(true,async({db,post})=>{
    const pair=evidencePair();
    for(const body of [{},{job:pair.job},{receipt:pair.receipt},{...pair,job:null},{...pair,receipt:false}])assert.equal((await post(body)).status,400);
    assert.equal((await post(pair,'wrong-synthetic-token')).status,403);
    assert.equal((await post(pair,null)).status,403);
    assert.equal(rows(db).length,0);
  });
});
test('actual HTTP route retains unconfigured-credential refusal without writes',async()=>{
  await withReceiptService(false,async({db,post})=>{
    assert.equal((await post(evidencePair())).status,503);assert.equal(rows(db).length,0);
  });
});
test('actual receipt HTTP route rejects non-object envelopes before artifact writes',async()=>{
  await withReceiptService(true,async({db,post})=>{
    assert.equal((await post(evidencePair())).status,200);const before=rows(db);
    for(const body of [null,false,0,17,'invalid',[]]){
      const result=await post(body);assert.equal(result.status,400);
      assert.deepEqual(result.body,{error:'job and receipt are required.'});assert.deepEqual(rows(db),before);
    }
    assert.equal((await post(null,'wrong-synthetic-token')).status,403);assert.deepEqual(rows(db),before);
  });
});
