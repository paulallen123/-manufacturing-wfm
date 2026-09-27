import http from 'node:http';

const origin = new URL(process.env.TARGET_ORIGIN).origin;
const password = process.env.WFM_STAGING_PASSWORD;
const port = Number(process.env.PORT || 3000);
let state = { status: 'PENDING', stage: 'startup', startedAt: new Date().toISOString() };

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  if (req.url === '/health') {
    res.statusCode = state.status === 'PASS' ? 200 : 503;
    return res.end(JSON.stringify(state));
  }
  if (req.url === '/proof') {
    res.statusCode = state.status === 'PASS' ? 200 : state.status === 'FAIL' ? 503 : 202;
    return res.end(JSON.stringify(state));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});
server.listen(port, '0.0.0.0', () => console.log('VECTOR_POLICY_DISCOVERY_LISTENING=' + port));

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function request(path, { method = 'GET', body = null, cookie = null } = {}) {
  const headers = {
    origin,
    'x-forwarded-proto': 'https'
  };
  if (body !== null) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(origin + path, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, text, json, headers: response.headers };
}

async function login(email) {
  const result = await request('/api/login', {
    method: 'POST',
    body: { email, password }
  });
  assert(result.status === 200, 'login ' + email + ' HTTP ' + result.status);
  const match = (result.headers.get('set-cookie') || '').match(/wfm_session=([^;]+)/);
  assert(match, 'session cookie missing for ' + email);
  return 'wfm_session=' + match[1];
}

const policyKey = /(policy|policies|break|overtime|holiday|absence|leave|entitle|sick|time|clock|shift)/i;
function relevant(value, depth = 0) {
  if (depth > 4 || value == null) return {};
  if (Array.isArray(value)) return value.slice(0, 8).map(item => relevant(item, depth + 1));
  if (typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (policyKey.test(key)) {
      output[key] = item && typeof item === 'object' ? relevant(item, depth + 1) : item;
    } else if (item && typeof item === 'object') {
      const child = relevant(item, depth + 1);
      if (child && typeof child === 'object' && Object.keys(child).length) output[key] = child;
    }
  }
  return output;
}

try {
  state = { ...state, stage: 'login' };
  const manager = await login('manager@northstar.example');
  const employee = await login('maya@northstar.example');

  const result = { manager: {}, employee: {} };
  state = { ...state, stage: 'manager-surfaces' };
  for (const path of ['/api/bootstrap', '/api/time-review', '/api/weekly-review', '/api/operations', '/api/onboarding']) {
    const response = await request(path, { cookie: manager });
    result.manager[path] = { status: response.status, relevant: response.json ? relevant(response.json) : {} };
  }

  state = { ...state, stage: 'employee-surfaces' };
  for (const path of ['/api/personal', '/api/bootstrap']) {
    const response = await request(path, { cookie: employee });
    result.employee[path] = { status: response.status, relevant: response.json ? relevant(response.json) : {} };
  }

  const asset = await request('/work-rules.js', { cookie: manager });
  result.workRulesAsset = {
    status: asset.status,
    markers: (asset.text.match(/.{0,90}(?:policy|break|overtime|holiday|absence|leave|entitle|sick|work.?rule).{0,150}/ig) || []).slice(0, 24)
  };

  console.log('VECTOR_POLICY_DISCOVERY=' + JSON.stringify(result));
  state = { status: 'PASS', stage: 'complete', finishedAt: new Date().toISOString(), result };
} catch (error) {
  state = { status: 'FAIL', stage: 'failed', finishedAt: new Date().toISOString(), error: String(error?.stack || error).slice(0, 5000) };
  console.error('VECTOR_POLICY_DISCOVERY=FAIL|' + state.error);
}
