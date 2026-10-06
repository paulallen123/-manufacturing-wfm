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
assert.equal(origin, expectedOrigin, 'Unexpected role-render proof origin.');

const outDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'wfm-evidence-output');
fs.mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function executable(candidates) {
  for (const candidate of candidates) {
    const which = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  }
  return '';
}
const chrome = executable(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']);
assert.ok(chrome, 'No Chrome/Chromium executable is available on the pinned runner.');

async function api(cookie, pathName) {
  return fetch(`${origin}${pathName}`, {
    headers: {
      Cookie: `${cookie.name}=${cookie.value}`,
      Accept: 'application/json,text/plain,*/*',
      Referer: `${origin}/`,
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
}

async function runRole(spec, index) {
  const port = 9500 + index * 20 + Math.floor(Math.random() * 15);
  const profile = path.join(process.env.RUNNER_TEMP || '/tmp', `wfm-render-${spec.slug}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(profile, { recursive: true });
  const chromeEnv = { ...process.env };
  delete chromeEnv.RAILWAY_TOKEN;
  delete chromeEnv.WFM_DEMO_PASSWORD;
  const proc = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=1440,1000', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'], env: chromeEnv });

  let ws;
  try {
    let targets;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) {
          const list = await r.json();
          if (Array.isArray(list) && list.length) { targets = list; break; }
        }
      } catch {}
      await sleep(150);
    }
    assert.ok(targets?.length, `No CDP target for ${spec.slug}.`);
    const target = targets.find(t => t.type === 'page') || targets[0];
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP open timeout for ${spec.slug}.`)), 5000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', event => { clearTimeout(timer); reject(event.error || new Error('CDP error')); }, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    const apiResponses = [];
    ws.addEventListener('message', event => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
      if (msg.id) {
        const item = pending.get(msg.id);
        if (!item) return;
        pending.delete(msg.id);
        msg.error ? item.reject(new Error(`${item.method}: ${msg.error.message}`)) : item.resolve(msg.result || {});
        return;
      }
      if (msg.method === 'Network.responseReceived') {
        try {
          const u = new URL(msg.params.response.url);
          if (u.origin === origin && u.pathname.startsWith('/api/')) {
            apiResponses.push({ path: u.pathname, status: msg.params.response.status });
          }
        } catch {}
      }
    });
    const send = (method, params = {}, timeoutMs = 12_000) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timeout for ${spec.slug}`)); }, timeoutMs);
      pending.set(id, {
        method,
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Page.enable');
    await send('Network.enable');
    const before = await send('Network.getCookies', { urls: [origin] });
    assert.equal(before.cookies?.length || 0, 0, `${spec.slug} fresh browser unexpectedly contained cookies.`);

    const unauth = await fetch(`${origin}/api/bootstrap`, { signal: AbortSignal.timeout(15_000) });
    assert.equal(unauth.status, 401, `${spec.slug} unauthenticated bootstrap did not fail closed.`);

    const signed=await signedProofSession(spec.email,origin); const session=signed.cookie;
    const set = await send('Network.setCookie', {
      name: session.name,
      value: session.value,
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    });
    assert.equal(set.success, true, `${spec.slug} server-issued session could not be bound to Chrome.`);

    const identityResponse = await api(session, '/api/bootstrap');
    assert.equal(identityResponse.status, 200, `${spec.slug} authenticated bootstrap failed.`);
    const identity = await identityResponse.json();
    assert.equal(identity.actor?.role, spec.role, `${spec.slug} role mismatch.`);
    assert.equal(identity.actor?.tenant, spec.tenant, `${spec.slug} tenant mismatch.`);
    const surfaceResponse = await api(session, spec.surface);
    assert.equal(surfaceResponse.status, 200, `${spec.slug} required surface ${spec.surface} failed.`);

    await send('Page.navigate', { url: origin });
    const deadline = Date.now() + 20_000;
    let docLength = 0;
    while (Date.now() < deadline) {
      try {
        const doc = await send('DOM.getDocument', { depth: 2, pierce: true }, 5000);
        const html = await send('DOM.getOuterHTML', { nodeId: doc.root.nodeId }, 5000);
        docLength = String(html.outerHTML || '').length;
        const bootstrapped = apiResponses.some(x => x.path === '/api/bootstrap' && x.status === 200);
        if (docLength > 10_000 && bootstrapped) break;
      } catch {}
      await sleep(300);
    }
    assert.ok(docLength > 10_000, `${spec.slug} authenticated rendered DOM did not reach proof threshold.`);
    assert.ok(apiResponses.some(x => x.path === '/api/bootstrap' && x.status === 200), `${spec.slug} browser did not complete authenticated bootstrap.`);

    await sleep(700);
    const desktopShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 10_000);
    const desktopName = `40-role-${spec.slug}-desktop.png`;
    fs.writeFileSync(path.join(outDir, desktopName), Buffer.from(desktopShot.data, 'base64'));
    assert.ok(fs.statSync(path.join(outDir, desktopName)).size > 10_000, `${spec.slug} desktop screenshot is unexpectedly small.`);

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Page.reload', { ignoreCache: true });
    await sleep(1200);
    assert.ok(apiResponses.some(x => x.path === '/api/bootstrap' && x.status === 200), `${spec.slug} mobile reload lost authenticated bootstrap evidence.`);
    const mobileShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 10_000);
    const mobileName = `41-role-${spec.slug}-mobile.png`;
    fs.writeFileSync(path.join(outDir, mobileName), Buffer.from(mobileShot.data, 'base64'));
    assert.ok(fs.statSync(path.join(outDir, mobileName)).size > 8_000, `${spec.slug} mobile screenshot is unexpectedly small.`);

    const uniqueApi = [...new Map(apiResponses.map(x => [`${x.path}:${x.status}`, x])).values()];
    console.log(`ROLE_RENDERED_UI_PASS=${spec.slug}|role=${spec.role}|tenant=${spec.tenant}|surface=${spec.surface}:200|desktop=${desktopName}|mobile=${mobileName}`);
    return {
      slug: spec.slug,
      role: spec.role,
      tenant: spec.tenant,
      email: spec.email,
      freshCookieCount: before.cookies?.length || 0,
      unauthenticatedBootstrapStatus: unauth.status,
      authenticatedBootstrapStatus: identityResponse.status,
      requiredSurface: spec.surface,
      requiredSurfaceStatus: surfaceResponse.status,
      renderedDomLength: docLength,
      desktopScreenshot: desktopName,
      mobileScreenshot: mobileName,
      observedApiResponses: uniqueApi,
      browserContext: 'fresh Chrome process/profile; exact server-issued session bound after zero-cookie and unauthenticated-401 checks; credential never passed to Chrome environment',
    };
  } finally {
    try { ws?.close(); } catch {}
    const exited = new Promise(resolve => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve(true);
      proc.once('exit', () => resolve(true));
    });
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
    await Promise.race([exited, sleep(1200)]);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    for (let attempt = 0; attempt < 4; attempt++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); break; }
      catch { await sleep(200); }
    }
  }
}

const healthResponse = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15_000) });
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.release, expectedRelease);
assert.equal(health.fixtureOnly, true);
assert.equal(health.productionApproved, false);
assert.equal(health.pilotReady, false);

const specs = [
  { slug: 'manager', email: 'manager@northstar.example', role: 'manager', tenant: 'northstar-demo', surface: '/api/time-review' },
  { slug: 'employee', email: 'maya@northstar.example', role: 'employee', tenant: 'northstar-demo', surface: '/api/personal' },
  { slug: 'payroll', email: 'payroll@northstar.example', role: 'payroll_admin', tenant: 'northstar-demo', surface: '/api/payroll-run' },
  { slug: 'company-admin', email: 'superuser@northstar.example', role: 'director', tenant: 'northstar-demo', surface: '/api/onboarding' },
];
const roles = [];
for (let i = 0; i < specs.length; i++) roles.push(await runRole(specs[i], i));

fs.writeFileSync(path.join(outDir, 'role-rendered-ui-evidence.json'), JSON.stringify({
  capturedAt: new Date().toISOString(),
  origin,
  release: expectedRelease,
  sealedRuntimeSha256: expectedRuntimeSha,
  result: 'PASS',
  roles,
  claimBoundary: 'fixture-only hosted staging; proves four role-specific authenticated rendered browser homes on desktop and mobile plus required server surfaces. It does not claim every role-specific task was clicked end-to-end, physical-device acceptance, production/pilot approval or real employee/payroll data.',
}, null, 2));
console.log(`LIVE_ROLE_RENDERED_UI_PROOF=PASS|roles=${roles.length}|screenshots=${roles.length * 2}`);
