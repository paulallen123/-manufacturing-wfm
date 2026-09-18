import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const PORT = 9271;
const CDP_PORT = 9272;
const cwd = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'wfm-ux11-browser-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };

const fixture = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/ux-reset-cycle11.css">
<style>
*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f5f7f7;color:#193842}.sidebar{display:flex;gap:8px;padding:8px;border-bottom:1px solid #d8e0e3;overflow:auto}.navbtn,.btn{padding:8px 10px}.shell{max-width:1180px;margin:auto;padding:16px}.heading{display:flex;justify-content:space-between;gap:12px;align-items:center}.fcc-main{min-width:0}.ux-leave-card,.tr-list,.ux-signoff-desk{border:1px solid #d8e0e3;border-radius:12px;padding:14px;margin:10px 0;background:white}.tr-list{display:grid;gap:8px}.tr-person{padding:8px;text-align:left}.scope{display:flex;gap:8px;align-items:center;flex-wrap:wrap}select{max-width:100%;padding:8px}@media(max-width:620px){.shell{padding:10px}.heading{align-items:flex-start;flex-direction:column}}
</style></head><body>
<nav class="sidebar" aria-label="Primary">
<button class="navbtn" data-page="overview">Today</button>
<button class="navbtn" data-page="leave">Absence</button>
<button class="navbtn" data-page="time-review">Time Review</button>
<button class="navbtn" data-page="weekly-review">Weekly Sign-off</button>
</nav>
<div class="shell" id="app"></div>
<script>
window.ui={page:'overview',role:'manager'};
window.F={actor:{role:'manager',team:'team-a'}};
window.isEmployee=()=>false;
const PEOPLE=[{id:'e1',name:'Alex Morgan',team:'team-a'},{id:'e2',name:'Sam Patel',team:'team-b'}];
window.people=()=>PEOPLE;
window.person=id=>PEOPLE.find(p=>String(p.id)===String(id))||null;
window.data={requests:[
 {id:'leave-1',employee:'e1',status:'pending',hours:8,date:'2026-09-21',createdAt:'2026-09-18T08:00:00Z'},
 {id:'leave-2',employee:'e2',status:'approved',hours:8,date:'2026-09-22',createdAt:'2026-09-17T08:00:00Z'}
]};
const REPORT={generatedAt:'2026-09-18T08:30:00Z',teams:[
 {id:'team-a',name:'Assembly',status:'in_review',canSign:false,workedMinutes:2400,issues:[{id:'time-1',status:'open',employee:'e1'}],blockers:[]},
 {id:'team-b',name:'Packing',status:'in_review',canSign:true,workedMinutes:1800,issues:[],blockers:[]}
]};
window.payrollPreview={report:()=>REPORT};
function heading(title){return '<div class="heading"><div><span class="eyebrow">MANAGER</span><h1>'+title+'</h1></div></div>';}
function wireScope(id,target,kind){const s=document.getElementById(id);if(!s)return;s.addEventListener('change',()=>{target.dataset.scope=s.value;if(kind==='time')target.querySelector('.tr-person').textContent=s.value==='team-a'?'Alex Morgan · late clocking':'Sam Patel · review';else target.querySelector('b').textContent=s.value==='team-b'?'Packing · ready to sign':'Assembly · review';});}
window.render=async function(){
 const app=document.getElementById('app');
 if(ui.page==='overview') app.innerHTML='<main class="fcc-main">'+heading('Today')+'<section><h2>Existing manager actions</h2><p>Authoritative workflows remain the owners.</p></section></main>';
 else if(ui.page==='leave') app.innerHTML=heading('Absence')+'<section class="ux-leave-card" data-request="leave-2"><b>Sam Patel</b><p>Approved leave.</p></section><section class="ux-leave-card" data-request="leave-1"><b>Alex Morgan</b><p>Pending manager decision.</p><button type="button">Review request</button></section>';
 else if(ui.page==='time-review') {app.innerHTML=heading('Time Review')+'<div class="scope"><label>Team <select id="tri-team"><option value="">All teams</option><option value="team-a">Assembly</option><option value="team-b">Packing</option></select></label></div><section class="tr-list" data-scope=""><button type="button" class="tr-person">All teams · first exception</button></section>';wireScope('tri-team',document.querySelector('.tr-list'),'time');}
 else if(ui.page==='weekly-review') {app.innerHTML=heading('Weekly Sign-off')+'<div class="scope"><label>Team <select id="review-team"><option value="team-a">Assembly</option><option value="team-b">Packing</option></select></label></div><section class="ux-signoff-desk" data-scope="team-a"><b>Assembly · review</b><p>Existing authoritative sign-off desk.</p></section>';wireScope('review-team',document.querySelector('.ux-signoff-desk'),'signoff');}
};
document.querySelectorAll('.navbtn[data-page]').forEach(b=>b.addEventListener('click',()=>{ui.page=b.dataset.page;window.render();}));
window.render();
</script>
<script src="/ux-reset-cycle11-model.js"></script>
<script src="/ux-reset-cycle11.js"></script>
</body></html>`;

const assets = new Map([
  ['/ux-reset-cycle11-model.js', readFileSync(join(cwd, 'ux-overlay/ux-reset-cycle11-model.js'))],
  ['/ux-reset-cycle11.js', readFileSync(join(cwd, 'ux-overlay/ux-reset-cycle11.js'))],
  ['/ux-reset-cycle11.css', readFileSync(join(cwd, 'ux-overlay/ux-reset-cycle11.css'))]
]);

const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(fixture); return;
  }
  if (assets.has(req.url)) {
    const type = req.url.endsWith('.css') ? 'text/css' : 'text/javascript';
    res.writeHead(200, {'content-type':type+'; charset=utf-8'}); res.end(assets.get(req.url)); return;
  }
  res.writeHead(404); res.end('not found');
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

function chromePath(){
  for (const name of ['google-chrome','chromium','chromium-browser']) {
    try { return execFileSync('bash',['-lc',`command -v ${name}`],{encoding:'utf8'}).trim(); } catch {}
  }
  throw new Error('Chrome/Chromium executable not found');
}

const chrome = spawn(chromePath(), [
  '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
  `--remote-debugging-port=${CDP_PORT}`,`--user-data-dir=${join(temp,'chrome')}`,
  '--window-size=1440,1000',`http://127.0.0.1:${PORT}/`
], {stdio:'ignore'});

async function retry(fn, attempts=100){let error;for(let i=0;i<attempts;i++){try{return await fn();}catch(e){error=e;await sleep(150);}}throw error;}
let ws;
try {
  const targets = await retry(async()=>{const r=await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);const x=await r.json();if(!x.find(v=>v.type==='page'))throw new Error('No browser page');return x;});
  const page = targets.find(x=>x.type==='page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(new Error('CDP open failed'));});
  let id=1; const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=id++;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evalx=async expression=>(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result?.value;
  await send('Runtime.enable');
  await send('Page.enable');
  await retry(async()=>{const ready=await evalx("document.readyState==='complete'&&document.querySelectorAll('.ux11-open').length===3");if(!ready)throw new Error('Action queue not ready');return true;});

  async function exercise({route,sourceId,targetCheck}){
    const origin=await evalx(`(()=>{const b=document.querySelector('.ux11-open[data-ux11-route="${route}"]');if(!b)return null;const x={id:b.dataset.ux11Id,sourceId:b.dataset.ux11SourceId};b.click();return x;})()`);
    assert(origin, `Missing ${route} queue action`);
    assert(origin.sourceId===sourceId, `${route} sourceId mismatch: ${origin.sourceId}`);
    await retry(async()=>{const state=await evalx(targetCheck);if(!state?.ready)throw new Error(`${route} target not focused yet`);return state;});
    const destination=await evalx(targetCheck);
    console.log(`UX11_${route.toUpperCase().replaceAll('-','_')}_DESTINATION=`+JSON.stringify(destination));
    const back=await evalx("(()=>{const b=document.querySelector('.ux11-back');if(!b)return false;b.click();return true})()");
    assert(back, `${route} return control missing`);
    await retry(async()=>{const ok=await evalx(`ui.page==='overview'&&document.activeElement?.dataset?.ux11Id==='${origin.id}'`);if(!ok)throw new Error(`${route} origin focus not restored`);return true;});
  }

  await exercise({
    route:'leave',sourceId:'leave-1',
    targetCheck:`(()=>({ready:ui.page==='leave'&&document.activeElement?.matches('.ux-leave-card[data-request="leave-1"]'),request:document.activeElement?.dataset?.request||null,back:!!document.querySelector('.ux11-back')}))()`
  });
  await exercise({
    route:'time-review',sourceId:'team-a',
    targetCheck:`(()=>({ready:ui.page==='time-review'&&document.getElementById('tri-team')?.value==='team-a'&&document.activeElement?.classList.contains('tr-person'),team:document.getElementById('tri-team')?.value||null,target:document.activeElement?.textContent?.trim()||null,back:!!document.querySelector('.ux11-back')}))()`
  });
  await exercise({
    route:'weekly-review',sourceId:'team-b',
    targetCheck:`(()=>({ready:ui.page==='weekly-review'&&document.getElementById('review-team')?.value==='team-b'&&document.activeElement?.classList.contains('ux-signoff-desk'),team:document.getElementById('review-team')?.value||null,target:document.querySelector('.ux-signoff-desk b')?.textContent?.trim()||null,back:!!document.querySelector('.ux11-back')}))()`
  });

  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(200);
  const mobile=await evalx(`(()=>({overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,actions:document.querySelectorAll('.ux11-open').length,queue:!!document.querySelector('.ux11-queue')}))()`);
  console.log('UX11_CONTEXT_MOBILE='+JSON.stringify(mobile));
  assert(mobile.queue&&mobile.actions===3&&mobile.overflow<=2,'390px queue containment failed');

  const mobileOrigin=await evalx(`(()=>{const b=document.querySelector('.ux11-open[data-ux11-route="leave"]');const id=b?.dataset.ux11Id||null;b?.click();return id})()`);
  assert(mobileOrigin,'Mobile leave action missing');
  await retry(async()=>{const ok=await evalx("ui.page==='leave'&&document.activeElement?.matches('.ux-leave-card[data-request=\"leave-1\"]')");if(!ok)throw new Error('Mobile absence target focus not ready');return true;});
  await evalx("document.querySelector('.ux11-back').click()");
  await retry(async()=>{const ok=await evalx(`ui.page==='overview'&&document.activeElement?.dataset?.ux11Id==='${mobileOrigin}'`);if(!ok)throw new Error('Mobile origin focus not restored');return true;});
  const mobileReturn=await evalx("({overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,focused:document.activeElement?.dataset?.ux11Route||null})");
  console.log('UX11_CONTEXT_MOBILE_RETURN='+JSON.stringify(mobileReturn));
  assert(mobileReturn.overflow<=2&&mobileReturn.focused==='leave','390px return-focus regression failed');
  console.log('UX11_CONTEXT_BROWSER_REGRESSION=PASS');
} finally {
  try { ws?.close(); } catch {}
  try { chrome.kill('SIGTERM'); } catch {}
  await new Promise(resolve=>server.close(resolve));
  rmSync(temp,{recursive:true,force:true});
}
