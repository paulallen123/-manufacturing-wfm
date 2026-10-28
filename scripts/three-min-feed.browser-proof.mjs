// Local synthetic desktop/narrow-viewport proof (not mobile-device/Safari proof).
// Requires Playwright and a Chromium executable.
// Does not connect to a hosted tenant or to the real 3Min provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createAttendanceRuntime} from '../verification/vector-repair-20260921/attendance-runtime-harness.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const root=path.resolve(import.meta.dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-3min-browser-'));
const runtime=path.join(dir,'runtime');
const token='synthetic-browser-feed-secret-'.repeat(3);
const binding={id:'browser-people',tenant:'northstar-demo',site:'synthetic-site',source:'synthetic-source',domain:'people',environment:'sandbox',endpointSlug:'synthetic-browser-intake',secretEnv:'WFM_3MIN_BROWSER_TOKEN'};
const keys=['WFM_3MIN_FEEDS_JSON','WFM_3MIN_BROWSER_TOKEN'];
const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
process.env.WFM_3MIN_FEEDS_JSON=JSON.stringify([binding]);process.env.WFM_3MIN_BROWSER_TOKEN=token;
const harness=createAttendanceRuntime({runtime,database:path.join(dir,'state.sqlite')});
let browser;
const evidence={scope:'local synthetic composed runtime; no hosted or provider proof',node:process.version,checks:[]};
try{
 execFileSync(process.execPath,[path.join(root,'scripts/compose-vector-local-runtime.mjs'),runtime],{cwd:root,stdio:'pipe'});
 const origin=await harness.start(),route='/api/integrations/autonomous/feeds/3min';
 const shell=fs.readFileSync(path.join(root,'ux-overlay/vector-shell.js'),'utf8');
 evidence.shellSha256=createHash('sha256').update(shell).digest('hex');
 assert.ok((await(await fetch(origin+'/vector-ui.js')).text()).includes(shell));
 const receipts=[];
 for(const operation of ['create','update']){
  const id=randomUUID();
  const payload={schemaVersion:'vector-feed-v1',tenant:binding.tenant,site:binding.site,source:binding.source,domain:binding.domain,environment:binding.environment,eventId:'browser-'+operation,occurredAt:new Date().toISOString(),records:[{employeeId:'synthetic-only'}]};
  const response=await fetch(origin+route+'/'+binding.id,{method:'POST',headers:{'content-type':'application/json','x-vector-feed-token':token,'x-3minapi-record-id':id},body:JSON.stringify({id,operation,status:'success',endpoint_slug:binding.endpointSlug,payload,processed_at:new Date().toISOString()})});
  assert.equal(response.status,202);const receipt=await response.json();
  assert.equal(receipt.status,operation==='create'?'RECEIVED_UNVALIDATED':'REJECTED_VALIDATION');receipts.push(receipt.receiptId);
 }
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
 evidence.browser=browser.version();
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport});
  try{
   await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   const response=await context.request.post(origin+'/api/login',{headers:{origin},data:{email:'superuser@northstar.example',password:'Factory-local-demo-2026!'}});
   assert.equal(response.status(),200);
   const page=await context.newPage();
   await page.goto(origin+'/#vector/integrations',{waitUntil:'domcontentloaded'});
   const card=page.locator('[data-vector-three-min-card]');
   await card.waitFor({state:'visible',timeout:15000});
   await page.waitForFunction(()=>document.querySelector('[data-vector-three-min-card]')?.textContent.includes('Receipt status checked'));
   assert.match(await card.innerText(),/Records have not been imported into workforce data/);
   assert.equal(await card.locator('details').getAttribute('open'),null);
   await card.locator('summary').click();
   const rendered=await card.innerText();
   assert.match(rendered,/Received — awaiting validation/);assert.match(rendered,/Rejected/);
   for(const receipt of receipts)assert.ok(rendered.includes(receipt));
   assert.equal(rendered.includes(token),false);assert.equal(rendered.includes('synthetic-only'),false);
   const dimensions=await card.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,viewport:innerWidth}));
   assert.ok(dimensions.width>0);assert.ok(dimensions.scrollWidth<=dimensions.width+1,JSON.stringify(dimensions));
   assert.ok(dimensions.left>=0&&dimensions.right<=dimensions.viewport+1,JSON.stringify(dimensions));
   await page.route(origin+route,r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"synthetic failure"}'}));
   await card.getByRole('button',{name:'Refresh deliveries'}).click();
   await page.waitForFunction(()=>document.querySelector('[data-vector-three-min-card]')?.textContent.includes('could not be checked'));
   assert.equal((await card.innerText()).includes(receipts[0]),false);
   await page.unroute(origin+route);
   await card.getByRole('button',{name:'Refresh deliveries'}).click();
   await page.waitForFunction(()=>document.querySelector('[data-vector-three-min-card]')?.textContent.includes('Receipt status checked'));
   await card.locator('summary').click();assert.ok((await card.innerText()).includes(receipts[0]));
   await page.evaluate(()=>window.nav('overview'));
   await card.waitFor({state:'detached'});
   evidence.checks.push({viewport,result:'PASS',dimensions,checks:['authenticated receipt rendering','intake limitation','accepted and rejected receipts','collapsed detail control','no secret or payload display','no horizontal overflow','refresh failure clears stale receipts','manual recovery','navigation removes receipt view']});
  }finally{await context.close();}
 }
 evidence.result='PASS';console.log(JSON.stringify(evidence,null,2));
}finally{
 try{await browser?.close();}finally{
  try{await harness.stop();}finally{
   for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
   fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
 }
}
