#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const temporary=await mkdtemp(path.join(os.tmpdir(),'wfm-staffology-assembly-'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function run(command,args,{capture=false}={}){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',stdio:capture?'pipe':'inherit',env:process.env});if(result.error)throw result.error;assert.equal(result.status,0,`${command} ${args.join(' ')} failed${capture?`: ${result.stderr}`:''}`);return result.stdout;}
try{
 run('tar',['-xzf',path.join(root,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'),'-C',temporary]);
 run(process.execPath,[path.join(root,'scripts/compose-vector-local-runtime.mjs'),temporary],{capture:true});
 run(process.execPath,['--check',path.join(temporary,'server.cjs')]);
 run(process.execPath,['--check',path.join(temporary,'integrations/staffology/canonical-runtime-bridge.cjs')]);
 run(process.execPath,['--check',path.join(temporary,'integrations/staffology/canonical-production-boundaries.cjs')]);
 const server=await readFile(path.join(temporary,'server.cjs'),'utf8');
 assert.match(server,/url\.pathname==='\/api\/integrations\/apply'/,'reviewed integration application route is missing');
 assert.match(server,/people:\(rows,batch\)=>.*ON\.stage/,'persisted onboarding application handler is missing');
 assert.match(server,/staffology:staffologyIntegration\.status\(\)/,'Staffology status is missing from the existing integration report');
 assert.match(server,/WHERE email=\? AND tenant=\?/,'Staffology authority is not bound to the exact authenticated account');
 const receipt=JSON.parse(await readFile(path.join(temporary,'STAFFOLOGY_ASSEMBLY.json'),'utf8'));
 assert.equal(receipt.sealedRuntimePreserved,true);
 assert.equal(receipt.activationAvailable,false);
 for(const [receiptKey,file] of [['adapter','staffology-adapter.cjs'],['bridge','canonical-runtime-bridge.cjs'],['productionBoundaries','canonical-production-boundaries.cjs']]){
  const source=await readFile(path.join(root,'integrations/staffology',file));
  const executable=await readFile(path.join(temporary,'integrations/staffology',file));
  assert.equal(sha256(executable),sha256(source),`${file} executable bytes differ from reviewed source`);
  assert.equal(receipt.assembledFiles[receiptKey],sha256(source),`${file} receipt identity differs from reviewed source`);
 }
 run(process.execPath,['--test','integrations/staffology/staffology-adapter.test.cjs','integrations/staffology/sqlite-contract.test.cjs','integrations/staffology/independent-boundaries.test.cjs','integrations/staffology/independent/succession-regressions.test.cjs','integrations/staffology/independent/current-authority-recovery-held-out.test.cjs','integrations/staffology/canonical-runtime-bridge.test.cjs','integrations/staffology/canonical-production-boundaries.test.cjs','integrations/staffology/review-5921699729-regressions.test.cjs','integrations/staffology/review-5925613376-regressions.test.cjs'],{capture:true});
 console.log('STAFFOLOGY_CANONICAL_ASSEMBLY=PASS');
}finally{await rm(temporary,{recursive:true,force:true});}
