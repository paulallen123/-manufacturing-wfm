import assert from 'node:assert/strict';
import { proofRunnerSession } from './proof-runner-auth.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const expectedOrigin = 'https://wfm-customer-proof-0676-production.up.railway.app';
const expectedRelease = '0.6.76-hosted-staging-rc1';
const expectedRuntimeSha = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
const origin = (process.env.WFM_PUBLIC_ORIGIN || expectedOrigin).replace(/\/$/, '');
assert.equal(origin, expectedOrigin, 'Unexpected role-browser proof origin.');

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

function digest(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

async function runRole({slug, email, expectedRole, expectedTenant, expectedPayrollStatus, requiredSurface, capabilityLabel}, roleIndex) {
  const port = 9300 + roleIndex * 30 + Math.floor(Math.random() * 20);
  const profile = path.join(process.env.RUNNER_TEMP || '/tmp', `wfm-role-${slug}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(profile, { recursive: true });
  const chromeEnv = { ...process.env };
    delete chromeEnv.WFM_PROOF_RUNNER_PRIVATE_KEY_B64;
  delete chromeEnv.RAILWAY_TOKEN;
  delete chromeEnv.WFM_DEMO_PASSWORD;
  const proc = spawn(chrome, [
    '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
    `--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1440,1000','about:blank'
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
    let id=1; const pending=new Map(); const browserApi=[];
    ws.addEventListener('message',event=>{
      const msg=JSON.parse(typeof event.data==='string'?event.data:Buffer.from(event.data).toString('utf8'));
      if (msg.id) {
        const p=pending.get(msg.id); if(!p) return; pending.delete(msg.id);
        msg.error?p.reject(new Error(`${p.method}: ${msg.error.message}`)):p.resolve(msg.result||{});
        return;
      }
      if(msg.method==='Network.responseReceived'){
        try{
          const u=new URL(msg.params.response.url);
          if(u.origin===origin&&u.pathname.startsWith('/api/')) browserApi.push({path:u.pathname,status:msg.params.response.status});
        }catch{}
      }
    });
    const send=(method,params={},timeoutMs=12000)=>new Promise((resolve,reject)=>{
      const n=id++;
      const timer=setTimeout(()=>{pending.delete(n);reject(new Error(`CDP ${method} timeout for ${slug}`));},timeoutMs);
      pending.set(n,{method,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
      ws.send(JSON.stringify({id:n,method,params}));
    });

    await send('Page.enable');
    await send('Network.enable');
    const beforeCookies = await send('Network.getCookies',{urls:[origin]});
    assert.equal(beforeCookies.cookies?.length || 0, 0, `${slug} fresh browser unexpectedly contained cookies.`);
    const pre = await fetch(`${origin}/api/bootstrap`, { signal: AbortSignal.timeout(15000) });
    assert.equal(pre.status,401,`${slug} unauthenticated bootstrap did not fail closed.`);
    const session = await proofRunnerSession({ origin, email, timeoutMs: 15_000 });
    const cookieSet = await send('Network.setCookie',{name:session.name,value:session.value,url:origin,secure:true,httpOnly:true,sameSite:'Strict'});
    assert.equal(cookieSet.success,true,`${slug} server-issued session could not be bound to the fresh browser.`);
    const browserCookies = await send('Network.getCookies',{urls:[origin]});
    assert.ok(browserCookies.cookies?.some(c=>c.name===session.name),`${slug} authenticated browser session cookie missing.`);
    const cookieHeader = `${session.name}=${session.value}`;

    const api = async pathName => fetch(`${origin}${pathName}`,{
      headers:{Cookie:cookieHeader,Accept:'application/json,text/plain,*/*',Referer:`${origin}/`},
      redirect:'manual',signal:AbortSignal.timeout(15000)
    });
    const identityResponse = await api('/api/bootstrap');
    assert.equal(identityResponse.status,200,`${slug} authenticated bootstrap failed.`);
    const identity = await identityResponse.json();
    assert.equal(identity.actor?.role,expectedRole,`${slug} role mismatch.`);
    assert.equal(identity.actor?.tenant,expectedTenant,`${slug} tenant mismatch.`);

    const payrollResponse = await api('/api/payroll-run');
    assert.equal(payrollResponse.status,expectedPayrollStatus,`${slug} payroll boundary mismatch.`);
    let surfaceStatus=null;
    if(requiredSurface){
      const surfaceResponse=await api(requiredSurface);
      surfaceStatus=surfaceResponse.status;
      assert.equal(surfaceStatus,200,`${slug} required surface ${requiredSurface} failed.`);
    }

    async function currentDom() {
      const doc=await send('DOM.getDocument',{depth:2,pierce:true},5000);
      const html=await send('DOM.getOuterHTML',{nodeId:doc.root.nodeId},5000);
      return String(html.outerHTML||'');
    }
    const bootstrapBeforeRender=browserApi.filter(x=>x.path==='/api/bootstrap'&&x.status===200).length;
    await send('Page.navigate',{url:origin});
    const deadline=Date.now()+20000;
    let desktopHtml='';
    while(Date.now()<deadline){
      try{
        desktopHtml=await currentDom();
        const count=browserApi.filter(x=>x.path==='/api/bootstrap'&&x.status===200).length;
        if(desktopHtml.length>1000&&count>bootstrapBeforeRender) break;
      }catch{}
      await sleep(300);
    }
    assert.ok(desktopHtml.length>1000,`${slug} authenticated rendered DOM was unexpectedly empty.`);
    assert.ok(browserApi.filter(x=>x.path==='/api/bootstrap'&&x.status===200).length>bootstrapBeforeRender,`${slug} browser did not perform a fresh authenticated bootstrap after navigation.`);
    const desktopDomSha256=digest(desktopHtml);

    console.log(`ROLE_BROWSER_SESSION_PASS=${slug}|role=${expectedRole}|tenant=${expectedTenant}|capability=${capabilityLabel}|payroll=${payrollResponse.status}|surface=${requiredSurface||'none'}:${surfaceStatus??'n/a'}|renderedDom=${desktopHtml.length}/${desktopDomSha256.slice(0,12)}`);
    return {
      slug,email,role:expectedRole,tenant:expectedTenant,capabilityLabel,
      freshBrowserCookieCount:beforeCookies.cookies?.length||0,
      freshBootstrapStatus:pre.status,loginStatus:loginResponse.status,payrollStatus:payrollResponse.status,
      requiredSurface,requiredSurfaceStatus:surfaceStatus,
      rendered:{domLength:desktopHtml.length,domSha256:desktopDomSha256,viewport:'1440x1000 browser window',authenticatedBootstrapAfterNavigation:true},
      observedBrowserApi:[...new Map(browserApi.map(x=>[`${x.path}:${x.status}`,x])).values()],
      browserContext:'fresh Chrome process/profile received the exact server-issued authenticated session cookie; cookie value never logged or persisted',
      uiClaimBoundary:'role/capability-specific authenticated home produced a non-trivial rendered DOM in a fresh browser; visual mobile/keyboard/overflow quality is proven separately by the dedicated authenticated visual gate; not every task is clicked end-to-end'
    };
  } finally {
    try{ws?.close();}catch{}
    const exited = new Promise(resolve => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve(true);
      proc.once('exit', () => resolve(true));
    });
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
    await Promise.race([exited, sleep(1500)]);
    if (proc.exitCode === null && proc.signalCode === null) { proc.kill('SIGKILL'); await Promise.race([exited, sleep(1500)]); }
    for(let attempt=0;attempt<4;attempt++){
      try { fs.rmSync(profile,{recursive:true,force:true}); break; }
      catch(error){ if(attempt===3) console.warn(`ROLE_BROWSER_PROFILE_CLEANUP_WARNING=${slug}|${error?.message||error}`); else await sleep(250); }
    }
  }
}

const healthResponse=await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(15000)});
assert.equal(healthResponse.status,200);
const health=await healthResponse.json();
assert.equal(health.release,expectedRelease);
assert.equal(health.productionApproved,false);
assert.equal(health.pilotReady,false);

const specs=[
  {slug:'manager',email:'manager@northstar.example',expectedRole:'manager',expectedTenant:'northstar-demo',expectedPayrollStatus:403,requiredSurface:'/api/time-review',capabilityLabel:'manager-time-review'},
  {slug:'employee',email:'maya@northstar.example',expectedRole:'employee',expectedTenant:'northstar-demo',expectedPayrollStatus:403,requiredSurface:'/api/personal',capabilityLabel:'employee-personal'},
  {slug:'payroll',email:'payroll@northstar.example',expectedRole:'payroll_admin',expectedTenant:'northstar-demo',expectedPayrollStatus:200,requiredSurface:'/api/payroll-run',capabilityLabel:'payroll-release'},
  {slug:'company-admin',email:'superuser@northstar.example',expectedRole:'director',expectedTenant:'northstar-demo',expectedPayrollStatus:200,requiredSurface:'/api/onboarding',capabilityLabel:'company-onboarding-and-payroll'},
  {slug:'isolation-manager',email:'other@isolation.example',expectedRole:'manager',expectedTenant:'isolation-test',expectedPayrollStatus:403,requiredSurface:'/api/bootstrap',capabilityLabel:'separate-tenant-manager'}
];
const roles=[];
for(let i=0;i<specs.length;i++) roles.push(await runRole(specs[i],i));

fs.writeFileSync(path.join(outDir,'separate-role-browser-contexts.json'),JSON.stringify({
  capturedAt:new Date().toISOString(),origin,release:expectedRelease,sealedRuntimeSha256:expectedRuntimeSha,
  processIsolation:'five fresh Chrome profiles/processes; each had zero cookies before authentication and unauthenticated /api/bootstrap returned 401',
  authMethod:'signed passwordless proof-runner exchange created the short-lived server session; CDP bound that session to the corresponding fresh Chrome process; signing material was not passed to Chrome',
  renderedEvidence:'manager, employee, payroll, company-admin capability account and separate-tenant manager each produced a hashed non-trivial authenticated DOM after a fresh browser navigation and authenticated browser bootstrap',
  companyAdminFixtureNote:'the account named superuser@northstar.example is represented by the server as role=director; company-level capability is proven by successful onboarding and payroll surfaces rather than relabelling the authoritative role enum',
  mobileVisualEvidence:'separate dedicated authenticated visual gate covers desktop/mobile screenshots, no horizontal overflow, keyboard focus and live navigation on the same frozen release',
  roles,result:'PASS',
  claimBoundary:'fictional fixture staging; proves separate authenticated browser session contexts, server-side role/tenant/capability boundaries, and role-specific browser rendering; visual mobile quality is covered separately; not every role-specific task is clicked end-to-end; no production/pilot approval and no real employee/payroll data'
},null,2));
console.log(`LIVE_SEPARATE_ROLE_BROWSER_SESSION_PROOF=PASS|contexts=${roles.length}|rendered_dom=${roles.length}`);
