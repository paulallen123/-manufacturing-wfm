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
  { slug: 'manager', email: 'manager@northstar.example', role: 'manager', tenant: 'northstar-demo', payroll: 403, surface: '/api/time-review' },
  { slug: 'employee', email: 'maya@northstar.example', role: 'employee', tenant: 'northstar-demo', payroll: 403, surface: '/api/personal' },
  { slug: 'payroll', email: 'payroll@northstar.example', role: 'payroll_admin', tenant: 'northstar-demo', payroll: 200, surface: '/api/payroll-run' },
  { slug: 'company-admin', email: 'superuser@northstar.example', role: 'director', tenant: 'northstar-demo', payroll: 200, surface: '/api/onboarding' },
  { slug: 'isolation-manager', email: 'other@isolation.example', role: 'manager', tenant: 'isolation-test', payroll: 403, surface: '/api/bootstrap' }
];

async function browserFetch(page, path) {
  return page.evaluate(async p => {
    const r = await fetch(p, { credentials: 'same-origin', headers: { accept: 'application/json,text/plain,*/*' } });
    let body = null;
    try { body = await r.json(); } catch { body = await r.text(); }
    return { status: r.status, body };
  }, path);
}

async function uiSnapshot(page) {
  return page.evaluate(() => {
    const login = document.querySelector('#v2-login');
    const rect = login?.getBoundingClientRect();
    const style = login ? getComputedStyle(login) : null;
    const visible = !!login && style?.display !== 'none' && style?.visibility !== 'hidden' && (rect?.width || 0) > 0 && (rect?.height || 0) > 0;
    const nav = [...new Set([...document.querySelectorAll('.vector-sidebar a,.vector-sidebar button,.vector-sidebar [role="tab"]')]
      .map(n => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
    return {
      href: location.href,
      bodyClass: document.body.className,
      vectorUi: document.body.dataset.vectorUi || null,
      app: !!document.querySelector('.app'),
      content: !!document.querySelector('.content'),
      sidebar: !!document.querySelector('.vector-sidebar'),
      topbar: !!document.querySelector('.vector-topbar'),
      loginPresent: !!login,
      loginVisible: visible,
      loginDisplay: style?.display || null,
      loginVisibility: style?.visibility || null,
      loginRect: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
      nav,
      text: (document.querySelector('.content')?.innerText || document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 900)
    };
  });
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
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error?.stack || error).slice(0, 1200)));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 1200)); });

    const roleResult = { slug: spec.slug, role: spec.role, tenant: spec.tenant };
    result.roles.push(roleResult);

    const pre = await page.request.get(`${origin}/api/bootstrap`, { failOnStatusCode: false });
    roleResult.unauthenticatedBootstrapStatus = pre.status();
    assert.equal(pre.status(), 401, `${spec.slug}: unauthenticated bootstrap did not fail closed.`);

    await page.goto(`${origin}/?vector_home=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const login = page.locator('#v2-login');
    assert.equal(await login.count(), 1, `${spec.slug}: login form missing.`);
    roleResult.beforeLogin = await uiSnapshot(page);
    await login.locator('select[name=email]').selectOption(spec.email);
    await login.locator('input[name=password]').fill(password);
    const loginResponsePromise = page.waitForResponse(r => r.url() === `${origin}/api/login` && r.request().method() === 'POST', { timeout: 20000 });
    await login.locator('button[type=submit]').click();
    const loginResponse = await loginResponsePromise;
    roleResult.loginStatus = loginResponse.status();
    assert.equal(loginResponse.status(), 200, `${spec.slug}: hosted browser login failed.`);

    await page.waitForTimeout(2500);
    const identity = await browserFetch(page, '/api/bootstrap');
    roleResult.authenticatedBootstrapStatus = identity.status;
    roleResult.authenticatedActor = identity.body?.actor ? { role: identity.body.actor.role, tenant: identity.body.actor.tenant } : null;
    roleResult.afterLogin = await uiSnapshot(page);
    roleResult.pageErrors = [...pageErrors];
    roleResult.consoleErrors = [...consoleErrors];

    if (roleResult.afterLogin.loginVisible) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(1500);
      roleResult.afterAuthenticatedReload = await uiSnapshot(page);
      roleResult.pageErrorsAfterReload = [...pageErrors];
      roleResult.consoleErrorsAfterReload = [...consoleErrors];
      throw new Error(`${spec.slug}: login POST returned 200 but the login surface remained visible; authenticated reload visibility=${roleResult.afterAuthenticatedReload.loginVisible}`);
    }

    assert.equal(identity.status, 200, `${spec.slug}: authenticated bootstrap failed.`);
    assert.equal(identity.body?.actor?.role, spec.role, `${spec.slug}: role mismatch.`);
    assert.equal(identity.body?.actor?.tenant, spec.tenant, `${spec.slug}: tenant mismatch.`);

    const payroll = await browserFetch(page, '/api/payroll-run');
    roleResult.payrollStatus = payroll.status;
    assert.equal(payroll.status, spec.payroll, `${spec.slug}: payroll authorization boundary mismatch.`);
    const required = await browserFetch(page, spec.surface);
    roleResult.requiredSurface = spec.surface;
    roleResult.requiredSurfaceStatus = required.status;
    assert.equal(required.status, 200, `${spec.slug}: required role surface failed.`);

    const shell = await uiSnapshot(page);
    roleResult.shell = shell;
    assert.equal(shell.content, true, `${spec.slug}: role-first content shell missing.`);
    assert.equal(shell.sidebar, true, `${spec.slug}: Vector sidebar missing.`);
    assert.equal(shell.topbar, true, `${spec.slug}: Vector topbar missing.`);
    assert.equal(shell.nav.length > 0, true, `${spec.slug}: no Vector navigation is visible.`);

    const candidateNav = page.locator('.vector-sidebar a,.vector-sidebar button,.vector-sidebar [role="tab"]').filter({ visible: true });
    const count = await candidateNav.count();
    let clicked = null;
    for (let i = 0; i < count; i++) {
      const item = candidateNav.nth(i);
      if (!(await item.isVisible())) continue;
      const label = ((await item.textContent()) || '').replace(/\s+/g, ' ').trim();
      if (!label || /^home$/i.test(label)) continue;
      await item.click();
      clicked = label;
      break;
    }
    assert.ok(clicked, `${spec.slug}: no non-home Vector navigation target was usable.`);
    roleResult.navClicked = clicked;
    await page.waitForTimeout(600);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const mobile = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      activeText: (document.querySelector('.content')?.innerText || '').slice(0, 300)
    }));
    roleResult.mobile = mobile;
    roleResult.pageErrors = [...pageErrors];
    roleResult.consoleErrors = [...consoleErrors];
    assert.equal(mobile.overflow, false, `${spec.slug}: mobile horizontal overflow detected.`);
    assert.deepEqual(pageErrors, [], `${spec.slug}: browser page errors detected.`);
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
