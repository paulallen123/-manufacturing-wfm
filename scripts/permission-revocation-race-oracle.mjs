// Read-only admission check for issue #265's permission-revocation race gate.
// Receipts must be captured from one authoritative, monotonic server sequence.
const SHA = /^[0-9a-f]{40}$/;
const DENIAL = new Set([401, 403, 404]);
const REASONS = new Set(['PERMISSION_REVOKED', 'SESSION_SECURITY_CONTEXT_CHANGED']);

export function assessPermissionRevocationRace(proof) {
  const failures = [];
  const fail = (condition, code) => { if (!condition) failures.push(code); };
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const seq = value => Number.isSafeInteger(value) && value > 0;
  const id = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
  const context = proof?.context;
  const names = ['preflight', 'inFlight', 'revocation', 'postRevocation', 'readback'];

  fail(record(context) && SHA.test(context.candidateSha || '') &&
    id(context.tenant) && id(context.principalId) && id(context.permission) &&
    id(context.operationKey) && id(context.sequenceDomain), 'INVALID_CONTEXT');
  for (const name of names) {
    const receipt = proof?.[name];
    fail(record(receipt), `MISSING_${name.toUpperCase()}`);
    if (!record(receipt) || !record(context)) continue;
    fail(receipt.candidateSha === context.candidateSha &&
      receipt.tenant === context.tenant &&
      receipt.principalId === context.principalId &&
      receipt.permission === context.permission &&
      receipt.operationKey === context.operationKey &&
      receipt.sequenceDomain === context.sequenceDomain, `IDENTITY_${name.toUpperCase()}`);
    fail(id(receipt.captureId), `CAPTURE_ID_${name.toUpperCase()}`);
  }
  if (failures.length) return { status: 'FAIL', failures };

  const { preflight, inFlight, revocation, postRevocation, readback } = proof;
  fail(new Set(names.map(name => proof[name].captureId)).size === names.length, 'REUSED_CAPTURE');
  fail(seq(preflight.sequence) && preflight.wouldAllow === true &&
    seq(preflight.permissionRevision), 'PREFLIGHT_NOT_AUTHORISED');
  fail(revocation.state === 'COMMITTED' && id(revocation.auditId) &&
    seq(revocation.sequence) && seq(revocation.previousRevision) &&
    seq(revocation.currentRevision) &&
    revocation.previousRevision === preflight.permissionRevision &&
    revocation.currentRevision > revocation.previousRevision,
  'REVOCATION_NOT_COMMITTED');
  fail(seq(inFlight.requestStartSequence) && seq(inFlight.decisionSequence) &&
    seq(inFlight.responseSequence) &&
    preflight.sequence < inFlight.requestStartSequence &&
    inFlight.requestStartSequence < revocation.sequence &&
    revocation.sequence < inFlight.decisionSequence &&
    inFlight.decisionSequence <= inFlight.responseSequence,
  'NO_ORDERED_RACE');
  fail(DENIAL.has(inFlight.status) && REASONS.has(inFlight.denialReason) &&
    inFlight.permissionRevision === revocation.currentRevision &&
    inFlight.effectApplied === false && inFlight.effectId === null,
  'IN_FLIGHT_ACTION_NOT_DENIED');
  fail(seq(postRevocation.decisionSequence) &&
    postRevocation.decisionSequence > inFlight.responseSequence &&
    (postRevocation.status === 403 || postRevocation.status === 404) &&
    postRevocation.denialReason === 'PERMISSION_REVOKED' &&
    postRevocation.freshSession === true &&
    postRevocation.permissionRevision === revocation.currentRevision &&
    postRevocation.effectApplied === false && postRevocation.effectId === null,
  'FRESH_SESSION_NOT_DENIED');
  fail(seq(readback.sequence) && readback.sequence > postRevocation.decisionSequence &&
    readback.permissionRevision === revocation.currentRevision &&
    readback.permissionActive === false && readback.effectCount === 0 &&
    readback.revocationAuditId === revocation.auditId,
  'READBACK_NOT_CLEAN');
  return { status: failures.length ? 'FAIL' : 'PASS', failures };
}

