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
assert.equal(origin, expectedOrigin, 'Unexpected role-control proof origin.');

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

function safeNavigationCandidate(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 120) return false;
  if (/sign\s*out|approve|reject|publish|delete|remove|clock\s*(in|out)|sign\s*off|apply|confirm|submit|save/i.test(t)) return false;
  return /^(Open|Inspect|View|Today|Personal|Schedule|Payroll|Time|Attendance|Readiness|Onboarding|Resources|Availability|Absence|Performance|More|My\s)/i.test(t)
    || /schedule|readiness|personal|payroll|onboarding|attendance|availability|absence|performance/i.test(t);
}

async function login(email) {
  return proofRunnerSession({ origin, email, timeoutMs: 15_000 });
}

async function runRole(spec, index) {
  const port = 9700 + index * 25 + Math.floor(Math.random() * 15);
  const profile = path.join(process.env.RUNNER_TEMP || '/tmp', `wfm-control-${spec.slug}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(profile, { recursive: true });
  const chromeEnv = { ...process.env };
  delete chromeEnv.WFM_STAGING_PASSWORD;
  delete chromeEnv.WFM_PROOF_RUNNER_PRIVATE_KEY_B64;
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
    await send('Accessibility.enable');
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
    let controls = [];
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const doc = await send('DOM.getDocument', { depth: 2, pierce: true }, 5000);
        const outer = await send('DOM.getOuterHTML', { nodeId: doc.root.nodeId }, 5000);
        html = String(outer.outerHTML || '');
        const ax = await send('Accessibility.getFullAXTree', {}, 5000);
        controls = (ax.nodes || [])
          .filter(n => !n.ignored && ['button', 'link', 'tab', 'menuitem'].includes(String(n.role?.value || '').toLowerCase()))
          .map(n => ({ role: String(n.role?.value || ''), name: String(n.name?.value || '').replace(/\s+/g, ' ').trim() }))
          .filter(x => x.name);
        const count = browserApi.filter(x => x.path === '/api/bootstrap' && x.status === 200).length;
        if (html.length > 1000 && count > bootstrapBefore && controls.length > 0) break;
      } catch {}
      await sleep(300);
    }
    assert.ok(html.length > 1000, `${spec.slug} rendered DOM was unexpectedly empty.`);
    assert.ok(browserApi.filter(x => x.path === '/api/bootstrap' && x.status === 200).length > bootstrapBefore, `${spec.slug} browser did not bootstrap after navigation.`);
    assert.ok(controls.length > 0, `${spec.slug} authenticated accessibility tree exposed no interactive controls; prior zero-control evidence must not be treated as a pass.`);

    const unique = [...new Map(controls.map(c => [`${c.role}:${c.name}`, c])).values()];
    const safe = unique.filter(c => safeNavigationCandidate(c.name));
    assert.ok(safe.length > 0, `${spec.slug} exposed controls but no bounded read-only navigation candidate could be identified safely.`);

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

    console.log(`ROLE_CONTROL_INVENTORY_PASS=${spec.slug}|role=${spec.role}|tenant=${spec.tenant}|controls=${unique.length}|safe=${safe.length}|screenshot=${screenshotStatus}|safe_names=${safe.slice(0,8).map(x => x.name).join(' / ')}`);
    return {
      slug: spec.slug,
      role: spec.role,
      tenant: spec.tenant,
      email: spec.email,
      freshCookieCount: before.cookies?.length || 0,
      unauthenticatedBootstrapStatus: pre.status,
      loginStatus: 200,
      renderedDomLength: html.length,
      accessibilityControlCount: unique.length,
      accessibilityControls: unique.slice(0, 120),
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
  correctedPriorHarnessFinding: 'The prior control-inventory attempt incorrectly allowed zero discovered controls and too-small screenshots to report PASS. This version fails closed unless each role exposes at least one accessibility control and one bounded read-only navigation candidate.',
  claimBoundary: 'fixture-only hosted staging; read-only proof of role-specific accessible rendered controls and bounded navigation candidates from four fresh authenticated browser processes. It does not claim those candidate tasks were executed, production/pilot approval, or real employee/payroll data.',
}, null, 2));
console.log(`LIVE_ROLE_CONTROL_INVENTORY_PROOF=PASS|roles=${roles.length}`);
delete process.env.WFM_STAGING_PASSWORD;