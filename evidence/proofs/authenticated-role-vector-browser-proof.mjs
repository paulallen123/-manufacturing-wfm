import { chromium } from 'playwright';
import http from 'node:http';
import assert from 'node:assert/strict';

const rawTarget = process.env.VECTOR_PROOF_URL;
const password = process.env.WFM_STAGING_PASSWORD;
assert.ok(rawTarget, 'VECTOR_PROOF_URL is required');
assert.ok(password && password.length >= 20, 'WFM_STAGING_PASSWORD is unavailable');
const origin = new URL(rawTarget).origin;

const specs = [
  { slug:'manager', email:'manager@northstar.example', role:'manager', tenant:'northstar-demo', surface:'/api/time-review', payroll:403, nav:['Time & Attendance','Absence & Leave','Scheduling','Home'] },
  { slug:'employee', email:'maya@northstar.example', role:'employee', tenant:'northstar-demo', surface:'/api/personal', payroll:403, nav:['Home','Time & Attendance','Absence & Leave'] },
  { slug:'payroll', email:'payroll@northstar.example', role:'payroll_admin', tenant:'northstar-demo', surface:'/api/payroll-run', payroll:200, nav:['Reports','Time & Attendance','Home'] },
  { slug:'superuser', email:'superuser@northstar.example', role:'superuser', tenant:'northstar-demo', surface:'/api/onboarding', payroll:200, nav:['Admin','Integrations','Home'] },
];

const browser = await chromium.launch({ headless:true });
const results = [];
try {
  for (const spec of specs) {
    const context = await browser.newContext({ viewport:{width:1440,height:1000} });
    const page = await context.newPage();
    const api = [];
    page.on('response', r => {
      try {
        const u = new URL(r.url());
        if (u.origin === origin && u.pathname.startsWith('/api/')) api.push({method:r.request().method(),path:u.pathname,status:r.status()});
      } catch {}
    });

    await page.goto(`${origin}/?vector_home=1`, { waitUntil:'networkidle', timeout:120000 });
    const login = page.locator('#v2-login');
    assert.equal(await login.count(), 1, `${spec.slug}: fresh context did not fail closed to login`);
    await login.locator('select[name="email"]').selectOption(spec.email);
    await login.locator('input[name="password"]').fill(password);
    const loginResponse = page.waitForResponse(r => r.url() === `${origin}/api/login` && r.request().method() === 'POST', { timeout:15000 });
    await login.locator('button[type="submit"]').click();
    assert.equal((await loginResponse).status(), 200, `${spec.slug}: login failed`);
    await page.waitForFunction(() => !document.querySelector('#v2-login'), null, { timeout:15000 });
    await page.waitForFunction(() => document.body.dataset.vectorUi === 'approved-reference-v1', null, { timeout:15000 });

    const roleState = await page.evaluate(async ({surface}) => {
      const get = async path => { const r = await fetch(path,{headers:{accept:'application/json'}}); let body=null; try{body=await r.json()}catch{} return {status:r.status,body}; };
      return {
        bootstrap: await get('/api/bootstrap'),
        surface: await get(surface),
        payroll: await get('/api/payroll-run'),
        vectorUi: document.body.dataset.vectorUi || null,
        shell: document.querySelector('.app')?.dataset.vectorShell || null,
        sidebar: !!document.querySelector('.vector-sidebar'),
        topbar: !!document.querySelector('.vector-topbar'),
        oldPayroll: (document.body.innerText||'').includes('Payroll review due today'),
        oldValueDesk: (document.body.innerText||'').includes('Automated value desk'),
        oldSaving: (document.body.innerText||'').includes('The system finds the saving.'),
      };
    }, { surface:spec.surface });

    assert.equal(roleState.bootstrap.status, 200, `${spec.slug}: bootstrap failed`);
    assert.equal(roleState.bootstrap.body?.actor?.role, spec.role, `${spec.slug}: role mismatch`);
    assert.equal(roleState.bootstrap.body?.actor?.tenant, spec.tenant, `${spec.slug}: tenant mismatch`);
    assert.equal(roleState.surface.status, 200, `${spec.slug}: required surface failed`);
    assert.equal(roleState.payroll.status, spec.payroll, `${spec.slug}: payroll capability boundary mismatch`);
    assert.equal(roleState.vectorUi, 'approved-reference-v1', `${spec.slug}: Vector UI marker missing`);
    assert.equal(roleState.sidebar, true, `${spec.slug}: Vector sidebar missing`);
    assert.equal(roleState.topbar, true, `${spec.slug}: Vector topbar missing`);
    assert.equal(roleState.oldPayroll || roleState.oldValueDesk || roleState.oldSaving, false, `${spec.slug}: retired presentation visible`);

    let clicked = null;
    for (const label of spec.nav) {
      const loc = page.getByText(label,{exact:true}).first();
      if (await loc.count() && await loc.isVisible()) {
        await loc.click();
        await page.waitForTimeout(500);
        clicked = label;
        break;
      }
    }
    assert.ok(clicked, `${spec.slug}: no permitted role-first navigation target was clickable`);
    assert.equal(await page.locator('#v2-login').count(), 0, `${spec.slug}: navigation lost authenticated session`);

    await page.setViewportSize({width:390,height:844});
    await page.reload({waitUntil:'networkidle',timeout:120000});
    await page.waitForFunction(() => document.body.dataset.vectorUi === 'approved-reference-v1', null, {timeout:15000});
    const mobile = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      vectorUi: document.body.dataset.vectorUi || null,
      sidebar: !!document.querySelector('.vector-sidebar'),
      topbar: !!document.querySelector('.vector-topbar'),
    }));
    assert.equal(mobile.vectorUi,'approved-reference-v1',`${spec.slug}: mobile Vector marker missing`);
    assert.ok(mobile.scrollWidth <= mobile.width + 2, `${spec.slug}: mobile horizontal overflow ${mobile.scrollWidth}/${mobile.width}`);

    results.push({
      slug:spec.slug,
      role:spec.role,
      tenant:spec.tenant,
      requiredSurface:spec.surface,
      requiredSurfaceStatus:roleState.surface.status,
      payrollStatus:roleState.payroll.status,
      clicked,
      desktopVector:true,
      mobileVector:true,
      mobileWidth:mobile.width,
      mobileScrollWidth:mobile.scrollWidth,
      api:[...new Map(api.map(x=>[`${x.method} ${x.path} ${x.status}`,x])).values()],
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const receipt={
  proof:'authenticated-role-vector-browser-proof',
  result:'PASS',
  origin,
  roles:results,
  claimBoundary:'Fixture-only hosted staging. Proves fresh-context login, role and tenant identity, required role surface, payroll capability boundary, Vector role-first render, one role-appropriate UI navigation click, and mobile no-horizontal-overflow for four roles. Does not claim production approval, physical-device acceptance, every task path, or real provider/customer data.',
};
console.log('AUTHENTICATED_ROLE_VECTOR_BROWSER_PROOF=PASS '+JSON.stringify(receipt));
http.createServer((req,res)=>{if(req.url==='/api/health'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:true,receipt}));return;}res.writeHead(200,{'content-type':'text/plain'});res.end('authenticated role Vector browser proof PASS');}).listen(Number(process.env.PORT||3000),'0.0.0.0');
