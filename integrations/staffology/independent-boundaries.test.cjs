'use strict';
// Synthetic regressions continued from the preserved independent review.
// Updated by the repair author; separate read-only review is recorded in the evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require(process.env.REVIEW_ADAPTER || './staffology-adapter.cjs');
globalThis.fetch = async () => { throw Error('NETWORK_FORBIDDEN'); };
const binding = {tenant:'synthetic-tenant',implementationRunId:'synthetic-run',candidateSha:'b'.repeat(40),deploymentId:'synthetic-deploy',configurationId:'synthetic-config',employerId:'synthetic-employer'};
const input = {...binding,batchId:'approved-batch',sourceRevision:'approved-rev',employeeId:'synthetic-employee',entryId:'synthetic-entry',payrollCode:'TEST01',effectiveDate:'2026-09-30',taxYear:'Year2026',payPeriod:'Monthly',periodNumber:6,ordinal:1,version:0,mode:'hourly-basic-replacement',rounding:'exact-cent',lines:[{code:'BASIC',hours:'1.25',rate:'10'}]};
const run = {taxYear:'Year2026',payPeriod:'Monthly',period:6,ordinal:1,version:0,state:'Open',startDate:'2026-09-01',endDate:'2026-09-30'};
function entry(amount=12.5) { return {id:'synthetic-entry',employee:{id:'synthetic-employee'},employmentDetails:{payrollCode:'TEST01'},taxYear:'Year2026',payPeriod:'Monthly',period:6,ordinal:1,payRunVersion:0,state:'Open',payOptions:{basis:'Hourly',payCode:'BASIC',payAmount:10,payAmountMultiplier:1.25,regularPayLines:[{code:'BASIC',rate:10,multiplier:1.25,value:12.5}],lines:[]},totals:{basicPay:amount},totalsYtd:{tax:10}}; }
function baselineEntry(){const e=entry(100);e.payOptions.payAmountMultiplier=10;e.payOptions.regularPayLines[0].multiplier=10;e.payOptions.regularPayLines[0].value=100;return e;}
const config = {apiKey:'FAKE-INDEPENDENT-ONLY',baseUrl:'https://api.staffology.co.uk',timeoutMs:100};
const response = x => new Response(x===undefined?null:JSON.stringify(x),{status:200});
function harness(options={}) {
 const rows=new Map(),evidence=[]; let current=true,posts=0,authorizations=0,dispatchGuards=0; let lateDispatch;
 const store={get:async id=>structuredClone(rows.get(id)),begin:async row=>{if(rows.has(row.deliveryId))return {acquired:false};rows.set(row.deliveryId,structuredClone({...row,token:'private-token'}));return {acquired:true,token:'private-token'};},assertOwned:async({deliveryId,digest,bindingDigest,dispatch,permit,request})=>{if(dispatch){dispatchGuards++;if(options.loseOwnershipAtDispatch)current=false;if(options.deferDispatch){lateDispatch=dispatch;return true;}if(current){const row=rows.get(deliveryId);if(row.dispatchAttempt)return false;row.dispatchAttempt=structuredClone({deliveryId,digest,bindingDigest,baselineSha256:permit.baselineSha256,baselineRunSha256:permit.baselineRunSha256,request});dispatch();}}return current;},recordEvidence:async(id,e)=>{if(!current)throw Error('STALE');evidence.push(structuredClone(e));if(e.phase==='baseline'&&!options.dropBaseline)rows.get(id).baseline=structuredClone(e);return true;},acknowledge:async(id,receipt)=>{if(!current)throw Error('STALE');rows.set(id,{...rows.get(id),status:'acknowledged',receipt});},markUncertain:async(id,details)=>{if(!current)throw Error('STALE');rows.set(id,{...rows.get(id),status:'uncertain',details});}};
 const client=async(url,init)=>{if(init.method==='POST'){posts++;return response();}const path=new URL(url).pathname;if(path==='/open')return response([run]);if(path.endsWith('/synthetic-entry'))return response(posts?(options.after?.()||entry()):(options.before?.()||baselineEntry()));return response(posts&&options.afterRun?options.afterRun():run);};
 const authorizeWrite=async()=>{authorizations++;if(options.loseOwnershipDuringAuthorization&&authorizations===2){await Promise.resolve();current=false;}return options.denyAuthority!==true;};
 return {coordinator:S.createDeliveryCoordinator({binding,config,store,client,authorizeWrite}),rows,evidence,get posts(){return posts;},get dispatchGuards(){return dispatchGuards;},lateDispatch:()=>lateDispatch?.()};
}
test('I01 independent 1250 cents expectation rejects returned 125000 cents',async()=>{
 const expectedCents=125*1000/100;assert.equal(expectedCents,1250);
 const h=harness({after:()=>entry(1250)});const r=await h.coordinator.deliver(input);
 assert.equal(r.reconciliationRequired,true);assert.equal(r.reconciliation.code,'STAFFOLOGY_FINANCIAL_MISMATCH');assert.notEqual([...h.rows.values()][0].status,'acknowledged');
 assert.equal(h.evidence.find(x=>x.phase==='readback').entry.snapshot.totals.basicPay,1250);
});
test('I02 losing owner during awaited final authorization must not dispatch',async()=>{
 const h=harness({loseOwnershipDuringAuthorization:true});await h.coordinator.deliver(input).catch(()=>{});assert.equal(h.posts,0,'stale claimant submitted after ownership changed inside final authorization');
});
test('I03 existing additional payroll lines must block this basic-only replacement',async()=>{
 const h=harness({before:()=>{const e=baselineEntry();e.payOptions.regularPayLines.push({code:'BONUS',rate:80,multiplier:1,value:80});return e;}});
 await h.coordinator.deliver(input).catch(()=>{});assert.equal(h.posts,0,'replacement dispatched despite an existing non-basic payroll line');
});
test('I04 unexplained non-basic financial delta must remain unresolved',async()=>{
 const h=harness({after:()=>{const e=entry();e.totalsYtd.tax=999;return e;}});const r=await h.coordinator.deliver(input);
 assert.equal(r.reconciliationRequired,true,'basic-pay acknowledgement accepted unclassified financial change');
});
test('I05 oversized streaming response must stop reading at the bound',async()=>{
 const chunk=new Uint8Array(1024*1024).fill(32);let pulled=0;
 const body=new ReadableStream({pull(c){pulled++;if(pulled<=12)c.enqueue(chunk);else c.close();}});
 await S.request(async()=>new Response(body,{status:200}),config,'/employers').catch(()=>{});
 assert.ok(pulled<=6,`read ${pulled} chunks before rejecting a 4MiB-limited response`);
});
test('I06 a text-only response is refused without invoking unbounded text()',async()=>{
 let reads=0;
 await assert.rejects(S.request(async()=>({status:200,text:async()=>{reads++;return '{}';}}),config,'/employers'));
 assert.equal(reads,0);
});
test('I07 oversized response cancels its reader and aborts the request',async()=>{
 let cancelled=false,signal,chunks=0;
 const body=new ReadableStream({pull(c){if(++chunks<=12)c.enqueue(new Uint8Array(1024*1024));else c.close();},cancel(){cancelled=true;}});
 await assert.rejects(S.request(async(u,o)=>{signal=o.signal;return new Response(body);},config,'/employers'),{code:'STAFFOLOGY_RESPONSE_INVALID'});
 assert.equal(cancelled,true);assert.equal(signal.aborted,true);
});
test('I08 stalled body deadline cancels the pending read',async()=>{
 let cancelled=false;
 const body=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}});
 await assert.rejects(S.request(async()=>new Response(body),{...config,timeoutMs:10},'/employers'),{code:'STAFFOLOGY_TRANSPORT_ERROR'});
 assert.equal(cancelled,true);
});
test('I09 UTF-8 split across chunks is decoded intact',async()=>{
 const bytes=new TextEncoder().encode('{"name":"£"}');let i=0;
 const body=new ReadableStream({pull(c){if(i===bytes.length)c.close();else {c.enqueue(bytes.slice(i,i+1));i++;}}});
 assert.deepEqual((await S.request(async()=>new Response(body),config,'/employers')).body,{name:'£'});
});

test('I10 successful basic-only transition requires the guarded dispatch boundary',async()=>{
 const h=harness();const r=await h.coordinator.deliver(input);
 assert.equal(h.posts,1);assert.equal(h.dispatchGuards,1);assert.equal(r.receipt.verification,'basic-pay-verified');assert.equal(r.receipt.fullPayrollVerified,false);
});
test('I11 ownership revoked at persistence dispatch guard refuses submission',async()=>{
 const h=harness({loseOwnershipAtDispatch:true});await assert.rejects(h.coordinator.deliver(input));assert.equal(h.posts,0);
});
test('I12 ignored or delayed guarded dispatch cannot become a late provider write',async()=>{
 const h=harness({deferDispatch:true});await assert.rejects(h.coordinator.deliver(input));assert.equal(h.posts,0);
 assert.throws(()=>h.lateDispatch());assert.equal(h.posts,0);
});

test('I13 malformed, duplicate or additional baseline lines refuse replacement',async()=>{
 for(const edit of [e=>delete e.payOptions.regularPayLines,e=>e.payOptions.regularPayLines={},e=>e.payOptions.regularPayLines=[],e=>e.payOptions.regularPayLines.push({...e.payOptions.regularPayLines[0]}),e=>e.payOptions.lines=[{code:'BONUS',value:5}],e=>e.payOptions.regularPayLines[0].code='OTHER']){
  const h=harness({before:()=>{const e=baselineEntry();edit(e);return e;}});await assert.rejects(h.coordinator.deliver(input));assert.equal(h.posts,0);assert.equal(h.evidence[0].phase,'baseline');
 }
});

test('I14 every unapproved container, unknown field and type change remains held',async()=>{
 const edits=[e=>e.totalsYtd.tax=999,e=>e.totalsYtd.tax='10',e=>e.pensionSummary={amount:4},e=>e.nationalInsuranceCalculation={amount:2},e=>e['totals.basicPay']=999,e=>e.payOptions.basicPay=999,e=>e.payOptions.regularPayLines[0].metadata={unclassified:1},e=>delete e.totalsYtd];
 for(const edit of edits){const h=harness({after:()=>{const e=entry();edit(e);return e;}});const r=await h.coordinator.deliver(input);assert.equal(h.posts,1);assert.equal(r.reconciliationRequired,true);assert.notEqual([...h.rows.values()][0].status,'acknowledged');}
});
test('I15 changed run-level financial data remains held with complete comparison evidence',async()=>{
 const h=harness({afterRun:()=>({...run,totals:{tax:999}})});const r=await h.coordinator.deliver(input);
 assert.equal(r.reconciliationRequired,true);const comparison=h.evidence.find(e=>e.phase==='comparison');assert.ok(comparison);assert.ok(comparison.comparison.changes.some(c=>c.path==='/run/totals'&&c.classification==='unclassified'));assert.equal(h.evidence.find(e=>e.phase==='readback').run.snapshot.totals.tax,999);
});
test('I16 missing persisted baseline refuses dispatch despite recordEvidence returning true',async()=>{
 const h=harness({dropBaseline:true});await assert.rejects(h.coordinator.deliver(input));assert.equal(h.posts,0);
});
test('I17 basic-only changes are classified and bound to preserved baseline/readback hashes',async()=>{
 const h=harness();const r=await h.coordinator.deliver(input);assert.equal(h.posts,1);assert.equal(r.reconciliationRequired,false);
 const c=h.evidence.find(e=>e.phase==='comparison').comparison;
 assert.equal(c.matchesApprovedTransition,true);assert.deepEqual(c.changes.map(x=>[x.path,x.before.value,x.after.value,x.classification]),[['/entry/payOptions/payAmountMultiplier',10,1.25,'approved-basic-input'],['/entry/payOptions/regularPayLines/0/multiplier',10,1.25,'approved-basic-input'],['/entry/payOptions/regularPayLines/0/value',100,12.5,'approved-basic-input'],['/entry/totals/basicPay',100,12.5,'approved-basic-input']]);
 assert.equal(c.baseline.entrySha256,h.evidence.find(e=>e.phase==='baseline').entry.sha256);assert.equal(c.readback.entrySha256,h.evidence.find(e=>e.phase==='readback').entry.sha256);
});

test('I18 accepted unresolved 404 cancels an unused response body',async()=>{
 let cancelled=false;const body=new ReadableStream({pull(){},cancel(){cancelled=true;}});
 const r=await S.request(async()=>new Response(body,{status:404}),config,'/employers',{acceptedStatuses:[404]});assert.equal(r.status,404);assert.equal(cancelled,true);
});
test('I19 a late client response after deadline is cancelled without reading',async()=>{
 let resolveClient,cancelled=false,pulled=0;
 const pending=S.request(async()=>new Promise(r=>{resolveClient=r;}),{...config,timeoutMs:10},'/employers');await assert.rejects(pending,{code:'STAFFOLOGY_TRANSPORT_ERROR'});
 const body=new ReadableStream({pull(){pulled++;},cancel(){cancelled=true;}},{highWaterMark:0});resolveClient(new Response(body));await new Promise(r=>setImmediate(r));assert.equal(cancelled,true);assert.equal(pulled,0);
});

test('I20 denied pre-dispatch authority cannot later reconcile already-matching pay',async()=>{
 const h=harness({denyAuthority:true,before:()=>entry()});await assert.rejects(h.coordinator.deliver(input));assert.equal(h.posts,0);
 const row=[...h.rows.values()][0];const r=await h.coordinator.reconcile({deliveryId:row.deliveryId,token:row.token});assert.equal(r.status,'unresolved');assert.notEqual([...h.rows.values()][0].status,'acknowledged');
});
test('I21 wrong amount retains complete comparison, classified as unapproved',async()=>{
 const h=harness({after:()=>entry(1250)});const r=await h.coordinator.deliver(input);assert.equal(r.reconciliationRequired,true);
 const c=h.evidence.find(e=>e.phase==='comparison').comparison;
 assert.equal(c.matchesApprovedTransition,false);assert.ok(c.changes.some(x=>x.path==='/entry/totals/basicPay'&&x.before.value===100&&x.after.value===1250&&x.classification==='unclassified'));
});

test('I22 missing, malformed or inconsistent baseline line amounts refuse before POST',async()=>{
 for(const edit of [e=>delete e.payOptions.regularPayLines[0].rate,e=>e.payOptions.regularPayLines[0].value='not-a-number',e=>e.payOptions.regularPayLines[0].multiplier=999,e=>e.totals.basicPay=13]){
  const h=harness({before:()=>{const e=entry();edit(e);return e;}});await assert.rejects(h.coordinator.deliver(input));assert.equal(h.posts,0);
 }
});
test('I23 immediate empty chunks cannot starve the deadline',async()=>{
 let count=0,cancelled=false;
 const body=new ReadableStream({pull(c){if(++count<=50000)c.enqueue(new Uint8Array(0));else {c.enqueue(new TextEncoder().encode('{}'));c.close();}},cancel(){cancelled=true;}});
 await assert.rejects(S.request(async()=>new Response(body),{...config,timeoutMs:1},'/employers'),{code:'STAFFOLOGY_TRANSPORT_ERROR'});assert.ok(count<50000);assert.equal(cancelled,true);
});
