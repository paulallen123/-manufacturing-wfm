import assert from 'node:assert/strict';
import { proofRunnerSession } from './proof-runner-auth.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const origin = (process.env.WFM_PUBLIC_ORIGIN || 'https://wfm-customer-proof-0676-production.up.railway.app').replace(/\/$/, '');
const expectedOrigin = 'https://wfm-customer-proof-0676-production.up.railway.app';
const expectedRelease = '0.6.76-hosted-staging-rc1';
assert.equal(origin, expectedOrigin, 'Unexpected proof origin.');
const outDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'wfm-evidence-output');
fs.mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function executable(names) {
  for (const name of names) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return '';
}
const chrome = executable(['google-chrome','google-chrome-stable','chromium','chromium-browser']);
assert.ok(chrome, 'Chrome/Chromium unavailable.');

async function login() {
  return proofRunnerSession({ origin, email: 'maya@northstar.example', timeoutMs: 15_000 });
}

const sourceResponse = await fetch(`${origin}/value-cockpit-ui.js`, { signal: AbortSignal.timeout(15000) });
assert.equal(sourceResponse.status, 200, 'Live value-cockpit-ui.js unavailable.');
const liveSource = await sourceResponse.text();
const cycle5Marker = '/* WFM UX evolution cycle 5:';
const cycle6Marker = '/* WFM UX evolution cycle 6:';
const c5 = liveSource.indexOf(cycle5Marker);
const c6 = liveSource.indexOf(cycle6Marker, c5 + 1);
assert.ok(c5 >= 0 && c6 > c5, 'Cycle 5/6 boundaries not found in live composed script.');
const cycle5Source = liveSource.slice(c5, c6);
const riskyInsert = "const more=nav.querySelector('[data-ux=\"more\"]');nav.insertBefore(b,more||null);";
const riskyLabel = "const label=b.querySelector('span');if(label)label.textContent='My details';b.setAttribute('aria-label','My details');b.title='My details';";
assert.equal((cycle5Source.match(new RegExp(riskyInsert.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g')) || []).length, 1, 'Expected cycle-5 nav reinsertion site not found exactly once.');
assert.equal((cycle5Source.match(new RegExp(riskyLabel.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g')) || []).length, 1, 'Expected cycle-5 label mutation site not found exactly once.');

const strippedSource = liveSource.slice(0, c5) + '/* cycle 5 intentionally stripped for browser-only causal diagnostic */\n' + liveSource.slice(c6);
let patchedCycle5 = cycle5Source.replace(
  riskyLabel,
  "const label=b.querySelector('span');if(label&&label.textContent!=='My details')label.textContent='My details';if(b.getAttribute('aria-label')!=='My details')b.setAttribute('aria-label','My details');if(b.title!=='My details')b.title='My details';"
).replace(
  riskyInsert,
  "const more=nav.querySelector('[data-ux=\"more\"]');if((more&&b.nextElementSibling!==more)||(!more&&b.nextElementSibling!==null))nav.insertBefore(b,more||null);"
);
assert.notEqual(patchedCycle5, cycle5Source, 'Cycle 5 repair transform made no change.');
const patchedSource = liveSource.slice(0, c5) + patchedCycle5 + liveSource.slice(c6);

async function runVariant(name, scriptSource, index) {
  const port = 9960 + index * 20 + Math.floor(Math.random() * 8);
  const profile = path.join(process.env.RUNNER_TEMP || '/tmp', `wfm-overlay-${name}-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(profile, { recursive: true });
  const env = {...process.env}; delete env.WFM_STAGING_PASSWORD; delete env.WFM_PROOF_RUNNER_PRIVATE_KEY_B64; delete env.RAILWAY_TOKEN; delete env.WFM_DEMO_PASSWORD;
  const proc = spawn(chrome, ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1440,1000','about:blank'], {stdio:['ignore','ignore','ignore'], env});
  let ws;
  try {
    let targets;
    for (let i=0;i<60;i++) { try { const r=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1500)}); if(r.ok){const j=await r.json();if(j.length){targets=j;break;}} } catch {} await sleep(150); }
    assert.ok(targets?.length, `No CDP target for ${name}`);
    const target = targets.find(x=>x.type==='page') || targets[0];
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CDP open timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',e=>{clearTimeout(timer);reject(e.error||new Error('CDP error'));},{once:true});});
    let id=1; const pending=new Map(); let intercepted=0; const failures=[]; const exceptions=[];
    const send=(method,params={},timeout=6000)=>new Promise((resolve,reject)=>{const n=id++;const timer=setTimeout(()=>{pending.delete(n);reject(new Error(`${method} timeout`));},timeout);pending.set(n,{method,resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params}));});
    ws.addEventListener('message', event => {
      const msg=JSON.parse(typeof event.data==='string'?event.data:Buffer.from(event.data).toString('utf8'));
      if(msg.id){const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);msg.error?p.reject(new Error(`${p.method}:${msg.error.message}`)):p.resolve(msg.result||{});return;}
      if(msg.method==='Fetch.requestPaused') {
        const u=String(msg.params?.request?.url||'');
        if(u.startsWith(`${origin}/value-cockpit-ui.js`)) {
          intercepted++;
          void send('Fetch.fulfillRequest',{requestId:msg.params.requestId,responseCode:200,responseHeaders:[{name:'content-type',value:'application/javascript; charset=utf-8'},{name:'cache-control',value:'no-store'}],body:Buffer.from(scriptSource,'utf8').toString('base64')},5000).catch(e=>failures.push(`fulfill:${e.message}`));
        } else void send('Fetch.continueRequest',{requestId:msg.params.requestId},5000).catch(e=>failures.push(`continue:${e.message}`));
      }
      if(msg.method==='Network.loadingFailed') failures.push(String(msg.params?.errorText||'network failure'));
      if(msg.method==='Runtime.exceptionThrown') exceptions.push(String(msg.params?.exceptionDetails?.exception?.description||msg.params?.exceptionDetails?.text||'runtime exception').slice(0,500));
    });
    await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable'); await send('DOM.enable'); await send('Accessibility.enable'); await send('Performance.enable');
    await send('Fetch.enable',{patterns:[{urlPattern:`${origin}/value-cockpit-ui.js*`,requestStage:'Request'}]});
    const session=await login();
    const bound=await send('Network.setCookie',{name:session.name,value:session.value,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}); assert.equal(bound.success,true);
    await send('Page.navigate',{url:origin});
    let controlCount=0, htmlLength=0, shotBytes=0, lastMetrics={}; const probes=[];
    const deadline=Date.now()+12000;
    while(Date.now()<deadline){
      try{const doc=await send('DOM.getDocument',{depth:2,pierce:true},1500);const outer=await send('DOM.getOuterHTML',{nodeId:doc.root.nodeId},1500);htmlLength=String(outer.outerHTML||'').length;}catch{}
      try{const ax=await send('Accessibility.getFullAXTree',{},1500);controlCount=(ax.nodes||[]).filter(n=>!n.ignored&&['button','link','tab','menuitem'].includes(String(n.role?.value||'').toLowerCase())&&String(n.name?.value||'').trim()).length;}catch{}
      try{const perf=await send('Performance.getMetrics',{},1500);const wanted=new Set(['TaskDuration','ScriptDuration','JSHeapUsedSize','Nodes']);lastMetrics=Object.fromEntries((perf.metrics||[]).filter(m=>wanted.has(m.name)).map(m=>[m.name,m.value]));}catch{}
      probes.push({at:Date.now(),htmlLength,controlCount,metrics:lastMetrics});
      if(controlCount>0)break;
      await sleep(350);
    }
    try{const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},4000);const file=path.join(outDir,`employee-overlay-${name}.png`);fs.writeFileSync(file,Buffer.from(shot.data,'base64'));shotBytes=fs.statSync(file).size;}catch{}
    const pass=intercepted===1&&controlCount>0&&shotBytes>8000;
    const result={variant:name,intercepted,liveSourceSha256:crypto.createHash('sha256').update(liveSource).digest('hex'),injectedSourceSha256:crypto.createHash('sha256').update(scriptSource).digest('hex'),htmlLength,controlCount,screenshotBytes:shotBytes,metrics:lastMetrics,probes:probes.slice(-30),networkFailures:failures.slice(-30),runtimeExceptions:exceptions.slice(-30),pass,claimBoundary:'Browser-only response substitution for causal diagnosis. Does not change Railway, the sealed runtime, tenant data, or the frozen proof candidate.'};
    fs.writeFileSync(path.join(outDir,`employee-overlay-${name}.json`),JSON.stringify(result,null,2));
    console.log(`EMPLOYEE_OVERLAY_AB=${name}|intercepted=${intercepted}|controls=${controlCount}|shot=${shotBytes}|nodes=${lastMetrics.Nodes}|script=${lastMetrics.ScriptDuration}|task=${lastMetrics.TaskDuration}|pass=${pass}`);
    return result;
  } finally { try{ws?.close();}catch{}; if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGTERM'); await sleep(400); if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL'); try{fs.rmSync(profile,{recursive:true,force:true});}catch{} }
}

const stripped = await runVariant('strip-cycle5', strippedSource, 0);
const repaired = await runVariant('idempotent-cycle5', patchedSource, 1);
const result = {
  capturedAt:new Date().toISOString(), origin, release:expectedRelease,
  sourceBoundaries:{cycle5Start:c5,cycle6Start:c6,cycle5Bytes:Buffer.byteLength(cycle5Source)},
  hypothesis:'Employee-only MutationObserver churn is caused by cycle-5 promotePersonal repeatedly mutating the observed navigation even after it is already in the desired state.',
  stripped, repaired,
  causalSupport: stripped.pass && repaired.pass,
  claimBoundary:'A/B evidence is browser-only response substitution. Passing variants support a repair hypothesis but are not release acceptance and do not modify the frozen candidate.'
};
fs.writeFileSync(path.join(outDir,'employee-overlay-isolation.json'),JSON.stringify(result,null,2));
console.log(`EMPLOYEE_OVERLAY_CAUSAL_SUPPORT=${result.causalSupport?'PASS':'NOT_PROVEN'}|strip=${stripped.pass}|repair=${repaired.pass}`);
delete process.env.WFM_STAGING_PASSWORD;
assert.equal(result.causalSupport,true,'Employee overlay causal isolation did not pass both strip and repair variants.');
