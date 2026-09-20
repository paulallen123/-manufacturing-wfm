import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { chromium } from 'playwright';

// DEVELOPMENT proof harness only. The frozen release candidate is never modified.
// Chromium is given a synthetic HTTPS origin and every network request is fulfilled
// through Railway's private network. Host/origin headers are rewritten to the
// candidate's configured staging origin so we exercise the real hosted security gates
// without exposing the candidate publicly or weakening them.
const targetBase = (process.env.PROOF_TARGET_BASE || '').replace(/\/$/, '');
const browserOrigin = (process.env.PROOF_BROWSER_ORIGIN || '').replace(/\/$/, '');
const expectedSha = process.env.WFM_EXPECTED_CANDIDATE_SHA;
const password = process.env.WFM_STAGING_PASSWORD;
const expectedRelease = '0.6.76-hosted-staging-rc1';
const frozenCommit = '19675a939bfc35b80152e61473462f2fb5eabc3a';
const expectedTargetHost = 'wfm-proof-frozen-0676-private.railway.internal';
const virtualOrigin = 'https://wfm-private-proof.invalid';

assert.ok(targetBase.includes('.railway.internal'), 'Private Railway target is required.');
assert.equal(browserOrigin, virtualOrigin, 'Synthetic browser origin is not the approved frozen-proof origin.');
assert.match(expectedSha || '', /^[0-9a-f]{40}$/);
assert.equal(expectedSha, frozenCommit, 'Candidate commit binding mismatch.');
assert.ok(password && password.length >= 20, 'Staging password unavailable.');

const target = new URL(targetBase);
assert.equal(target.hostname, expectedTargetHost, 'Proof target is not the frozen private candidate service.');
assert.ok(['http:', 'https:'].includes(target.protocol), 'Unexpected private target protocol.');
const browserHost = new URL(browserOrigin).host;
const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;

function upstreamRequest(path, method, incomingHeaders, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    for (const [key, value] of Object.entries(incomingHeaders || {})) {
      const lower = key.toLowerCase();
      if (['host', 'origin', 'referer', 'content-length', 'connection', 'accept-encoding'].includes(lower)) continue;
      headers[lower] = value;
    }
    headers.host = browserHost;
    headers['x-forwarded-host'] = browserHost;
    headers['x-forwarded-proto'] = 'https';
    headers.origin = browserOrigin;
    headers.referer = `${browserOrigin}/`;
    headers['accept-encoding'] = 'identity';
    if (body?.length) headers['content-length'] = String(body.length);

    const req = transport({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method,
      path,
      headers,
      timeout: 20000,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('timeout', () => req.destroy(new Error('private bridge timeout')));
    req.on('error', reject);
    if (body?.length) req.write(body);
    req.end();
  });
}

async function installPrivateBridge(page, counters) {
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    counters.bridged += 1;
    const upstream = await upstreamRequest(
      `${url.pathname}${url.search}`,
      request.method(),
      request.headers(),
      request.postDataBuffer(),
    );
    const headers = {};
    for (const [key, value] of Object.entries(upstream.headers || {})) {
      if (value == null) continue;
      const lower = key.toLowerCase();
      if (['connection', 'transfer-encoding', 'content-length', 'keep-alive'].includes(lower)) continue;
      headers[lower] = Array.isArray(value) ? value.join('\n') : String(value);
    }
    await route.fulfill({ status: upstream.status, headers, body: upstream.body });
  });
}

const specs = [
  { slug: 'manager', email: 'manager@northstar.example', role: 'manager', tenant: 'northstar-demo', payroll: 403, surface: '/api/time-review', nav: 'Time & Attendance' },
  { slug: 'employee', email: 'maya@northstar.example', role: 'employee', tenant: 'northstar-demo', payroll: 403, surface: '/api/personal', nav: null },
  { slug: 'payroll', email: 'payroll@northstar.example', role: 'payroll_admin', tenant: 'northstar-demo', payroll: 200, surface: '/api/payroll-run', nav: 'Reports' },
  { slug: 'company-admin', email: 'superuser@northstar.example', role: 'director', tenant: 'northstar-demo', payroll: 200, surface: '/api/onboarding', nav: 'Integrations' },
  { slug: 'isolation-manager', email: 'other@isolation.example', role: 'manager', tenant: 'isolation-test', payroll: 403, surface: '/api/bootstrap', nav: 'Time & Attendance' },
];

const browser = await chromium.launch({ headless: true });
const receipts = [];
let navigationClicks = 0;
let managerActionJourneys = 0;
let totalBridged = 0;

try {
  for (const spec of specs) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const counters = { bridged: 0 };
    await installPrivateBridge(page, counters);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));

    const first = await page.goto(virtualOrigin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert.ok(first && first.status() < 500, `${spec.slug} initial page failed.`);

    const health = await page.evaluate(async () => {
      const response = await fetch('/api/health', { cache: 'no-store' });
      return { status: response.status, json: await response.json() };
    });
    assert.equal(health.status, 200);
    assert.equal(health.json?.release, expectedRelease);
    assert.equal(health.json?.fixtureOnly, true);
    assert.equal(health.json?.productionApproved, false);

    const unauthenticatedBootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).status);
    assert.equal(unauthenticatedBootstrap, 401, `${spec.slug} bootstrap did not fail closed.`);

    const loginStatus = await page.evaluate(async ({ email, password }) => {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return response.status;
    }, { email: spec.email, password });
    assert.equal(loginStatus, 200, `${spec.slug} login failed.`);

    const cookies = await context.cookies(virtualOrigin);
    assert.ok(cookies.length > 0, `${spec.slug} browser did not retain the authenticated session.`);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length > 0,
      { timeout: 30000 },
    );
    await page.waitForTimeout(300);

    const identity = await page.evaluate(async () => {
      const response = await fetch('/api/bootstrap', { cache: 'no-store' });
      return { status: response.status, json: await response.json() };
    });
    assert.equal(identity.status, 200, `${spec.slug} authenticated bootstrap failed.`);
    assert.equal(identity.json.actor?.role, spec.role, `${spec.slug} role mismatch.`);
    assert.equal(identity.json.actor?.tenant, spec.tenant, `${spec.slug} tenant mismatch.`);

    const boundary = await page.evaluate(async ({ surface }) => {
      const payroll = await fetch('/api/payroll-run', { cache: 'no-store' });
      const required = await fetch(surface, { cache: 'no-store' });
      return { payroll: payroll.status, surface: required.status };
    }, { surface: spec.surface });
    assert.equal(boundary.payroll, spec.payroll, `${spec.slug} payroll boundary mismatch.`);
    assert.equal(boundary.surface, 200, `${spec.slug} required surface failed.`);

    const ui = await page.evaluate(async () => {
      const asset = await fetch('/vector-shell.js', { cache: 'no-store' });
      const text = await asset.text();
      const visible = node => node.getClientRects().length > 0;
      const interactive = [...document.querySelectorAll('button,a,input,select,textarea,[tabindex]')].filter(visible);
      const unnamedButtons = [...document.querySelectorAll('button')].filter(visible).filter(button => {
        const label = (button.getAttribute('aria-label') || button.textContent || '').trim();
        return !label;
      }).length;
      return {
        assetStatus: asset.status,
        approved: text.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1'),
        retired: ['WFM_UX_RESET_CYCLE11_BEGIN', 'WFM_UX_RESET_CYCLE12_BEGIN', 'VECTOR_PRIORITY_BRIDGE_V1'].filter(marker => text.includes(marker)),
        vectorNodes: document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length,
        bodyText: (document.body?.innerText || '').length,
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        hasMain: Boolean(document.querySelector('main,[role="main"]')),
        interactiveCount: interactive.length,
        unnamedButtons,
      };
    });
    assert.equal(ui.assetStatus, 200);
    assert.equal(ui.approved, true);
    assert.deepEqual(ui.retired, []);
    assert.ok(ui.vectorNodes > 0, `${spec.slug} Vector DOM missing.`);
    assert.ok(ui.bodyText > 200, `${spec.slug} rendered body too small.`);
    assert.ok(ui.scrollWidth <= ui.width + 1, `${spec.slug} desktop horizontal overflow.`);
    assert.equal(ui.hasMain, true, `${spec.slug} has no main landmark.`);
    assert.ok(ui.interactiveCount > 0, `${spec.slug} has no interactive controls.`);
    assert.equal(ui.unnamedButtons, 0, `${spec.slug} has visible unnamed buttons.`);

    if (spec.slug === 'employee') {
      const status = await page.evaluate(async () => (await fetch('/api/workforce/lifecycle/action-evidence/time-review', { cache: 'no-store' })).status);
      assert.equal(status, 403, 'Employee unexpectedly received manager action evidence.');
    }
    if (spec.slug === 'manager') {
      const evidence = await page.evaluate(async () => {
        const response = await fetch('/api/workforce/lifecycle/action-evidence/time-review', { cache: 'no-store' });
        return { status: response.status, json: await response.json() };
      });
      assert.equal(evidence.status, 200, 'Manager action-evidence bridge unavailable.');
      const active = (Array.isArray(evidence.json?.items) ? evidence.json.items : [])
        .filter(item => String(item?.confirmation?.state || '').toLowerCase() !== 'resolved');
      assert.ok(active.length > 0, 'Manager fixture has no active Time Review item.');
      const actionButton = page.locator('.vector-alert-row button[data-vector-source-id][data-vector-workflow="time-review"]').first();
      await actionButton.waitFor({ state: 'visible', timeout: 10000 });
      const sourceId = await actionButton.getAttribute('data-vector-source-id');
      assert.ok(sourceId && active.some(item => String(item?.sourceId || '') === sourceId), 'Rendered manager action is not bound to active evidence.');
      await actionButton.click({ timeout: 5000 });
      const returnButton = page.locator('[data-vector-return-context]').first();
      await returnButton.waitFor({ state: 'visible', timeout: 10000 });
      const postOpenStillPresent = await page.evaluate(async sourceId => {
        const response = await fetch('/api/workforce/lifecycle/action-evidence/time-review', { cache: 'no-store' });
        const json = await response.json();
        return (Array.isArray(json?.items) ? json.items : []).some(item => String(item?.sourceId || '') === sourceId && String(item?.confirmation?.state || '').toLowerCase() !== 'resolved');
      }, sourceId);
      assert.equal(postOpenStillPresent, true, 'Opening Time Review cleared the source action prematurely.');
      await returnButton.click({ timeout: 5000 });
      await page.locator('.vector-alerts').first().waitFor({ state: 'visible', timeout: 10000 });
      managerActionJourneys += 1;
    }

    let navigationClicked = null;
    if (spec.nav) {
      const locator = page.getByText(spec.nav, { exact: true }).first();
      if (await locator.count()) {
        await locator.click({ timeout: 5000 });
        await page.waitForTimeout(250);
        navigationClicked = spec.nav;
        navigationClicks += 1;
      }
    }

    const screenshot = await page.screenshot({ fullPage: true });
    assert.ok(screenshot.length > 10000, `${spec.slug} rendered frame too small.`);
    const renderDigest = crypto.createHash('sha256').update(screenshot).digest('hex');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const mobile = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(mobile.scrollWidth <= mobile.width + 1, `${spec.slug} mobile horizontal overflow.`);

    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName || '', body: document.activeElement === document.body }));
    assert.equal(focus.body, false, `${spec.slug} keyboard focus remained on body.`);
    assert.deepEqual(pageErrors, [], `${spec.slug} uncaught page errors: ${pageErrors.join(' | ')}`);
    assert.ok(counters.bridged > 5, `${spec.slug} did not exercise the private network bridge.`);
    totalBridged += counters.bridged;

    receipts.push({
      slug: spec.slug,
      role: spec.role,
      tenant: spec.tenant,
      unauthenticatedBootstrap,
      loginStatus,
      payrollStatus: boundary.payroll,
      requiredSurfaceStatus: boundary.surface,
      vectorApproved: ui.approved,
      desktopOverflow: ui.scrollWidth - ui.width,
      mobileOverflow: mobile.scrollWidth - mobile.width,
      keyboardFocusTag: focus.tag,
      renderDigest,
      privateRequests: counters.bridged,
      pageErrors,
    });
    console.log(`PRIVATE_ROLE_BROWSER_PASS=${spec.slug}|role=${spec.role}|tenant=${spec.tenant}|nav=${navigationClicked || 'not-applicable'}|requests=${counters.bridged}`);
    await context.close();
  }

  assert.ok(navigationClicks >= 3, 'Insufficient role-first navigation clicks.');
  assert.equal(managerActionJourneys, 1, 'Manager Time Review action journey was not proven exactly once.');
  assert.equal(receipts.length, 5);
  console.log(`PRIVATE_BROWSER_MATRIX=PASS|roles=${receipts.length}|navClicks=${navigationClicks}|privateRequests=${totalBridged}|sha=${expectedSha}`);
} finally {
  await browser.close();
  delete process.env.WFM_STAGING_PASSWORD;
}
