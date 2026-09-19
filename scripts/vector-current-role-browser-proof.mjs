import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';

const origin = new URL(process.env.VECTOR_PROOF_URL).origin;
const password = process.env.WFM_STAGING_PASSWORD;
assert.ok(password && password.length >= 20, 'WFM_STAGING_PASSWORD is unavailable or too short.');

const result = {
  origin,
  startedAt: new Date().toISOString(),
  claimBoundary: 'Hosted fixture proof only: real browser sessions against the current Railway candidate. It does not claim production approval, real employee/payroll data, or live external-provider connectivity.',
  roles: []
};

const specs = [
  { slug: 'manager', email: 'manager@northstar.example', role: 'manager', tenant: 'northstar-demo', payroll: 403, surface: '/api/time-review', nav: 'Time' },
  { slug: 'employee', email: 'maya@northstar.example', role: 'employee', tenant: 'northstar-demo', payroll: 403, surface: '/api/personal', nav: 'Personal' },
  { slug: 'payroll', email: 'payroll@northstar.example', role: 'payroll_admin', tenant: 'northstar-demo', payroll: 200, surface: '/api/payroll-run', nav: 'Payroll' },
  { slug: 'company-admin', email: 'superuser@northstar.example', role: 'director', tenant: 'northstar-demo', payroll: 200, surface: '/api/onboarding', nav: 'Readiness' },
  { slug: 'isolation-manager', email: 'other@isolation.example', role: 'manager', tenant: 'isolation-test', payroll: 403, surface: '/api/bootstrap', nav: 'Time' }
];

async function browserFetch(page, path) {
  return page.evaluate(async p => {
    const r = await fetch(p, { credentials: 'same-origin', headers: { accept: 'application/json,text/plain,*/*' } });
    let body = null;
    try { body = await r.json(); } catch { body = await r.text(); }
    return { status: r.status, body };
  }, path);
}

let browser;
try {
  const healthResponse = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15000) });
  assert.equal(healthResponse.status, 200, 'Hosted candidate health endpoint failed.');
  const health = await healthResponse.json();
  assert.equal(health.fixtureOnly, true, 'Proof must remain fixture-only.');
  assert.equal(health.productionApproved, false, 'Proof environment unexpectedly claims production approval.');
  result.health = { status: healthResponse.status, fixtureOnly: health.fixtureOnly, productionApproved: health.productionApproved, release: health.release ?? null };

  browser = await chromium.launch({ headless: true });
  for (const spec of specs) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error?.stack || error).slice(0, 1200)));

    const pre = await page.request.get(`${origin}/api/bootstrap`, { failOnStatusCode: false });
    assert.equal(pre.status(), 401, `${spec.slug}: unauthenticated bootstrap did not fail closed.`);

    await page.goto(`${origin}/?vector_home=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const login = page.locator('#v2-login');
    assert.equal(await login.count(), 1, `${spec.slug}: login form missing.`);
    await login.locator('select[name=email]').selectOption(spec.email);
    await login.locator('input[name=password]').fill(password);
    const loginResponsePromise = page.waitForResponse(r => r.url() === `${origin}/api/login` && r.request().method() === 'POST', { timeout: 20000 });
    await login.locator('button[type=submit]').click();
    const loginResponse = await loginResponsePromise;
    assert.equal(loginResponse.status(), 200, `${spec.slug}: hosted browser login failed.`);
    await page.waitForFunction(() => {
      const el = document.querySelector('#v2-login');
      if (!el) return true;
      const rect = el.getBoundingClientRect();
      return getComputedStyle(el).display === 'none' || rect.width === 0 || rect.height === 0;
    }, null, { timeout: 20000 });
    await page.waitForTimeout(1000);

    const identity = await browserFetch(page, '/api/bootstrap');
    assert.equal(identity.status, 200, `${spec.slug}: authenticated bootstrap failed.`);
    assert.equal(identity.body?.actor?.role, spec.role, `${spec.slug}: role mismatch.`);
    assert.equal(identity.body?.actor?.tenant, spec.tenant, `${spec.slug}: tenant mismatch.`);

    const payroll = await browserFetch(page, '/api/payroll-run');
    assert.equal(payroll.status, spec.payroll, `${spec.slug}: payroll authorization boundary mismatch.`);
    const required = await browserFetch(page, spec.surface);
    assert.equal(required.status, 200, `${spec.slug}: required role surface failed.`);

    const shell = await page.evaluate(() => ({
      vectorUi: document.body.dataset.vectorUi || null,
      content: !!document.querySelector('.content'),
      sidebar: !!document.querySelector('.vector-sidebar'),
      topbar: !!document.querySelector('.vector-topbar'),
      nav: [...new Set([...document.querySelectorAll('a,button,[role="tab"]')].map(n => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 120)
    }));
    assert.equal(shell.content, true, `${spec.slug}: role-first content shell missing.`);
    assert.equal(shell.sidebar, true, `${spec.slug}: Vector sidebar missing.`);
    assert.equal(shell.topbar, true, `${spec.slug}: Vector topbar missing.`);

    const nav = page.getByText(spec.nav, { exact: true }).first();
    assert.equal(await nav.count() > 0, true, `${spec.slug}: required navigation '${spec.nav}' missing.`);
    assert.equal(await nav.isVisible(), true, `${spec.slug}: required navigation '${spec.nav}' not visible.`);
    await nav.click();
    await page.waitForTimeout(600);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const mobile = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      activeText: (document.querySelector('.content')?.innerText || '').slice(0, 300)
    }));
    assert.equal(mobile.overflow, false, `${spec.slug}: mobile horizontal overflow detected.`);
    assert.deepEqual(pageErrors, [], `${spec.slug}: browser page errors detected.`);

    result.roles.push({
      slug: spec.slug,
      role: spec.role,
      tenant: spec.tenant,
      loginStatus: loginResponse.status(),
      unauthenticatedBootstrapStatus: pre.status(),
      authenticatedBootstrapStatus: identity.status,
      payrollStatus: payroll.status,
      requiredSurface: spec.surface,
      requiredSurfaceStatus: required.status,
      navClicked: spec.nav,
      vectorUi: shell.vectorUi,
      visibleNavCount: shell.nav.length,
      mobile,
      pageErrors: pageErrors.length
    });
    await context.close();
  }

  assert.notEqual(result.roles.find(r => r.slug === 'manager')?.tenant, result.roles.find(r => r.slug === 'isolation-manager')?.tenant, 'Tenant-isolation role contexts unexpectedly share a tenant.');
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.error = String(error?.stack || error);
} finally {
  if (browser) await browser.close();
  delete process.env.WFM_STAGING_PASSWORD;
}

result.finishedAt = new Date().toISOString();
console.log('VECTOR_CURRENT_ROLE_BROWSER_PROOF=' + JSON.stringify(result));

const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(result.passed ? 200 : 500, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: result.passed, proofPassed: result.passed, roles: result.roles.length }));
  }
  if (req.url === '/report.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(result, null, 2));
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Current Vector hosted role-browser proof');
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
