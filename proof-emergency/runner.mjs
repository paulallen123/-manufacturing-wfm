import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
const port=Number(process.env.PORT||3000);
let state={running:true,passed:false,error:null,video:null,url:null,title:null};
http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify(state));}).listen(port,'0.0.0.0');
(async()=>{
 let browser,context;
 try{
  const target=process.env.TARGET_URL;
  if(!target) throw new Error('TARGET_URL missing');
  fs.mkdirSync('/tmp/evidence',{recursive:true});
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({recordVideo:{dir:'/tmp/evidence',size:{width:1440,height:900}},viewport:{width:1440,height:900}});
  const page=await context.newPage();
  const consoleErrors=[]; page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000});
  if(process.env.LOGIN_PASSWORD){
   const p=page.locator('input[type=password]').first();
   if(await p.count()){await p.fill(process.env.LOGIN_PASSWORD); const btn=page.locator('button[type=submit],button:has-text("Sign in"),button:has-text("Login")').first(); if(await btn.count()) await btn.click();}
  }
  await page.waitForTimeout(5000);
  state.url=page.url(); state.title=await page.title();
  await page.screenshot({path:'/tmp/evidence/post-login.png',fullPage:true});
  const body=(await page.locator('body').innerText()).slice(0,12000);
  fs.writeFileSync('/tmp/evidence/body.txt',body); fs.writeFileSync('/tmp/evidence/console-errors.json',JSON.stringify(consoleErrors,null,2));
  const vector=await page.locator('.vector-shell,.vector-sidebar,[class*="vector-"],[data-testid*="vector"]').count();
  state.passed=vector>0; if(!state.passed) state.error='Vector UI marker not detected; diagnostics captured';
  await context.close(); state.video='captured by Playwright context';
 }catch(e){state.error=String(e?.stack||e); try{if(context)await context.close()}catch{}}
 finally{try{if(browser)await browser.close()}catch{} state.running=false;}
})();