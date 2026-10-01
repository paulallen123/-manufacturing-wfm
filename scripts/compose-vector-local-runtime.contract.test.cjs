'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,rmSync,existsSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');

test('composer preserves the absent-directory canonical caller contract',()=>{
 const source=join(__dirname,'compose-vector-local-runtime.mjs');
 const temporary=mkdtempSync(join(tmpdir(),'vector-canonical-composer-'));
 const runtime=join(temporary,'runtime');
 assert.equal(existsSync(runtime),false);
 try{
  const result=spawnSync(process.execPath,[source,runtime],{cwd:join(__dirname,'..'),env:{PATH:'/usr/bin:/bin',HOME:temporary},encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,`Canonical composition failed. Actual stderr:\n${result.stderr}`);
  assert.equal(existsSync(join(runtime,'LOCAL_PROOF_PROVENANCE.json')),true);
  assert.equal(existsSync(join(runtime,'security-runtime/bootstrap.cjs')),true);
  assert.equal(existsSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json')),true);
  const provenance=JSON.parse(readFileSync(join(runtime,'LOCAL_PROOF_PROVENANCE.json'),'utf8'));
  assert.ok(provenance.runtimeFiles.some(file=>file.path==='integrations/staffology/canonical-production-boundaries.cjs'));
  assert.ok(provenance.runtimeFiles.some(file=>file.path==='integrations/staffology/canonical-operations.cjs'));
  const assembly=JSON.parse(readFileSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json'),'utf8'));
  assert.equal(assembly.sealedRuntimePreserved,true);
  assert.equal(assembly.activationAvailable,false);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('composer preserves the extracted-runtime container caller contract',()=>{
 const source=join(__dirname,'compose-vector-local-runtime.mjs');
 const root=join(__dirname,'..');
 const temporary=mkdtempSync(join(tmpdir(),'vector-container-composer-'));
 const runtime=join(temporary,'runtime');
 try{
  mkdirSync(runtime);
  const extracted=spawnSync('tar',['--no-same-owner','-xzf',join(root,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'),'-C',runtime],{encoding:'utf8',timeout:120000});
  assert.equal(extracted.status,0,`Sealed runtime extraction failed. Actual stderr:\n${extracted.stderr}`);
  const result=spawnSync(process.execPath,[source,runtime],{cwd:root,env:{PATH:'/usr/bin:/bin',HOME:temporary},encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,`Container composition failed. Actual stderr:\n${result.stderr}`);
  assert.equal(existsSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json')),true);
  assert.equal(existsSync(join(runtime,'LOCAL_PROOF_PROVENANCE.json')),false);
  const assembly=JSON.parse(readFileSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json'),'utf8'));
  assert.equal(assembly.sealedRuntimePreserved,true);
  assert.equal(assembly.activationAvailable,false);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
