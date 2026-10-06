import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { signedProofSession } from './signed-proof-session.mjs';

const expectedOrigin = 'https://vector-customer-ready-candidate-production.up.railway.app';
const expectedRelease = '0.6.76-hosted-staging-rc1';
const expectedRuntimeSha = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
const origin = (process.env.WFM_PUBLIC_ORIGIN || expectedOrigin).replace(/\/$/, '');
assert.equal(origin, expectedOrigin, 'Unexpected diagnostic origin.');
const outDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'wfm-evidence-output');
fs.mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = (v, max = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const routeOnly = value => { try { const u = new URL(String(value)); return `${u.origin}${u.pathname}`; } catch { return short(value, 220); } };

function executable(candidates) {
  for (const c of candidates) {
    const w = spawnSync('which', [c], { encoding: 'utf8' });
    if (w.status === 0 && w.stdout.trim()) return w.stdout.trim();
  }
  return '';
}
const chrome = executable(['google-chrome','google-chrome-stable','chromium','chromium-browser']);
assert.ok(chrome, 'Chrome/Chromium unavailable.');

async function inspectRole(spec,index) {
  const port=9850+index*20+Math.floor(Math.random()*10);
  const profile=path.join(process.env.RUNNER_TEMP||'/tmp',`wfm-a11y-${spec.slug}-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(profile,{recursive:true});
  const env={...process.env}; delete env.WFM_STAGING_PASSWORD; delete env.RAILWAY_TOKEN; delete env.WFM_DEMO_PASSWORD;
  const proc=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1440,1000','about:blank'],{stdio:['ignore','ignore','ignore'],env});
  let ws;
  try {
    let targets;
    for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1500)});if(r.ok){const j=await r.json();if(j.length){targets=j;break;}}}catch{} await sleep(150);}
    assert.ok(targets?.length,`No CDP target ${spec.slug}`);
    const t=targets.find(x=>x.type==='page')||targets[0]; ws=new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CDP open timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',e=>{clearTimeout(timer);reject(e.error||new Error('CDP error'));},{once:true});});
    let id=1; const pending=new Map();
    const telemetry={events:[],responses:[],failures:[],exceptions:[],logs:[],probeHistory:[]};
    ws.addEventListener('message',event=>{
      const msg=JSON.parse(typeof event.data==='string'?event.data:Buffer.from(event.data).toString('utf8'));
      if(msg.id){const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);msg.error?p.reject(new Error(`${p.method}:${msg.error.message}`)):p.resolve(msg.result||{});return;}
      const method=String(msg.method||''); const p=msg.params||{};
      if(['Page.domContentEventFired','Page.loadEventFired','Page.frameStoppedLoading','Page.frameStartedLoading'].includes(method)) telemetry.events.push({at:Date.now(),method});
      if(method==='Network.responseReceived') telemetry.responses.push({status:Number(p.response?.status||0),type:p.type||'',url:routeOnly(p.response?.url)});
      if(method==='Network.loadingFailed') telemetry.failures.push({type:p.type||'',errorText:short(p.errorText,240),canceled:!!p.canceled,blockedReason:p.blockedReason||null});
      if(method==='Runtime.exceptionThrown') telemetry.exceptions.push({text:short(p.exceptionDetails?.exception?.description||p.exceptionDetails?.text,700),url:routeOnly(p.exceptionDetails?.url||''),line:p.exceptionDetails?.lineNumber??null});
      if(method==='Log.entryAdded') telemetry.logs.push({level:p.entry?.level||'',source:p.entry?.source||'',text:short(p.entry?.text,700),url:routeOnly(p.entry?.url||'')});
    });
    const send=(method,params={},timeout=8000)=>new Promise((resolve,reject)=>{const n=id++;const timer=setTimeout(()=>{pending.delete(n);reject(new Error(`${method} timeout`));},timeout);pending.set(n,{method,resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params}));});
    await send('Page.enable'); await send('Network.enable'); await send('DOM.enable'); await send('Accessibility.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Performance.enable');
    const before=await send('Network.getCookies',{urls:[origin]}); assert.equal(before.cookies?.length||0,0);
    const pre=await fetch(`${origin}/api/bootstrap`,{signal:AbortSignal.timeout(15000)}); assert.equal(pre.status,401);
    const session=await login(spec.email); const bound=await send('Network.setCookie',{name:session.name,value:session.value,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}); assert.equal(bound.success,true);
    const cookie=`${session.name}=${session.value}`;
    const br=await fetch(`${origin}/api/bootstrap`,{headers:{Cookie:cookie,Accept:'application/json',Referer:`${origin}/`},signal:AbortSignal.timeout(15000)});assert.equal(br.status,200);const identity=await br.json();assert.equal(identity.actor?.role,spec.role);assert.equal(identity.actor?.tenant,spec.tenant);
    await send('Page.navigate',{url:origin});
    let html=''; let axNodes=[]; let domErrors=[]; let axErrors=[]; const deadline=Date.now()+25000;
    while(Date.now()<deadline){
      const probe={at:Date.now(),htmlLength:html.length,axCount:axNodes.length};
      try{const doc=await send('DOM.getDocument',{depth:2,pierce:true},2500);const outer=await send('DOM.getOuterHTML',{nodeId:doc.root.nodeId},2500);html=String(outer.outerHTML||'');probe.htmlLength=html.length;probe.dom='ok';}catch(e){domErrors.push(e.message);probe.dom=e.message;}
      try{const ax=await send('Accessibility.getFullAXTree',{},2500);axNodes=(ax.nodes||[]).filter(n=>!n.ignored).map(n=>({role:String(n.role?.value||''),name:String(n.name?.value||'').replace(/\s+/g,' ').trim()}));probe.axCount=axNodes.length;probe.ax='ok';}catch(e){axErrors.push(e.message);probe.ax=e.message;}
      try{const perf=await send('Performance.getMetrics',{},2000);const wanted=new Set(['TaskDuration','ScriptDuration','JSHeapUsedSize','Nodes','LayoutCount','RecalcStyleCount']);probe.metrics=Object.fromEntries((perf.metrics||[]).filter(m=>wanted.has(m.name)).map(m=>[m.name,m.value]));}catch(e){probe.performance=e.message;}
      telemetry.probeHistory.push(probe);
      if(html.length>1000&&axNodes.some(n=>['button','link','tab','menuitem'].includes(n.role.toLowerCase())))break;
      await sleep(350);
    }
    const runtimeProbe={};
    try{const r=await send('Runtime.evaluate',{expression:`(()=>({ready:document.readyState,bodyChildren:document.body?.childElementCount||0,bodyText:(document.body?.innerText||'').slice(0,240),controls:document.querySelectorAll('button,a,[role="button"],input,select,textarea').length,activeElement:document.activeElement?.tagName||null}))()`,returnByValue:true},2500);runtimeProbe.beforeTerminate=r.result?.value||null;}catch(e){runtimeProbe.beforeTerminateError=e.message;}
    try{const cookies=await send('Network.getCookies',{urls:[origin]},2500);runtimeProbe.sessionCookiePresentAfterNavigate=(cookies.cookies||[]).some(c=>c.name===session.name);}catch(e){runtimeProbe.cookieProbeError=e.message;}
    let shotStatus='BLOCKED'; let shotFile=`a11y-${spec.slug}.png`;
    try{const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},5000);fs.writeFileSync(path.join(outDir,shotFile),Buffer.from(shot.data,'base64'));shotStatus=fs.statSync(path.join(outDir,shotFile)).size>8000?'PASS':'TOO_SMALL';}catch(e){shotStatus=`BLOCKED:${e.message}`;shotFile=null;}
    const controls=[...new Map(axNodes.filter(n=>['button','link','tab','menuitem'].includes(n.role.toLowerCase())&&n.name).map(n=>[`${n.role}:${n.name}`,n])).values()];
    const postTerminate={attempted:false};
    if(!controls.length||!shotFile){
      postTerminate.attempted=true;
      try{await send('Runtime.terminateExecution',{},3000);postTerminate.terminate='ok';}catch(e){postTerminate.terminate=e.message;}
      await sleep(400);
      try{const doc=await send('DOM.getDocument',{depth:2,pierce:true},3000);const outer=await send('DOM.getOuterHTML',{nodeId:doc.root.nodeId},3000);postTerminate.htmlLength=String(outer.outerHTML||'').length;}catch(e){postTerminate.dom=e.message;}
      try{const ax=await send('Accessibility.getFullAXTree',{},3000);const nodes=(ax.nodes||[]).filter(n=>!n.ignored);postTerminate.axCount=nodes.length;postTerminate.controlCount=nodes.filter(n=>['button','link','tab','menuitem'].includes(String(n.role?.value||'').toLowerCase())&&String(n.name?.value||'').trim()).length;}catch(e){postTerminate.ax=e.message;}
      try{const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},5000);const file=`a11y-${spec.slug}-post-terminate.png`;fs.writeFileSync(path.join(outDir,file),Buffer.from(shot.data,'base64'));postTerminate.screenshot=file;postTerminate.screenshotBytes=fs.statSync(path.join(outDir,file)).size;}catch(e){postTerminate.screenshotError=e.message;}
    }
    const result={slug:spec.slug,email:spec.email,role:spec.role,tenant:spec.tenant,htmlLength:html.length,htmlSha256:crypto.createHash('sha256').update(html).digest('hex'),controlCount:controls.length,controls:controls.slice(0,100),axSummary:axNodes.slice(0,200),screenshot:shotFile,screenshotStatus:shotStatus,runtimeProbe,domErrors:[...new Set(domErrors)].slice(0,20),axErrors:[...new Set(axErrors)].slice(0,20),telemetry:{events:telemetry.events.slice(-80),responses:telemetry.responses.slice(-200),failures:telemetry.failures.slice(-80),exceptions:telemetry.exceptions.slice(-80),logs:telemetry.logs.slice(-80),probeHistory:telemetry.probeHistory.slice(-80)},postTerminate,pass:controls.length>0};
    fs.writeFileSync(path.join(outDir,`a11y-${spec.slug}.json`),JSON.stringify(result,null,2));
    console.log(`ROLE_A11Y_DIAGNOSTIC=${spec.slug}|controls=${controls.length}|screenshot=${shotStatus}|runtime=${runtimeProbe.beforeTerminateError||'responsive'}|postTerminate=${postTerminate.attempted?JSON.stringify({terminate:postTerminate.terminate,controls:postTerminate.controlCount,shot:postTerminate.screenshotBytes}):'not-needed'}|pass=${result.pass}`);
    return result;
  } finally {try{ws?.close();}catch{};if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGTERM');await sleep(500);if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL');try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
}

const health=await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(15000)}).then(r=>{assert.equal(r.status,200);return r.json();});
assert.equal(health.release,expectedRelease);assert.equal(health.fixtureOnly,true);assert.equal(health.productionApproved,false);assert.equal(health.pilotReady,false);
const specs=[
  {slug:'manager',email:'manager@northstar.example',role:'manager',tenant:'northstar-demo'},
  {slug:'employee',email:'maya@northstar.example',role:'employee',tenant:'northstar-demo'},
  {slug:'payroll',email:'payroll@northstar.example',role:'payroll_admin',tenant:'northstar-demo'},
  {slug:'company-admin',email:'superuser@northstar.example',role:'director',tenant:'northstar-demo'}
];
const roles=[];for(let i=0;i<specs.length;i++){try{roles.push(await inspectRole(specs[i],i));}catch(error){const fail={slug:specs[i].slug,email:specs[i].email,role:specs[i].role,tenant:specs[i].tenant,pass:false,error:String(error?.stack||error)};roles.push(fail);fs.writeFileSync(path.join(outDir,`a11y-${specs[i].slug}.json`),JSON.stringify(fail,null,2));console.error(`ROLE_A11Y_DIAGNOSTIC_FAIL=${specs[i].slug}|${error?.message||error}`);}}
const summary={capturedAt:new Date().toISOString(),origin,release:expectedRelease,sealedRuntimeSha256:expectedRuntimeSha,roles,pass:roles.every(r=>r.pass),claimBoundary:'fixture-only hosted staging diagnostic. Evidence is written before the gate fails. Zero accessible interactive controls is a failure, not a pass. Renderer/network/runtime telemetry is diagnostic only and does not mutate WFM state.'};
fs.writeFileSync(path.join(outDir,'role-accessibility-diagnostic.json'),JSON.stringify(summary,null,2));
console.log(`LIVE_ROLE_A11Y_DIAGNOSTIC=${summary.pass?'PASS':'FAIL'}|roles=${roles.length}|failed=${roles.filter(r=>!r.pass).map(r=>r.slug).join(',')||'none'}`);
assert.equal(summary.pass,true,`Role accessibility diagnostic failed for: ${roles.filter(r=>!r.pass).map(r=>r.slug).join(', ')}`);