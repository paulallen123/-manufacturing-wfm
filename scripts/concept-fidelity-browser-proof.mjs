'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const jsPath = path.join(root, 'ux-overlay', 'concept-fidelity.js');
const cssPath = path.join(root, 'ux-overlay', 'concept-fidelity.css');
assert.ok(fs.existsSync(jsPath));
assert.ok(fs.existsSync(cssPath));

const html = [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<link rel="stylesheet" href="/concept-fidelity.css">',
  '<style>*{box-sizing:border-box}body{margin:0;font-family:Arial}.app{display:grid;grid-template-columns:220px 1fr;min-height:100vh}.sidebar{position:relative;min-height:100vh}.sidebar nav{display:grid}.navbtn{display:flex;gap:8px}.content{min-width:0}.fcc-hero{display:grid;grid-template-columns:1fr auto}.fcc-decision-number{padding:10px}.fcc-main,.fcc-pulse-grid{margin-top:12px}.fcc-pulse-grid{display:grid;grid-template-columns:repeat(4,1fr)}.fcc-actions{display:grid}.fcc-action{padding:12px}.fcc-dept-grid{display:grid;grid-template-columns:repeat(3,1fr)}.ux-today-detail{border:1px solid #ddd}.ux-tool-drawer{display:none}.ux-tool-list{display:grid}</style>',
  '</head><body class="ux-reset-active" data-ux-role="manager" data-ux-job="today"><div class="app">',
  '<aside class="sidebar"><nav>',
  '<button class="navbtn ux-primary-route active" data-page="overview"><span>Today</span></button>',
  '<button class="navbtn ux-primary-route" data-page="leave"><span>Absence</span></button>',
  '<button class="navbtn ux-primary-route" data-page="weekly-review"><span>Sign off</span></button>',
  '<button class="navbtn ux-primary-route" data-page="savings-decisions"><span>Performance</span></button>',
  '<button class="navbtn ux-secondary-route" data-page="schedule-publication"><span>Schedule</span></button>',
  '<button class="navbtn ux-secondary-route" data-page="attendance"><span>Attendance</span></button>',
  '<button class="navbtn ux-secondary-route" data-page="readiness"><span>Readiness</span></button>',
  '<button class="navbtn ux-more-button"><span>More</span></button>',
  '</nav></aside>',
  '<main class="content">',
  '<div class="heading"><div><h1>Factory control centre</h1><p>Old heading</p></div></div>',
  '<section class="fcc-hero ux-today-hero"><div><span class="eyebrow">FACTORY CONTROL CENTRE</span><h1>Know what needs your decision.</h1><p>Manufacturing evidence and the next safe action.</p></div><div class="fcc-decision-number"><small>NEEDS REVIEW</small><strong>4</strong></div></section>',
  '<section class="fcc-main ux-today-actions"><div class="fcc-section-head"><h2>What needs attention</h2></div><div class="fcc-actions">',
  '<article class="fcc-action"><strong>Clocking evidence unresolved</strong><p>3 records need manager review.</p><button id="real-control">Review evidence</button></article>',
  '<article class="fcc-action"><strong>Coverage gap on Assembly</strong><p>One timed gap needs a controlled decision.</p></article>',
  '</div></section>',
  '<section class="fcc-pulse-grid ux-today-pulse"><div><small>Working now</small><strong>16</strong></div><div><small>Reported sick</small><strong>1</strong></div><div><small>Late starts</small><strong>3</strong></div><div><small>Pending leave</small><strong>3</strong></div></section>',
  '<div class="fcc-dept-grid"><div>CNC machining</div><div>Assembly</div><div>Quality</div></div>',
  '<details class="ux-today-detail capacity"><summary>Capacity by area</summary><div>Capacity detail</div></details>',
  '<details class="ux-today-detail readiness"><summary>Readiness map</summary><div class="fcc-map">Readiness detail</div></details>',
  '</main></div>',
  '<div class="ux-tool-drawer"><div class="ux-tool-list"></div><div class="ux-tool-list"></div><div class="ux-tool-list"></div><div class="ux-tool-list"></div></div>',
  '<script>var ui={page:"overview",role:"manager"};var F={actor:{role:"manager"},scope:{site:"tamworth"}};function isEmployee(){return false}window.__controlClicks=0;document.getElementById("real-control").addEventListener("click",function(){window.__controlClicks++});window.fetch=async function(){return {ok:false,status:404,json:async function(){return {error:"harness"}}}}</script>',
  '<script src="/concept-fidelity.js"></script>',
  '</body></html>'
].join('');

const server = http.createServer((req, res) => {
  if (req.url === '/concept-fidelity.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(fs.readFileSync(jsPath));
    return;
  }
  if (req.url === '/concept-fidelity.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end(fs.readFileSync(cssPath));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});
await new Promise(resolve => server.listen(9268, '127.0.0.1', resolve));

function executable(names) {
  for (const name of names) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return '';
}
const chrome = executable(['google-chrome','google-chrome-stable','chromium','chromium-browser']);
assert.ok(chrome, 'Chrome/Chromium is unavailable on runner.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-concept-'));
const proc = spawn(chrome, [
  '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
  '--remote-debugging-port=9269','--user-data-dir='+profile,'--window-size=1440,1000',
  'http://127.0.0.1:9268'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn, attempts = 80) {
  let last;
  for (let i=0;i<attempts;i++) {
    try { return await fn(); } catch (e) { last=e; await sleep(200); }
  }
  throw last;
}

let ws;
try {
  const list = await retry(async () => {
    const r = await fetch('http://127.0.0.1:9269/json/list');
    const x = await r.json();
    if (!x.find(v => v.type === 'page')) throw new Error('No page target.');
    return x;
  });
  const page = list.find(v => v.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {
    ws.addEventListener('open', resolve, { once:true });
    ws.addEventListener('error', () => reject(new Error('CDP open failed')), { once:true });
  });
  let id=1;
  const pending=new Map();
  ws.addEventListener('message', event => {
    const msg=JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
    if (!msg.id || !pending.has(msg.id)) return;
    const p=pending.get(msg.id);pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result||{});
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=id++;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
  const evalx=async expression => {
    const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text||'Browser evaluation failed');
    return r.result && r.result.value;
  };
  await send('Runtime.enable');
  await retry(async()=>{if(!(await evalx('document.body.dataset.uxConcept==="fidelity-v2"')))throw new Error('not ready');return true;});

  const proof=await evalx('(()=>({labels:[...document.querySelectorAll(".sidebar nav .ux-concept-primary span")].map(x=>x.textContent.trim()),pages:[...document.querySelectorAll(".sidebar nav .ux-concept-primary")].map(x=>x.dataset.page),modes:[...document.querySelectorAll(".ux-view-choice")].map(x=>x.textContent.trim()),strip:document.querySelectorAll(".ux-concept-line-chip").length,kpis:[...document.querySelectorAll("[data-ux-concept-kpi]")].map(x=>x.dataset.uxConceptKpi),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,rail:getComputedStyle(document.querySelector(".sidebar")).backgroundImage}))()');
  console.log('CONCEPT_BROWSER_PROOF='+JSON.stringify(proof));
  assert.deepEqual(proof.labels,['Today','People','Plan','Improve']);
  assert.deepEqual(proof.pages,['overview','leave','schedule-publication','savings-decisions']);
  assert.equal(proof.modes.length,4);
  assert.ok(proof.modes.includes('Operational Visual'));
  assert.ok(proof.strip>=3);
  assert.deepEqual(proof.kpis,['Production','Workforce coverage','Labour cost','Decisions']);
  assert.ok(proof.rail.includes('gradient'));
  assert.ok(proof.overflow<=2);

  await evalx('document.querySelector("[data-mode=operational_visual]").click()');
  await sleep(180);
  const op=await evalx('(()=>({mode:document.body.dataset.uxViewMode,capacity:document.querySelector(".ux-today-detail.capacity").open,readiness:document.querySelector(".ux-today-detail.readiness").open}))()');
  assert.equal(op.mode,'operational_visual');
  assert.equal(op.capacity,true);
  assert.equal(op.readiness,true);

  await evalx('document.querySelector(".fcc-action").click()');
  assert.equal(await evalx('document.querySelector(".ux-concept-decision-drawer").classList.contains("open")'),true);
  const stages=await evalx('[...document.querySelectorAll(".ux-concept-step b")].map(x=>x.textContent)');
  assert.deepEqual(stages,['Detected','Analysed','Your Decision','Applying','Verified']);

  await evalx('document.querySelector(".ux-concept-drawer-close").click();document.getElementById("real-control").click()');
  assert.equal(await evalx('window.__controlClicks'),1);
  assert.equal(await evalx('document.querySelector(".ux-concept-decision-drawer").classList.contains("open")'),false);

  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(250);
  assert.ok((await evalx('document.documentElement.scrollWidth-document.documentElement.clientWidth'))<=2);

  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true});
  const out=process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP,'concept-fidelity.png') : path.join(os.tmpdir(),'concept-fidelity.png');
  fs.writeFileSync(out,Buffer.from(shot.data,'base64'));
  assert.ok(fs.statSync(out).size>10000);
  console.log('CONCEPT_FUNCTIONAL_BROWSER=PASS');
  console.log('CONCEPT_SCREENSHOT='+out);
} finally {
  try{ws && ws.close();}catch{}
  proc.kill('SIGTERM');
  server.close();
  fs.rmSync(profile,{recursive:true,force:true});
}
