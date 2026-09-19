import assert from 'node:assert/strict';
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
