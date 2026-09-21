// Independent, local synthetic-DOM/HTTP proof. NEVER product or release acceptance.
// Original: hosted journey SHA256 36d996c04079c1d6dd5ef33356972f2dc5bc56fabdbcae0c4531f067f9d0fdbc,
// source-inspector deployment 2423d5cd-b0e7-4a78-9b8c-aba794b9a6ca, lines 62-63.
// Returned repair: PR220 commit 17cf75c49240be3fc4f5b2950d839c1da0d843dd,
// scripts/vector-browser-feedback-wrapper.cjs blob 16b4d2c9778d83ae7cc3d6a0e183b51601d9c5e7.
// The existing builder owns the wrapper; this file is an independent verifier.
// Run node --test with Playwright installed or PLAYWRIGHT_MODULE pointing to it.
// VECTOR_TRUST_ORIGINAL=1 executes only the original failing reproducer (one test).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const original=async({manager,id,read,assert})=>{
   await manager.page.locator('#modalform input[name="reviewed"]').check();await manager.page.locator('#modalform button[type="submit"]').click();await manager.page.locator('.vw-receipt').waitFor();
   assert.equal((await read(manager.ctx,'/api/bootstrap')).state.requests.find(r=>r.id===id).status,'declined');
};
const oldWait="await manager.page.locator('.vw-receipt').waitFor();";
const returnedWait="await manager.page.locator('.vw-receipt').filter({hasText:' \u00b7 leave-decision \u00b7 '+id+' \u00b7 declined \u00b7 version '}).waitFor();console.log(JSON.stringify({event:'VECTOR_MANAGER_RECEIPT_BOUND',run,id,decision:'declined'}));";
assert.equal(original.toString().split(oldWait).length,2,'Original source extraction changed');
const repairedSource=original.toString().replace(oldWait,returnedWait).replace('({manager,id,read,assert})','({manager,id,read,assert,run=1})');
const run=process.env.VECTOR_TRUST_ORIGINAL==='1'?original:require('node:vm').runInNewContext('('+repairedSource+')',{console});

const origin = 'https://vector-proof.invalid';
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});});
test.after(async()=>{await browser?.close();});
async function fixture(options={}) {
  const id=options.id || 'owned-request-2';
  const ctx=await browser.newContext(); const page=await ctx.newPage();
  page.setDefaultTimeout(600);
  let saved='pending',posts=0,acknowledged=false,readsBeforeAcknowledgement=0;
  const pendingRoutes=new Set();
  // ALL HTTP is intercepted locally. No deployed service is called.
  await ctx.route('**/*',async route=>{
    if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'POST,GET,OPTIONS','access-control-allow-headers':'content-type'}});
    posts++;
    const task=(async()=>{
      await new Promise(r=>setTimeout(r,options.delay??200));
      if(options.persist!==false && (options.httpStatus??200)===200) saved='declined';
      const body=options.body || {ok:true,version:42,result:{id,status:'declined'}};
      acknowledged=true;
      await route.fulfill({status:options.httpStatus??200,headers:{'content-type':'application/json','access-control-allow-origin':'*'},body:JSON.stringify(body)});
    })();
    pendingRoutes.add(task);try{await task;}finally{pendingRoutes.delete(task);}
  });
  await page.setContent(`<form id="modalform"><input type="checkbox" name="reviewed"><button type="submit">Decline</button></form><p class="vw-receipt" role="status">Saved and read back from the service · leave-decision · owned-request-1 · declined · version 40.</p>`);
  await page.evaluate(({origin,id,options})=>{
    document.querySelector('form').onsubmit=async e=>{
      e.preventDefault();
      const response=await fetch((options.requestOrigin||origin)+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:options.command||'leave-decision',version:41,payload:{id:options.requestId||id,decision:options.decision||'declined',reviewed:true}})});
      const body=await response.json();
      if(options.render===false) return;
      await new Promise(r=>setTimeout(r,options.renderDelay||0));
      const receipt=document.querySelector('.vw-receipt');
      receipt.textContent='Saved and read back from the service · leave-decision · '+(options.receiptId||id)+' · declined · version '+(options.receiptVersion??body.version)+'.';
      if(options.hideReceipt)receipt.style.visibility='hidden';
    };
  },{origin,id,options});
  const read=async()=>{if(!acknowledged)readsBeforeAcknowledgement++;return {state:{requests:[{id,status:saved}]}}};
  return {manager:{ctx,page},id,read,assert,origin,owned:{id},state:{},timeout:600,
    stats:()=>({posts,saved,acknowledged,readsBeforeAcknowledgement}),
    close:async()=>{await Promise.allSettled([...pendingRoutes]);await ctx.close();}};
}

test('a stale first-journey receipt must not release a second-journey read before its command finishes',async()=>{
  const f=await fixture();try{await run(f);assert.equal(f.stats().readsBeforeAcknowledgement,0);assert.equal(f.stats().posts,1);assert.equal(f.stats().saved,'declined');}finally{await f.close();}
});

if(process.env.VECTOR_TRUST_ORIGINAL!=='1'){
for (const [name,options] of [
  ['fast acknowledgement',{delay:0}],
  ['delayed receipt rendering',{delay:50,renderDelay:180}],
  ['a hyphenated request ID',{delay:70,id:'owned-request-with-dashes-22'}]
]) test('returned repair accepts '+name+' only after saved state',async()=>{
  const f=await fixture(options);try{await run(f);assert.equal(f.stats().readsBeforeAcknowledgement,0);assert.equal(f.stats().posts,1);assert.equal(f.stats().saved,'declined');}finally{await f.close();}
});
for (const [name,options,expected] of [
  ['old receipt never replaced',{render:false},/Timeout/],
  ['another request receipt',{receiptId:'not-the-owned-request'},/Timeout/],
  ['request ID followed by a lookalike suffix',{receiptId:'owned-request-2-extra'},/Timeout/],
  ['request ID preceded by a lookalike prefix',{receiptId:'extra-owned-request-2'},/Timeout/],
  ['hidden current receipt',{hideReceipt:true},/Timeout/],
  ['UI says saved but authoritative read remains pending',{persist:false},/pending/],
  ['rejected command despite misleading current receipt',{httpStatus:409,persist:false},/pending/]
]) test('returned repair refuses '+name+' without a second write',async()=>{
  const f=await fixture(options);try{await assert.rejects(()=>run(f),expected);assert.equal(f.stats().posts,1);assert.equal(f.stats().readsBeforeAcknowledgement,0);}finally{await f.close();}
});

}
