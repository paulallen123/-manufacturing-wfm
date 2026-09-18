import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const expectedOrigin = 'https://wfm-customer-proof-0676-production.up.railway.app';
const expectedRelease = '0.6.76-hosted-staging-rc1';
const expectedRuntimeSha = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
const origin = (process.env.WFM_PUBLIC_ORIGIN || expectedOrigin).replace(/\/$/, '');
const password = process.env.WFM_STAGING_PASSWORD;
assert.equal(origin, expectedOrigin, 'Unexpected role-browser proof origin.');
assert.ok(password && password.length >= 20, 'Staging password is unavailable to role-browser proof.');

const outDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'wfm-evidence-output');
fs.mkdirSync(outDir, { recursive: true });

function executable(candidates) {
  for (const candidate of candidates) {
    const which = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  }
  return '';
}
const chrome = executable(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']);
assert.ok(chrome, 'No Chrome/Chromium executable is available on the pinned runner.');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runRole({slug, email, expectedRole, expectedTenant, mobile=false, expectedPayrollStatus, requiredSurface}) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = path.join(process.env.RUNNER_TEMP || '/tmp', `wfm-role-${slug}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(profile, { recursive: true });
  const chromeEnv = { ...process.env };
  delete chromeEnv.WFM_STAGING_PASSWORD;
  delete chromeEnv.RAILWAY_TOKEN;
  delete chromeEnv.WFM_DEMO_PASSWORD;
  const proc = spawn(chrome, [
    '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
    `--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,
    mobile ? '--window-size=390,844' : '--window-size=1280,900','about:blank'
  ], {stdio:['ignore','ignore','ignore'], env:chromeEnv});
  let ws;
  try {
    let targets;
    for (let i=0;i<50;i++) {
      try {
        const r=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1500)});
        if (r.ok) { const j=await r.json(); if (j.length) {targets=j; break;} }
      } catch {}
      await sleep(150);
    }
    assert.ok(targets?.length, `No CDP target for ${slug}.`);
    const t=targets.find(x=>x.type==='page')||targets[0];
    ws=new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`CDP open timeout for ${slug}`)),5000);
      ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      ws.addEventListener('error',e=>{clearTimeout(timer);reject(e.error||new Error('CDP error'));},{once:true});
    });
    let id=1; const pending=new Map();
    ws.addEventListener('message',event=>{
      const msg=JSON.parse(typeof event.data==='string'?event.data:Buffer.from(event.data).toString('utf8'));
      if (!msg.id) return;
      const p=pending.get(msg.id); if(!p) return; pending.delete(msg.id);
      msg.error?p.reject(new Error(`${p.method}: ${msg.error.message}`)):p.resolve(msg.result||{});
    });
    const send=(method,params={})=>new Promise((resolve,reject)=>{const n=id++;pending.set(n,{resolve,reject,method});ws.send(JSON.stringify({id:n,method,params}));});
    const evalv=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text||'eval failed');return r.result?.value;};
    const wait=async (expr,timeout=15000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await evalv(expr))return;await sleep(180);}throw new Error(`wait timeout ${slug}: ${expr}`);};
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1280,height:mobile?844:900,deviceScaleFactor:1,mobile});
    await send('Page.navigate',{url:origin});
    await wait(`document.readyState==='complete'||document.readyState==='interactive'`);

    // Every process starts from a new user-data directory. Prove it has no inherited authenticated session.
    const pre=await evalv(`(async()=>{const r=await fetch('/api/bootstrap');return r.status})()`);
    assert.equal(pre,401,`${slug} fresh browser unexpectedly inherited a session.`);

    const login=await evalv(`(async()=>{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:${JSON.stringify(password)}})});return r.status})()`);
    assert.equal(login,200,`${slug} login failed.`);
    await send('Page.reload',{ignoreCache:true});
    await wait(`!document.querySelector('#v2-login')&&document.body&&document.body.innerText.length>100`);
    const identity=await evalv(`(async()=>{const r=await fetch('/api/bootstrap');return {status:r.status,json:await r.json()}})()`);
    assert.equal(identity.status,200);
    assert.equal(identity.json.actor?.role,expectedRole,`${slug} role mismatch.`);
    assert.equal(identity.json.actor?.tenant,expectedTenant,`${slug} tenant mismatch.`);

    const payroll=await evalv(`(async()=>{const r=await fetch('/api/payroll-run');return r.status})()`);
    assert.equal(payroll,expectedPayrollStatus,`${slug} payroll boundary mismatch.`);
    let surfaceStatus=null;
    if(requiredSurface){
      surfaceStatus=await evalv(`(async()=>{const r=await fetch(${JSON.stringify(requiredSurface)});return r.status})()`);
      assert.equal(surfaceStatus,200,`${slug} required surface ${requiredSurface} failed.`);
    }
    const layout=await evalv(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('button,a[href]')].filter(x=>{const s=getComputedStyle(x);return x.getClientRects().length>0&&s.display!=='none'&&s.visibility!=='hidden'}).length})`);
    assert.ok(layout.scrollWidth<=layout.width+1,`${slug} horizontal overflow.`);
    assert.ok(layout.buttons>0,`${slug} has no rendered interactive controls.`);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true});
    const shotName=`40-role-${slug}-${mobile?'mobile':'desktop'}.png`;
    const shotPath=path.join(outDir,shotName); fs.writeFileSync(shotPath,Buffer.from(shot.data,'base64'));
    assert.ok(fs.statSync(shotPath).size>10000,`${slug} screenshot unexpectedly small.`);
    console.log(`ROLE_BROWSER_PASS=${slug}|role=${expectedRole}|tenant=${expectedTenant}|payroll=${payroll}|surface=${requiredSurface||'none'}:${surfaceStatus??'n/a'}|overflow=${layout.scrollWidth-layout.width}`);
    return {slug,email,role:expectedRole,tenant:expectedTenant,freshBootstrapStatus:pre,loginStatus:login,payrollStatus:payroll,requiredSurface,requiredSurfaceStatus:surfaceStatus,viewport:mobile?'390x844':'1280x900',horizontalOverflowPixels:layout.scrollWidth-layout.width,renderedInteractiveControls:layout.buttons,screenshot:shotName};
  } finally {
    try{ws?.close();}catch{}
    proc.kill('SIGTERM'); await sleep(200); if(!proc.killed)proc.kill('SIGKILL');
    fs.rmSync(profile,{recursive:true,force:true});
  }
}

const health=await (await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(15000)})).json();
assert.equal(health.release,expectedRelease);
assert.equal(health.productionApproved,false);
assert.equal(health.pilotReady,false);

const roles=[];
roles.push(await runRole({slug:'manager',email:'manager@northstar.example',expectedRole:'manager',expectedTenant:'northstar-demo',expectedPayrollStatus:403,requiredSurface:'/api/time-review'}));
roles.push(await runRole({slug:'employee',email:'maya@northstar.example',expectedRole:'employee',expectedTenant:'northstar-demo',mobile:true,expectedPayrollStatus:403,requiredSurface:'/api/personal'}));
roles.push(await runRole({slug:'payroll',email:'payroll@northstar.example',expectedRole:'payroll_admin',expectedTenant:'northstar-demo',expectedPayrollStatus:200,requiredSurface:'/api/payroll-run'}));
roles.push(await runRole({slug:'isolation-manager',email:'other@isolation.example',expectedRole:'manager',expectedTenant:'isolation-test',expectedPayrollStatus:403,requiredSurface:'/api/bootstrap'}));

fs.writeFileSync(path.join(outDir,'separate-role-browser-contexts.json'),JSON.stringify({
  capturedAt:new Date().toISOString(),origin,release:expectedRelease,sealedRuntimeSha256:expectedRuntimeSha,
  processIsolation:'four fresh Chrome profiles/processes; each proved /api/bootstrap 401 before login',roles,
  result:'PASS',
  claimBoundary:'fictional fixture staging; separate authenticated browser contexts; no production/pilot approval and no real employee/payroll data'
},null,2));
console.log(`LIVE_SEPARATE_ROLE_BROWSER_CONTEXT_PROOF=PASS|contexts=${roles.length}`);
delete process.env.WFM_STAGING_PASSWORD;
