import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyWeeklySignoffAudit } from '../scripts/weekly-signoff-audit-oracle.mjs';

const sha = 'a'.repeat(40);
function fixture() {
  const expected = { candidateSha: sha, deploymentId: 'deployment-fixture', tenant: 'fixture-a', period: '2026-W40', teamIds: ['team-a', 'team-b'] };
  const submissions = [
    { teamId: 'team-a', actor: 'manager-a', revision: 4 },
    { teamId: 'team-b', actor: 'manager-b', revision: 7 },
  ];
  const identity = { candidateSha: sha, deploymentId: expected.deploymentId, tenant: expected.tenant, period: expected.period, status: 200 };
  const managerCapture = { ...identity, role: 'manager', sessionId: 'manager-session-fixture', teams: [
    { id: 'team-a', status: 'signed', signature: { by: 'manager-a', revision: 4 } },
    { id: 'team-b', status: 'signed', signature: { by: 'manager-b', revision: 7 } },
  ] };
  const payrollCapture = { ...identity, role: 'payroll_admin', sessionId: 'payroll-session-fixture', teams: [
    { id: 'team-a', status: 'signed' }, { id: 'team-b', status: 'signed' },
  ], audit: [
    { type: 'team-signed', team: 'team-a', actor: 'manager-a', revision: 4 },
    { type: 'team-signed', team: 'team-b', actor: 'manager-b', revision: 7 },
    { type: 'category-checked', team: 'team-a' },
  ] };
  return { expected, submissions, managerCapture, payrollCapture };
}
const run = x => verifyWeeklySignoffAudit(x);
test('exact signed-team set reconstructs from separate manager and payroll captures', () => {
  const f = fixture();
  const result = run(f);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.teams, 2);
  assert.match(result.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(run(f), result);
  f.payrollCapture.audit[2].category = 'adjustments';
  assert.notEqual(run(f).evidenceDigest, result.evidenceDigest);
});
for (const [name, mutate] of [
  ['wrong source', f => { f.payrollCapture.candidateSha = 'b'.repeat(40); }],
  ['wrong deployment', f => { f.managerCapture.deploymentId = 'other'; }],
  ['wrong tenant', f => { f.payrollCapture.tenant = 'fixture-b'; }],
  ['wrong period', f => { f.managerCapture.period = '2026-W39'; }],
  ['same session', f => { f.payrollCapture.sessionId = f.managerCapture.sessionId; }],
  ['missing team', f => { f.payrollCapture.teams.pop(); }],
  ['extra team', f => { f.managerCapture.teams.push({ id: 'team-c', status: 'signed' }); }],
  ['missing audit', f => { f.payrollCapture.audit.shift(); }],
  ['duplicate audit', f => { f.payrollCapture.audit.push({ ...f.payrollCapture.audit[0] }); }],
  ['undeclared signed team', f => { f.payrollCapture.audit.push({ type: 'team-signed', team: 'team-c', actor: 'manager-c', revision: 2 }); }],
  ['foreign stamped audit', f => { f.payrollCapture.audit[0].tenant = 'fixture-b'; }],
  ['stale stamped audit', f => { f.payrollCapture.audit[0].period = '2026-W39'; }],
  ['wrong stamped source', f => { f.payrollCapture.audit[0].candidateSha = 'b'.repeat(40); }],
  ['wrong stamped deployment', f => { f.payrollCapture.audit[0].deploymentId = 'other'; }],
  ['conflicting payroll signature', f => { f.payrollCapture.teams[0].signature = { by: 'other', revision: 4 }; }],
  ['conflicting manager team scope', f => { f.managerCapture.teams[0].tenant = 'fixture-b'; }],
  ['wrong actor', f => { f.payrollCapture.audit[0].actor = 'other'; }],
  ['stale revision', f => { f.managerCapture.teams[1].signature.revision = 6; }],
  ['unsigned payroll', f => { f.payrollCapture.teams[0].status = 'open'; }],
  ['duplicate submission', f => { f.submissions[1].teamId = 'team-a'; }],
  ['bad role', f => { f.payrollCapture.role = 'employee'; }],
]) test(`refuses ${name}`, () => { const f = fixture(); mutate(f); assert.throws(() => run(f), /reconstruction failed/); });
