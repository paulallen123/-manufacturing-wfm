import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const docker=fs.readFileSync(new URL('../Dockerfile.frontier-proof',import.meta.url),'utf8');
const ci=fs.readFileSync(new URL('./run-forge-ci.mjs',import.meta.url),'utf8');
const manifest=JSON.parse(fs.readFileSync(new URL('../release/vector-frontier-convergence.json',import.meta.url),'utf8'));
const required=[
  'COPY trust/runtime/vector-zero-human-governance.cjs /app/trust/runtime/vector-zero-human-governance.cjs',
  'COPY trust/runtime/vector-zero-human-governance.test.cjs /app/trust/runtime/vector-zero-human-governance.test.cjs',
  'COPY product-factory/vector-meta-loop-policy.json /app/product-factory/vector-meta-loop-policy.json',
  'COPY release/proof-lane-policy.json /app/release/proof-lane-policy.json',
  'COPY resilience/blocker-autopilot-policy.json /app/resilience/blocker-autopilot-policy.json',
  'COPY resilience/failure-scenarios.json /app/resilience/failure-scenarios.json',
  'COPY resilience/blocker-autopilot.cjs /app/resilience/blocker-autopilot.cjs',
  'COPY resilience/blocker-autopilot.test.cjs /app/resilience/blocker-autopilot.test.cjs',
  'COPY scripts/validate-vector-meta-loop.mjs /app/scripts/validate-vector-meta-loop.mjs',
  'node --check /app/trust/runtime/vector-zero-human-governance.cjs',
  'node --check /app/resilience/blocker-autopilot.cjs',
  'node --check /app/scripts/validate-vector-meta-loop.mjs',
  '/app/trust/runtime/vector-zero-human-governance.test.cjs',
  '/app/resilience/blocker-autopilot.test.cjs',
  'node /app/scripts/validate-vector-meta-loop.mjs',
  "require('/app/trust/runtime/vector-zero-human-governance.cjs')",
  "require('/app/product-factory/vector-meta-loop-policy.json')"
];

test('frontier Docker admission binds zero-human governance and meta-loop evidence',()=>{
  for(const token of required) assert.ok(docker.includes(token),`missing admission token: ${token}`);
  assert.match(docker,/typeof z\.decideZeroHumanAction/);
  assert.match(docker,/typeof z\.evaluateHumanTouchReleaseGate/);
  assert.match(docker,/meta\.contract!==['"]VECTOR_META_LOOP_V1['"]/);
});

test('runtime marker is derived from packaged zero-human and meta-loop modules',()=>{
  assert.match(docker,/zeroHumanGovernance:z\.decideZeroHumanAction\(\{\}\)\.contractVersion/);
  assert.match(docker,/metaLoop:meta\.contract/);
});

test('source CI is valid JavaScript and admits the proof regression',()=>{
  assert.doesNotMatch(ci,/\],\\n\s*\[/,'literal backslash-n must not separate CI entries');
  assert.match(ci,/scripts\/validate-vector-meta-loop\.mjs/);
  assert.match(ci,/trust\/runtime\/vector-zero-human-governance\.test\.cjs/);
  assert.match(ci,/resilience\/blocker-autopilot\.test\.cjs/);
  assert.match(ci,/scripts\/vector-frontier-proof-admission\.test\.mjs/);
});

test('frontier manifest declares the newly admitted proof layer',()=>{
  for(const item of [
    'trust/runtime/vector-zero-human-governance.cjs',
    'resilience/blocker-autopilot.cjs'
  ]) assert.ok(manifest.requiredRuntime.includes(item),item);
  for(const item of [
    'trust/runtime/vector-zero-human-governance.test.cjs',
    'resilience/blocker-autopilot.test.cjs',
    'product-factory/vector-meta-loop-policy.json',
    'scripts/validate-vector-meta-loop.mjs',
    'scripts/vector-frontier-proof-admission.test.mjs'
  ]) assert.ok(manifest.requiredAdmission.includes(item),item);
  assert.equal(manifest.proofRules.zeroHumanGovernanceDockerAdmissionRequired,true);
  assert.equal(manifest.proofRules.blockerAutopilotDockerAdmissionRequired,true);
  assert.equal(manifest.proofRules.metaLoopDockerAdmissionRequired,true);
});
