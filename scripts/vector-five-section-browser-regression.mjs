// Exercises the real authenticated product. No intercepted API responses or mocked pages.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES]}));
const root=path.resolve(import.meta.dirname),runtime=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:4188',app=spawn(process.execPath,[runtime+'/security-runtime/bootstrap.cjs'],{env:{...process.env,PORT:'4188',WFM_DB:out+'/synthetic.sqlite'},stdio:'ignore'});let browser,context,page;const checks=[],errors=[],network=[];
async function check(name,fn){try{await fn();checks.push({name,pass:true});console.log('PASS '+name);}catch(e){checks.push({name,pass:false,error:e.message});console.log('FAIL '+name+': '+e.message.split('\n')[0]);await page?.screenshot({path:out+'/failure-'+checks.length+'.png'});}}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||path.resolve(root,'../vector-reliability/browser-bin/chromium'),args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--disable-gpu']});
 context=await browser.newContext({viewport:{width:1440,height:1000}});const login=await context.request.post(base+'/api/login',{headers:{Origin:base},data:{email:'superuser@northstar.example',password:process.env.WFM_PROOF_PASSWORD||'Factory-local-demo-2026!'}});assert.equal(login.status(),200);
 page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>network.push({path:new URL(r.url()).pathname,status:r.status()}));await page.goto(base);await page.locator('.vector-sidebar').waitFor();
 const primary=()=>page.locator('.vector-nav');
 await check('approved navigation reaches each real section instead of leaving stale content',async()=>{
  assert.deepEqual(await primary().getByRole('button').allTextContents(),['Today','People','Plan','Factory','Improve']);
  for(const [label,heading] of [['People','People'],['Plan','Build and publish the week.'],['Factory','Factory'],['Improve','Know what changed. Know what to check.']]){
   await primary().getByRole('button',{name:label,exact:true}).click();await page.locator('.content h1').filter({hasText:heading}).waitFor();assert.ok(page.url().includes('#vector/'));await page.screenshot({path:out+'/'+label.toLowerCase()+'.png'});
  }
 });
 await check('People opens the scoped workforce; search filters real records',async()=>{
  await primary().getByRole('button',{name:'People',exact:true}).click();await page.getByRole('searchbox',{name:'Search people'}).fill('Daniel Reed');assert.equal(await page.locator('[data-vector-person-row]:visible').count(),1);await page.getByRole('button',{name:'Open Daniel Reed'}).click();await page.getByRole('dialog').getByText('Daniel Reed',{exact:false}).first().waitFor();await page.keyboard.press('Escape');
 });
 await check('back, forward and reload preserve the section',async()=>{
  await primary().getByRole('button',{name:'Today',exact:true}).click();await page.locator('.vector-home').waitFor();await primary().getByRole('button',{name:'People',exact:true}).click();await page.getByRole('searchbox',{name:'Search people'}).waitFor();await page.goBack();await page.locator('.vector-home').waitFor();await page.goForward();await page.getByRole('searchbox',{name:'Search people'}).waitFor();await page.reload();await page.getByRole('searchbox',{name:'Search people'}).waitFor();
 });
 await check('old factory presentation cannot be served or executed',async()=>{
  for(const asset of ['/factory-control-ui.js','/factory-control-ui.js?v=old','/%66actory-control-ui.js','/review-ui.js','/value-cockpit-ui.js'])assert.ok([404,410].includes((await context.request.get(base+asset)).status()),asset);assert.equal(network.some(r=>r.path==='/factory-control-ui.js'&&r.status===200),false);
 });
 await check('review drawer explains the source request without changing its state',async()=>{
  await primary().getByRole('button',{name:'Today',exact:true}).click();await page.locator('.vector-home').waitFor();
  const before=await (await context.request.get(base+'/api/bootstrap')).json();await page.getByRole('button',{name:'Review Daniel Reed · leave request',exact:true}).click();await page.locator('.vector-decision-drawer').getByRole('heading',{name:'So what?',exact:true}).waitFor();
  assert.equal((await (await context.request.get(base+'/api/bootstrap')).json()).state.version,before.state.version);await page.getByRole('button',{name:'Review coverage',exact:true}).click();await page.getByRole('heading',{name:'Review holiday coverage',exact:true}).waitFor();await page.keyboard.press('Escape');
 });
 await check('cost details and every enabled section tab replace the previous page',async()=>{
  for(const section of ['People','Plan','Factory','Improve']){
   const previous=await page.locator('.content').elementHandle();await primary().getByRole('button',{name:section,exact:true}).click();await page.waitForFunction(el=>!el.isConnected,previous);await previous.dispose();await page.getByRole('navigation',{name:'Section pages'}).waitFor();const routes=await page.getByRole('navigation',{name:'Section pages'}).locator('button').evaluateAll(bs=>bs.filter(b=>!b.disabled).map(b=>({route:b.dataset.vectorRoute,name:b.textContent})));
   for(const {route,name} of routes){const old=await page.locator('.content').elementHandle();await page.getByRole('navigation',{name:'Section pages'}).getByRole('button',{name,exact:true}).click();await page.waitForFunction(el=>!el.isConnected,old);assert.ok(page.url().endsWith('/'+route));if(route==='costs')await page.getByRole('heading',{name:'Every hour. Every premium. In view.',exact:true}).waitFor();await old.dispose();}
  }
 });
 await check('leave approval retains coverage review and persists after reload',async()=>{
  await primary().getByRole('button',{name:'People',exact:true}).click();await page.getByRole('navigation',{name:'Section pages'}).getByRole('button',{name:'Absence & leave',exact:true}).click();await page.locator('.request').first().waitFor();
  const request=page.locator('[data-act="approve"]').first(),id=await request.getAttribute('data-id');assert.ok(id);await request.click();await page.getByRole('heading',{name:'Review holiday coverage',exact:true}).waitFor();await page.getByRole('checkbox',{name:'I reviewed leave balance and safe cover.',exact:true}).check();await page.getByRole('button',{name:'Approve time off',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('modal').open);await page.reload();await page.locator('.request').first().waitFor();const b=await (await context.request.get(base+'/api/bootstrap')).json();assert.equal(b.state.requests.find(r=>r.id===id).status,'approved');
 });
 await check('phone view has accessible navigation and no page overflow',async()=>{
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open menu',exact:true}).click();await primary().getByRole('button',{name:'Today',exact:true}).click();await page.locator('.vector-home').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
 });
 await check('no browser errors',async()=>assert.deepEqual(errors,[]));
 await check('employee navigation cannot expose manager workforce or financial views',async()=>{
  const ctx=await browser.newContext();try{const l=await ctx.request.post(base+'/api/login',{headers:{Origin:base},data:{email:'maya@northstar.example',password:process.env.WFM_PROOF_PASSWORD||'Factory-local-demo-2026!'}});assert.equal(l.status(),200);const p=await ctx.newPage();await p.goto(base+'/#vector/vector-people');await p.locator('.vector-sidebar').waitFor();await p.waitForFunction(()=>location.hash==='#vector/overview');assert.equal(await p.locator('[data-vector-person-row]').count(),0);assert.equal(await p.locator('.vector-nav').getByRole('button',{name:'Factory',exact:true}).isDisabled(),true);assert.equal(await ctx.request.get(base+'/api/costs').then(r=>r.status()),403);assert.equal(await p.getByText('Labour cost (today)',{exact:true}).count(),0);}finally{await ctx.close();}
 });
 const release=await (await fetch(base+'/api/release')).json();fs.writeFileSync(out+'/result.json',JSON.stringify({release,checks,errors,network},null,2));console.log(JSON.stringify({passed:checks.filter(c=>c.pass).length,total:checks.length}));if(checks.some(c=>!c.pass))process.exitCode=1;
}finally{await context?.close();await browser?.close();app.kill();await new Promise(r=>app.on('exit',r));}
