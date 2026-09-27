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
  const headers = { origin, 'x-forwarded-proto': 'https' };
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
  const result = await request('/api/login', { method: 'POST', body: { email, password } });
  assert(result.status === 200, 'login ' + email + ' HTTP ' + result.status);
  const match = (result.headers.get('set-cookie') || '').match(/wfm_session=([^;]+)/);
  assert(match, 'session cookie missing for ' + email);
  return 'wfm_session=' + match[1];
}
function shallow(value) {
  if (Array.isArray(value)) return value.slice(0, 12);
  if (!value || typeof value !== 'object') return value;
  return value;
}

try {
  const manager = await login('manager@northstar.example');
  const employee = await login('maya@northstar.example');
  state = { ...state, stage: 'read-runtime' };

  const [bootstrap, personal, weekly, timeReview, asset] = await Promise.all([
    request('/api/bootstrap', { cookie: manager }),
    request('/api/personal', { cookie: employee }),
    request('/api/weekly-review', { cookie: manager }),
    request('/api/time-review', { cookie: manager }),
    request('/work-rules.js', { cookie: manager })
  ]);
  for (const [name, item] of Object.entries({ bootstrap, personal, weekly, timeReview, asset })) {
    assert(item.status === 200, name + ' HTTP ' + item.status);
  }

  const bs = bootstrap.json?.state || {};
  const result = {
    bootstrapKeys: Object.keys(bs).sort(),
    costingKeys: Object.keys(bs.costing || {}).sort(),
    workRulesKeys: Object.keys(bs.workRules || {}).sort(),
    costingPolicies: shallow(bs.costing?.policies || null),
    employeePolicies: shallow(bs.costing?.employeePolicies || null),
    workRules: shallow(bs.workRules || null),
    assignments: (bs.assignments || []).slice(0, 12).map(x => ({
      id: x.id ?? null,
      employeeId: x.employeeId ?? x.employee ?? null,
      breakMinutes: x.breakMinutes ?? null,
      start: x.start ?? x.startTime ?? null,
      end: x.end ?? x.endTime ?? null
    })),
    employeePolicy: personal.json?.policy || null,
    employeeLeave: personal.json?.leave || null,
    weeklyTotals: (weekly.json?.teams || []).slice(0, 6).map(team => ({
      id: team.id ?? null,
      holidayMinutes: team.holidayMinutes ?? null,
      sicknessMinutes: team.sicknessMinutes ?? null,
      employees: (team.employees || []).slice(0, 12).map(e => ({
        id: e.id ?? e.employeeId ?? null,
        overtimeMinutes: e.overtimeMinutes ?? null,
        holidayMinutes: e.holidayMinutes ?? null,
        sicknessMinutes: e.sicknessMinutes ?? null,
        paidAbsenceMinutes: e.paidAbsenceMinutes ?? null
      }))
    })),
    timeReviewSample: (timeReview.json?.rows || []).slice(0, 12).map(row => ({
      id: row.id ?? null,
      clockIn: row.clockIn ?? null,
      clockOut: row.clockOut ?? null,
      breakCount: Array.isArray(row.breaks) ? row.breaks.length : null,
      breaks: row.breaks || []
    })),
    workRulesMarkers: (asset.text.match(/.{0,100}(?:overtimeBasis|overtimeAfter|overtimeMultiplier|holidayMethod|holidayWeeks|rolledUp|breaks|paid).{0,170}/ig) || []).slice(0, 40)
  };

  console.log('VECTOR_POLICY_DISCOVERY_V2=' + JSON.stringify(result));
  state = { status: 'PASS', stage: 'complete', finishedAt: new Date().toISOString(), result };
} catch (error) {
  state = { status: 'FAIL', stage: 'failed', finishedAt: new Date().toISOString(), error: String(error?.stack || error).slice(0, 5000) };
  console.error('VECTOR_POLICY_DISCOVERY_V2=FAIL|' + state.error);
}
