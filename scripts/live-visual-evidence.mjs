import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const expectedOrigin = 'https://wfm-customer-proof-0676-production.up.railway.app';
const expectedRelease = '0.6.76-hosted-staging-rc1';
const expectedRuntimeSha = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
const expectedDeployment = '2d399257-e7ea-43e8-a728-d563e8cb366b';
const origin = (process.env.WFM_PUBLIC_ORIGIN || expectedOrigin).replace(/\/$/, '');
const password = process.env.WFM_STAGING_PASSWORD;
assert.equal(origin, expectedOrigin, 'Unexpected visual-evidence origin.');
assert.ok(password && password.length >= 20, 'Staging password is unavailable to visual evidence runner.');

const health = await (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15_000) })).json();
assert.equal(health.release, expectedRelease);
assert.equal(health.fixtureOnly, true);
assert.equal(health.productionApproved, false);
assert.equal(health.pilotReady, false);

const outDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'wfm-evidence-output');
const profileDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'wfm-evidence-chrome-profile');
fs.rmSync(outDir, { recursive: true, force: true });
fs.rmSync(profileDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(profileDir, { recursive: true });

const candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
let chrome = '';
for (const candidate of candidates) {
  const which = spawnSync('which', [candidate], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) { chrome = which.stdout.trim(); break; }
}
assert.ok(chrome, 'No Chrome/Chromium executable is available on the pinned runner.');

const chromeEnv = { ...process.env };
delete chromeEnv.WFM_STAGING_PASSWORD;
delete chromeEnv.RAILWAY_TOKEN;
delete chromeEnv.WFM_DEMO_PASSWORD;
const debugPort = 9223;
const chromeProc = spawn(chrome, [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--hide-scrollbars',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  '--window-size=1440,1000',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'], env: chromeEnv });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function retry(fn, { attempts = 50, delay = 200 } = {}) {
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
  assert.ok(typeof WebSocket === 'function', 'Node WebSocket client is unavailable.');

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
  ws.addEventListener('message', event => {
    const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
    const msg = JSON.parse(raw);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result || {});
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

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression, { awaitPromise = true, returnByValue = true } = {}) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
    return result.result?.value;
  }
  async function waitForExpression(expression, timeout = 15_000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for browser expression: ${expression}`);
  }
  async function screenshot(name) {
    await sleep(350);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
    const file = path.join(outDir, name);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    assert.ok(fs.statSync(file).size > 10_000, `${name} screenshot is unexpectedly small.`);
    return name;
  }
  async function clickText(labels) {
    for (const label of labels) {
      const clicked = await evaluate(`(() => {
        const label = ${JSON.stringify(label)};
        const nodes = [...document.querySelectorAll('nav a,nav button,[role="tab"],[data-nav],[data-page],a,button')];
        const el = nodes.find(n => (n.textContent || '').replace(/\\s+/g,' ').trim() === label && n.offsetParent !== null);
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
  await sleep(1200);

  const loginPresent = await evaluate(`Boolean(document.querySelector('#v2-login'))`);
  if (loginPresent) {
    const loginExpression = `(() => {
      const form = document.querySelector('#v2-login');
      if (!form) return false;
      const email = form.querySelector('[name="email"]');
      const password = form.querySelector('[name="password"]');
      if (!email || !password) return false;
      email.value = 'superuser@northstar.example';
      email.dispatchEvent(new Event('change', { bubbles: true }));
      password.value = ${JSON.stringify(password)};
      password.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
      return true;
    })()`;
    assert.equal(await evaluate(loginExpression), true, 'Could not submit live login form.');
    await waitForExpression(`!document.querySelector('#v2-login')`, 20_000);
  }
  await waitForExpression(`document.body && document.body.innerText.length > 100`);

  const captured = [];
  captured.push(await screenshot('00-control-centre.png'));
  const routes = [];

  const readiness = await clickText(['Inspect readiness', 'Readiness']);
  if (readiness) { routes.push(readiness); captured.push(await screenshot('01-readiness.png')); }

  const schedule = await clickText(['Schedule', 'Open weekly schedule']);
  if (schedule) { routes.push(schedule); captured.push(await screenshot('02-schedule.png')); }

  const time = await clickText(['Time', 'Time review', 'Attendance']);
  if (time) { routes.push(time); captured.push(await screenshot('03-time-attendance.png')); }

  const payroll = await clickText(['Payroll']);
  if (payroll) { routes.push(payroll); captured.push(await screenshot('04-payroll.png')); }

  const personal = await clickText(['Personal']);
  if (personal) { routes.push(personal); captured.push(await screenshot('05-personal.png')); }

  await send('Page.navigate', { url: `${origin}/kiosk.html` });
  await waitForExpression(`document.readyState === 'complete' || document.readyState === 'interactive'`);
  await sleep(900);
  captured.push(await screenshot('06-kiosk.png'));

  const uniqueApiResponses = [...new Map(apiResponses.map(x => [`${x.method} ${x.path} ${x.status}`, x])).values()];
  const metadata = {
    capturedAt: new Date().toISOString(),
    origin,
    release: expectedRelease,
    railwayDeploymentId: expectedDeployment,
    sealedRuntimeSha256: expectedRuntimeSha,
    claimBoundary: { fixtureOnly: true, productionApproved: false, pilotReady: false },
    authenticatedAs: 'superuser@northstar.example',
    screenshots: captured,
    navigationLabelsExercised: routes,
    observedApiResponses: uniqueApiResponses,
  };
  fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(metadata, null, 2));
  fs.writeFileSync(path.join(outDir, 'README.txt'), [
    'Manufacturing WFM live customer-proof visual evidence',
    `Release: ${expectedRelease}`,
    `Railway deployment: ${expectedDeployment}`,
    `Runtime SHA-256: ${expectedRuntimeSha}`,
    `Origin: ${origin}`,
    'Data: fictional fixture data only',
    'Production approved: false',
    'Pilot ready: false',
    '',
    `Screenshots: ${captured.join(', ')}`,
    `Read-only navigation: ${routes.join(', ') || 'control centre only'}`,
    '',
    'Authentication credential is not stored in this package.',
  ].join('\n'));

  console.log(`VISUAL_EVIDENCE_SCREENSHOTS=${captured.length}`);
  console.log(`VISUAL_EVIDENCE_NAV=${routes.join('|')}`);
  console.log('LIVE_VISUAL_EVIDENCE_CAPTURE=PASS');
} finally {
  try { ws?.close(); } catch {}
  chromeProc.kill('SIGTERM');
  await sleep(300);
  if (!chromeProc.killed) chromeProc.kill('SIGKILL');
  delete process.env.WFM_STAGING_PASSWORD;
}
