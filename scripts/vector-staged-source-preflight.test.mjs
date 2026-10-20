import test from 'node:test';
import assert from 'node:assert/strict';
import { assessStagedSource } from './vector-staged-source-preflight.mjs';

const LIVE = '90ad90fcf60adaca9abacdd4ad14bf392f95e585';
const OLD_PATCH = '48dce8f697825c8cd5f99b3e5aeea3953647f8c2';
const NEXT = '1111111111111111111111111111111111111111';
const SERVICE = 'cded4ff7-24b1-4aaa-a7e2-67f143583bc2';
const ENV = 'eed9f097-610a-416e-83b9-6bc7bdb3eeef';
const sourcePath = `services.${SERVICE}.source.commitSha`;
function snapshot(to = NEXT) {
  return {
    service: { id: SERVICE, state: 'live-with-staged-changes' },
    environment: { id: ENV, name: 'production' },
    latestDeployment: { id: '057e19a2-7d49-4390-8705-63e71ea79a89', status: 'SUCCESS' },
    staged: { patchId: 'patch-1', status: 'STAGED', changeCount: 1 },
    stagedChanges: [{ path: sourcePath, type: 'updated', from: LIVE, to, destructive: false }]
  };
}
const options = { serviceId: SERVICE, environmentId: ENV, servingCommitSha: LIVE, candidateCommitSha: NEXT };

test('accepts an exact isolated source patch as preflight evidence only', () => {
  const result = assessStagedSource(snapshot(), options);
  assert.equal(result.status, 'EXACT_PATCH');
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.candidateCommitSha, NEXT);
  assert.equal(result.patchId, 'patch-1');
});

test('blocks the actual stale staging patch without changing the service', () => {
  const result = assessStagedSource(snapshot(OLD_PATCH), options);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'STAGED_TARGET_MISMATCH');
});

test('blocks unrelated, destructive, applying, incomplete and drifted patches', () => {
  const mutations = [
    x => { x.stagedChanges.push({ path: `services.${SERVICE}.deploy.startCommand`, type: 'updated', from: 'a', to: 'b', destructive: false }); x.staged.changeCount = 2; },
    x => { x.stagedChanges[0].destructive = true; },
    x => { x.staged.status = 'APPLYING'; },
    x => { x.staged.changeCount = 2; },
    x => { x.stagedChanges[0].from = OLD_PATCH; },
    x => { x.latestDeployment.status = 'FAILED'; },
    x => { x.environment.id = 'other-environment'; },
    x => { x.service.id = 'other-service'; },
    x => { x.stagedChanges[0].to = 'not-a-sha'; }
  ];
  for (const mutate of mutations) {
    const value = snapshot(); mutate(value);
    assert.equal(assessStagedSource(value, options).status, 'BLOCKED');
  }
});

test('distinguishes no pending patch from an exact staged patch', () => {
  const value = snapshot();
  value.service.state = 'live'; value.staged = null; value.stagedChanges = [];
  const result = assessStagedSource(value, options);
  assert.equal(result.status, 'NO_STAGED_PATCH');
  assert.equal(result.releaseAuthorized, false);
});
