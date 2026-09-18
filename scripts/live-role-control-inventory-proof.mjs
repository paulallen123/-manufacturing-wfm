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
assert.equal(origin, expectedOrigin, 'Unexpected role-control proof origin.');
assert.ok(password && password.length >= 20, 'Staging password is unavailable to role-control proof.');

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

function sessionCookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const first = values[0];
  assert.ok(first, 'Authenticated login did not return a session cookie.');
  const pair = first.split(';', 1)[0];
  const split = pair.indexOf('=');
  assert.ok(split > 0, 'Session Set-Cookie header is malformed.');
  return { name: pair.slice(0, split), value: pair.slice(split + 1) };
}

function decodeText(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function safeCandidate(text, outerHTML) {
  const t = String(text || '').trim();
  if (!t || t.length > 100) return false;
  if (/sign\s*out|approve|reject|publish|delete|remove|clock\s*(in|out)|sign\s*off|apply|confirm|submit|save/i.test(t)) return false;
  const navigationish = /^<a\b/i.test(String(outerHTML).trim()) || /role=["']tab["']|data-nav=|data-page=/i.test(outerHTML) || /^(Open|Inspect|View|Today|Personal|Schedule|Payroll|Time|Attendance|Readiness|Onboarding|Resources|Availability|Absence|Performance|More)/i.test(t);
  return navigationish;
}

async function login(email) {
  const response = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      referer: `${origin}/`,
      accept: 'application/json,text/plain,*/*',
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, `${email} login failed with HTTP ${response.status}.`);
  return sessionCookieFrom(response);
}

async function runRole(spec, index) {
  const port = 9700 + index * 25 + Math.floor(Math.random() * 15);
  const profile = path.join(process.env.RUNNER_TEMP || '/tmp', `wfm-control-${spec.slug}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(profile, { recursive: true });
  const chromeEnv = { ...process.env };
  delete chromeEnv.WFM_STAGING_PASSWORD;
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
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) { const j = await r.json(); if (Array.isArray(j) && j.length) { targets = j; break; } }
      } catch {}
      await sleep(150);
    }
    assert.ok(targets?.length, `No CDP target for ${spec.slug}.`);
    const target = targets.find(x => x.type === 'page') || targets[0];
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP open timeout for ${spec.slug}`)), 5000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', e => { clearTimeout(timer); reject(e.error || new Error('CDP error')); }, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    const browserApi = [];
    ws.addEventListener('message', event => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
      if (msg.id) {
        const p = pending.get(msg.id); if (!p) return;
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result || {});
        return;
      }
      if (msg.method === 'Network.responseReceived') {
        try {
          const u = new URL(msg.params.response.url);
          if (u.origin === origin && u.pathname.startsWith('/api/')) browserApi.push({ path: u.pathname, status: msg.params.response.status });
        } catch {}
      }
    });
    const send = (method, params = {}, timeoutMs = 8000) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timeout for ${spec.slug}`)); }, timeoutMs);
      pending.set(id, { method, resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Page.enable');
    await send('Network.enable');
    await send('DOM.enable');
    const before = await send('Network.getCookies', { urls: [origin] });
    assert.equal(before.cookies?.length || 0, 0, `${spec.slug} fresh browser unexpectedly contained cookies.`);
    const pre = await fetch(`${origin}/api/bootstrap`, { signal: AbortSignal.timeout(15_000) });
    assert.equal(pre.status, 401, `${spec.slug} unauthenticated bootstrap did not fail closed.`);

    const session = await login(spec.email);
    const setCookie = await send('Network.setCookie', { name: session.name, value: session.value, url: origin, secure: true, httpOnly: true, sameSite: 'Lax' });
    assert.equal(setCookie.success, true, `${spec.slug} server-issued session could not be bound to Chrome.`);

    const cookieHeader = `${session.name}=${session.value}`;
    const identityResponse = await fetch(`${origin}/api/bootstrap`, {
      headers: { Cookie: cookieHeader, Accept: 'application/json,text/plain,*/*', Referer: `${origin}/` },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(identityResponse.status, 200, `${spec.slug} authenticated bootstrap failed.`);
    const identity = await identityResponse.json();
    assert.equal(identity.actor?.role, spec.role, `${spec.slug} role mismatch.`);
    assert.equal(identity.actor?.tenant, spec.tenant, `${spec.slug} tenant mismatch.`);

    const bootstrapBefore = browserApi.filter(x => x.path === '/api/bootstrap' && x.status === 200).length;
    await send('Page.navigate', { url: origin });
    let html = '';
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const doc = await send('DOM.getDocument', { depth: 2, pierce: true }, 5000);
        const outer = await send('DOM.getOuterHTML', { nodeId: doc.root.nodeId }, 5000);
        html = String(outer.outerHTML || '');
        const count = browserApi.filter(x => x.path === '/api/bootstrap' && x.status === 200).length;
        if (html.length > 1000 && count > bootstrapBefore) break;
      } catch {}
      await sleep(300);
    }
    assert.ok(html.length > 1000, `${spec.slug} rendered DOM was unexpectedly empty.`);
    assert.ok(browserApi.filter(x => x.path === '/api/bootstrap' && x.status === 200).length > bootstrapBefore, `${spec.slug} browser did not bootstrap after navigation.`);

    const doc = await send('DOM.getDocument', { depth: 2, pierce: true }, 5000);
    const query = await send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'a,button,[role="tab"],[data-nav],[data-page]' }, 5000);
    const controls = [];
    for (const nodeId of (query.nodeIds || []).slice(0, 160)) {
      let box;
      try { box = await send('DOM.getBoxModel', { nodeId }, 1800); } catch { continue; }
      const quad = box?.model?.border;
      if (!Array.isArray(quad) || quad.length < 8) continue;
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      if (Math.max(...xs) - Math.min(...xs) < 2 || Math.max(...ys) - Math.min(...ys) < 2) continue;
      let outerHTML = '';
      try { outerHTML = String((await send('DOM.getOuterHTML', { nodeId }, 1800)).outerHTML || ''); } catch { continue; }
      const text = decodeText(outerHTML).slice(0, 160);
      if (!text) continue;
      controls.push({ text, tag: (outerHTML.match(/^<([a-z0-9-]+)/i)?.[1] || '').toLowerCase(), safeNavigationCandidate: safeCandidate(text, outerHTML) });
    }
    const unique = [...new Map(controls.map(c => [`${c.tag}:${c.text}`, c])).values()];
    const safe = unique.filter(c => c.safeNavigationCandidate);

    let screenshot = null;
    let screenshotStatus = 'NOT_ATTEMPTED';
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 8000);
      screenshot = `50-role-control-${spec.slug}.png`;
      fs.writeFileSync(path.join(outDir, screenshot), Buffer.from(shot.data, 'base64'));
      screenshotStatus = fs.statSync(path.join(outDir, screenshot)).size > 8000 ? 'PASS' : 'TOO_SMALL';
    } catch (error) {
      screenshotStatus = `BLOCKED:${error.message}`;
    }

    console.log(`ROLE_CONTROL_INVENTORY_PASS=${spec.slug}|role=${spec.role}|tenant=${spec.tenant}|controls=${unique.length}|safe=${safe.length}|screenshot=${screenshotStatus}`);
    return {
      slug: spec.slug,
      role: spec.role,
      tenant: spec.tenant,
      email: spec.email,
      freshCookieCount: before.cookies?.length || 0,
      unauthenticatedBootstrapStatus: pre.status,
      loginStatus: 200,
      renderedDomLength: html.length,
      controlCount: unique.length,
      controls: unique.slice(0, 100),
      safeNavigationCandidates: safe.slice(0, 40),
      screenshot,
      screenshotStatus,
      observedBrowserApi: [...new Map(browserApi.map(x => [`${x.path}:${x.status}`, x])).values()],
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
  { slug: 'manager', email: 'manager@northstar.example', role: 'manager', tenant: 'northstar-demo' },
  { slug: 'employee', email: 'maya@northstar.example', role: 'employee', tenant: 'northstar-demo' },
  { slug: 'payroll', email: 'payroll@northstar.example', role: 'payroll_admin', tenant: 'northstar-demo' },
  { slug: 'company-admin', email: 'superuser@northstar.example', role: 'director', tenant: 'northstar-demo' },
];
const roles = [];
for (let i = 0; i < specs.length; i++) roles.push(await runRole(specs[i], i));

fs.writeFileSync(path.join(outDir, 'role-control-inventory.json'), JSON.stringify({
  capturedAt: new Date().toISOString(),
  origin,
  release: expectedRelease,
  sealedRuntimeSha256: expectedRuntimeSha,
  result: 'PASS',
  roles,
  claimBoundary: 'fixture-only hosted staging; read-only proof of role-specific rendered controls and safe navigation candidates from four fresh authenticated browser processes. It does not claim those tasks were executed, production/pilot approval, or real employee/payroll data.',
}, null, 2));
console.log(`LIVE_ROLE_CONTROL_INVENTORY_PROOF=PASS|roles=${roles.length}`);
delete process.env.WFM_STAGING_PASSWORD;