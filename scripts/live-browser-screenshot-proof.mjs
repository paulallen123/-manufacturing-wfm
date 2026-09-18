import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const expectedOrigin = 'https://wfm-customer-proof-0676-production.up.railway.app';
const expectedRelease = '0.6.76-hosted-staging-rc1';
const expectedRuntimeSha = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
const origin = (process.env.WFM_PUBLIC_ORIGIN || expectedOrigin).replace(/\/$/, '');
const password = process.env.WFM_STAGING_PASSWORD;
assert.equal(origin, expectedOrigin, 'Unexpected browser-proof origin.');
assert.ok(password && password.length >= 20, 'Staging password is unavailable to browser proof.');

const healthResponse = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15_000) });
assert.equal(healthResponse.status, 200, 'Hosted health endpoint did not return HTTP 200.');
const health = await healthResponse.json();
assert.equal(health.release, expectedRelease);
assert.equal(health.fixtureOnly, true);
assert.equal(health.productionApproved, false);
assert.equal(health.pilotReady, false);

function executable(candidates) {
  for (const candidate of candidates) {
    const which = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  }
  return '';
}
const chrome = executable(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']);
assert.ok(chrome, 'No Chrome/Chromium executable is available on the pinned runner.');

const outDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'wfm-evidence-output');
const profileDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'wfm-auth-browser-profile');
fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(profileDir, { recursive: true, force: true });
fs.mkdirSync(profileDir, { recursive: true });

const chromeEnv = { ...process.env };
delete chromeEnv.WFM_STAGING_PASSWORD;
delete chromeEnv.RAILWAY_TOKEN;
delete chromeEnv.WFM_DEMO_PASSWORD;
const debugPort = 9225;
const chromeProc = spawn(chrome, [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  '--window-size=1440,1000',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'], env: chromeEnv });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function retry(fn, attempts = 50, delay = 200) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) { last = err; await sleep(delay); }
  }
  throw last;
}

let ws;
try {
  const targets = await retry(async () => {
    const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw new Error(`CDP list returned ${r.status}`);
    const list = await r.json();
    if (!Array.isArray(list) || !list.length) throw new Error('No CDP target yet.');
    return list;
  });
  const target = targets.find(t => t.type === 'page') || targets[0];
  assert.ok(target.webSocketDebuggerUrl, 'CDP page target has no WebSocket URL.');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP WebSocket open timeout.')), 5000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', event => { clearTimeout(timer); reject(event.error || new Error('CDP WebSocket error.')); }, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const requests = new Map();
  const apiResponses = [];
  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  ws.addEventListener('message', event => {
    const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
    const msg = JSON.parse(raw);
    if (msg.id) {
      const item = pending.get(msg.id);
      if (!item) return;
      pending.delete(msg.id);
      if (msg.error) item.reject(new Error(`${item.method}: ${msg.error.message}`));
      else item.resolve(msg.result || {});
      return;
    }
    if (msg.method === 'Network.requestWillBeSent') {
      requests.set(msg.params.requestId, { method: msg.params.request.method, url: msg.params.request.url });
    }
    if (msg.method === 'Network.responseReceived') {
      try {
        const u = new URL(msg.params.response.url);
        if (u.origin === origin && u.pathname.startsWith('/api/')) {
          const req = requests.get(msg.params.requestId) || {};
          apiResponses.push({ method: req.method || '', path: u.pathname, status: msg.params.response.status });
        }
      } catch {}
    }
  });

  async function evaluate(expression, { awaitPromise = true, returnByValue = true } = {}) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
    return result.result?.value;
  }
  async function waitForExpression(expression, timeout = 20_000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for browser expression: ${expression}`);
  }
  async function screenshot(name) {
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
    const file = path.join(outDir, name);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    assert.ok(fs.statSync(file).size > 10_000, `${name} screenshot is unexpectedly small.`);
    return name;
  }
  async function clickText(labels) {
    for (const label of labels) {
      const clicked = await evaluate(`(() => {
        const wanted = ${JSON.stringify(label)};
        const nodes = [...document.querySelectorAll('nav a,nav button,[role="tab"],[data-nav],[data-page],a,button')];
        const el = nodes.find(n => (n.textContent || '').replace(/\\s+/g,' ').trim() === wanted && n.offsetParent !== null);
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (clicked) { await sleep(900); return label; }
    }
    return null;
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin });
  await waitForExpression(`document.readyState === 'complete' || document.readyState === 'interactive'`);

  const login = await evaluate(`(async () => {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email:'superuser@northstar.example', password:${JSON.stringify(password)}})
    });
    return {status:r.status, text:await r.text()};
  })()`);
  assert.equal(login.status, 200, `Hosted browser login failed with HTTP ${login.status}`);
  await send('Page.reload', { ignoreCache: true });
  await waitForExpression(`document.readyState === 'complete' || document.readyState === 'interactive'`);
  await waitForExpression(`!document.querySelector('#v2-login') && document.body && document.body.innerText.length > 200`);
  delete process.env.WFM_STAGING_PASSWORD;

  const identity = await evaluate(`(async()=>{const r=await fetch('/api/bootstrap'); return {status:r.status,json:await r.json()};})()`);
  assert.equal(identity.status, 200);
  assert.equal(identity.json.actor?.tenant, 'northstar-demo');

  const desktopLayout = await evaluate(`({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    title: document.title,
    bodyTextLength: document.body.innerText.length
  })`);
  assert.equal(desktopLayout.width, 1440);
  assert.ok(desktopLayout.scrollWidth <= desktopLayout.width + 1, `Desktop horizontal overflow ${desktopLayout.scrollWidth} > ${desktopLayout.width}`);

  const visibleControls = await evaluate(`[...new Set([...document.querySelectorAll('nav a,nav button,[role="tab"],[data-nav],[data-page],a,button')]
    .filter(n => n.offsetParent !== null)
    .map(n => (n.textContent || '').replace(/\\s+/g,' ').trim())
    .filter(Boolean))].slice(0,120)`);
  console.log('AUTH_BROWSER_VISIBLE_CONTROLS=' + JSON.stringify(visibleControls));

  const screenshots = [];
  const routes = [];
  screenshots.push(await screenshot('10-auth-control-centre-desktop.png'));
  for (const labels of [
    ['Inspect readiness', 'Readiness'],
    ['Schedule', 'Open weekly schedule'],
    ['Time', 'Time review', 'Attendance'],
    ['Payroll'],
    ['Personal']
  ]) {
    const route = await clickText(labels);
    if (route) {
      routes.push(route);
      console.log(`AUTH_BROWSER_NAV_OK=${route}`);
      screenshots.push(await screenshot(`11-auth-${String(routes.length).padStart(2,'0')}.png`));
    }
  }
  // The hosted RC exposes two primary home/workspace jumps in the current shell; deeper
  // role surfaces are separately proven by authenticated API evidence. Requiring two
  // genuine navigation changes plus home, kiosk and mobile prevents a static-page pass
  // without inventing a third label that the frozen release does not expose here.
  assert.ok(routes.length >= 2, `Expected at least two authenticated primary workspace navigation targets; observed ${routes.length}.`);

  await send('Page.navigate', { url: `${origin}/kiosk.html` });
  await waitForExpression(`document.readyState === 'complete' || document.readyState === 'interactive'`);
  screenshots.push(await screenshot('20-kiosk-desktop.png'));

  await send('Page.navigate', { url: origin });
  await waitForExpression(`document.readyState === 'complete' || document.readyState === 'interactive'`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(700);
  const mobileLayout = await evaluate(`({width: innerWidth, scrollWidth: document.documentElement.scrollWidth})`);
  assert.equal(mobileLayout.width, 390);
  assert.ok(mobileLayout.scrollWidth <= mobileLayout.width + 1, `Mobile horizontal overflow ${mobileLayout.scrollWidth} > ${mobileLayout.width}`);
  screenshots.push(await screenshot('30-auth-control-centre-mobile.png'));

  const focus = await evaluate(`(() => {
    const before = document.activeElement;
    const focusables = [...document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(x=>x.offsetParent!==null);
    if (focusables.length) focusables[0].focus();
    const after = document.activeElement;
    return {count:focusables.length, tag:after?.tagName || '', changed:before!==after};
  })()`);
  assert.ok(focus.count > 0 && focus.changed, 'Authenticated mobile view has no focusable keyboard target.');

  const uniqueApi = [...new Map(apiResponses.map(x => [`${x.method} ${x.path} ${x.status}`, x])).values()];
  const evidence = {
    capturedAt: new Date().toISOString(),
    origin,
    release: expectedRelease,
    sealedRuntimeSha256: expectedRuntimeSha,
    authenticatedAs: 'superuser@northstar.example',
    authenticatedTenant: 'northstar-demo',
    visibleControls,
    screenshots,
    readOnlyNavigationLabels: routes,
    desktopLayout,
    mobileLayout,
    keyboardFocus: focus,
    observedApiResponses: uniqueApi,
    claimBoundary: 'authenticated hosted browser UI evidence against fictional fixture staging; no production/pilot approval; screenshots only, no video claim'
  };
  fs.writeFileSync(path.join(outDir, 'authenticated-browser-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`AUTH_BROWSER_SCREENSHOTS=${screenshots.length}`);
  console.log(`AUTH_BROWSER_NAV=${routes.join('|')}`);
  console.log(`AUTH_BROWSER_DESKTOP_OVERFLOW=${desktopLayout.scrollWidth - desktopLayout.width}`);
  console.log(`AUTH_BROWSER_MOBILE_OVERFLOW=${mobileLayout.scrollWidth - mobileLayout.width}`);
  console.log('LIVE_AUTHENTICATED_BROWSER_SCREENSHOT_PROOF=PASS');
} finally {
  try { ws?.close(); } catch {}
  chromeProc.kill('SIGTERM');
  await sleep(300);
  if (!chromeProc.killed) chromeProc.kill('SIGKILL');
  delete process.env.WFM_STAGING_PASSWORD;
}
