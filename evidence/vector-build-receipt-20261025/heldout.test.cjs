'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root='/workspace/scratch/cd4e2bcb0821/build-failure/source';
const helper=path.join(root,'scripts/staffology-test-receipt.cjs'),{receipt}=require(helper);
test('maximal numeric bounds remain finite and bounded with CRLF and rejected arbitrary fields',()=>{
 const line='  error: canonical server did not become healthy: phase=unhealthy-response; attempts=999999999999; elapsedMs=999999999999; lastHealthStatus=999999999999; lastProbeError=ETIMEDOUT; output=COOKIE_SECRET\r\n';
 const tap='not ok 999999999 - NAME_SECRET\r\n'.repeat(200)+line.repeat(200)+'# tests 999999999\r\n# pass 999999999\r\n# fail 999999999\r\n# cancelled 999999999\r\n# skipped 999999999\r\n';
 const r=receipt(tap,255),json=JSON.stringify(r);assert.equal(r.failedTestNumbers.length,32);assert.equal(r.startup.length,8);assert.ok(json.length<4096);assert.doesNotMatch(json,/SECRET|NaN|Infinity/);assert.equal(r.exitStatus,255);assert.equal(r.bytes,Buffer.byteLength(tap));
});
test('a forged transport code, URL, control text and nonmatching counters never replay',()=>{
 const tap='not ok 1 - token=SECRET\nerror: canonical server did not become healthy: lastProbeError=SECRET_URL; phase=SECRET_PHASE; attempts=1e9; elapsedMs=-1; lastHealthStatus=200SECRET; output=SECRET\n# tests 1SECRET\n';
 const r=receipt(tap,1);assert.deepEqual(r.totals,{});assert.deepEqual(r.startup,[{}]);assert.doesNotMatch(JSON.stringify(r),/SECRET/);
});
test('actual Docker subshell retains process failure, prints marker and unchanged TAP when receipt process exits nonzero',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-independent-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const fakeNode=path.join(dir,'fake-node');fs.writeFileSync(fakeNode,'#!/bin/sh\nexit 42\n',{mode:0o700});
 const input=path.join(dir,'tap'),tap='not ok 1 - SYNTHETIC\n# tests 1\n# fail 1\n';fs.writeFileSync(input,tap);
 for(const originalStatus of [0,1,2,137,255]){
  const run=spawnSync('/bin/sh',['-c','set +e; status="$1"; printf "VECTOR_STAFFOLOGY_EXIT status=%s\\n" "$status" >&2; "$2" "$3" "$4" "$status"; cat "$4"; exit "$status"','sh',String(originalStatus),fakeNode,helper,input],{encoding:'utf8'});
  assert.equal(run.status,originalStatus);assert.equal(run.stdout,tap);assert.equal(run.stderr,'VECTOR_STAFFOLOGY_EXIT status='+originalStatus+'\n');assert.equal(fs.readFileSync(input,'utf8'),tap);
 }
});
test('CLI malformed status and missing input disclose only fixed unavailable marker',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-cli-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const f=path.join(dir,'SECRET.tap');fs.writeFileSync(f,'SECRET');
 for(const [file,status] of [[f,'999'],[f,'$(SECRET)'],[path.join(dir,'SECRET-missing'),'1']]){
  const r=spawnSync(process.execPath,[helper,file,status],{encoding:'utf8',env:{}});assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr,'VECTOR_STAFFOLOGY_RECEIPT_UNAVAILABLE\n');
 }
});
