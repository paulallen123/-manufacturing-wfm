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

function allSafe() {
  return Object.fromEntries(BRANCHES.map((branch) => [branch, snapshot()]));
}

function assertDeploymentWorkflowGuarded(workflow) {
  const gate = workflow.indexOf('node scripts/verify-github-release-authority.mjs');
  const credential = workflow.indexOf('RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}');
  const deploy = workflow.indexOf('"$RAILWAY_BIN" up');

  if (gate < 0) throw new Error('release-authority gate is missing');
  if (credential >= 0 && gate > credential) throw new Error('release-authority gate must run before deployment credentials are exposed');
  if (deploy >= 0 && gate > deploy) throw new Error('release-authority gate must run before deployment starts');
}

test('accepts only protected branches with verified heads', () => {
  const result = assessReleaseAuthority(allSafe(), BRANCHES);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('fails closed when any release branch is unprotected', () => {
  const snapshots = allSafe();
  snapshots['release/production'] = snapshot({ protectedBranch: false });
  const result = assessReleaseAuthority(snapshots, BRANCHES);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /release\/production: branch is not protected/);
});

test('fails closed when an exact release head is unsigned or unverified', () => {
  const snapshots = allSafe();
  snapshots.main = snapshot({ verified: false });
  const result = assessReleaseAuthority(snapshots, BRANCHES);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /main: branch head is not cryptographically verified/);
});

test('fails closed when branch posture evidence is missing', () => {
  const snapshots = allSafe();
  delete snapshots['release/staging'];
  const result = assessReleaseAuthority(snapshots, BRANCHES);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /release\/staging: branch posture evidence is missing/);
});

test('network verifier rejects unsafe repository posture', async () => {
  const responses = new Map(BRANCHES.map((branch) => [branch, snapshot()]));
  responses.set('main', snapshot({ protectedBranch: false }));

  const fakeFetch = async (url) => {
    const branch = decodeURIComponent(url.split('/branches/')[1]);
    return {
      ok: true,
      status: 200,
      async json() { return responses.get(branch); }
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
