import assert from 'node:assert/strict';

const origin = new URL(process.env.VECTOR_PROOF_URL).origin;
const password = process.env.WFM_STAGING_PASSWORD;
const expectedSha = process.env.WFM_EXPECTED_CANDIDATE_SHA;
assert.ok(password && password.length >= 20, 'Staging password unavailable.');
assert.match(expectedSha || '', /^[0-9a-f]{40}$/);

async function raw(path, cookie = '', method = 'GET', payload) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return {
    status: response.status,
    body,
    cookie: response.headers.get('set-cookie')?.split(';')[0] || ''
  };
}

async function login(email) {
  const result = await raw('/api/login', '', 'POST', { email, password });
  assert.equal(result.status, 200, 'Login failed for proof role.');
  assert.ok(result.cookie, 'Login returned no session cookie.');
  return result.cookie;
}

async function bootstrap(cookie) {
  const result = await raw('/api/bootstrap', cookie);
  assert.equal(result.status, 200, 'Bootstrap failed during live action proof.');
  return result.body;
}

const receipts = [];
function pass(name, detail = {}) {
  receipts.push({ name, status: 'PASS', ...detail });
}

const health = await raw('/api/health');
assert.equal(health.status, 200);
assert.equal(health.body?.productionApproved, false);
pass('hosted health is reachable and remains non-production approved');

const employee = await login('maya@northstar.example');
const manager = await login('manager@northstar.example');
const other = await login('other@isolation.example');
const payroll = await login('payroll@northstar.example');
const director = await login('superuser@northstar.example');

function londonLocal(iso) {
  if (!iso) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(iso)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
}

// Create a genuine Time Review action through the supported manager correction workflow.
// Reuse an existing open adjustment if a previous proof run left one for independent review.
const period = '2026-09-07';
let weekly = await raw('/api/weekly-review?period=' + encodeURIComponent(period), manager);
assert.equal(weekly.status, 200);
let adjustment = null;
let adjustmentTeam = null;
for (const team of weekly.body?.teams || []) {
  const existing = (team.issues || []).find(issue => issue?.status === 'open' && issue?.type === 'adjustment');
  if (existing) { adjustment = existing; adjustmentTeam = team; break; }
}
if (!adjustment) {
  const team = (weekly.body?.teams || []).find(item => (item.records || []).some(row =>
    row?.effective?.kind === 'worked' && row?.effective?.clockIn && row?.effective?.clockOut &&
    (row?.effective?.breaks || []).length <= 1 && !(row?.effective?.breaks || []).some(item => item?.paid === true)
  ));
  assert.ok(team, 'No safe worked Time Review record exists for hosted correction proof.');
  const row = team.records.find(item =>
    item?.effective?.kind === 'worked' && item?.effective?.clockIn && item?.effective?.clockOut &&
    (item?.effective?.breaks || []).length <= 1 && !(item?.effective?.breaks || []).some(entry => entry?.paid === true)
  );
  const managerBootstrap = await bootstrap(manager);
  const breaks = row.effective.breaks || [];
  const proposed = await raw('/api/command', manager, 'POST', {
    command: 'review-amend',
    payload: {
      period,
      team: team.id,
      revision: team.revision,
      record: row.id,
      clockIn: londonLocal(row.effective.clockIn),
      clockOut: londonLocal(new Date(Date.parse(row.effective.clockOut) + 5 * 60_000).toISOString()),
      breakStart: londonLocal(breaks[0]?.start),
      breakEnd: londonLocal(breaks[0]?.end),
      breaksConfirmed: true,
      reason: 'Hosted proof correction proposed from preserved source clock evidence.'
    },
    version: managerBootstrap.state.version
  });
  assert.equal(proposed.status, 200, 'Hosted review-amend failed: ' + JSON.stringify(proposed.body));
  weekly = await raw('/api/weekly-review?period=' + encodeURIComponent(period), manager);
  assert.equal(weekly.status, 200);
  adjustmentTeam = (weekly.body?.teams || []).find(item => item.id === team.id);
  adjustment = (adjustmentTeam?.issues || []).find(issue => issue?.status === 'open' && issue?.type === 'adjustment' && issue?.row === row.id);
  assert.ok(adjustment, 'Saved manager correction did not create an open adjustment issue.');
}
pass('manager correction proposal created a real Time Review action', { issueId: adjustment.id, team: adjustmentTeam.id });

const sourceAfterAdjustment = await raw('/api/time-review', manager);
assert.equal(sourceAfterAdjustment.status, 200);
const sourceIssue = (sourceAfterAdjustment.body?.teams || [])
  .flatMap(team => team?.issues || [])
  .find(issue => issue?.id === adjustment.id || issue?.sourceId === adjustment.id);
assert.ok(sourceIssue, 'Time Review source did not expose the saved open adjustment.');
const actionEvidenceAfterAdjustment = await raw('/api/workforce/lifecycle/action-evidence/time-review', manager);
assert.equal(actionEvidenceAfterAdjustment.status, 200);
const actionItem = (actionEvidenceAfterAdjustment.body?.items || [])
  .find(item => item?.sourceId === adjustment.id || item?.sourceId === sourceIssue.id);
assert.ok(actionItem, 'Lifecycle action-evidence bridge did not expose the saved Time Review adjustment.');
pass('lifecycle bridge exposes the real Time Review action', {
  sourceId: actionItem.sourceId,
  state: actionItem.confirmation?.state || null
});
console.log('CURRENT_HOSTED_TIME_REVIEW_ACTION_CREATED|' + JSON.stringify({
  issueId: adjustment.id,
  state: actionItem.confirmation?.state || null,
  reasonCode: actionItem.reasonCode || null,
  observedAt: actionItem.observedAt || null,
  authorityRequired: actionItem.authorityRequired || null
}));

for (const [label, path, cookie, accepted] of [
  ['integration catalog', '/api/integrations/autonomous/catalog', manager, [200]],
  ['integration status', '/api/integrations/autonomous/status', manager, [200]],
  ['training plan', '/api/learning/training/plan?route=overview', employee, [200]],
  ['decision intelligence', '/api/operations/intelligence/summary', manager, [200]],
  ['reporting catalog', '/api/reporting/catalog', manager, [200]],
  ['implementation status', '/api/implementation/autonomous/status', manager, [200, 404]]
]) {
  const result = await raw(path, cookie);
  assert.ok(accepted.includes(result.status), label + ' returned unexpected HTTP ' + result.status);
  pass(label + ' is reachable under authenticated authority', { httpStatus: result.status });
}

const beforeBootstrap = await bootstrap(employee);
const personalResult = await raw('/api/personal', employee);
assert.equal(personalResult.status, 200);
const personal = personalResult.body;
const existingDates = new Set((beforeBootstrap?.state?.requests || [])
  .filter(request => request?.employee === beforeBootstrap?.actor?.personId && request?.status !== 'declined')
  .map(request => String(request?.date || request?.start || '').slice(0, 10))
  .filter(Boolean));
const candidates = (personal?.shifts || [])
  .map(shift => String(shift?.start || '').slice(0, 10))
  .filter(date => date && !existingDates.has(date));
assert.ok(candidates.length, 'No safe unused employee shift date exists for live leave proof.');

let created = null;
let leaveDate = null;
for (const date of candidates) {
  const current = await bootstrap(employee);
  const attempt = await raw('/api/personal/work', employee, 'POST', {
    command: 'leave-request',
    payload: { date, hours: 7.5 },
    version: current.state.version
  });
  if (attempt.status === 200) {
    created = attempt;
    leaveDate = date;
    break;
  }
  if (attempt.status !== 409) {
    throw new Error('Unexpected leave-request result: HTTP ' + attempt.status + ' ' + JSON.stringify(attempt.body));
  }
}
assert.ok(created?.body?.result?.id, 'Could not create a safe live leave request.');
assert.equal(created.body.result.status, 'pending');
const leaveId = created.body.result.id;
pass('employee leave request saved through hosted API', { leaveId, leaveDate });

const afterCreate = await bootstrap(employee);
const savedPending = (afterCreate.state.requests || []).find(request => request.id === leaveId);
assert.equal(savedPending?.status, 'pending');
pass('employee refresh reads back pending request from hosted state');

const ownDecision = await raw('/api/command', employee, 'POST', {
  command: 'leave-decision',
  payload: { id: leaveId, decision: 'approved', reviewed: true },
  version: afterCreate.state.version
});
assert.equal(ownDecision.status, 403);
pass('employee cannot approve own request');

const otherState = await bootstrap(other);
const crossTenant = await raw('/api/command', other, 'POST', {
  command: 'leave-decision',
  payload: { id: leaveId, decision: 'declined', reviewed: true, reason: 'Hosted tenant-isolation proof.' },
  version: otherState.state.version
});
assert.equal(crossTenant.status, 404);
pass('other tenant cannot act on request identifier');

const managerState = await bootstrap(manager);
let managerDecision = await raw('/api/command', manager, 'POST', {
  command: 'leave-decision',
  payload: { id: leaveId, decision: 'approved', reviewed: true },
  version: managerState.state.version
});
let expectedDecision = 'approved';
if (managerDecision.status === 409) {
  const refreshedManager = await bootstrap(manager);
  managerDecision = await raw('/api/command', manager, 'POST', {
    command: 'leave-decision',
    payload: {
      id: leaveId,
      decision: 'declined',
      reviewed: true,
      reason: 'Hosted proof: authoritative staffing control refused approval.'
    },
    version: refreshedManager.state.version
  });
  expectedDecision = 'declined';
}
assert.equal(managerDecision.status, 200, JSON.stringify(managerDecision.body));
pass('manager decision saved under hosted business rules', { decision: expectedDecision });

const freshEmployee = await login('maya@northstar.example');
const freshState = await bootstrap(freshEmployee);
const savedDecision = (freshState.state.requests || []).find(request => request.id === leaveId);
assert.equal(savedDecision?.status, expectedDecision);
pass('fresh login reads back manager decision', { decision: expectedDecision });

const employeePayroll = await raw('/api/payroll-run', freshEmployee);
assert.equal(employeePayroll.status, 403);
const payrollRun = await raw('/api/payroll-run', payroll);
assert.equal(payrollRun.status, 200);
pass('payroll boundary remains role-governed');

const reportingAudit = await raw('/api/reporting/audit', director);
assert.equal(reportingAudit.status, 200);
pass('director reporting audit surface remains authorised and readable');

console.log('CURRENT_HOSTED_ACTION_JOURNEY=PASS|' + JSON.stringify({
  candidateSha: expectedSha,
  leaveId,
  leaveDate,
  decision: expectedDecision,
  checks: receipts.length,
  productionMutation: false,
  fixtureDataOnly: true,
  claimBoundary: 'Hosted fixture customer-action proof only; not live provider, production approval, or full contract-to-go-live proof.'
}));
