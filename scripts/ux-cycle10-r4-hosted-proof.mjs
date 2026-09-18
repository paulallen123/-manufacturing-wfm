import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const rawVars=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const vars=rawVars?.variables&&typeof rawVars.variables==='object'?rawVars.variables:rawVars;
const outDir=path.join(process.argv[3],'cycle10-r4-hosted-evidence');
fs.mkdirSync(outDir,{recursive:true});
const origin=String(vars.WFM_PUBLIC_ORIGIN||'').replace(/\/$/,'');
const password=vars.WFM_STAGING_PASSWORD;
const sourceSha=process.env.GITHUB_SHA||'';
assert.equal(origin,process.env.EXPECTED_ORIGIN,'Unexpected isolated proof origin.');
assert.ok(password&&password.length>=20,'Isolated hosted password did not resolve.');
assert.match(sourceSha,/^[0-9a-f]{40}$/,'Expected immutable Git source SHA.');
delete process.env.RAILWAY_TOKEN;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function text(pathname,init={}){
 const r=await fetch(origin+pathname,{...init,signal:AbortSignal.timeout(20_000)});
 return {r,body:await r.text()};
}
async function waitForHealth(attempts=40){
 let last='no response';
 for(let i=0;i<attempts;i++){
  try{
   const result=await text('/api/health');
   last=`HTTP ${result.r.status}`;
   if(result.r.status===200)return result;
  }catch(e){last=String(e?.message||e);}
  await sleep(750);
 }
 throw new Error(`Isolated hosted service never became ready: ${last}`);
}
function cookieFrom(r){
 const values=typeof r.headers.getSetCookie==='function'?r.headers.getSetCookie():[r.headers.get('set-cookie')].filter(Boolean);
 return values[0]?.split(';',1)[0]||'';
}

const health=await waitForHealth();
const hb=JSON.parse(health.body);assert.equal(hb.mode,'hosted-staging');assert.equal(hb.productionApproved,false);assert.equal(hb.fixtureOnly,true);
const unauth=await text('/api/bootstrap');assert.equal(unauth.r.status,401,'Protected bootstrap must fail closed before login.');
const login=await text('/api/login',{method:'POST',headers:{'content-type':'application/json',origin,referer:origin+'/'},body:JSON.stringify({email:'manager@northstar.example',password})});
assert.equal(login.r.status,200,'Manager login failed.');
const cookie=cookieFrom(login.r);assert.ok(cookie);
const headers={cookie,referer:origin+'/',accept:'application/json,text/plain,*/*'};
const schedule=await text('/api/schedule-publication',{headers});assert.equal(schedule.r.status,200,'Schedule publication workflow unavailable to manager.');
const js=await text('/value-cockpit-ui.js',{headers}),css=await text('/factory-control-ui.css',{headers});
assert.equal(js.r.status,200);assert.equal(css.r.status,200);
for(const marker of ['WFM_UX_RESET_CYCLE10_BEGIN','window.WFMUXCycle10=','Resolve risk before you publish','data-ux-preserved-publish'])assert.ok(js.body.includes(marker),'Missing hosted JS marker '+marker);
for(const marker of ['WFM_UX_RESET_CYCLE10_BEGIN','.ux-plan-focus','.ux-plan-grid'])assert.ok(css.body.includes(marker),'Missing hosted CSS marker '+marker);
console.log('HOSTED_CYCLE10_HTTP_ASSET_PROOF=PASS');
console.log('HOSTED_CYCLE10_FAIL_CLOSED_BOOTSTRAP=PASS');
console.log('HOSTED_CYCLE10_MANAGER_WORKFLOW_HTTP=PASS');

const which=name=>{const x=spawnSync('which',[name],{encoding:'utf8'});return x.status===0?x.stdout.trim():''};
const chrome=['google-chrome','google-chrome-stable','chromium','chromium-browser'].map(which).find(Boolean);assert.ok(chrome,'Chrome/Chromium unavailable.');
const profile=path.join(process.argv[3],'cycle10-r4-chrome');fs.rmSync(profile,{recursive:true,force:true});
const port=9231,chromeEnv={...process.env};delete chromeEnv.RAILWAY_TOKEN;
const cp=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1440,1000','about:blank'],{stdio:['ignore','ignore','ignore'],env:chromeEnv});
async function retry(fn,n=125){let e;for(let i=0;i<n;i++){try{return await fn()}catch(x){e=x;await sleep(200)}}throw e}
let ws;
try{
 const targets=await retry(async()=>{const r=await fetch(`http://127.0.0.1:${port}/json/list`);const a=await r.json();if(!a.find(x=>x.type==='page'))throw Error('No browser page');return a});
 const page=targets.find(x=>x.type==='page');ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=()=>bad(Error('CDP open failed'))});
 let id=1;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=id++;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
 const evalx=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result?.value;
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin});
 await retry(async()=>{if(!(await evalx("document.readyState==='complete'||document.readyState==='interactive'")))throw Error('not loaded');return true});
 const browserLogin=await evalx(`(async()=>{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'manager@northstar.example',password:${JSON.stringify(password)}})});return r.status})()`);assert.equal(browserLogin,200);
 await send('Page.reload',{ignoreCache:true});
 await retry(async()=>{if(!(await evalx("!document.querySelector('#v2-login')&&document.body?.innerText?.length>200")))throw Error('not authenticated');return true});
 assert.equal(await evalx('!!window.WFMUXCycle10'),true,'Hosted browser did not load Cycle 10 runtime.');
 const navigation=await evalx(`(async()=>{const direct=document.querySelector('[data-page="schedule-publication"]');if(direct){direct.click();return 'visible-nav';}if(window.ui&&typeof window.render==='function'){window.ui.page='schedule-publication';await window.render();return 'render-route';}return 'unavailable';})()`);assert.notEqual(navigation,'unavailable');
 const focusMode=await retry(async()=>{const mode=await evalx("document.querySelector('.content')?.dataset.uxPlannerFocus||''");if(!['active','calm'].includes(mode))throw Error('Cycle 10 planner mode not ready');return mode});

 const desktop=await evalx(`(()=>{
  const tagged=document.querySelector('[data-ux-preserved-publish="true"]');
  const exportButton=[...document.querySelectorAll('button,[role="button"]')].find(n=>/^export published week$/i.test((n.textContent||'').replace(/\\s+/g,' ').trim()));
  return {mode:document.querySelector('.content')?.dataset.uxPlannerFocus||'',focus:!!document.querySelector('.ux-plan-focus'),priority:!!document.querySelector('.ux-plan-priority'),grid:!!document.querySelector('.ux-plan-grid'),gridHidden:document.querySelector('.ux-plan-grid')?.hidden===true,publish:tagged?.textContent?.replace(/\\s+/g,' ').trim()||'',exportVisible:!!exportButton,exportMisclassified:!!exportButton?.matches('[data-ux-preserved-publish="true"]'),jumps:document.querySelectorAll('.ux-plan-jump').length,issueJump:!!document.querySelector('[data-target="issues"]'),gridJump:!!document.querySelector('[data-target="grid"]'),publishJump:!!document.querySelector('[data-target="publish"]'),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,expanded:document.querySelector('.ux-plan-grid-toggle')?.getAttribute('aria-expanded')||'',toggleText:document.querySelector('.ux-plan-grid-toggle')?.textContent?.replace(/\\s+/g,' ').trim()||''};
 })()`);
 const pre=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true});fs.writeFileSync(path.join(outDir,'cycle10-r4-hosted-desktop-before-assert.png'),Buffer.from(pre.data,'base64'));
 fs.writeFileSync(path.join(outDir,'desktop-state.json'),JSON.stringify({capturedAt:new Date().toISOString(),origin,sourceSha,navigation,focusMode,desktop},null,2));

 assert.ok(desktop.grid,'Weekly planner surface was not identified.');
 assert.equal(desktop.exportMisclassified,false,'Published-week export must never be treated as publish authority.');
 assert.ok(desktop.overflow<=2,`Desktop page overflow ${desktop.overflow}px.`);
 let toggled=null;
 if(desktop.priority){
  assert.equal(desktop.mode,'active');assert.ok(desktop.focus,'Risk mode must expose the focused decision surface.');
  const expectedJumps=2+(desktop.publish?1:0);assert.equal(desktop.jumps,expectedJumps,'Unexpected risk-focus action count.');
  assert.equal(desktop.issueJump,true);assert.equal(desktop.gridJump,true);assert.equal(desktop.publishJump,!!desktop.publish);
  assert.equal(desktop.gridHidden,true,'Planner must collapse behind verified issue evidence.');assert.equal(desktop.expanded,'false');assert.match(desktop.toggleText,/open full planner/i);
  await evalx("document.querySelector('.ux-plan-grid-toggle').click()");await sleep(150);
  toggled=await evalx("({hidden:document.querySelector('.ux-plan-grid')?.hidden===true,expanded:document.querySelector('.ux-plan-grid-toggle')?.getAttribute('aria-expanded'),focused:document.activeElement?.classList.contains('ux-plan-grid')===true})");
  assert.equal(toggled.hidden,false);assert.equal(toggled.expanded,'true');assert.equal(toggled.focused,true,'Opening planner must move keyboard focus into planner detail.');
  if(desktop.publish){await evalx("document.querySelector('[data-target=\"publish\"]').click()");await sleep(75);assert.equal(await evalx("document.activeElement?.hasAttribute('data-ux-preserved-publish')"),true,'Publish jump did not focus authoritative control.');}
 }else{
  assert.equal(desktop.mode,'calm');assert.equal(desktop.focus,false,'No-risk state must not add a duplicate focus card.');
  assert.equal(desktop.gridHidden,false,'Planner must remain visible when no verified issue exists.');
  assert.equal(desktop.jumps,0,'No-risk state must not add redundant jump controls.');
  assert.equal(desktop.issueJump,false);assert.equal(desktop.gridJump,false);assert.equal(desktop.publishJump,false);
 }

 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(300);
 const mobile=await evalx("({overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,mode:document.querySelector('.content')?.dataset.uxPlannerFocus||'',focus:!!document.querySelector('.ux-plan-focus'),grid:!!document.querySelector('.ux-plan-grid'),exportMisclassified:!![...document.querySelectorAll('button,[role=\"button\"]')].find(n=>/^export published week$/i.test((n.textContent||'').replace(/\\s+/g,' ').trim()))?.matches('[data-ux-preserved-publish=\"true\"]')})");
 assert.ok(mobile.overflow<=2,`Mobile page overflow ${mobile.overflow}px.`);assert.ok(mobile.grid);assert.equal(mobile.exportMisclassified,false);assert.equal(mobile.focus,desktop.priority);
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true});fs.writeFileSync(path.join(outDir,'cycle10-r4-hosted-mobile.png'),Buffer.from(shot.data,'base64'));
 fs.writeFileSync(path.join(outDir,'proof.json'),JSON.stringify({capturedAt:new Date().toISOString(),origin,sourceSha,health:{mode:hb.mode,fixtureOnly:hb.fixtureOnly,productionApproved:hb.productionApproved},navigation,focusMode,desktop,toggled,mobile,claimBoundary:'isolated hosted fixture staging only; no production/pilot approval; authoritative publish control preserved'},null,2));
 console.log('HOSTED_CYCLE10_BROWSER_INTERACTION=PASS');console.log('HOSTED_CYCLE10_SOURCE_SHA='+sourceSha);console.log('HOSTED_CYCLE10_MODE='+desktop.mode);console.log('HOSTED_CYCLE10_RISK_PANEL_PRESENT='+desktop.priority);console.log('HOSTED_CYCLE10_AUTHORITATIVE_PUBLISH_PRESENT='+!!desktop.publish);console.log('HOSTED_CYCLE10_DESKTOP_OVERFLOW='+desktop.overflow);console.log('HOSTED_CYCLE10_MOBILE_OVERFLOW='+mobile.overflow);
}finally{try{ws?.close()}catch{};cp.kill('SIGTERM');await sleep(250);if(!cp.killed)cp.kill('SIGKILL');delete vars.WFM_STAGING_PASSWORD;}
