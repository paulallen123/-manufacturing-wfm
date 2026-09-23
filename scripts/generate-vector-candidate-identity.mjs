#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const digestFile=path=>fs.existsSync(path)?sha256(fs.readFileSync(path)):null;
function sourceSha(){
  for(const value of [process.env.VECTOR_SOURCE_SHA,process.env.CIRCLE_SHA1,process.env.GITHUB_SHA]){
    if(/^[a-f0-9]{7,64}$/i.test(String(value||''))) return String(value).toLowerCase();
  }
  const r=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
  const value=String(r.stdout||'').trim();
  if(r.status===0&&/^[a-f0-9]{40,64}$/i.test(value)) return value.toLowerCase();
  throw new Error('Exact source SHA unavailable.');
}
const identity={
  contract:'VECTOR_CANDIDATE_IDENTITY_V1',
  sourceSha:sourceSha(),
  inputs:{
    dockerfileSha256:digestFile('Dockerfile'),
    proofPolicySha256:digestFile('release/proof-lane-policy.json'),
    blockerPolicySha256:digestFile('resilience/blocker-autopilot-policy.json'),
    integrationContractSha256:digestFile('integration-fabric/openapi.yaml'),
    integrationContinuitySha256:digestFile('integration-fabric/evidence-continuity.json'),
    packageLockSha256:digestFile('package-lock.json')
  }
};
identity.candidateId=sha256(JSON.stringify(identity));
identity.productionMutation=false;
identity.productionAuthorityGranted=false;
fs.writeFileSync('candidate-identity.json',JSON.stringify(identity,null,2)+'\n');
console.log('VECTOR_CANDIDATE_IDENTITY='+identity.candidateId+' source='+identity.sourceSha);
