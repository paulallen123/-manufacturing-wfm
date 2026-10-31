'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createHash}=require('node:crypto');
const path=require('node:path');
// Uses colocated production source by default. The optional path is for fail-first
// verification against a preserved baseline; assertions below test public output.
const file=process.env.V042_WORKFLOW||path.join(__dirname,'vector-workflows.js');
const expected=process.env.V042_WORKFLOW_SHA;
const source=fs.readFileSync(file,'utf8');
if(expected){assert.match(expected,/^[a-f0-9]{64}$/);assert.equal(createHash('sha256').update(source).digest('hex'),expected);}

// Mock response objects include values that real JSON cannot represent, such
// as NaN and Infinity. These are presentation adversaries, not backend claims.
test('synthetic leave presentation accepts finite numbers and rejects absent or malformed values',async t=>{
 const actor={tenant:'fictional-fixture',email:'synthetic-actor',personId:'e0',role:'employee',permissions:[]};
 let personal={leave:{},shifts:[]};const calls=[];
 const context=vm.createContext({
  console,URL,setTimeout,clearTimeout,OFFLINE:false,F:{ready:true,actor},ui:{page:'leave'},data:{},
  payrollActor:()=>actor,PR:{has:()=>false},request:async url=>{calls.push(url);if(url==='/api/bootstrap')return {state:{version:1,requests:[]}};if(url==='/api/personal')return personal;throw Error('Unexpected mock endpoint '+url);},
  command:async()=>{throw Error('Unexpected command');},reload:async()=>{},modal(){},modalActions:()=>'',toast(){},shell:html=>html,render:async()=>{},showLogin(){},fmt:value=>String(value),
  document:{addEventListener(){},removeEventListener(){},querySelector(){return null;},getElementById(){return {innerHTML:''};}}
 });
 vm.runInContext(source,context,{filename:'vector-workflows-under-test.js'});const workflow=context.VectorWorkflow;
 async function display(leave){personal={leave,shifts:[]};assert.equal(await workflow.leaveRefresh(),true);return workflow.leavePage();}
 function tiles(html){return [...html.matchAll(/<div><b>(.*?)<\/b><small>(?:Available after pending requests|Awaiting a manager decision)<\/small><\/div>/g)].map(x=>x[1]);}
 await t.test('numeric zero and positive/negative finite values preserve hour formatting',async()=>{
  for(const [a,p,want] of [[0,0,['0.0 hours','0.0 hours']],[90,-30,['1.5 hours','-0.5 hours']],[150,30,['2.5 hours','0.5 hours']]])assert.deepEqual(tiles(await display({availableMinutes:a,pendingMinutes:p})),want);
 });
 await t.test('null and independently missing fields never become zero',async()=>{
  assert.deepEqual(tiles(await display({availableMinutes:null,pendingMinutes:0})),['Not verified','0.0 hours']);
  assert.deepEqual(tiles(await display({availableMinutes:60})),['1.0 hours','Not verified']);
  assert.deepEqual(tiles(await display(null)),['Not verified','Not verified']);
 });
 await t.test('nonfinite, string, boolean and object values are not treated as minutes',async()=>{
  for(const [a,p] of [[NaN,Infinity],[-Infinity,'60'],[true,false],[{},[]]])assert.deepEqual(tiles(await display({availableMinutes:a,pendingMinutes:p})),['Not verified','Not verified']);
 });
 await t.test('needs-review source is escaped as text and absent for empty or nonprimitive source',async()=>{
  const hostile='<img src=x onerror="x"> & <script>test</script>';
  const html=await display({availableMinutes:null,pendingMinutes:null,yearStatus:'needs_review',source:hostile});
  assert.ok(html.includes('<p class="vw-warning" role="status">&lt;img src=x onerror=&quot;x&quot;&gt; &amp; &lt;script&gt;test&lt;/script&gt;</p>'));
  assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));
  for(const item of [{yearStatus:'needs_review',source:'   '},{yearStatus:'needs_review',source:{x:'not a string'}},{yearStatus:'current',source:'should-not-appear'}]){
   const next=await display(item);assert.ok(!next.includes('should-not-appear'));assert.ok(!next.includes('<p class="vw-warning" role="status">'));
  }
 });
 await t.test('needs-review source is a warning status, not a saved-result receipt',async()=>{
  const note='Review the fictional opening before using the balance.';
  const html=await display({availableMinutes:null,pendingMinutes:null,yearStatus:'needs_review',source:note});
  assert.ok(html.includes('<p class="vw-warning" role="status">'+note+'</p>'));
  assert.ok(!html.includes('<p class="vw-receipt" role="status">'+note+'</p>'));
 });
 await t.test('refresh from unknown to numeric removes prior review text',async()=>{
  assert.ok((await display({yearStatus:'needs_review',source:'Prior fictional review note',availableMinutes:null,pendingMinutes:null})).includes('Prior fictional review note'));
  const html=await display({availableMinutes:0,pendingMinutes:0});assert.ok(!html.includes('Prior fictional review note'));assert.deepEqual(tiles(html),['0.0 hours','0.0 hours']);
 });
 await t.test('programmatic request with missing numeric balance is held before a mock POST',async()=>{
  await display({availableMinutes:null,pendingMinutes:0});calls.length=0;
  await assert.rejects(workflow.leaveRequest({date:'2027-01-18',hours:1}),/Current leave balance evidence is unavailable/);
  assert.ok(!calls.includes('/api/personal/work'));
 });
 t.diagnostic('Mocked in-memory personal response only; nonfinite values are not valid JSON numbers. No real login, backend entitlement, leave submission, customer, provider or hosted proof.');
});
