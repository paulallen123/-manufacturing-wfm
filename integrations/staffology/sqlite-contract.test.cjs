'use strict';
// Offline persistence tests: real disposable SQLite files and fake provider IO.
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {openFixtureStore}=require('./test-support/sqlite-store-fixture.cjs');
const S=require('./staffology-adapter.cjs');
globalThis.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const config={apiKey:'FAKE-OFFLINE-CREDENTIAL-ONLY',baseUrl:'https://api.staffology.co.uk'};
const binding={tenant:'northstar-demo',implementationRunId:'run-001',candidateSha:'a'.repeat(40),deploymentId:'deployment-001',configurationId:'configuration-001',employerId:'employer-001'};
const input={...binding,batchId:'batch-001',sourceRevision:'1',employeeId:'employee-001',entryId:'entry-001',payrollCode:'W001',effectiveDate:'2026-09-30',taxYear:'Year2026',payPeriod:'Monthly',periodNumber:6,ordinal:1,version:0,mode:'hourly-basic-replacement',rounding:'exact-cent',lines:[{code:'BASIC',hours:'1.25',rate:'10'}]};
const run={taxYear:'Year2026',payPeriod:'Monthly',period:6,ordinal:1,version:0,state:'Open',startDate:'2026-09-01',endDate:'2026-09-30'};
const entry=amount=>({taxYear:run.taxYear,payPeriod:run.payPeriod,period:run.period,ordinal:1,payRunVersion:0,state:'Open',id:'entry-001',employee:{id:'employee-001'},employmentDetails:{payrollCode:'W001'},payOptions:{basis:'Hourly',payCode:'BASIC',payAmount:10,payAmountMultiplier:1.25,basicPay:2000,regularPayLines:[{code:'BASIC',rate:10,multiplier:1.25,value:12.5}]},totals:{basicPay:amount},totalsYtd:{basicPay:500}});
function baselineEntry(){const e=entry(100);e.payOptions.payAmountMultiplier=10;e.payOptions.regularPayLines[0].multiplier=10;e.payOptions.regularPayLines[0].value=100;return e;}
const response=(status,body)=>new Response(body===undefined?null:JSON.stringify(body),{status});
function provider({unavailable=false,wrong=false}={}){let posts=0;const client=async(url,init)=>{const p=new URL(url).pathname;if(init.method==='POST'){posts++;if(unavailable)throw Error('synthetic lost response');return response(200);}if(p==='/open')return response(200,[run]);if(p.endsWith('/entry-001'))return posts&&unavailable?response(404):response(200,posts?entry(wrong?1250:12.5):baselineEntry());return response(200,run);};return {client,get posts(){return posts;}};}
function harness(t){const dir=mkdtempSync(join(tmpdir(),'staffology-fixture-'));const stores=[];const open=()=>{const store=openFixtureStore(join(dir,'fixture.sqlite'));stores.push(store);return store;};t.after(()=>{for(const s of stores){try{s.close();}catch{}}rmSync(dir,{recursive:true,force:true});});return {open};}
const coordinator=(store,client)=>S.createDeliveryCoordinator({store,client,config,binding,authorizeWrite:async()=>true});
test('S01 two independent SQLite connections permit exactly one outbound submission',async t=>{const h=harness(t),a=h.open(),b=h.open(),p=provider();const results=await Promise.all([coordinator(a,p.client).deliver(input),coordinator(b,p.client).deliver(input)]);assert.equal(p.posts,1);assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal((await b.get(results[0].deliveryId)).status,'acknowledged');});
test('S02 acknowledgement and evidence survive closing and reopening SQLite without a resend',async t=>{const h=harness(t),a=h.open(),p=provider();const first=await coordinator(a,p.client).deliver(input);const before=a.evidence();a.close();const b=h.open();const replay=await coordinator(b,async()=>assert.fail('replay must not call provider')).deliver(input);assert.equal(replay.replayed,true);assert.equal(replay.receipt.verification,'basic-pay-verified');assert.equal(S.sha256(replay.receipt),S.sha256(first.receipt));assert.deepEqual(b.evidence(),before);assert.equal(p.posts,1);});
test('S03 uncertain provider outcome stays held after SQLite reopen',async t=>{const h=harness(t),a=h.open(),p=provider({unavailable:true});const first=await coordinator(a,p.client).deliver(input);assert.equal(first.reconciliationRequired,true);a.close();const b=h.open();const replay=await coordinator(b,async()=>assert.fail('held operation must not resend')).deliver(input);assert.equal(replay.status,'uncertain');assert.equal(replay.reconciliationRequired,true);assert.equal(p.posts,1);});
test('S04 mismatched financial details persist across reopen and cannot be acknowledged',async t=>{const h=harness(t),a=h.open(),p=provider({wrong:true});const first=await coordinator(a,p.client).deliver(input);assert.equal(first.reconciliationRequired,true);a.close();const b=h.open();assert.equal((await b.get(first.deliveryId)).status,'uncertain');const snapshots=b.evidence();assert.equal(snapshots.find(e=>e.phase==='baseline').entry.snapshot.totals.basicPay,100);assert.equal(snapshots.find(e=>e.phase==='readback').entry.snapshot.totals.basicPay,1250);});
test('S05 wrong owner token cannot change SQLite evidence or receipt',async t=>{const h=harness(t),a=h.open(),p=provider();const first=await coordinator(a,p.client).deliver(input);const before=await a.get(first.deliveryId);await assert.rejects(a.acknowledge(first.deliveryId,{forged:true},'wrong-token'));await assert.rejects(a.recordEvidence(first.deliveryId,{forged:true},'wrong-token'));assert.deepEqual(await a.get(first.deliveryId),before);});
test('S06 transaction failure cannot produce a successful receipt or a resend',async t=>{const h=harness(t),a=h.open(),p=provider();a.db.exec("CREATE TRIGGER fixture_stop_ack BEFORE UPDATE ON fixture_deliveries WHEN NEW.status='acknowledged' BEGIN SELECT RAISE(ABORT,'FIXTURE_RECEIPT_FAILURE'); END");const first=await coordinator(a,p.client).deliver(input);assert.equal(first.reconciliationRequired,true);assert.equal((await a.get(first.deliveryId)).status,'uncertain');assert.equal((await a.get(first.deliveryId)).receipt,null);a.close();const b=h.open();await coordinator(b,async()=>assert.fail('failure must remain held')).deliver(input);assert.equal(p.posts,1);});

function matchingReadback(){return async(url,init)=>{assert.equal(init.method,'GET','recovery must never write');const p=new URL(url).pathname;return response(200,p==='/open'?[run]:p.endsWith('/entry-001')?entry(12.5):run);};}
test('S07 fresh recovery after reopen uses the original persisted baseline, not a new baseline',async t=>{
 const h=harness(t),a=h.open(),p=provider({unavailable:true});const first=await coordinator(a,p.client).deliver(input);const original=a.evidence().find(e=>e.phase==='baseline');a.close();
 const b=h.open(),row=await b.get(first.deliveryId);const r=await coordinator(b,matchingReadback()).reconcile({deliveryId:first.deliveryId,token:row.token});
 assert.equal(r.status,'reconciled');assert.equal(r.receipt.comparison.baseline.entrySha256,original.entry.sha256);assert.equal(b.evidence().filter(e=>e.phase==='baseline').length,1);assert.equal(p.posts,1);
});
test('S08 missing baseline after restart cannot acknowledge a matching readback',async t=>{
 const h=harness(t),a=h.open(),p=provider({unavailable:true});const first=await coordinator(a,p.client).deliver(input);a.db.exec("DELETE FROM fixture_evidence WHERE json_extract(evidence,'$.phase')='baseline'");a.close();
 const b=h.open(),row=await b.get(first.deliveryId);const r=await coordinator(b,matchingReadback()).reconcile({deliveryId:first.deliveryId,token:row.token});assert.equal(r.status,'unresolved');assert.equal(r.code,'STAFFOLOGY_BASELINE_NOT_PERSISTED');assert.equal((await b.get(first.deliveryId)).receipt,null);
});
test('S09 comparison persistence failure cannot acknowledge or resend',async t=>{
 const h=harness(t),a=h.open(),p=provider();a.db.exec("CREATE TRIGGER fixture_stop_comparison BEFORE INSERT ON fixture_evidence WHEN json_extract(NEW.evidence,'$.phase')='comparison' BEGIN SELECT RAISE(ABORT,'FIXTURE_COMPARISON_FAILURE'); END");
 const first=await coordinator(a,p.client).deliver(input);assert.equal(first.reconciliationRequired,true);assert.equal((await a.get(first.deliveryId)).receipt,null);await coordinator(a,async()=>assert.fail('must not resend')).deliver(input);assert.equal(p.posts,1);
});

test('S10 failed dispatch reservation transaction prevents the provider write',async t=>{
 const h=harness(t),a=h.open(),p=provider();a.db.exec("CREATE TRIGGER fixture_stop_dispatch BEFORE INSERT ON fixture_evidence WHEN json_extract(NEW.evidence,'$.phase')='dispatchAttempt' BEGIN SELECT RAISE(ABORT,'FIXTURE_DISPATCH_FAILURE'); END");
 await assert.rejects(coordinator(a,p.client).deliver(input));assert.equal(p.posts,0);assert.equal(a.evidence().filter(e=>e.phase==='dispatchAttempt').length,0);
});
