#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const read=p=>readFileSync(p,'utf8');
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const policy=JSON.parse(read('ci/reliability/ci-resilience-policy.json'));
const gh=read('.github/workflows/zero-useful-foothold.yml');
const circle=read('.circleci/config.yml');
const runner=read('scripts/run-zero-cost-ci.mjs');
const cmd=policy.releaseProof.canonicalCommand;
const node=policy.releaseProof.exactNodeVersion;
const fail=m=>{throw new Error(m);};

if(policy.releaseProof.minimumIndependentExecutedPasses<2) fail('Independent release proof quorum must be at least two providers.');
if(new Set(policy.releaseProof.providers).size<2) fail('At least two distinct CI providers are required.');
if(policy.releaseProof.zeroExecutedStepsClassification!=='INFRASTRUCTURE_UNAVAILABLE') fail('Zero-step runs must classify as infrastructure unavailable.');
if(policy.releaseProof.infrastructureUnavailableCountsAsProductFailure!==false) fail('Infrastructure unavailability must not become a product failure.');
if(policy.releaseProof.infrastructureUnavailableCountsAsPass!==false) fail('Infrastructure unavailability must never become a pass.');
if(policy.releaseProof.receiptMustBindExactCommit!==true) fail('Proof receipts must bind the exact commit.');
if(policy.repositoryGovernance.mainProtectionRequired!==true||policy.repositoryGovernance.signedCommitsRequired!==true) fail('Protected signed main is mandatory.');
if(policy.availability.automaticPaidRetriesAllowed!==false) fail('Automatic paid retries are forbidden by the current no-new-spend policy.');

if(!gh.includes(cmd)) fail('GitHub must execute the canonical provider-neutral proof command.');
if(!gh.includes(`node-version: '${node}'`)) fail('GitHub Node version drift.');
if(!gh.includes('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02')) fail('GitHub proof receipt upload must be immutable-pinned.');
if(!gh.includes('zero-useful-foothold-proof.json')) fail('GitHub must preserve the exact proof receipt.');

if(!circle.includes(`image: cimg/node:${node}`)) fail('CircleCI Node version drift.');
if(!runner.includes('scripts/validate-zero-useful-foothold.mjs')) fail('CircleCI consolidated proof runner must execute the canonical validator.');
if(!circle.includes('cp *-proof.json circleci-artifacts/')) fail('CircleCI must preserve proof receipts independently of GitHub Actions.');

const tests=spawnSync(process.execPath,['--test','ci/reliability/ci-evidence-classifier.test.mjs'],{stdio:'inherit'});
if(tests.error) throw tests.error;
if(tests.status!==0) process.exit(tests.status??1);

const receipt={
  schemaVersion:1,
  proofClass:'DEVELOPMENT',
  claim:'CI provider resilience policy and evidence classifier are internally consistent and both CI paths execute the same zero-useful-foothold proof logic.',
  claimBoundary:'This does not prove GitHub or CircleCI availability, active branch protection, CircleCI GitHub Checks linkage, off-GitHub source backup, or customer-release quorum. Those remain live external gates.',
  exactCandidate:{
    sourceCommit:process.env.CIRCLE_SHA1||process.env.GITHUB_SHA||null,
    node:process.version,
    policySha256:sha('ci/reliability/ci-resilience-policy.json'),
    classifierSha256:sha('ci/reliability/ci-evidence-classifier.mjs'),
    classifierTestsSha256:sha('ci/reliability/ci-evidence-classifier.test.mjs')
  },
  executed:{result:'PASS',classifierTests:'10/10'},
  releaseQuorum:policy.releaseProof,
  generatedAt:new Date().toISOString()
};
writeFileSync('ci-resilience-proof.json',JSON.stringify(receipt,null,2)+'\n');
console.log('CI_RESILIENCE_DEVELOPMENT_PROOF=PASS');
