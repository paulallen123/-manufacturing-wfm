import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(repo,'release/capability-superset.json'),'utf8'));
const release=fs.readFileSync(path.join(repo,'release/vector-eow-convergence.json'),'utf8');
const validator=fs.readFileSync(path.join(repo,'scripts/validate-capability-superset.mjs'),'utf8');
const sourceSha='a'.repeat(40),imageDigest='sha256:'+'b'.repeat(64);
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const trustedKey=publicKey.export({type:'spki',format:'pem'});

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-retirement-'));
  fs.mkdirSync(path.join(dir,'release'),{recursive:true});
  fs.mkdirSync(path.join(dir,'scripts'),{recursive:true});
  const copy=structuredClone(manifest);
  for(const capability of copy.capabilities)capability.integratedPaths=[];
  fs.writeFileSync(path.join(dir,'release/capability-superset.json'),JSON.stringify(copy));
  fs.writeFileSync(path.join(dir,'release/vector-eow-convergence.json'),release);
  fs.writeFileSync(path.join(dir,'scripts/validate-capability-superset.mjs'),validator);
  return {dir,copy};
}
function run(dir,env={}){
  return spawnSync(process.execPath,['scripts/validate-capability-superset.mjs'],{cwd:dir,encoding:'utf8',
    env:{...process.env,VECTOR_CANDIDATE_SOURCE_SHA:sourceSha,VECTOR_CANDIDATE_IMAGE_DIGEST:imageDigest,
      VECTOR_RETIREMENT_PROOF_PUBLIC_KEY:trustedKey,VECTOR_PROOF_NOW:'2026-10-12T20:00:00.000Z',...env}});
}
function save(dir,copy){fs.writeFileSync(path.join(dir,'release/capability-superset.json'),JSON.stringify(copy));}
function proven(copy){
  const cap=copy.capabilities[0];
  cap.status='superset-proven';cap.mayRetireLegacySource=true;cap.proof=[...copy.proofRequiredToRetire];
  return cap;
}
function addReceipts(dir,copy,cap){
  const receiptDir=path.join(dir,'release/retirement-evidence');
  fs.mkdirSync(receiptDir,{recursive:true});
  cap.proofReceipts=copy.proofRequiredToRetire.map((proofType,index)=>{
    const evidencePath=`release/retirement-evidence/receipt-${index}.json`;
    const bytes=JSON.stringify({capabilityId:cap.id,proofType,status:'PASS',sourceSha,imageDigest,
      observedAt:'2026-10-12T19:00:00.000Z',expiresAt:'2026-10-13T19:00:00.000Z',evidenceRef:`fixture-${index}`});
    fs.writeFileSync(path.join(dir,evidencePath),bytes);
    return {proofType,evidencePath,evidenceSha256:createHash('sha256').update(bytes).digest('hex'),
      evidenceSignature:sign(null,Buffer.from(bytes),privateKey).toString('base64')};
  });
}

test('retirement refuses required proof labels with zero evidence receipts',()=>{
  const {dir,copy}=fixture();
  try{
    assert.equal(run(dir).status,0);
    proven(copy);
    save(dir,copy);
    const result=run(dir);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/receipt|evidence/i);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('bound receipts admit only the exact candidate and current evidence bytes',()=>{
 const {dir,copy}=fixture();
 try{
  const cap=proven(copy);addReceipts(dir,copy,cap);save(dir,copy);
  assert.equal(run(dir).status,0);
  assert.notEqual(run(dir,{VECTOR_RETIREMENT_PROOF_PUBLIC_KEY:''}).status,0);
  const receipt=cap.proofReceipts[0],file=path.join(dir,receipt.evidencePath);
  const original=fs.readFileSync(file,'utf8');
  const forged=JSON.stringify({...JSON.parse(original),evidenceRef:'self-asserted replacement'});
  fs.writeFileSync(file,forged);
  receipt.evidenceSha256=createHash('sha256').update(forged).digest('hex');save(dir,copy);
  assert.notEqual(run(dir).status,0,'a self-matched hash cannot replace the independent signature');
  receipt.evidenceSha256=createHash('sha256').update(original).digest('hex');
  fs.writeFileSync(file,original);save(dir,copy);
  for(const mutate of [
   body=>({...body,sourceSha:'c'.repeat(40)}),
   body=>({...body,imageDigest:'sha256:'+'d'.repeat(64)}),
   body=>({...body,status:'FAIL'}),
   body=>({...body,expiresAt:'2026-10-11T19:00:00.000Z'}),
   body=>({...body,capabilityId:'another-capability'})
  ]){
   fs.writeFileSync(file,JSON.stringify(mutate(JSON.parse(original))));
   assert.notEqual(run(dir).status,0);
  }
  fs.writeFileSync(file,original);
  receipt.evidencePath='../elsewhere.json';save(dir,copy);
  assert.notEqual(run(dir).status,0);
  receipt.evidencePath='release/retirement-evidence/receipt-0.json';save(dir,copy);
  const evidenceRoot=path.join(dir,'release/retirement-evidence');
  const elsewhere=path.join(dir,'elsewhere');
  fs.renameSync(evidenceRoot,elsewhere);
  fs.symlinkSync(elsewhere,evidenceRoot,'dir');
  assert.notEqual(run(dir).status,0,'a symlinked evidence directory must not escape its declared location');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

