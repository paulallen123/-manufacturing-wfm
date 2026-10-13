import { createHash } from 'node:crypto';

// Read-only verifier. The caller retains authenticated capture and fixture custody.
export function verifyWeeklySignoffAudit({ expected, submissions, managerCapture, payrollCapture }) {
  const fail = () => { throw new Error('Weekly sign-off audit reconstruction failed.'); };
  const sha = expected?.candidateSha;
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !expected?.deploymentId || !expected?.tenant || !expected?.period ||
      !Array.isArray(expected?.teamIds) || !expected.teamIds.length ||
      new Set(expected.teamIds).size !== expected.teamIds.length ||
      expected.teamIds.some(id => typeof id !== 'string' || !id)) fail();
  if (!Array.isArray(submissions) || submissions.length !== expected.teamIds.length ||
      !managerCapture || !payrollCapture || managerCapture.sessionId === payrollCapture.sessionId ||
      !managerCapture.sessionId || !payrollCapture.sessionId ||
      managerCapture.role !== 'manager' || payrollCapture.role !== 'payroll_admin') fail();
  for (const capture of [managerCapture, payrollCapture]) {
    if (capture.candidateSha !== sha || capture.deploymentId !== expected.deploymentId ||
        capture.tenant !== expected.tenant || capture.period !== expected.period || capture.status !== 200) fail();
  }
  const ids = new Set(expected.teamIds);
  const unique = array => Array.isArray(array) && array.length === ids.size &&
    new Set(array.map(row => row?.id)).size === ids.size && array.every(row => ids.has(row?.id));
  if (!unique(managerCapture.teams) || !unique(payrollCapture.teams) ||
      new Set(submissions.map(row => row?.teamId)).size !== ids.size ||
      submissions.some(row => !ids.has(row?.teamId) || !Number.isSafeInteger(row.revision) ||
        row.revision < 0 || typeof row.actor !== 'string' || !row.actor)) fail();
  const audit = payrollCapture.audit;
  if (!Array.isArray(audit)) fail();
  const relevant = audit.filter(row => row?.type === 'team-signed');
  if (relevant.length !== ids.size || new Set(relevant.map(row => row.team)).size !== ids.size) fail();

  const scopeMatches = row => Object.entries({ tenant: expected.tenant, period: expected.period,
    candidateSha: sha, deploymentId: expected.deploymentId }).every(([key, value]) =>
    !Object.hasOwn(row, key) || row[key] === value);

  const rows = expected.teamIds.map(teamId => {
    const submitted = submissions.find(row => row.teamId === teamId);
    const manager = managerCapture.teams.find(row => row.id === teamId);
    const payroll = payrollCapture.teams.find(row => row.id === teamId);
    const event = relevant.find(row => row.team === teamId);
    if (!scopeMatches(manager) || !scopeMatches(payroll) || !scopeMatches(event) ||
        manager.status !== 'signed' || payroll.status !== 'signed' ||
        manager.signature?.by !== submitted.actor ||
        manager.signature?.revision !== submitted.revision ||
        (payroll.signature != null && (payroll.signature.by !== submitted.actor ||
          payroll.signature.revision !== submitted.revision)) ||
        event.actor !== submitted.actor || event.revision !== submitted.revision) fail();
    return { teamId, actor: submitted.actor, revision: submitted.revision };
  });
  return Object.freeze({ status: 'MATCHED', candidateSha: sha, deploymentId: expected.deploymentId,
    tenant: expected.tenant, period: expected.period, teams: rows.length,
    evidenceDigest: createHash('sha256').update(JSON.stringify({ expected, submissions, managerCapture, payrollCapture, rows })).digest('hex') });
}
