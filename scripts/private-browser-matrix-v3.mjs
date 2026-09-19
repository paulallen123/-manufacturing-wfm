import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { chromium } from 'playwright';

// DEVELOPMENT proof harness only. Browser requests are intercepted and fulfilled
// over Railway private networking. The frozen candidate remains untouched.
const targetBase=(process.env.PROOF_TARGET_BASE||'').replace(/\/$/,'');
const browserOrigin=(process.env.PROOF_BROWSER_ORIGIN||'').replace(/\/$/,'');
const expectedSha=process.env.WFM_EXPECTED_CANDIDATE_SHA;
const password=process.env.WFM_STAGING_PASSWORD;
assert.ok(targetBase.includes('.railway.internal'));
assert.ok(browserOrigin.startsWith('https://'));
assert.match(expectedSha||'',/^[0-9a-f]{40}$/);
assert.ok(password&&password.length>=20);
const target=new URL(targetBase),browserHost=new URL(browserOrigin).host;
const transport=target.protocol==='https:'?httpsRequest:httpRequest;

async function upstream(path,method,sourceHeaders,body){
 const headers={};
 for(const [k,v] of Object.entries(sourceHeaders||{})){const n=k.toLowerCase();if(['host','origin','referer','content-length','connection','accept-encoding'].includes(n))continue;headers[n]=v;}
 Object.assign(headers,{host:browserHost,'x-forwarded-host':browserHost,'x-forwarded-proto':'https',origin:browserOrigin,referer:`${browserOrigin}/`,'accept-encoding':'identity'});
 if(body?.length)headers['content-length']=String(body.length);
 return new Promise((resolve,reject)=>{const req=transport({protocol:target.protocol,hostname:target.hostname,port:target.port||undefined,method,path,headers,timeout:20000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode||0,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('timeout',()=>req.destroy(new Error('private browser bridge timeout')));req.on('error',reject);if(body?.length)req.write(body);req.end();});
}
async function installBridge(page,counter){await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(!['http:','https:'].includes(u.protocol))return route.continue();counter.count++;const out=await upstream(`${u.pathname}${u.search}`,r.method(),r.headers(),r.postDataBuffer());const h={};for(const [k,v] of Object.entries(out.headers||{})){const n=k.toLowerCase();if(v==null||['connection','transfer-encoding','content-length','keep-alive'].includes(n))continue;h[n]=Array.isArray(v)?v.join('\n'):String(v);}await route.fulfill({status:out.status,headers:h,body:out.body});});}

const specs=[
 ['manager','manager@northstar.example','manager','northstar-demo',403,'/api/time-review'],
 ['employee','maya@northstar.example','employee','northstar-demo',403,'/api/personal'],
 ['payroll','payroll@northstar.example','payroll_admin','northstar-demo',200,'/api/payroll-run'],
 ['company-admin','superuser@northstar.example','director','northstar-demo',200,'/api/onboarding'],
 ['isolation-manager','other@isolation.example','manager','isolation-test',403,'/api/bootstrap'],
];
const browser=await chromium.launch({headless:true});
const failures=[];let completed=0,totalRequests=0;
try{
 for(const [slug,email,role,tenant,payrollExpected,surface] of specs){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),counter={count:0},pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e?.message||e)));await installBridge(page,counter);
  try{
   const first=await page.goto(browserOrigin,{waitUntil:'domcontentloaded',timeout:60000});assert.ok(first&&first.status()<500,`${slug} initial page failed`);
   const health=await page.evaluate(async()=>{const r=await fetch('/api/health',{cache:'no-store'});return{status:r.status,j:await r.json()}});assert.equal(health.status,200);assert.equal(health.j?.release,'0.6.76-hosted-staging-rc1');assert.equal(health.j?.fixtureOnly,true);assert.equal(health.j?.productionApproved,false);
   assert.equal(await page.evaluate(async()=> (await fetch('/api/bootstrap')).status),401,`${slug} unauthenticated boundary failed`);
   const login=await page.evaluate(async({email,password})=> (await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})})).status,{email,password});assert.equal(login,200,`${slug} login failed`);assert.ok((await context.cookies(browserOrigin)).length>0,`${slug} session cookie missing`);
   await page.reload({waitUntil:'networkidle',timeout:60000});
   const identity=await page.evaluate(async()=>{const r=await fetch('/api/bootstrap',{cache:'no-store'});return{status:r.status,j:await r.json()}});assert.equal(identity.status,200,`${slug} authenticated bootstrap failed`);assert.equal(identity.j.actor?.role,role,`${slug} role mismatch`);assert.equal(identity.j.actor?.tenant,tenant,`${slug} tenant mismatch`);
   const boundary=await page.evaluate(async surface=>({payroll:(await fetch('/api/payroll-run',{cache:'no-store'})).status,surface:(await fetch(surface,{cache:'no-store'})).status}),surface);assert.equal(boundary.payroll,payrollExpected,`${slug} payroll boundary mismatch`);assert.equal(boundary.surface,200,`${slug} required surface failed`);
   const ui=await page.evaluate(async()=>{const js=await fetch('/value-cockpit-ui.js',{cache:'no-store'});const jsText=await js.text();const visible=n=>n.getClientRects().length>0;const controls=[...document.querySelectorAll('button,a,input,select,textarea,[tabindex]')].filter(visible);const unnamedButtons=[...document.querySelectorAll('button')].filter(visible).filter(b=>!(b.getAttribute('aria-label')||b.textContent||'').trim()).length;return{assetStatus:js.status,cycle9:jsText.includes('WFM_UX_RESET_CYCLE9_BEGIN'),bodyText:(document.body?.innerText||'').trim().length,controls:controls.length,unnamedButtons,w:innerWidth,sw:document.documentElement.scrollWidth,title:document.title||'',lang:document.documentElement.lang||'',main:!!document.querySelector('main,[role="main"],.content')}});assert.equal(ui.assetStatus,200);assert.equal(ui.cycle9,true,`${slug} expected hosted UI layer missing`);assert.ok(ui.bodyText>200,`${slug} rendered body too small`);assert.ok(ui.controls>0,`${slug} no visible controls`);assert.ok(ui.sw<=ui.w+1,`${slug} desktop horizontal overflow`);assert.equal(ui.unnamedButtons,0,`${slug} visible unnamed button`);assert.equal(ui.main,true,`${slug} primary content landmark missing`);
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);const mobile=await page.evaluate(()=>({w:innerWidth,sw:document.documentElement.scrollWidth}));assert.ok(mobile.sw<=mobile.w+1,`${slug} mobile horizontal overflow`);
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement===document.body),false,`${slug} keyboard focus failed`);assert.deepEqual(pageErrors,[],`${slug} page errors: ${pageErrors.join(' | ')}`);assert.ok(counter.count>5,`${slug} private bridge not exercised`);
   completed++;totalRequests+=counter.count;console.log(`PRIVATE_BROWSER_ROLE_PASS=${slug}|role=${role}|tenant=${tenant}|requests=${counter.count}`);
  }catch(e){failures.push(`${slug}: ${e.message}`);console.error(`PRIVATE_BROWSER_ROLE_FAIL=${slug}|${e.message}`);}
  await context.close();
 }
 assert.equal(completed,5,`browser matrix failures: ${failures.join(' || ')}`);console.log(`PRIVATE_BROWSER_MATRIX=PASS|roles=${completed}|privateRequests=${totalRequests}|sha=${expectedSha}`);
}finally{await browser.close();delete process.env.WFM_STAGING_PASSWORD;}
