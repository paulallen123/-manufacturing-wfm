import http from 'node:http';

const origin = String(process.env.TARGET_ORIGIN || '').replace(/\/$/, '');
const password = process.env.TARGET_PASSWORD || '';
const expectedRelease = process.env.EXPECTED_RELEASE || '0.6.76-hosted-staging-rc1';
const port = Number(process.env.PORT || 3000);
let latest = { status: 'starting', startedAt: new Date().toISOString(), checks: [] };

function check(name, ok, detail = '') {
  latest.checks.push({ name, ok, detail });
  if (!ok) throw new Error(name + (detail ? ': ' + detail : ''));
}

async function req(path, init = {}) {
  const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  return { response, text };
}
function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';', 1)[0];
}
async function login(email) {
  const { response } = await req('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, referer: origin + '/', accept: 'application/json,text/plain,*/*' },
    body: JSON.stringify({ email, password }),
  });
  check('login:' + email, response.status === 200, 'HTTP ' + response.status);
  const cookie = cookieFrom(response);
  check('session-cookie:' + email, Boolean(cookie), 'missing session cookie');
  return cookie;
}
async function authed(cookie, path, expected = 200) {
  const { response, text } = await req(path, { headers: { cookie, accept: 'application/json,text/plain,*/*', referer: origin + '/' } });
  check(path, response.status === expected, 'HTTP ' + response.status + ', expected ' + expected);
  return { response, text };
}
async function runProof() {
  latest = { status: 'running', startedAt: new Date().toISOString(), target: origin, expectedRelease, checks: [] };
  try {
    check('configuration', origin.startsWith('https://') && password.length >= 20, 'invalid verifier configuration');

    const health = await req('/api/health');
    check('public-health-http', health.response.status === 200, 'HTTP ' + health.response.status);
    const body = JSON.parse(health.text);
    check('release-identity', body.release === expectedRelease, String(body.release));
    check('hosted-mode', body.mode === 'hosted-staging', String(body.mode));
    check('fixture-boundary', body.fixtureOnly === true && body.productionApproved === false && body.pilotReady === false,
      JSON.stringify({ fixtureOnly: body.fixtureOnly, productionApproved: body.productionApproved, pilotReady: body.pilotReady }));

    const unauth = await req('/api/bootstrap');
    check('unauth-bootstrap-fail-closed', unauth.response.status === 401, 'HTTP ' + unauth.response.status);

    const manager = await login('manager@northstar.example');
    await authed(manager, '/api/bootstrap');
    await authed(manager, '/api/payroll-run', 403);

    const superuser = await login('superuser@northstar.example');
    const core = [
      '/api/bootstrap','/api/readiness','/api/weekly-review','/api/schedule-publication','/api/operations',
      '/api/payroll-run','/api/readiness/payroll-outcomes','/api/readiness/finance-attribution',
      '/api/payroll-intelligence','/api/support/bot','/api/personal'
    ];
    for (const path of core) await authed(superuser, path);

    const categories = {
      'company-onboarding':['/api/onboarding','/api/company'],
      'workforce-resources':['/api/resources','/api/availability'],
      'demand-labour':['/api/demand','/api/operations'],
      'time-attendance':['/api/time-review','/api/attendance-corrections','/api/payroll-run'],
      'cost-value':['/api/cost','/api/recommendations','/api/value-cockpit','/api/readiness/finance-attribution']
    };
    for (const [name, paths] of Object.entries(categories)) {
      let passed = '';
      for (const path of paths) {
        const r = await req(path, { headers: { cookie: superuser, accept: 'application/json,text/plain,*/*', referer: origin + '/' } });
        if (r.response.status === 200) { passed = path; break; }
      }
      check('category:' + name, Boolean(passed), 'no HTTP-200 route');
    }

    const assets = ['/','/onboarding-ui.js','/resources-ui.js','/availability-ui.js','/demand-ui.js','/time-review-ui.js',
      '/cost-ui.js','/recommendation-ui.js','/kiosk-admin-ui.js','/kiosk.html'];
    for (const path of assets) {
      const r = await req(path, { headers: { cookie: superuser, referer: origin + '/' } });
      check('asset:' + path, r.response.status === 200, 'HTTP ' + r.response.status);
    }

    latest.status = 'PASS';
  } catch (error) {
    latest.status = 'FAIL';
    latest.error = String(error?.message || error);
  }
  latest.finishedAt = new Date().toISOString();
  latest.passCount = latest.checks.filter(x => x.ok).length;
  latest.failCount = latest.checks.filter(x => !x.ok).length;
  return latest;
}

runProof();

const server = http.createServer(async (request, response) => {
  if (request.url === '/rerun') await runProof();
  response.writeHead(latest.status === 'PASS' ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(latest));
});
server.listen(port, '0.0.0.0');
