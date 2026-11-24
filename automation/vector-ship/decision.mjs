import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'paulallen123/-manufacturing-wfm';
export const RECEIPT_MARKER = '<!-- vector-ship-receipt:v1 -->';
const SHA = /^[a-f0-9]{40}$/i;
const DIGEST = /^[a-f0-9]{64}$/i;
const EVENTS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review',
  'review_submitted', 'review_comment_created', 'issue_comment_created']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 1000;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sha = value => typeof value === 'string' && SHA.test(value);
const digest = value => typeof value === 'string' && DIGEST.test(value);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export function validatePolicy(policy) {
  requireValue(object(policy) && policy.schemaVersion === 1, 'Unsupported or malformed policy');
  requireValue(policy.repository === REPOSITORY, 'Policy repository must be VECTOR');
  requireValue(JSON.stringify(policy.allowedRequesters) === '["paulallen123"]', 'Invalid requester policy');
  requireValue(JSON.stringify(policy.trustedCheckAppIds) === '[15368]', 'Invalid trusted check app policy');
  requireValue(integer(policy.maxRepairAttempts) && policy.maxRepairAttempts > 0 && policy.maxRepairAttempts <= 2,
    'Repair budget must be 1 or 2');
  requireValue(integer(policy.maxSnapshotAgeSeconds) && policy.maxSnapshotAgeSeconds > 0 && policy.maxSnapshotAgeSeconds <= 300,
    'Snapshot lifetime must be 1 to 300 seconds');
  requireValue(JSON.stringify(policy.routineDocumentationRoots) === '["docs/"]'
    && JSON.stringify(policy.routineTestRoots) === '["tests/"]', 'Invalid routine path policy');
  requireValue(policy.releaseOwnerTaskId === '6ae68ba7ee488191870bc5774b593a45'
    && policy.releaseOwnerRef === 'refs/heads/coord/vector-release-owner'
    && policy.prClaimRefPrefix === 'refs/heads/coord/vector-ship-pr-', 'Ownership policy mismatch');
  return policy;
}

export function validPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 1024
    && /^[A-Za-z0-9_.@/+-]+$/.test(path) && !path.startsWith('/')
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export function classifyFile(file) {
  if (!object(file) || !validPath(file.path) || !['added', 'modified', 'renamed', 'removed', 'type_changed'].includes(file.status)
    || (file.status === 'renamed' && !validPath(file.previousPath))) {
    return { classification: 'invalid', reason: 'Malformed changed-file entry' };
  }
  if (file.status !== 'renamed' && file.previousPath !== undefined) {
    return { classification: 'invalid', reason: 'Unexpected previous path' };
  }
  if (!['100644', '100755'].includes(file.mode)
    || (file.status !== 'added' && !['100644', '100755'].includes(file.previousMode))) {
    return { classification: 'owner', reason: `Missing regular-file mode or special file: ${file.path}` };
  }
  if (file.previousMode && file.previousMode !== file.mode) {
    return { classification: 'owner', reason: `File mode change: ${file.path}` };
  }
  if (['removed', 'type_changed'].includes(file.status)) {
    return { classification: 'owner', reason: `Deletion or type change: ${file.path}` };
  }
  const paths = [file.path, ...(file.previousPath ? [file.previousPath] : [])];
  const privileged = /github|automation|release|security|dockerfile|manifest|package|lock|payroll|auth|tenant|tenancy|migrat|ownership|owners|agents|claude|instruction|policy|policies|rbac|abac|passkey|permission/i;
  for (const path of paths) {
    if (privileged.test(path)) return { classification: 'owner', reason: `Privileged path: ${path}` };
    const routine = /^docs\/.+\.(md|txt)$/.test(path) || /^tests\/.+\.test\.(mjs|cjs|js)$/.test(path);
    if (!routine) return { classification: 'owner', reason: `Unclassified path: ${path}` };
  }
  return { classification: 'routine', reason: 'Allowlisted documentation or standalone test' };
}

function validateSnapshot(s) {
  requireValue(object(s) && s.schemaVersion === 1, 'Unsupported or malformed snapshot');
  requireValue(object(s.provenance) && s.provenance.kind === 'github-api' && date(s.provenance.readAt), 'Missing API read provenance');
  requireValue(text(s.repository) && object(s.requester) && text(s.requester.login)
    && object(s.worker) && text(s.worker.id), 'Missing repository or worker identity');
  const p = s.pr;
  requireValue(object(p) && integer(p.number) && p.number > 0 && text(p.author)
    && text(p.state) && typeof p.draft === 'boolean' && text(p.headRepository), 'Malformed PR identity');
  for (const field of ['headSha', 'baseSha', 'expectedHeadSha', 'expectedBaseSha']) {
    requireValue(sha(p[field]), `Invalid ${field}`);
  }
  requireValue(object(p.files) && typeof p.files.complete === 'boolean' && integer(p.files.total)
    && Array.isArray(p.files.entries), 'Malformed file readback');
  requireValue(object(s.event) && s.event.kind === 'pull_request' && text(s.event.action)
    && text(s.event.id) && text(s.event.actor), 'Malformed event');
  requireValue(object(s.state) && Array.isArray(s.state.processedKeys) && s.state.processedKeys.every(digest)
    && Array.isArray(s.state.processedFeedback) && s.state.processedFeedback.every(f => object(f)
      && ['github-review', 'github-check'].includes(f.source) && text(f.id) && sha(f.headSha) && sha(f.baseSha) && digest(f.fingerprint))
    && Array.isArray(s.state.attempts), 'Malformed durable state');
  requireValue(s.state.attempts.every(a => object(a) && sha(a.headSha) && sha(a.baseSha)
    && text(a.feedbackId) && digest(a.fingerprint) && ['failed', 'succeeded'].includes(a.outcome)), 'Malformed attempt history');
  if (s.owner !== null) {
    requireValue(object(s.owner) && s.owner.source === 'github-ref' && text(s.owner.ref) && text(s.owner.workerId)
      && integer(s.owner.prNumber) && sha(s.owner.claimSha) && sha(s.owner.headSha) && sha(s.owner.baseSha)
      && text(s.owner.state) && date(s.owner.expiresAt), 'Malformed ownership readback');
  }
  if (s.feedback !== null) {
    requireValue(object(s.feedback) && ['github-review', 'github-check'].includes(s.feedback.source)
      && text(s.feedback.id) && sha(s.feedback.headSha) && digest(s.feedback.fingerprint)
      && typeof s.feedback.actionable === 'boolean', 'Malformed feedback');
    if (s.feedback.source === 'github-review') requireValue(text(s.feedback.authorLogin), 'Missing fetched feedback author');
    else requireValue(integer(s.feedback.appId) && s.feedback.appId > 0 && integer(s.feedback.checkRunId)
      && s.feedback.checkRunId > 0 && text(s.feedback.checkName), 'Missing check feedback source binding');
  }
  requireValue(object(s.checks) && s.checks.source === 'github-rulesets' && Array.isArray(s.checks.required)
    && Array.isArray(s.checks.runs), 'Missing authoritative required-check readback');
  requireValue(s.checks.required.every(c => object(c) && text(c.name) && integer(c.appId) && c.appId > 0), 'Malformed required check');
  requireValue(s.checks.runs.every(c => object(c) && integer(c.id) && c.id > 0 && text(c.name) && integer(c.appId) && c.appId > 0
    && sha(c.headSha) && text(c.status) && (c.conclusion === null || text(c.conclusion))), 'Malformed check run');
  requireValue(Array.isArray(s.tests), 'Malformed test evidence');
  requireValue(s.tests.every(t => object(t) && t.source === 'execution-receipt' && sha(t.headSha) && sha(t.baseSha)
    && text(t.command) && integer(t.exitCode) && integer(t.passed) && integer(t.failed) && integer(t.skipped)
    && digest(t.receiptSha256) && Array.isArray(t.coveredPaths) && t.coveredPaths.every(validPath)), 'Malformed test receipt');
  if (s.review !== null) {
    requireValue(object(s.review) && s.review.source === 'independent-review-receipt' && sha(s.review.headSha)
      && sha(s.review.baseSha) && text(s.review.reviewerId) && text(s.review.state) && text(s.review.verdict)
      && typeof s.review.revoked === 'boolean' && digest(s.review.receiptSha256)
      && (s.review.githubLogin === undefined || s.review.githubLogin === null || text(s.review.githubLogin)), 'Malformed review receipt');
  }
}

export function eventKey(s) {
  return createHash('sha256').update(JSON.stringify([s.repository, s.pr.number, s.pr.headSha, s.pr.baseSha,
    s.event.action, s.event.id, s.feedback?.source ?? null, s.feedback?.id ?? null, s.feedback?.fingerprint ?? null])).digest('hex');
}

function readyReasons(s) {
  const reasons = [];
  if (s.checks.required.length === 0) reasons.push('No authoritative required checks are configured');
  const names = new Set();
  for (const expected of s.checks.required) {
    if (names.has(expected.name)) reasons.push(`Ambiguous required check: ${expected.name}`);
    names.add(expected.name);
    const runs = s.checks.runs.filter(c => c.name === expected.name);
    if (runs.length !== 1) { reasons.push(`Missing or ambiguous check: ${expected.name}`); continue; }
    const actual = runs[0];
    if (actual.headSha !== s.pr.headSha || actual.appId !== expected.appId
      || actual.status !== 'completed' || actual.conclusion !== 'success') {
      reasons.push(`Check must succeed on exact head from expected app: ${expected.name}`);
    }
  }
  if (s.tests.length === 0) reasons.push('No executed test evidence');
  const covered = new Set();
  for (const test of s.tests) {
    if (test.headSha !== s.pr.headSha || test.baseSha !== s.pr.baseSha || test.exitCode !== 0
      || test.failed !== 0 || test.skipped !== 0 || test.passed === 0) reasons.push('Test receipt is stale, failed, skipped or empty');
    else for (const path of test.coveredPaths) covered.add(path);
  }
  for (const file of s.pr.files.entries) {
    if (!covered.has(file.path)) reasons.push(`Missing relevant test coverage: ${file.path}`);
  }
  const review = s.review;
  if (!review) reasons.push('Missing independent exact-head review');
  else {
    if (review.headSha !== s.pr.headSha || review.baseSha !== s.pr.baseSha) reasons.push('Review is stale');
    if (review.reviewerId === s.worker.id || review.reviewerId === s.pr.author || review.githubLogin === s.pr.author) {
      reasons.push('Review is by implementation worker or PR author');
    }
    if (review.revoked || review.state !== 'current' || review.verdict !== 'pass') reasons.push('Review is revoked, stale or not passing');
  }
  return reasons;
}

export function evaluate(snapshot, policy, { now = Date.now() } = {}) {
  let identity = null;
  let key = null;
  const result = (status, reasons, nextAction, extra = {}) => ({
    schemaVersion: 1, status, reasons, nextAction, identity, idempotencyKey: key,
    release_authorized: false, merge_authorized: false, approval_authorized: false,
    repair_eligible: false, emitReceipt: !['NOOP', 'INVALID_INPUT'].includes(status), ...extra
  });
  try {
    validatePolicy(policy);
    validateSnapshot(snapshot);
    requireValue(Number.isFinite(now), 'Invalid evaluation clock');
    const s = snapshot;
    const p = s.pr;
    identity = { repository: s.repository, pr: p.number, headSha: p.headSha, baseSha: p.baseSha, workerId: s.worker.id };
    key = eventKey(s);
    if (s.repository === REPOSITORY && p.headRepository === REPOSITORY
      && policy.allowedRequesters.includes(s.requester.login)
      && s.event.receiptMarker === RECEIPT_MARKER && s.event.receiptWorker === s.worker.id && s.event.actor === s.requester.login) {
      return result('NOOP', ['Own receipt feedback'], 'Do not write another receipt');
    }
    const blocks = [];
    if (s.repository !== REPOSITORY || p.headRepository !== REPOSITORY) blocks.push('Repository mismatch or external fork');
    if (!policy.allowedRequesters.includes(s.requester.login)) blocks.push('Requester is not authorised');
    if (!policy.allowedRequesters.includes(s.event.actor)) blocks.push('Event actor is not authorised for writes');
    if (!EVENTS.has(s.event.action)) blocks.push('Unsupported event action');
    const age = now - Date.parse(s.provenance.readAt);
    if (age < 0 || age > policy.maxSnapshotAgeSeconds * 1000) blocks.push('API snapshot is stale or from the future');
    if (p.headSha !== p.expectedHeadSha || p.baseSha !== p.expectedBaseSha) blocks.push('Expected head or base changed');
    if (p.state !== 'open' || p.draft) blocks.push('PR must be open and non-draft');
    if (!p.files.complete || p.files.total !== p.files.entries.length || p.files.total === 0) blocks.push('Changed-file readback is incomplete or empty');
    const files = p.files.entries.map(classifyFile);
    if (files.some(f => f.classification === 'invalid')) blocks.push('Malformed file path or file operation');
    if (new Set(p.files.entries.map(f => f.path)).size !== p.files.entries.length) blocks.push('Duplicate changed-file paths');
    if (blocks.length) return result('BLOCKED', blocks, 'Read-only assessment or refresh authorised GitHub state; do not write', { emitReceipt: false });
    if (s.feedback) {
      if (s.feedback.source === 'github-review' && s.feedback.authorLogin !== s.event.actor) {
        return result('BLOCKED', ['Feedback author does not match the authorised event actor'], 'Read-only assessment; do not write', { emitReceipt: false });
      }
      if (s.feedback.source === 'github-check') {
        const matches = s.checks.runs.filter(c => c.id === s.feedback.checkRunId);
        if (!policy.trustedCheckAppIds.includes(s.feedback.appId) || matches.length !== 1
          || matches[0].appId !== s.feedback.appId || matches[0].name !== s.feedback.checkName
          || matches[0].headSha !== s.feedback.headSha || matches[0].headSha !== p.headSha) {
          return result('BLOCKED', ['Check feedback is not bound to an exact-head check from a trusted app'],
            'Read-only assessment; fetch the actual check and do not write', { emitReceipt: false });
        }
        if (s.feedback.actionable && (matches[0].status !== 'completed' || matches[0].conclusion === 'success')) {
          return result('BLOCKED', ['Actionable check feedback requires a completed non-successful check'],
            'Read-only assessment; fetch the actual check and do not write', { emitReceipt: false });
        }
      }
    }
    if (s.state.processedKeys.includes(key)) return result('NOOP', ['Event already processed'], 'Do not repeat work');
    if (s.feedback?.actionable && s.state.processedFeedback.some(f => f.source === s.feedback.source && f.id === s.feedback.id
      && f.fingerprint === s.feedback.fingerprint && f.headSha === p.headSha && f.baseSha === p.baseSha)) {
      return result('NOOP', ['Feedback already processed on this head and base'], 'Do not repeat work');
    }
    const owner = s.owner;
    if (!owner || owner.state !== 'active' || Date.parse(owner.expiresAt) <= now || owner.ref !== `${policy.prClaimRefPrefix}${p.number}`
      || owner.prNumber !== p.number || owner.headSha !== p.headSha || owner.baseSha !== p.baseSha) {
      return result('BLOCKED', ['No current attributable ownership claim for this PR/head/base'], 'Obtain an authorised atomic owner reservation');
    }
    if (owner.workerId !== s.worker.id) return result('OWNER_HANDOFF', [`Active owner: ${owner.workerId}`], 'Hand off to the current owner; do not create a second writer');
    const ownerReasons = files.filter(f => f.classification === 'owner').map(f => f.reason);
    if (ownerReasons.length) return result('OWNER_REVIEW_REQUIRED', [...ownerReasons, ...readyReasons(s)], 'Request designated owner assessment; no routine repair');
    if (s.feedback?.actionable) {
      if (s.feedback.headSha !== p.headSha) return result('BLOCKED', ['Feedback targets an older head'], 'Revalidate the finding on current code');
      const attempts = s.state.attempts.filter(a => a.headSha === p.headSha);
      if (attempts.length >= policy.maxRepairAttempts) return result('BLOCKED', ['Repair attempt budget exhausted'], 'Hand off the remaining defect with evidence');
      if (attempts.some(a => a.outcome === 'failed' && a.baseSha === p.baseSha && a.fingerprint === s.feedback.fingerprint)) {
        return result('BLOCKED', ['Unchanged failed repair would repeat'], 'Record the dependency or a materially new repair hypothesis');
      }
      return result('REPAIR_ELIGIBLE', ['Fresh actionable feedback, routine scope and matching owner'],
        'Recheck the atomic claim and head/base, repair in isolation, test and obtain independent review', { repair_eligible: true });
    }
    const reasons = readyReasons(s);
    if (reasons.length) return result('BLOCKED', reasons, 'Obtain the missing checks, tests or independent review');
    return result('READY_FOR_RELEASE_OWNER', ['Checks, tests and independent review match this head/base'],
      `Hand evidence to existing release owner ${policy.releaseOwnerTaskId}; no merge or deployment permission`);
  } catch (error) {
    return result('INVALID_INPUT', [error.message], 'Correct the trusted adapter input or policy; do not write');
  }
}

export function runCli(args) {
  try {
    requireValue(args.length >= 1 && args.length <= 2, 'Usage: node decision.mjs SNAPSHOT.json [POLICY.json]');
    const snapshot = JSON.parse(readFileSync(args[0], 'utf8'));
    const policy = JSON.parse(readFileSync(args[1] ?? new URL('./policy.json', import.meta.url), 'utf8'));
    const decision = evaluate(snapshot, policy);
    return { decision, exitCode: decision.status === 'INVALID_INPUT' ? 2 : decision.status === 'BLOCKED' ? 1 : 0 };
  } catch (error) {
    return { decision: { schemaVersion: 1, status: 'INVALID_INPUT', reasons: [error.message], nextAction: 'Correct the input; do not write',
      identity: null, idempotencyKey: null, release_authorized: false, merge_authorized: false, approval_authorized: false,
      repair_eligible: false, emitReceipt: false }, exitCode: 2 };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { decision, exitCode } = runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  process.exitCode = exitCode;
}
