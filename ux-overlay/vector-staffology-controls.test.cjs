'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');

test('Staffology customer controls use only authenticated canonical routes and server-held scope', () => {
  for (const route of ['/api/integrations','/employees/acquire-stage','/payroll/approve-deliver','/payroll/readback','/payroll/recover','/api/integrations/apply']) assert.ok(source.includes(route), route);
  assert.match(source, /credentials:'same-origin'/);
  assert.match(source, /operation\.cohort\.employeeIds/);
  assert.match(source, /connectorId:operation\.connector\.id/);
  assert.match(source, /approval:operation\.payroll\.approval/);
  assert.match(source, /reviewed:true/);
  assert.doesNotMatch(source, /STAFFOLOGY_API_KEY|apiKey|Authorization.*Staffology/i);
  assert.doesNotMatch(source, /one JSON object per line|data-vector-staffology-mappings|<textarea/i);
});

test('Staffology controls expose dormant, authority, progress and double-submit boundaries', () => {
  assert.match(source, /Operations are dormant until an exact server-held employer and employee cohort are configured/);
  assert.match(source, /current account is not the exact authorised operator/);
  assert.match(source, /if\(!staffologyCurrent\(panel\)\|\|panel\.busy\)return/);
  assert.match(source, /button\.disabled=!!panel\.busy/);
  assert.match(source, /Every write is current-account checked, exact-scope checked and audit recorded/);
  for(const field of ['managerId','site','job','contractType'])assert.ok(source.includes(`select('${field}'`));assert.match(source,/data-vector-staffology-field=\"weeklyHours\"/);
  assert.match(source, /Source employee and payroll identities remain provider-held and cannot be edited here/);
  assert.match(source, /Records held for review/);
  assert.match(source, /Loading Staffology status/);
  assert.match(source, /data-vector-staffology-restage/);
  assert.match(source, /data-vector-staffology-reviewed/);
  assert.match(source, /\/api\/bootstrap/);
  assert.doesNotMatch(source, /setInterval\([^)]*Staffology|setTimeout\([^)]*Staffology/i);
});

test('mapping controls derive ordinary choices from authenticated bootstrap without inventing payroll values',()=>{const start=source.indexOf('function staffologyOptions'),end=source.indexOf('function renderStaffologyPanel',start),sandbox={esc:value=>String(value??'').replace(/[&<>"']/g,''),api:null};assert.ok(start>0&&end>start);vm.runInNewContext(source.slice(start,end)+';api={staffologyChoices,staffologyMappingRows};',sandbox);const panel={bootstrap:{state:{org:[{id:'manager-1',name:'Reviewed Manager'}],staff:[{site:'Reviewed Site',job:'Reviewed Job'}]}},mappingValues:{}},operation={mappingOptions:{managers:[{id:'manager-1',name:'Reviewed Manager'}],sites:['Reviewed Site'],jobs:['Reviewed Job'],contractTypes:['full_time'],weeklyHours:['37.5']}},html=sandbox.api.staffologyMappingRows(panel,{employeeIds:['provider-employee-1']},operation);assert.match(html,/Reviewed Manager/);assert.match(html,/Reviewed Site/);assert.match(html,/Reviewed Job/);assert.match(html,/full_time/);assert.match(html,/provider-employee-1/);assert.match(html,/data-vector-staffology-field="weeklyHours"/);assert.match(html,/Select weekly hours/);assert.doesNotMatch(html,/payrollId|hourlyRate|10\.00/);});

test('mixed lifecycle response exposes held reasons while eligible batch remains applicable',()=>{assert.match(source,/lifecycleHold\?\.batchId/);assert.match(source,/Apply eligible staged people batch/);assert.match(source,/held lifecycle records will not be applied/);assert.doesNotMatch(source,/panel\.staged&&!panel\.heldReasons/);});

test('acquisition retry retains one reviewed-intent key and recovery needs no browser digest',()=>{assert.match(source,/panel\.acquireIntent\?\.fingerprint!==fingerprint/);assert.match(source,/idempotencyKey:panel\.acquireIntent\.idempotencyKey/);assert.doesNotMatch(source,/data-vector-staffology-digest/);assert.match(source,/\{approval:operation\.payroll\.approval,deliveryId\}/);});

test('recover action renders only acknowledged outcomes as success and explains held outcomes',async()=>{const start=source.indexOf('function staffologyRecoveryOutcome'),end=source.indexOf('function syncStaffologyPanel',start),messages=[],sandbox={STAFFOLOGY_PREFIX:'/api/integrations/staffology',staffologyCurrent:()=>true,renderStaffologyPanel:()=>{},staffologyMessage:(_panel,message,tone)=>messages.push({message,tone}),staffologyRequest:async()=>sandbox.result,console};assert.ok(start>0&&end>start);vm.runInNewContext(source.slice(start,end)+';api=staffologyAction;',sandbox);for(const [result,tone,reason] of [[{status:'reconciled'},'success','reconciled'],[{status:'acknowledged'},'success','acknowledged'],[{status:'unresolved',code:'STAFFOLOGY_READBACK_UNRESOLVED'},'error','not yet conclusive'],[{status:'retryable',code:'STAFFOLOGY_BASELINE_CHANGED'},'error','baseline changed'],[{status:'rejected',code:'STAFFOLOGY_AUTH_REJECTED'},'error','will not be resent']]){sandbox.result=result;messages.length=0;const panel={snapshot:{staffology:{operation:{activationAvailable:true,payroll:{approval:'synthetic'}}}},card:{querySelector:()=>({value:'delivery-001'})},busy:'',message:''};await sandbox.api(panel,'recover');assert.equal(messages.at(-1).tone,tone);assert.match(messages.at(-1).message,new RegExp(reason,'i'));}});


test('reviewed missing-provider email renders without inventing identity and preserves only the reviewed value',()=>{const start=source.indexOf('function staffologyOptions'),end=source.indexOf('function renderStaffologyPanel',start),sandbox={esc:value=>String(value??'').replace(/[&<>"']/g,''),api:null};vm.runInNewContext(source.slice(start,end)+';api=staffologyMappingRows;',sandbox);const operation={mappingOptions:{managers:[],sites:[],jobs:[],contractTypes:[],weeklyHours:[]}},panel={bootstrap:{state:{}},mappingValues:{}},cohort={employeeIds:['provider-employee-1']};const empty=sandbox.api(panel,cohort,operation);assert.match(empty,/type="email" maxlength="254" value=""/);assert.match(empty,/data-vector-staffology-field="email"/);panel.mappingValues['provider-employee-1']={email:'reviewed-test@example.invalid'};const reviewed=sandbox.api(panel,cohort,operation);assert.match(reviewed,/value="reviewed-test@example.invalid"/);assert.doesNotMatch(empty,/@|identityVerified|createCredential/);});

test('acquisition first persists review and sends only its opaque ID to the import consumer',async()=>{const calls=[],mapping={managerId:'manager',site:'Exact Plant',job:'Owned Job',contractType:'Owned Contract',weeklyHours:'38'},row={dataset:{vectorStaffologyMapping:'source-one'},querySelectorAll:()=>Object.entries(mapping).map(([key,value])=>({dataset:{vectorStaffologyField:key},value}))},panel={snapshot:{staffology:{operation:{activationAvailable:true,cohort:{employeeIds:['source-one']},connector:{id:'people-one'}}}},card:{querySelectorAll:()=>[row],querySelector:()=>({checked:true})},busy:'',message:''},sandbox={STAFFOLOGY_PREFIX:'/api/integrations/staffology',staffologyCurrent:()=>true,renderStaffologyPanel:()=>{},staffologyMessage:()=>{},crypto:{randomUUID:()=> 'one-reviewed-request'},staffologyRequest:async(_p,url,body)=>{calls.push({url,body:JSON.parse(JSON.stringify(body))});return url.endsWith('/preview')?{previewId:'SP-authenticated',configurationBinding:{mustNeverReturn:true}}:{id:'batch-one',held:0};}};const start=source.indexOf('function staffologyRecoveryOutcome'),end=source.indexOf('function syncStaffologyPanel',start);vm.runInNewContext(source.slice(start,end)+';api=staffologyAction;',sandbox);await sandbox.api(panel,'acquire');assert.deepEqual(calls.map(x=>x.url),['/api/integrations/staffology/employees/preview','/api/integrations/staffology/employees/acquire-stage']);assert.deepEqual(calls[1].body,{reviewed:true,previewId:'SP-authenticated'});assert.equal(calls[0].body.idempotencyKey,'one-reviewed-request');assert.equal(calls[0].body.mappings[0].site,'Exact Plant');});

test('authenticated request checks the panel again after response decoding',async()=>{let current=true;const sandbox={staffologyCurrent:()=>current,fetch:async()=>({ok:true,json:async()=>{current=false;return{previewId:'SP-stale'};}})};const start=source.indexOf('async function staffologyRequest'),end=source.indexOf('async function refreshStaffology',start);vm.runInNewContext(source.slice(start,end)+';api=staffologyRequest;',sandbox);await assert.rejects(sandbox.api({controller:{signal:{}}},'/preview',{}),/STAFFOLOGY_PANEL_STALE/);});
