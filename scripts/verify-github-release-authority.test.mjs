import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { assessReleaseAuthority, verifyReleaseAuthority } from './verify-github-release-authority.mjs';

const BRANCHES = ['integration/canonical', 'release/staging', 'release/production', 'main'];

function snapshot({ protectedBranch = true, verified = true } = {}) {
  return {
    protected: protectedBranch,
    commit: {
      commit: {
        verification: { verified }
      }
    }
  };
}

function safeRules() {
  return [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'required_signatures' },
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
        require_last_push_approval: true
      }
    },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [{ context: 'release-safety' }]
      }
    }
  ];
}

function allSafe() {
  return Object.fromEntries(BRANCHES.map((branch) => [branch, snapshot()]));
}

function allRules() {
  return Object.fromEntries(BRANCHES.map((branch) => [branch, safeRules()]));
}

function assertDeploymentWorkflowGuarded(workflow) {
  const gate = workflow.indexOf('node scripts/verify-github-release-authority.mjs');
  const credential = workflow.indexOf('RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}');
  const deploy = workflow.indexOf('"$RAILWAY_BIN" up');

  if (gate < 0) throw new Error('release-authority gate is missing');
  if (credential >= 0 && gate > credential) throw new Error('release-authority gate must run before deployment credentials are exposed');
  if (deploy >= 0 && gate > deploy) throw new Error('release-authority gate must run before deployment starts');
}

test('accepts only protected branches with verified heads and enforceable release rules', () => {
  const result = assessReleaseAuthority(allSafe(), BRANCHES, allRules());
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('fails closed when any release branch is unprotected', () => {
  const snapshots = allSafe();
  snapshots['release/production'] = snapshot({ protectedBranch: false });
  const result = assessReleaseAuthority(snapshots, BRANCHES, allRules());
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /release\/production: branch is not protected/);
});

test('fails closed when an exact release head is unsigned or unverified', () => {
  const snapshots = allSafe();
  snapshots.main = snapshot({ verified: false });
  const result = assessReleaseAuthority(snapshots, BRANCHES, allRules());
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /main: branch head is not cryptographically verified/);
});

test('fails closed when branch posture evidence is missing', () => {
  const snapshots = allSafe();
  delete snapshots['release/staging'];
  const result = assessReleaseAuthority(snapshots, BRANCHES, allRules());
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /release\/staging: branch posture evidence is missing/);
});

test('fails closed when a protected branch has no active release rules', () => {
  const rules = allRules();
  rules.main = [];
  const result = assessReleaseAuthority(allSafe(), BRANCHES, rules);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /main: required pull_request rule is missing/);
  assert.match(result.failures.join('\n'), /main: required required_signatures rule is missing/);
});

test('fails closed when approval can become stale or the last pusher can self-approve', () => {
  const rules = allRules();
  const prRule = rules.main.find((rule) => rule.type === 'pull_request');
  prRule.parameters.dismiss_stale_reviews_on_push = false;
  prRule.parameters.require_last_push_approval = false;
  const result = assessReleaseAuthority(allSafe(), BRANCHES, rules);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /main: stale approvals are not dismissed/);
  assert.match(result.failures.join('\n'), /main: the last reviewable push does not require fresh approval/);
});

test('fails closed when required checks are absent or not strict', () => {
  const rules = allRules();
  const checkRule = rules['release/staging'].find((rule) => rule.type === 'required_status_checks');
  checkRule.parameters.strict_required_status_checks_policy = false;
  checkRule.parameters.required_status_checks = [];
  const result = assessReleaseAuthority(allSafe(), BRANCHES, rules);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /release\/staging: required checks are not strict/);
  assert.match(result.failures.join('\n'), /release\/staging: no required status checks are configured/);
});

test('network verifier rejects unsafe repository posture and reads active rules separately', async () => {
  const responses = new Map(BRANCHES.map((branch) => [branch, snapshot()]));
  responses.set('main', snapshot({ protectedBranch: false }));
  const ruleResponses = new Map(BRANCHES.map((branch) => [branch, safeRules()]));

  const fakeFetch = async (url) => {
    const isRuleRead = url.includes('/rules/branches/');
    const marker = isRuleRead ? '/rules/branches/' : '/branches/';
    const branch = decodeURIComponent(url.split(marker)[1]);
    return {
      ok: true,
      status: 200,
      async json() { return isRuleRead ? ruleResponses.get(branch) : responses.get(branch); }
    };
  };

  await assert.rejects(
    verifyReleaseAuthority({
      repository: 'example/wfm',
      token: 'synthetic-test-token',
      branches: BRANCHES,
      fetchImpl: fakeFetch
    }),
    /main: branch is not protected/
  );
});

test('canonical staging deployment proves release authority before any Railway credential or deploy action', () => {
  const workflow = fs.readFileSync('.github/workflows/canonical-staging-release.yml', 'utf8');
  assert.doesNotThrow(() => assertDeploymentWorkflowGuarded(workflow));
});

test('deployment guard rejects a workflow that exposes deployment credentials before trust is proven', () => {
  const unsafeWorkflow = [
    'RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}',
    'node scripts/verify-github-release-authority.mjs',
    '"$RAILWAY_BIN" up'
  ].join('\n');
  assert.throws(
    () => assertDeploymentWorkflowGuarded(unsafeWorkflow),
    /must run before deployment credentials/
  );
});
