'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildTrainingModule}=require('./training-workflow-manifest.cjs');
const {createVideoGenerationJob}=require('./training-video-contract.cjs');
const {createTrainingArtifactRegistry}=require('./training-artifact-registry.cjs');

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
