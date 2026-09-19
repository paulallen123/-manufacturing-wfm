import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';

const origin = new URL(process.env.VECTOR_PROOF_URL).origin;
const password = process.env.WFM_STAGING_PASSWORD;
if (!password) throw new Error('WFM_STAGING_PASSWORD is required');

const result = { origin, startedAt: new Date().toISOString() };
let screenshot = null;
try {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const consoleLines = [];
    const pageErrors = [];
    page.on('console', m => consoleLines.push({ type: m.type(), text: m.text().slice(0, 500) }));
    page.on('pageerror', e => pageErrors.push(String(e?.stack || e).slice(0, 1200)));
    await page.goto(origin + '/?vector_home=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
    const login = page.locator('#v2-login');
    await login.locator('select[name=email]').selectOption('manager@northstar.example');
    await login.locator('input[name=password]').fill(password);
    const loginResponse = page.waitForResponse(r => r.url() === origin + '/api/login' && r.request().method() === 'POST', { timeout: 20000 });
    await login.locator('button[type=submit]').click();
    result.loginStatus = (await loginResponse).status();
    await page.waitForTimeout(3500);
    result.snapshot = await page.evaluate(() => {
      const l = document.querySelector('#v2-login');
      return {
        vectorUi: document.body.dataset.vectorUi || null,
        bodyClass: document.body.className,
        app: !!document.querySelector('.app'),
        content: !!document.querySelector('.content'),
        vectorSidebar: !!document.querySelector('.vector-sidebar'),
        vectorTopbar: !!document.querySelector('.vector-topbar'),
        loginPresent: !!l,
        loginDisplay: l ? getComputedStyle(l).display : null,
        loginVisibility: l ? getComputedStyle(l).visibility : null,
        loginRect: l ? { w: l.getBoundingClientRect().width, h: l.getBoundingClientRect().height } : null,
        currentText: (document.querySelector('.content')?.innerText || document.body.innerText || '').slice(0, 1200)
      };
    });
    result.console = consoleLines.slice(-40);
    result.pageErrors = pageErrors;
    screenshot = '/tmp/vector-proof/live-after-fix.png';
    await page.screenshot({ path: screenshot, fullPage: true });
    result.screenshot = true;
    result.passed = result.loginStatus === 200 && result.snapshot.content === true && result.snapshot.vectorSidebar === true && result.snapshot.vectorTopbar === true && result.pageErrors.length === 0 && (!result.snapshot.loginPresent || result.snapshot.loginDisplay === 'none' || result.snapshot.loginRect?.w === 0);
  } finally {
    await browser.close();
  }
} catch (error) {
  result.error = String(error?.stack || error);
  result.passed = false;
}
result.finishedAt = new Date().toISOString();
console.log('VECTOR_LIVE_AFTER_FIX=' + JSON.stringify(result));

const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, proofPassed: result.passed }));
  }
  if (req.url === '/report.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(result, null, 2));
  }
  if (req.url === '/live-after-fix.png' && screenshot) {
    try {
      res.writeHead(200, { 'content-type': 'image/png' });
      return fs.createReadStream(screenshot).pipe(res);
    } catch {}
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Vector live proof service');
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
