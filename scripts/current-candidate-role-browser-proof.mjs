import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const origin = new URL(process.env.VECTOR_PROOF_URL).origin;
const expectedSha = process.env.WFM_EXPECTED_CANDIDATE_SHA;
const password = process.env.WFM_STAGING_PASSWORD;

assert.match(expectedSha || '', /^[0-9a-f]{40}$/);
assert.ok(password && password.length >= 20, 'Staging password unavailable.');

const specs = [
  { slug: 'manager', email: 'manager@northstar.example', role: 'manager', tenant: 'northstar-demo', payroll: 403, surface: '/api/time-review', nav: 'Time & Attendance' },
  { slug: 'employee', email: 'maya@northstar.example', role: 'employee', tenant: 'northstar-demo', payroll: 403, surface: '/api/personal', nav: null },
  { slug: 'payroll', email: 'payroll@northstar.example', role: 'payroll_admin', tenant: 'northstar-demo', payroll: 200, surface: '/api/payroll-run', nav: 'Reports' },
  { slug: 'company-admin', email: 'superuser@northstar.example', role: 'director', tenant: 'northstar-demo', payroll: 200, surface: '/api/onboarding', nav: 'Integrations' },
  { slug: 'isolation-manager', email: 'other@isolation.example', role: 'manager', tenant: 'isolation-test', payroll: 403, surface: '/api/bootstrap', nav: 'Time & Attendance' }
];

const healthResponse = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15000) });
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.fixtureOnly, true);
assert.equal(health.productionApproved, false);

const browser = await chromium.launch({ headless: true });
const receipts = [];
let navigationClicks = 0;

try {
  for (const spec of specs) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));

    const first = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert.ok(first && first.status() < 500, `${spec.slug} initial page failed.`);

    const unauthenticatedBootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).status);
    assert.equal(unauthenticatedBootstrap, 401, `${spec.slug} bootstrap did not fail closed.`);

    const loginStatus = await page.evaluate(async ({ email, password }) => {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      return response.status;
    }, { email: spec.email, password });
    assert.equal(loginStatus, 200, `${spec.slug} login failed.`);

    // Do not wait for global network-idle. The hosted app has legitimate ongoing
    // network activity. Readiness is the conjunction of DOMContentLoaded plus the
    // approved Vector shell becoming present in the rendered DOM.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length > 0,
      { timeout: 30000 }
    );
    await page.waitForTimeout(400);

    const identity = await page.evaluate(async () => {
      const response = await fetch('/api/bootstrap');
      return { status: response.status, json: await response.json() };
    });
    assert.equal(identity.status, 200);
    assert.equal(identity.json.actor?.role, spec.role, `${spec.slug} role mismatch.`);
    assert.equal(identity.json.actor?.tenant, spec.tenant, `${spec.slug} tenant mismatch.`);

    const boundary = await page.evaluate(async ({ surface }) => {
      const payroll = await fetch('/api/payroll-run');
      const required = await fetch(surface);
      return { payroll: payroll.status, surface: required.status };
    }, { surface: spec.surface });
    assert.equal(boundary.payroll, spec.payroll, `${spec.slug} payroll boundary mismatch.`);
    assert.equal(boundary.surface, 200, `${spec.slug} required surface failed.`);

    const ui = await page.evaluate(async () => {
      const asset = await fetch('/vector-shell.js', { cache: 'no-store' });
      const text = await asset.text();
      const resources = performance.getEntriesByType('resource').map(entry => entry.name);
      const nodes = document.querySelectorAll('.vector-shell,.vector-sidebar,[class*=vector-]').length;
      const labels = [...new Set([...document.querySelectorAll('nav a,nav button,.vector-sidebar a,.vector-sidebar button')]
        .filter(node => node.getClientRects().length > 0)
        .map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean))];
      return {
        assetStatus: asset.status,
        approved: text.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1'),
        retired: ['WFM_UX_RESET_CYCLE11_BEGIN', 'WFM_UX_RESET_CYCLE12_BEGIN', 'VECTOR_PRIORITY_BRIDGE_V1'].filter(marker => text.includes(marker)),
        executed: resources.some(name => name.includes('vector-shell.js')),
        nodes,
        labels,
        bodyText: (document.body?.innerText || '').length,
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth
      };
    });
    assert.equal(ui.assetStatus, 200);
    assert.equal(ui.approved, true);
    assert.deepEqual(ui.retired, []);
    assert.equal(ui.executed, true, `${spec.slug} Vector shell was not loaded.`);
    assert.ok(ui.nodes > 0, `${spec.slug} Vector DOM missing.`);
    assert.ok(ui.bodyText > 200, `${spec.slug} rendered body too small.`);
    assert.ok(ui.scrollWidth <= ui.width + 1, `${spec.slug} desktop horizontal overflow.`);

    let navigationClicked = null;
    if (spec.nav) {
      const locator = page.getByText(spec.nav, { exact: true }).first();
      if (await locator.count()) {
        await locator.click({ timeout: 5000 });
        await page.waitForTimeout(300);
        navigationClicked = spec.nav;
        navigationClicks += 1;
      }
    }

    const screenshot = await page.screenshot({ fullPage: true });
    assert.ok(screenshot.length > 10000, `${spec.slug} screenshot too small.`);
    const screenshotSha256 = crypto.createHash('sha256').update(screenshot).digest('hex');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const mobile = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(mobile.scrollWidth <= mobile.width + 1, `${spec.slug} mobile horizontal overflow.`);

    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName || '', body: document.activeElement === document.body }));
    assert.equal(focus.body, false, `${spec.slug} keyboard focus remained on body.`);
    assert.deepEqual(pageErrors, [], `${spec.slug} uncaught page errors: ${pageErrors.join(' | ')}`);

    receipts.push({
      slug: spec.slug,
      role: spec.role,
      tenant: spec.tenant,
      unauthenticatedBootstrap,
      loginStatus,
      payrollStatus: boundary.payroll,
      requiredSurface: spec.surface,
      requiredSurfaceStatus: boundary.surface,
      vectorApproved: ui.approved,
      vectorExecuted: ui.executed,
      vectorNodes: ui.nodes,
      visibleNavigation: ui.labels,
      navigationClicked,
      desktopOverflow: ui.scrollWidth - ui.width,
      mobileOverflow: mobile.scrollWidth - mobile.width,
      keyboardFocusTag: focus.tag,
      screenshotSha256,
      pageErrors
    });
    console.log(`CURRENT_ROLE_BROWSER_PASS=${spec.slug}|role=${spec.role}|tenant=${spec.tenant}|nav=${navigationClicked || 'not-applicable'}|shot=${screenshotSha256.slice(0, 16)}`);
    await context.close();
  }

  assert.ok(navigationClicks >= 3, 'Insufficient role-first navigation clicks.');
  console.log(`CURRENT_CANDIDATE_ROLE_BROWSER_MATRIX=PASS|roles=${receipts.length}|navClicks=${navigationClicks}|sha=${expectedSha}`);
} finally {
  await browser.close();
  delete process.env.WFM_STAGING_PASSWORD;
}
