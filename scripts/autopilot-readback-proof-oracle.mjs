const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,179}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const utc = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Accept JSON text only. The approved collector remains responsible for
// authenticating each response and the independent lifecycle readback.
export function assessAutopilotReadbackEvidence(jsonText) {
  if (typeof jsonText !== 'string' || jsonText.length > 262144) {
    return { status: 'BLOCKED', blockers: ['PACKET_UNAVAILABLE'] };
  }
  let packet;
  try { packet = JSON.parse(jsonText); } catch { return { status: 'BLOCKED', blockers: ['PACKET_UNAVAILABLE'] }; }
  const blockers = [];
  const check = (condition, reason) => { if (!condition) blockers.push(reason); };
  const b = packet?.binding || {};
  const { permit, execution, status, lifecycle } = packet?.captures || {};
  check(sha(b.candidateSha) && id(b.deploymentId) && id(b.tenant)
    && id(b.contextRevision) && id(b.episodeId) && id(b.optionId), 'BINDING_UNPROVEN');
  if (![permit, execution, status, lifecycle].every(value => value && typeof value === 'object' && !Array.isArray(value))) {
    return { status: 'BLOCKED', blockers: [...new Set([...blockers, 'CAPTURES_MISSING'])] };
  }
  const captures = [permit, execution, status, lifecycle];
  check(captures.every(c => c.candidateSha === b.candidateSha && c.deploymentId === b.deploymentId
    && c.tenant === b.tenant && id(c.responseId) && utc(c.capturedAt)), 'SOURCE_SCOPE_UNPROVEN');
  check(new Set(captures.map(c => c.responseId)).size === captures.length, 'DUPLICATE_RESPONSE');
  check(captures.every((c, index) => index === 0 || Date.parse(c.capturedAt) > Date.parse(captures[index - 1].capturedAt)),
    'CAPTURE_ORDER_UNPROVEN');
  const p = permit.body?.permit || {};
  const action = p.plan?.action || {};
  check(permit.httpStatus === 201 && permit.body?.contractVersion === 'VECTOR_AUTOPILOT_PERMIT_V1'
    && id(p.permitId) && p.tenant === b.tenant && p.shadowEpisodeId === b.episodeId
    && p.optionId === b.optionId && p.contextRevision === b.contextRevision
    && id(p.actorRef) && utc(p.issuedAt) && utc(p.expiresAt)
    && Date.parse(p.issuedAt) <= Date.parse(permit.capturedAt)
    && Date.parse(p.expiresAt) > Date.parse(execution.capturedAt)
    && p.plan?.adapter === 'workforce-lifecycle' && p.plan?.reversible === true
    && id(action.eventKey) && id(action.employeeId)
    && ['OVERTIME_OVERRIDE', 'AGENCY_ASSIGNMENT'].includes(action.kind), 'PERMIT_UNPROVEN');
  const e = execution.body?.result || {};
  check(execution.httpStatus === 200 && execution.body?.contractVersion === 'VECTOR_AUTOPILOT_EXECUTION_V1'
    && id(e.executionId) && e.idempotent === false && e.state === 'VERIFIED'
    && id(e.detail?.eventId) && e.detail?.outcomeStatus === 'UNPROVEN'
    && e.detail?.outcomeDigest === null, 'EXECUTION_UNPROVEN');
  const rows = status.body?.events;
  const matched = Array.isArray(rows) ? rows.filter(row => row?.executionId === e.executionId) : [];
  const preparedAt = Date.parse(matched.find(row => row.state === 'PREPARED')?.createdAt);
  const appliedAt = Date.parse(matched.find(row => row.state === 'APPLIED')?.createdAt);
  const verifiedAt = Date.parse(matched.find(row => row.state === 'VERIFIED')?.createdAt);
  check(status.httpStatus === 200 && status.body?.contractVersion === 'VECTOR_AUTOPILOT_EXECUTION_V1'
    && status.body?.tenant === b.tenant && Array.isArray(rows)
    && matched.length === 3 && matched.every(row => row.permitId === p.permitId && utc(row.createdAt))
    && new Set(matched.map(row => row.state)).size === 3
    && ['PREPARED', 'APPLIED', 'VERIFIED'].every(state => matched.some(row => row.state === state))
    && preparedAt >= Date.parse(p.issuedAt) && preparedAt <= appliedAt
    && appliedAt <= verifiedAt && verifiedAt <= Date.parse(execution.capturedAt)
    && matched.find(row => row.state === 'APPLIED')?.detail?.eventId === e.detail?.eventId
    && matched.find(row => row.state === 'VERIFIED')?.detail?.eventId === e.detail?.eventId
    && matched.find(row => row.state === 'VERIFIED')?.detail?.outcomeStatus === 'UNPROVEN'
    && matched.find(row => row.state === 'VERIFIED')?.detail?.outcomeDigest === null,
  'EXECUTION_HISTORY_UNPROVEN');
  const l = lifecycle.body || {};
  check(lifecycle.httpStatus === 200 && l.tenant === b.tenant && l.eventKey === action.eventKey
    && l.id === e.detail?.eventId && l.status === 'ACCEPTED'
    && l.employeeId === action.employeeId && l.kind === action.kind,
  'LIFECYCLE_READBACK_UNPROVEN');
  return Object.freeze({ contractVersion: 'VECTOR_AUTOPILOT_READBACK_EVIDENCE_V1',
    status: blockers.length ? 'BLOCKED' : 'EVIDENCE_CONSISTENT',
    blockers: Object.freeze([...new Set(blockers)]),
    claimBoundary: 'Capture consistency only; collector authentication, final-image identity, session authority, persistence and independently measured outcome require separate proof.' });
}
