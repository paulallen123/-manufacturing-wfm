#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {classifyProofBlocker} from './classify-proof-blocker.mjs';

const cases=[
  ['PROVIDER_DEGRADED','runner_id=0 no runner allocated before execution'],
  ['MISSING_PROOF_DEPENDENCY',"ENOENT: no such file or directory, open '/proof/missing.json'"],
  ['SECURITY_INVARIANT','not ok 7 - cross-tenant payroll authority isolation failed'],
  ['EVIDENCE_OR_CATALOG_DRIFT','not ok 8 - integration-fabric canonicalTargets expected protocol evidence'],
  ['STALE_PROOF_CONTRACT','AssertionError expected Odoo version but actual provider documentation changed'],
  ['MISSING_EVIDENCE','PROOF_REQUIRED exact hosted evidence unavailable'],
  ['PRODUCT_REGRESSION','not ok 10 - calculation result failed']
];
for(const [expected,log] of cases){
  const r=classifyProofBlocker(log);
  assert.equal(r.blockerClass,expected,log);
  assert.equal(r.globalStop,false,log);
  assert.equal(r.unaffectedDevelopment,'CONTINUE',log);
  assert.equal(r.unaffectedProof,'CONTINUE',log);
}
const unknown=classifyProofBlocker('Build Failed without useful evidence');
assert.equal(unknown.blockerClass,'UNKNOWN_FAIL_CLOSED');
assert.equal(unknown.globalStop,false);
assert.equal(unknown.affectedScopeMode,'DIAGNOSTIC_ONLY');
const railpackLog='using build driver railpack-v0.40.0\n[railway] prepare railpack-v0.40.0\nScript start.sh not found\nRailpack could not determine how to build the app.';
const deployment={id:'13fd2993-bb47-4cae-90d3-f693e04cb18e',sourceSha:'a'.repeat(40),snapshotId:'snapshot-1'};
const dockerConfig={builder:'DOCKERFILE',dockerfilePath:'Dockerfile.current-candidate-role-browser-proof',deploymentId:deployment.id,sourceSha:deployment.sourceSha,snapshotId:deployment.snapshotId};
const context={build:dockerConfig,deployment,logsDeploymentId:deployment.id};
const wrongBuilder=classifyProofBlocker(railpackLog,context);
assert.equal(wrongBuilder.blockerClass,'PROVIDER_BUILD_PATH_MISMATCH');
assert.equal(wrongBuilder.blocking,true);
assert.equal(wrongBuilder.affectedPromotion,'QUARANTINED');
assert.equal(wrongBuilder.globalStop,false);
assert.match(wrongBuilder.nextAction,/Dockerfile|provider/i);
assert.equal(classifyProofBlocker(railpackLog).blockerClass,'UNKNOWN_FAIL_CLOSED');
assert.equal(classifyProofBlocker(railpackLog,{build:dockerConfig}).blockerClass,'UNKNOWN_FAIL_CLOSED');
assert.equal(classifyProofBlocker(railpackLog,{...context,logsDeploymentId:'different'}).blockerClass,'UNKNOWN_FAIL_CLOSED');
assert.equal(classifyProofBlocker(railpackLog,{...context,build:{...dockerConfig,sourceSha:'b'.repeat(40)}}).blockerClass,'UNKNOWN_FAIL_CLOSED');
assert.equal(classifyProofBlocker(railpackLog,{build:{builder:'RAILPACK'}}).blockerClass,'UNKNOWN_FAIL_CLOSED');
for(const path of ['./Dockerfile','apps/proof/Dockerfile']) assert.equal(classifyProofBlocker(railpackLog,
  {...context,build:{...dockerConfig,dockerfilePath:path}}).blockerClass,'PROVIDER_BUILD_PATH_MISMATCH');
assert.equal(classifyProofBlocker(railpackLog,{...context,build:{...dockerConfig,dockerfilePath:'../Dockerfile'}}).blockerClass,'UNKNOWN_FAIL_CLOSED');
const temporary=mkdtempSync(join(tmpdir(),'vector-builder-classifier-'));
try{
  const logFile=join(temporary,'build.log'),buildFile=join(temporary,'build.json');
  writeFileSync(logFile,railpackLog);writeFileSync(buildFile,JSON.stringify(context));
  const cli=spawnSync(process.execPath,[fileURLToPath(new URL('./classify-proof-blocker.mjs',import.meta.url)),
    '--file',logFile,'--deployment-context',buildFile,'--enforce'],{encoding:'utf8'});
  assert.equal(cli.status,2,cli.stderr);
  assert.equal(JSON.parse(cli.stdout).blockerClass,'PROVIDER_BUILD_PATH_MISMATCH');
  const missing=spawnSync(process.execPath,[fileURLToPath(new URL('./classify-proof-blocker.mjs',import.meta.url)),
    '--file',logFile,'--enforce'],{encoding:'utf8'});
  assert.equal(missing.status,2,missing.stderr);
  assert.equal(JSON.parse(missing.stdout).blockerClass,'UNKNOWN_FAIL_CLOSED');
}finally{rmSync(temporary,{recursive:true,force:true});}
console.log('VECTOR_PROOF_BLOCKER_CLASSIFIER=PASS cases='+cases.length+' scopedIsolation=true');
