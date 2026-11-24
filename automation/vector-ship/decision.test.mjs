import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluate, eventKey, RECEIPT_MARKER } from './decision.mjs';

const policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
const NOW = Date.now();
const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), OTHER = 'c'.repeat(40), HASH = 'd'.repeat(64);
function fixture() {
  return {
    schemaVersion: 1, provenance: { kind: 'github-api', readAt: new Date(NOW).toISOString() },
    repository: policy.repository, requester: { login: 'paulallen123' }, worker: { id: 'worker-1' },
    pr: { number: 123, author: 'paulallen123', state: 'open', draft: false, headRepository: policy.repository,
      headSha: HEAD, baseSha: BASE, expectedHeadSha: HEAD, expectedBaseSha: BASE,
      files: { complete: true, total: 1, entries: [{ path: 'docs/help.md', status: 'modified', mode: '100644', previousMode: '100644' }] } },
    event: { kind: 'pull_request', action: 'synchronize', id: 'event-1', actor: 'paulallen123' },
    owner: { source: 'github-ref', ref: `${policy.prClaimRefPrefix}123`, workerId: 'worker-1', prNumber: 123,
      claimSha: OTHER, headSha: HEAD, baseSha: BASE, state: 'active', expiresAt: new Date(NOW + 60_000).toISOString() },
    state: { processedKeys: [], processedFeedback: [], attempts: [] }, feedback: null,
    checks: { source: 'github-rulesets', required: [{ name: 'required-tests', appId: 15368 }],
      runs: [{ id: 1, name: 'required-tests', appId: 15368, headSha: HEAD, status: 'completed', conclusion: 'success' }] },
    tests: [{ source: 'execution-receipt', headSha: HEAD, baseSha: BASE, command: 'node --test tests/docs.test.mjs',
      exitCode: 0, passed: 3, failed: 0, skipped: 0, receiptSha256: HASH, coveredPaths: ['docs/help.md'] }],
    review: { source: 'independent-review-receipt', headSha: HEAD, baseSha: BASE, reviewerId: 'reviewer-2',
      state: 'current', verdict: 'pass', revoked: false, receiptSha256: HASH }
  };
}
function feedback(s = fixture()) {
  s.feedback = { source: 'github-review', id: 'review-1', authorLogin: 'paulallen123', headSha: HEAD, fingerprint: HASH, actionable: true };
  return s;
}
function checkFeedback(s = fixture()) {
  s.checks.runs[0].conclusion = 'failure';
  s.feedback = { source: 'github-check', id: 'check-1', appId: 15368, checkRunId: 1, checkName: 'required-tests',
    headSha: HEAD, fingerprint: HASH, actionable: true };
  return s;
}
function decide(s, p = policy) {
  const result = evaluate(s, p, { now: NOW });
  assert.equal(result.release_authorized, false);
  assert.equal(result.merge_authorized, false);
  assert.equal(result.approval_authorized, false);
  if (result.status !== 'REPAIR_ELIGIBLE') assert.equal(result.repair_eligible, false);
  return result;
}

test('clean exact-commit evidence is handed to the existing release owner', () => {
  const r = decide(fixture());
  assert.equal(r.status, 'READY_FOR_RELEASE_OWNER');
  assert.match(r.nextAction, new RegExp(policy.releaseOwnerTaskId));
  assert.deepEqual(r.identity, { repository: policy.repository, pr: 123, headSha: HEAD, baseSha: BASE, workerId: 'worker-1' });
});
test('routine actionable repair remains eligible with failing product checks', () => {
  const s = feedback(); s.checks.runs[0].conclusion = 'failure'; s.review = null;
  const r = decide(s); assert.equal(r.status, 'REPAIR_ELIGIBLE'); assert.equal(r.repair_eligible, true);
});
test('standalone tests may be repaired but confer no release permission', () => {
  const s = feedback(); s.pr.files.entries[0].path = 'tests/help.test.mjs';
  assert.equal(decide(s).status, 'REPAIR_ELIGIBLE');
});

for (const [name, mutate, status = 'BLOCKED'] of [
  ['absent owner', s => { s.owner = null; }],
  ['expired lease', s => { s.owner.expiresAt = new Date(NOW - 1).toISOString(); }],
  ['unknown lease', s => { s.owner.state = 'unknown'; }],
  ['wrong ownership ref', s => { s.owner.ref = 'refs/heads/other'; }],
  ['global release ownership is not a PR repair lease', s => { s.owner.ref = policy.releaseOwnerRef; }],
  ['stale ownership head', s => { s.owner.headSha = OTHER; }],
  ['stale ownership base', s => { s.owner.baseSha = OTHER; }],
  ['wrong ownership PR', s => { s.owner.prNumber = 124; }],
  ['different active owner', s => { s.owner.workerId = 'original-worker'; }, 'OWNER_HANDOFF'],
  ['stale expected head', s => { s.pr.expectedHeadSha = OTHER; }],
  ['stale expected base', s => { s.pr.expectedBaseSha = OTHER; }],
  ['external fork', s => { s.pr.headRepository = 'outsider/repo'; }],
  ['different repository', s => { s.repository = 'outsider/repo'; }],
  ['unknown requester', s => { s.requester.login = 'outsider'; }],
  ['unsupported event', s => { s.event.action = 'deleted'; }],
  ['draft PR', s => { s.pr.draft = true; }],
  ['closed PR', s => { s.pr.state = 'closed'; }],
  ['incomplete file pages', s => { s.pr.files.complete = false; }],
  ['file count mismatch', s => { s.pr.files.total = 2; }],
  ['empty file diff', s => { s.pr.files.entries = []; s.pr.files.total = 0; }],
  ['duplicate file paths', s => { s.pr.files.entries.push({ ...s.pr.files.entries[0] }); s.pr.files.total = 2; }],
  ['stale snapshot', s => { s.provenance.readAt = new Date(NOW - 301_000).toISOString(); }],
  ['future snapshot', s => { s.provenance.readAt = new Date(NOW + 1).toISOString(); }],
  ['short head SHA', s => { s.pr.headSha = 'abcd'; }, 'INVALID_INPUT'],
  ['zero PR', s => { s.pr.number = 0; }, 'INVALID_INPUT'],
  ['unknown provenance', s => { s.provenance.kind = 'pr-description'; }, 'INVALID_INPUT']
]) test(name, () => { const s = feedback(); mutate(s); assert.equal(decide(s).status, status); });

test('own receipt is suppressed without another receipt', () => {
  const s = fixture(); s.event.receiptMarker = RECEIPT_MARKER; s.event.receiptWorker = s.worker.id;
  const r = decide(s); assert.equal(r.status, 'NOOP'); assert.equal(r.emitReceipt, false);
});
test('own receipt on a draft or stale PR is suppressed before readiness checks', () => {
  const s = fixture(); s.event.receiptMarker = RECEIPT_MARKER; s.event.receiptWorker = s.worker.id;
  s.pr.draft = true; s.pr.expectedHeadSha = OTHER; s.owner = null;
  const r = decide(s); assert.equal(r.status, 'NOOP'); assert.equal(r.emitReceipt, false);
});
test('another actor cannot claim to be our receipt writer', () => {
  const s = fixture(); s.event.receiptMarker = RECEIPT_MARKER; s.event.receiptWorker = s.worker.id; s.event.actor = 'outsider';
  const r = decide(s); assert.equal(r.status, 'BLOCKED'); assert.equal(r.emitReceipt, false);
});
test('an untrusted comment author cannot repair through the authenticated worker', () => {
  const s = feedback(); s.event.action = 'issue_comment_created'; s.event.actor = 'untrusted-stranger';
  s.feedback.authorLogin = 'untrusted-stranger';
  const r = decide(s); assert.equal(r.status, 'BLOCKED'); assert.equal(r.emitReceipt, false);
});
test('an authorised event cannot launder another author feedback', () => {
  const s = feedback(); s.feedback.authorLogin = 'untrusted-stranger';
  const r = decide(s); assert.equal(r.status, 'BLOCKED'); assert.equal(r.emitReceipt, false);
});
for (const [context, mutate] of [
  ['routine scope', () => {}],
  ['absent owner', s => { s.owner = null; }],
  ['different owner', s => { s.owner.workerId = 'another-worker'; }],
  ['privileged path', s => { s.pr.files.entries[0].path = 'docs/security.md'; }]
]) {
  for (const actionable of [true, false]) {
    test(`untrusted review cannot emit a receipt: ${context}, actionable=${actionable}`, () => {
      const s = feedback(); s.feedback.authorLogin = 'untrusted-stranger'; s.feedback.actionable = actionable; mutate(s);
      const r = decide(s); assert.equal(r.status, 'BLOCKED'); assert.equal(r.emitReceipt, false);
    });
    test(`untrusted check cannot emit a receipt: ${context}, actionable=${actionable}`, () => {
      const s = checkFeedback(); s.feedback.appId = 99; s.feedback.actionable = actionable; mutate(s);
      const r = decide(s); assert.equal(r.status, 'BLOCKED'); assert.equal(r.emitReceipt, false);
    });
  }
}
test('authorised non-actionable feedback preserves clean owner handoff', () => {
  const s = feedback(); s.feedback.actionable = false;
  const r = decide(s); assert.equal(r.status, 'READY_FOR_RELEASE_OWNER'); assert.equal(r.emitReceipt, true);
});
test('non-actionable successful trusted check preserves clean owner handoff', () => {
  const s = checkFeedback(); s.feedback.actionable = false; s.checks.runs[0].conclusion = 'success';
  const r = decide(s); assert.equal(r.status, 'READY_FOR_RELEASE_OWNER'); assert.equal(r.emitReceipt, true);
});
test('non-actionable check feedback still requires an exact source binding', () => {
  const s = checkFeedback(); s.feedback.actionable = false; s.checks.runs[0].conclusion = 'success';
  for (const mutate of [x => { x.feedback.checkRunId = 99; }, x => { x.feedback.checkName = 'invented'; },
    x => { x.feedback.headSha = OTHER; }, x => { x.checks.runs[0].headSha = OTHER; },
    x => { x.checks.runs.push({ ...x.checks.runs[0] }); }]) {
    const changed = structuredClone(s); mutate(changed);
    const r = decide(changed); assert.equal(r.status, 'BLOCKED'); assert.equal(r.emitReceipt, false);
  }
});
test('authentic own receipts remain non-emitting before feedback and draft gates', () => {
  for (const make of [feedback, checkFeedback]) {
    const s = make(); s.feedback.authorLogin = 'untrusted-stranger'; s.feedback.appId = 99;
    s.event.receiptMarker = RECEIPT_MARKER; s.event.receiptWorker = s.worker.id;
    s.pr.draft = true; s.pr.expectedHeadSha = OTHER; s.owner = null;
    const r = decide(s); assert.equal(r.status, 'NOOP'); assert.equal(r.emitReceipt, false);
  }
});
test('trusted failed check feedback is bound to actual app, run and commit', () => {
  const s = checkFeedback();
  assert.equal(decide(s).status, 'REPAIR_ELIGIBLE');
  for (const mutate of [x => { x.feedback.appId = 99; }, x => { x.feedback.checkRunId = 99; },
    x => { x.feedback.checkName = 'invented'; }, x => { x.feedback.headSha = OTHER; }, x => { x.checks.runs[0].headSha = OTHER; },
    x => { x.checks.runs[0].conclusion = 'success'; }, x => { x.event.actor = 'github-actions[bot]'; }]) {
    const altered = structuredClone(s); mutate(altered);
    const r = decide(altered); assert.equal(r.status, 'BLOCKED'); assert.equal(r.emitReceipt, false);
  }
});
test('exact event replay is a no-op', () => {
  const s = feedback(); s.state.processedKeys.push(eventKey(s));
  assert.equal(decide(s).status, 'NOOP');
});
test('new feedback on the same commit is not lost', () => {
  const s = feedback(); const previousKey = eventKey(s); s.state.processedKeys.push(previousKey);
  s.feedback.id = 'review-2'; s.event.id = 'event-2';
  assert.notEqual(eventKey(s), previousKey); assert.equal(decide(s).status, 'REPAIR_ELIGIBLE');
});
test('already handled feedback is suppressed despite a new delivery', () => {
  const s = feedback(); s.state.processedFeedback.push({ source: s.feedback.source, id: s.feedback.id,
    headSha: HEAD, baseSha: BASE, fingerprint: s.feedback.fingerprint });
  s.event.id = 'redelivery'; assert.equal(decide(s).status, 'NOOP');
});
test('revised same-ID feedback is not suppressed by its processed original', () => {
  const s = feedback(); s.state.processedKeys.push(eventKey(s));
  s.state.processedFeedback.push({ source: s.feedback.source, id: s.feedback.id,
    headSha: HEAD, baseSha: BASE, fingerprint: s.feedback.fingerprint });
  s.feedback.fingerprint = 'e'.repeat(64);
  assert.equal(decide(s).status, 'REPAIR_ELIGIBLE');
});
test('processed review IDs cannot suppress check feedback in another source namespace', () => {
  const s = checkFeedback(); s.state.processedFeedback.push({ source: 'github-review', id: s.feedback.id,
    headSha: HEAD, baseSha: BASE, fingerprint: s.feedback.fingerprint });
  assert.equal(decide(s).status, 'REPAIR_ELIGIBLE');
});
test('event replay keys distinguish feedback source namespaces', () => {
  const s = feedback(); const previousKey = eventKey(s); s.state.processedKeys.push(previousKey);
  const sameId = s.feedback.id; checkFeedback(s); s.feedback.id = sameId;
  assert.notEqual(eventKey(s), previousKey); assert.equal(decide(s).status, 'REPAIR_ELIGIBLE');
});
test('revised feedback still shares the existing head repair budget', () => {
  const s = feedback(); s.state.processedFeedback.push({ source: s.feedback.source, id: s.feedback.id,
    headSha: HEAD, baseSha: BASE, fingerprint: s.feedback.fingerprint });
  s.feedback.fingerprint = 'e'.repeat(64);
  s.state.attempts = [1, 2].map(i => ({ headSha: HEAD, baseSha: BASE, feedbackId: `old-${i}`,
    fingerprint: String(i).repeat(64), outcome: 'succeeded' }));
  const r = decide(s); assert.equal(r.status, 'BLOCKED'); assert.ok(r.reasons.includes('Repair attempt budget exhausted'));
});
for (const [name, change] of [
  ['missing fingerprint', { fingerprint: undefined }], ['invalid fingerprint', { fingerprint: 'unknown' }],
  ['missing source', { source: undefined }], ['unknown source', { source: 'github-issue' }]
]) test(`unreconciled processed feedback fails closed: ${name}`, () => {
  const s = feedback(); s.state.processedFeedback.push({ source: s.feedback.source, id: s.feedback.id,
    headSha: HEAD, baseSha: BASE, fingerprint: s.feedback.fingerprint, ...change });
  const r = decide(s); assert.equal(r.status, 'INVALID_INPUT'); assert.equal(r.emitReceipt, false);
});
test('idempotency includes base, action and feedback identity', () => {
  const s = feedback(); const key = eventKey(s);
  for (const mutate of [x => { x.pr.baseSha = OTHER; }, x => { x.event.action = 'opened'; },
    x => { x.feedback.id = 'other'; }, x => { x.feedback.fingerprint = 'e'.repeat(64); }]) {
    const changed = structuredClone(s); mutate(changed); assert.notEqual(eventKey(changed), key);
  }
});

for (const path of ['../docs/help.md', '/docs/help.md', 'docs/../help.md', 'docs//help.md', 'docs\\help.md', 'docs/%2e%2e/help.md', 'docs/help\n.md']) {
  test(`malformed path ${JSON.stringify(path)}`, () => { const s = feedback(); s.pr.files.entries[0].path = path; assert.equal(decide(s).status, 'BLOCKED'); });
}
for (const path of ['.github/workflows/run.yml', 'automation/vector-ship/policy.json', 'release/proof.md', 'security/rules.md',
  'Dockerfile', 'package.json', 'docs/payroll.md', 'docs/auth.md', 'docs/tenant.md', 'docs/migrations.md',
  'docs/AGENTS.md', 'tests/security.test.mjs', 'tests/tenantIsolation.test.mjs', 'tests/authz.test.mjs', 'src/unknown.js', 'docs/config.yml']) {
  test(`designated owner required: ${path}`, () => { const s = feedback(); s.pr.files.entries[0].path = path; assert.equal(decide(s).status, 'OWNER_REVIEW_REQUIRED'); });
}
test('protected old path remains protected after rename to documentation', () => {
  const s = feedback(); Object.assign(s.pr.files.entries[0], { status: 'renamed', previousPath: 'security/controls.md' });
  assert.equal(decide(s).status, 'OWNER_REVIEW_REQUIRED');
});
test('routine rename requires both paths to be routine', () => {
  const s = feedback(); Object.assign(s.pr.files.entries[0], { status: 'renamed', previousPath: 'docs/previous.md' });
  assert.equal(decide(s).status, 'REPAIR_ELIGIBLE');
});
for (const [name, change] of [
  ['deletion', { status: 'removed' }], ['type change', { status: 'type_changed' }],
  ['symlink', { mode: '120000' }], ['executable mode change', { mode: '100755' }], ['missing file mode', { mode: undefined }]
]) test(`${name} requires owner`, () => { const s = feedback(); Object.assign(s.pr.files.entries[0], change); assert.equal(decide(s).status, 'OWNER_REVIEW_REQUIRED'); });

test('repair budget is per PR head, including distinct feedback', () => {
  const s = feedback(); s.state.attempts = [1, 2].map(i => ({ headSha: HEAD, baseSha: BASE, feedbackId: `old-${i}`,
    fingerprint: String(i).repeat(64), outcome: 'succeeded' }));
  assert.equal(decide(s).status, 'BLOCKED');
});
test('an unchanged failed attempt cannot repeat', () => {
  const s = feedback(); s.state.attempts.push({ headSha: HEAD, baseSha: BASE, feedbackId: 'old', fingerprint: HASH, outcome: 'failed' });
  assert.equal(decide(s).status, 'BLOCKED');
});
test('feedback from an older head is blocked', () => { const s = feedback(); s.feedback.headSha = OTHER; assert.equal(decide(s).status, 'BLOCKED'); });

for (const [name, mutate] of [
  ['no required checks', s => { s.checks.required = []; }],
  ['missing required check', s => { s.checks.runs = []; }],
  ['wrong check app', s => { s.checks.runs[0].appId = 99; }],
  ['stale check', s => { s.checks.runs[0].headSha = OTHER; }],
  ['running check', s => { s.checks.runs[0].status = 'in_progress'; }],
  ['ambiguous check runs', s => { s.checks.runs.push({ ...s.checks.runs[0] }); }],
  ['ambiguous check policy', s => { s.checks.required.push({ ...s.checks.required[0] }); }],
  ['missing executed tests', s => { s.tests = []; }],
  ['wrong test head', s => { s.tests[0].headSha = OTHER; }],
  ['wrong test base', s => { s.tests[0].baseSha = OTHER; }],
  ['empty test results', s => { s.tests[0].passed = 0; }],
  ['failed test results', s => { s.tests[0].failed = 1; }],
  ['skipped tests', s => { s.tests[0].skipped = 1; }],
  ['nonzero test exit', s => { s.tests[0].exitCode = 1; }],
  ['irrelevant tests', s => { s.tests[0].coveredPaths = ['docs/other.md']; }],
  ['missing review', s => { s.review = null; }],
  ['stale review head', s => { s.review.headSha = OTHER; }],
  ['stale review base', s => { s.review.baseSha = OTHER; }],
  ['implementation-worker review', s => { s.review.reviewerId = s.worker.id; }],
  ['PR-author review identity', s => { s.review.reviewerId = s.pr.author; }],
  ['PR-author GitHub review', s => { s.review.githubLogin = s.pr.author; }],
  ['revoked review', s => { s.review.revoked = true; }],
  ['stale review state', s => { s.review.state = 'stale'; }],
  ['changes-requested review', s => { s.review.verdict = 'changes_requested'; }]
]) test(name, () => { const s = fixture(); mutate(s); assert.equal(decide(s).status, 'BLOCKED'); });
for (const conclusion of ['failure', 'skipped', 'neutral', 'cancelled', 'stale', 'timed_out', 'action_required', null]) {
  test(`required conclusion ${conclusion} blocks handoff`, () => {
    const s = fixture(); s.checks.runs[0].conclusion = conclusion; assert.equal(decide(s).status, 'BLOCKED');
  });
}
test('protected changes preserve owner requirement even with complete passing evidence', () => {
  const s = fixture(); s.pr.files.entries[0].path = 'docs/security.md'; s.tests[0].coveredPaths = ['docs/security.md'];
  assert.equal(decide(s).status, 'OWNER_REVIEW_REQUIRED');
});
test('protected output includes factual missing evidence', () => {
  const s = fixture(); s.pr.files.entries[0].path = 'security/check.mjs'; s.checks.required = []; s.review = null;
  const r = decide(s); assert.equal(r.status, 'OWNER_REVIEW_REQUIRED'); assert.ok(r.reasons.includes('Missing independent exact-head review'));
});
for (const input of [null, {}, [], true, 'approved']) test(`malformed snapshot ${JSON.stringify(input)}`, () => {
  const r = decide(input); assert.equal(r.status, 'INVALID_INPUT'); assert.equal(r.emitReceipt, false);
});
for (const change of [{ repository: 'other/repo' }, { maxRepairAttempts: 999 }, { maxSnapshotAgeSeconds: 10000 },
  { allowedRequesters: ['outsider'] }, { routineTestRoots: ['src/'] }, { releaseOwnerTaskId: 'other' }]) {
  test(`malformed/weak policy ${JSON.stringify(change)}`, () => assert.equal(decide(fixture(), { ...policy, ...change }).status, 'INVALID_INPUT'));
}

test('CLI executes a real input file and produces explicit non-authorising JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vector-ship-test-'));
  try {
    const input = join(dir, 'snapshot.json'); writeFileSync(input, JSON.stringify(fixture()));
    const r = spawnSync(process.execPath, [new URL('./decision.mjs', import.meta.url).pathname, input], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); const result = JSON.parse(r.stdout);
    assert.equal(result.status, 'READY_FOR_RELEASE_OWNER'); assert.equal(result.merge_authorized, false);
    const blocked = fixture(); blocked.owner = null; writeFileSync(input, JSON.stringify(blocked));
    const b = spawnSync(process.execPath, [new URL('./decision.mjs', import.meta.url).pathname, input], { encoding: 'utf8' });
    assert.equal(b.status, 1); assert.equal(JSON.parse(b.stdout).status, 'BLOCKED');
    writeFileSync(input, '{');
    const invalid = spawnSync(process.execPath, [new URL('./decision.mjs', import.meta.url).pathname, input], { encoding: 'utf8' });
    assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stdout).status, 'INVALID_INPUT');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('CLI without arguments fails closed', () => {
  const r = spawnSync(process.execPath, [new URL('./decision.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.equal(JSON.parse(r.stdout).approval_authorized, false);
});
