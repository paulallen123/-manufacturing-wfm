import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const PORT=9271, DRIVER_PORT=9515;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(v,m)=>{if(!v)throw new Error(m);};
const temp=mkdtempSync(join(tmpdir(),'wfm-ux11-webdriver-'));
const source=readFileSync('.github/scripts/ux-cycle11-context-browser.mjs','utf8');
const marker='function chromePath(){';
const cut=source.indexOf(marker);
if(cut<0)throw new Error('Existing browser fixture/server contract marker missing');
const hostFile=join(temp,'fixture-host.mjs');
writeFileSync(hostFile,source.slice(0,cut)+"\nconsole.log('UX11_FIXTURE_HOST_READY');\n");

const node=process.execPath;
const host=spawn(node,[hostFile],{cwd:process.cwd(),stdio:['ignore','inherit','inherit']});
let driver=null, sessionId=null;

async function retry(fn,attempts=100,delay=150){let err;for(let i=0;i<attempts;i++){try{return await fn();}catch(e){err=e;await sleep(delay);}}throw err;}
async function jsonFetch(url,opts={},timeoutMs=5000){
  const r=await fetch(url,{...opts,signal:AbortSignal.timeout(timeoutMs)});
  const text=await r.text();
  let body={}; try{body=text?JSON.parse(text):{};}catch{throw new Error(`Non-JSON WebDriver response ${r.status}: ${text.slice(0,160)}`);}
  if(!r.ok||body?.value?.error)throw new Error(body?.value?.message||`WebDriver HTTP ${r.status}`);
  return body;
}
async function wd(method,path,body){
  const out=await jsonFetch(`http://127.0.0.1:${DRIVER_PORT}${path}`,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  return out.value;
}

try{
  await retry(async()=>{const r=await fetch(`http://127.0.0.1:${PORT}/`,{signal:AbortSignal.timeout(1000)});if(!r.ok)throw new Error('fixture host not ready');return true;});
  const driverPath=execFileSync('bash',['-lc','command -v chromedriver'],{encoding:'utf8'}).trim();
  if(!driverPath)throw new Error('ChromeDriver not found on hosted runner');
  driver=spawn(driverPath,[`--port=${DRIVER_PORT}`,'--allowed-ips=127.0.0.1'],{stdio:['ignore','inherit','inherit']});
  await retry(async()=>{const r=await fetch(`http://127.0.0.1:${DRIVER_PORT}/status`,{signal:AbortSignal.timeout(1000)});if(!r.ok)throw new Error('chromedriver not ready');const j=await r.json();if(j?.value?.ready===false)throw new Error('chromedriver reports not ready');return true;});

  const created=await jsonFetch(`http://127.0.0.1:${DRIVER_PORT}/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capabilities:{alwaysMatch:{browserName:'chrome',pageLoadStrategy:'none','goog:chromeOptions':{args:['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--window-size=1440,1000']}}}})},20000);
  sessionId=created?.value?.sessionId||created?.sessionId;
  if(!sessionId)throw new Error('ChromeDriver did not return a session id');
  await wd('POST',`/session/${sessionId}/url`,{url:`http://127.0.0.1:${PORT}/`});
  const evalx=async expression=>wd('POST',`/session/${sessionId}/execute/sync`,{script:`return (${expression});`,args:[]});
  const cdp=async(cmd,params={})=>wd('POST',`/session/${sessionId}/goog/cdp/execute`,{cmd,params});
  console.log('UX11_BROWSER_STAGE=WEBDRIVER_READY');

  await retry(async()=>{const ready=await evalx(`(()=>{const b=document.querySelector('.vector-priority-slot .ux11-open[data-ux11-route="integrations"]');const q=b?.closest('.ux11-queue');return document.body.classList.contains('vector-ui-active')&&!!document.querySelector('.vector-home')&&!!b&&q?.dataset.vectorProjected==='true'&&getComputedStyle(q).display!=='none';})()`);if(!ready)throw new Error('Vector governed action queue not ready');return true;});
  const projection=await evalx(`(()=>({vector:document.body.dataset.vectorUi||null,slot:!!document.querySelector('.vector-priority-slot'),projected:document.querySelector('.vector-priority-slot .ux11-queue')?.dataset.vectorProjected||null,hiddenSource:getComputedStyle(document.querySelector('.vector-home-source')).display}))()`);
  console.log('VECTOR_PRIORITY_PROJECTION='+JSON.stringify(projection));
  assert(projection.slot&&projection.projected==='true'&&projection.hiddenSource==='none','Governed action queue was not projected out of hidden Vector source');

  async function exercise({route,sourceId,targetCheck}){
    const origin=await evalx(`(()=>{const b=document.querySelector('.vector-priority-slot .ux11-open[data-ux11-route="${route}"]');if(!b)return null;const x={id:b.dataset.ux11Id,sourceId:b.dataset.ux11SourceId};b.click();return x;})()`);
    assert(origin,`Missing ${route} queue action`);
    assert(origin.sourceId===sourceId,`${route} sourceId mismatch: ${origin.sourceId}`);
    await retry(async()=>{const state=await evalx(targetCheck);if(!state?.ready)throw new Error(`${route} target not ready`);return state;});
    const destination=await evalx(targetCheck);
    console.log(`UX11_${route.toUpperCase().replaceAll('-','_')}_DESTINATION=`+JSON.stringify(destination));
    const back=await evalx("(()=>{const b=document.querySelector('.ux11-back');if(!b)return false;b.click();return true})()");
    assert(back,`${route} return control missing`);
    await retry(async()=>{const ok=await evalx(`ui.page==='overview'&&document.querySelector('.vector-home')&&document.activeElement?.dataset?.ux11Id==='${origin.id}'&&!!document.activeElement?.closest('.vector-priority-slot')`);if(!ok)throw new Error(`${route} origin focus not restored in Vector priority slot`);return true;});
  }

  await exercise({route:'integrations',sourceId:'conn-1',targetCheck:`(()=>({ready:ui.page==='integrations'&&!!document.querySelector('.integration-panel[data-integration-id="conn-1"]')&&!!document.querySelector('.ux11-back')&&document.body.classList.contains('vector-ui-active'),back:!!document.querySelector('.ux11-back'),vector:document.body.dataset.vectorUi||null}))()`});
  console.log('VECTOR_INTEGRATIONS_ROUNDTRIP=PASS');
  await exercise({route:'leave',sourceId:'leave-1',targetCheck:`(()=>({ready:ui.page==='leave'&&document.activeElement?.matches('.ux-leave-card[data-request="leave-1"]'),request:document.activeElement?.dataset?.request||null,back:!!document.querySelector('.ux11-back')}))()`});
  await exercise({route:'time-review',sourceId:'team-a',targetCheck:`(()=>({ready:ui.page==='time-review'&&document.getElementById('tri-team')?.value==='team-a'&&document.activeElement?.classList.contains('tr-person'),team:document.getElementById('tri-team')?.value||null,target:document.activeElement?.textContent?.trim()||null,back:!!document.querySelector('.ux11-back')}))()`});
  await exercise({route:'weekly-review',sourceId:'team-b',targetCheck:`(()=>({ready:ui.page==='weekly-review'&&document.getElementById('review-team')?.value==='team-b'&&document.activeElement?.classList.contains('ux-signoff-desk'),team:document.getElementById('review-team')?.value||null,target:document.querySelector('.ux-signoff-desk b')?.textContent?.trim()||null,back:!!document.querySelector('.ux11-back')}))()`});

  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(250);
  const mobile=await evalx(`(()=>({overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,actions:document.querySelectorAll('.vector-priority-slot .ux11-open').length,queue:!!document.querySelector('.vector-priority-slot .ux11-queue'),vectorMenu:!!document.querySelector('.vector-mobile-menu')}))()`);
  console.log('UX11_CONTEXT_MOBILE='+JSON.stringify(mobile));
  assert(mobile.queue&&mobile.actions>=4&&mobile.overflow<=2,'390px Vector queue containment failed');
  const mobileOrigin=await evalx(`(()=>{const b=document.querySelector('.vector-priority-slot .ux11-open[data-ux11-route="integrations"]');const id=b?.dataset.ux11Id||null;b?.click();return id})()`);
  assert(mobileOrigin,'Mobile Integrations action missing');
  await retry(async()=>{const ok=await evalx("ui.page==='integrations'&&!!document.querySelector('.ux11-back')");if(!ok)throw new Error('Mobile Integrations route not ready');return true;});
  await evalx("(()=>{document.querySelector('.ux11-back').click();return true})()");
  await retry(async()=>{const ok=await evalx(`ui.page==='overview'&&document.querySelector('.vector-home')&&document.activeElement?.dataset?.ux11Id==='${mobileOrigin}'&&!!document.activeElement?.closest('.vector-priority-slot')`);if(!ok)throw new Error('Mobile Vector origin focus not restored');return true;});
  const mobileReturn=await evalx("(()=>({overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,focused:document.activeElement?.dataset?.ux11Route||null,projected:document.querySelector('.vector-priority-slot .ux11-queue')?.dataset.vectorProjected||null}))()");
  console.log('UX11_CONTEXT_MOBILE_RETURN='+JSON.stringify(mobileReturn));
  assert(mobileReturn.overflow<=2&&mobileReturn.focused==='integrations'&&mobileReturn.projected==='true','390px Vector return-focus regression failed');
  console.log('UX11_CONTEXT_BROWSER_REGRESSION=PASS');
} finally {
  if(sessionId){try{await wd('DELETE',`/session/${sessionId}`);}catch(e){console.error('WEBDRIVER_SESSION_CLEANUP_WARNING='+e.message);}}
  try{driver?.kill('SIGTERM');}catch{}
  try{host.kill('SIGTERM');}catch{}
  await sleep(300);
  try{driver?.kill('SIGKILL');}catch{}
  try{host.kill('SIGKILL');}catch{}
  try{rmSync(temp,{recursive:true,force:true});}catch(e){console.error('WEBDRIVER_TEMP_CLEANUP_WARNING='+e.code);}
}
