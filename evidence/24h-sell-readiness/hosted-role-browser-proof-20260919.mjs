import { chromium } from 'playwright';
import http from 'node:http';

const origin = new URL(process.env.VECTOR_PROOF_URL).origin;
const password = process.env.WFM_STAGING_PASSWORD;
const expectedSha = process.env.WFM_EXPECTED_CANDIDATE_SHA || null;
if (!password || password.length < 20) throw new Error('WFM_STAGING_PASSWORD unavailable');

const specs = [
  { slug: 'manager', email: 'manager@northstar.example', role: 'manager', tenant: 'northstar-demo', surface: '/api/time-review' },
  { slug: 'employee', email: 'maya@northstar.example', role: 'employee', tenant: 'northstar-demo', surface: '/api/personal' },
  { slug: 'payroll', email: 'payroll@northstar.example', role: 'payroll_admin', tenant: 'northstar-demo', surface: '/api/payroll-run' },
  { slug: 'superuser', email: 'superuser@northstar.example', role: 'superuser', tenant: 'northstar-demo', surface: '/api/onboarding' },
  { slug: 'isolation', email: 'other@isolation.example', role: null, tenant: 'isolation-test', surface: '/api/bootstrap' },
];

const report = { origin, expectedSha, startedAt: new Date().toISOString(), roles: [], passed: false };
let browser;
try {
  const healthResponse = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(15000) });
  if (healthResponse.status !== 200) throw new Error(`health ${healthResponse.status}`);
  const health = await healthResponse.json();
  if (health.fixtureOnly !== true || health.productionApproved !== false) {
    throw new Error('claim boundary flags changed unexpectedly');
  }
  report.health = { release: health.release, fixtureOnly: health.fixtureOnly, productionApproved: health.productionApproved, pilotReady: health.pilotReady };

  const unauth = await fetch(origin + '/api/bootstrap', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  if (unauth.status !== 401) throw new Error(`unauthenticated bootstrap expected 401, got ${unauth.status}`);
  report.unauthenticatedBootstrapStatus = unauth.status;

  browser = await chromium.launch({ headless: true });
  for (const spec of specs) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error?.stack || error).slice(0, 1200)));

    await page.goto(origin + '/?vector_home=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
    const login = page.locator('#v2-login');
    await login.locator('select[name=email]').selectOption(spec.email);
    await login.locator('input[name=password]').fill(password);
    const loginResponsePromise = page.waitForResponse(r => r.url() === origin + '/api/login' && r.request().method() === 'POST', { timeout: 20000 });
    await login.locator('button[type=submit]').click();
    const loginResponse = await loginResponsePromise;
    if (loginResponse.status() !== 200) throw new Error(`${spec.slug} login ${loginResponse.status()}`);
    await page.waitForTimeout(1800);

    const bootstrapResponse = await context.request.get(origin + '/api/bootstrap', { timeout: 15000 });
    if (bootstrapResponse.status() !== 200) throw new Error(`${spec.slug} bootstrap ${bootstrapResponse.status()}`);
    const identity = await bootstrapResponse.json();
    if (spec.role && identity.actor?.role !== spec.role) throw new Error(`${spec.slug} role ${identity.actor?.role}`);
    if (identity.actor?.tenant !== spec.tenant) throw new Error(`${spec.slug} tenant ${identity.actor?.tenant}`);

    const surfaceResponse = await context.request.get(origin + spec.surface, { timeout: 15000 });
    if (surfaceResponse.status() !== 200) throw new Error(`${spec.slug} surface ${spec.surface} ${surfaceResponse.status()}`);

    const learningResponse = await context.request.get(origin + '/api/learning/adaptive/plan', { timeout: 15000 });
    if (learningResponse.status() !== 200) throw new Error(`${spec.slug} learning plan ${learningResponse.status()}`);
    const learning = await learningResponse.json();

    const desktop = await page.evaluate(() => {
      const login = document.querySelector('#v2-login');
      const root = document.documentElement;
      return {
        vectorUi: document.body.dataset.vectorUi || null,
        vectorSidebar: Boolean(document.querySelector('.vector-sidebar')),
        vectorTopbar: Boolean(document.querySelector('.vector-topbar')),
        content: Boolean(document.querySelector('.content')),
        coach: Boolean(document.querySelector('#wfm-adaptive-coach')),
        loginHidden: !login || getComputedStyle(login).display === 'none' || login.getBoundingClientRect().width === 0,
        overflowPx: Math.max(0, root.scrollWidth - window.innerWidth),
      };
    });
    if (!desktop.vectorSidebar || !desktop.vectorTopbar || !desktop.content || !desktop.loginHidden) {
      throw new Error(`${spec.slug} Vector shell not rendered`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(1200);
    const mobile = await page.evaluate(() => ({
      vectorSidebar: Boolean(document.querySelector('.vector-sidebar')),
      vectorTopbar: Boolean(document.querySelector('.vector-topbar')),
      content: Boolean(document.querySelector('.content')),
      overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    }));
    if (!mobile.vectorTopbar || !mobile.content || mobile.overflowPx > 2) throw new Error(`${spec.slug} mobile Vector proof failed`);
    if (pageErrors.length) throw new Error(`${spec.slug} page errors: ${pageErrors.join(' | ')}`);

    report.roles.push({
      slug: spec.slug,
      email: spec.email,
      role: identity.actor?.role || null,
      tenant: identity.actor?.tenant || null,
      loginStatus: loginResponse.status(),
      bootstrapStatus: bootstrapResponse.status(),
      requiredSurface: spec.surface,
      requiredSurfaceStatus: surfaceResponse.status(),
      learningPlanStatus: learningResponse.status(),
      masteryPercent: learning.progress?.percent ?? learning.masteryPercent ?? null,
      desktop,
      mobile,
      pageErrors,
    });
    await context.close();
  }
  report.passed = true;
} catch (error) {
  report.error = String(error?.stack || error);
  report.passed = false;
} finally {
  await browser?.close().catch(() => {});
  delete process.env.WFM_STAGING_PASSWORD;
}
report.finishedAt = new Date().toISOString();
console.log('HOSTED_ROLE_BROWSER_PROOF=' + JSON.stringify(report));

http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, proofPassed: report.passed, expectedSha }));
  }
  if (req.url === '/report.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(report, null, 2));
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Hosted role browser proof service');
}).listen(Number(process.env.PORT || 3000), '0.0.0.0');
