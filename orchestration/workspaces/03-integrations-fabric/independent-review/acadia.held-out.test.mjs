import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url)),work=path.resolve(directory,'..');
const source=path.join(work,'lane03-fabric/source/integration-fabric'),baseline=path.join(work,'lane03-fabric/baseline-source/integration-fabric');
const relative='research-overlays/2026-09-20-1251.json';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const observation=[];
test.after(()=>fs.writeFileSync(path.join(directory,'acadia.observations.json'),JSON.stringify({node:process.version,externalProviderRequests:0,observations:observation},null,2)));
function guard(root){return spawnSync(process.execPath,['--require',path.join(directory,'network-guard.cjs'),path.join(root,'scripts/conformance.mjs')],{encoding:'utf8',timeout:30000,cwd:directory});}
test('Acadia metadata changes exactly one unresolved-interface label and no other knowledge/authority',()=>{
 const before=read(path.join(baseline,relative)),after=read(path.join(source,relative));
 const prior=before.systems.find(s=>s.id==='acadia-performance-platform'),current=after.systems.find(s=>s.id==='acadia-performance-platform');
 assert.equal(prior.researchStatus,'vendor-capability-verified-interface-unresolved');assert.equal(current.researchStatus,'vendor-capability-verified-interface-unverified');
 const restored=structuredClone(after);restored.systems.find(s=>s.id==='acadia-performance-platform').researchStatus=prior.researchStatus;assert.deepEqual(restored,before);
 assert.deepEqual(fs.readFileSync(path.join(source,'scripts/conformance.mjs')),fs.readFileSync(path.join(baseline,'scripts/conformance.mjs')),'Original conformance guard must remain byte-identical');
 observation.push({id:'ACADIA-DELTA',changedField:'researchStatus',before:prior.researchStatus,after:current.researchStatus,allOtherMetadataUnchanged:true,guardUnchanged:true});
});
test('Acadia conservative declaration passes actual unchanged conformance while adapter/write proof remains absent',async()=>{
 const result=guard(source);assert.equal(result.status,0,result.stderr||result.error?.message);
 const {connectorById}=await import(pathToFileURL(path.join(source,'runtime/connector-registry.mjs')));
 const system=connectorById('acadia-performance-platform');
 assert.equal(system.evidenceLevel,'discovery-queued');assert.deepEqual(system.adapters,[]);assert.equal(system.security.writeEnabled,false);
 observation.push({id:'ACADIA-CONFORMANCE',exitCode:result.status,evidenceLevel:system.evidenceLevel,adapterCount:system.adapters.length,writeEnabled:system.security.writeEnabled});
});
test('Acadia marker removal fails actual unchanged guard in reviewer-owned fixture',()=>{
 const parent=path.join(directory,'acadia-fixtures');fs.mkdirSync(parent,{recursive:true});const fixture=fs.mkdtempSync(path.join(parent,'review-'));
 try{
   const fabric=path.join(fixture,'integration-fabric');fs.cpSync(source,fabric,{recursive:true});const target=path.join(fabric,relative),catalog=read(target);catalog.systems.find(s=>s.id==='acadia-performance-platform').researchStatus='vendor-capability-verified';fs.writeFileSync(target,JSON.stringify(catalog));
   const result=guard(fabric);assert.equal(result.status,1,result.stderr||result.error?.message);assert.match(result.stderr,/A protocol-less system must explicitly declare the external interface unresolved: acadia-performance-platform/);
   observation.push({id:'ACADIA-NEGATIVE',exitCode:result.status,guardRejectsInventedPromotion:true});
 }finally{
   const absolute=path.resolve(fixture);assert.equal(path.dirname(absolute),path.resolve(parent));assert.ok(path.basename(absolute).startsWith('review-'));fs.rmSync(absolute,{recursive:true,force:false});
 }
});
