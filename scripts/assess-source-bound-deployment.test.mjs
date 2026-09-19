import assert from 'node:assert/strict';
import test from 'node:test';
import { assessSourceBoundDeployment } from './assess-source-bound-deployment.mjs';

function branch({ protectedBranch = true, verified = true } = {}) {
  return {
    protected: protectedBranch,
    commit: { commit: { verification: { verified } } }
  };
}

const source = {
  repo: 'example/wfm',
  branch: 'release/staging',
  checkSuites: true
};

test('fails closed for a credential-bearing service on an unprotected unsigned branch', () => {
  const result = assessSourceBoundDeployment({
    source: { ...source, checkSuites: false },
    variableNames: ['WFM_STAGING_PASSWORD'],
    branchSnapshot: branch({ protectedBranch: false, verified: false })
  });

  assert.equal(result.ok, false);
  assert.equal(result.contained, false);
  assert.match(result.failures.join('\n'), /unprotected branch/);
  assert.match(result.failures.join('\n'), /unsigned or unverified/);
  assert.match(result.failures.join('\n'), /successful checks/);
});

test('treats the Railway watch hold as auto-trigger-only, never full containment of an unsafe source', () => {
  const result = assessSourceBoundDeployment({
    source: { ...source, checkSuites: false },
    variableNames: ['WFM_STAGING_PASSWORD'],
    branchSnapshot: branch({ protectedBranch: false, verified: false }),
    watchPatterns: ['__security_hold__/DO_NOT_MATCH']
  });

  assert.equal(result.ok, false);
  assert.equal(result.contained, false);
  assert.equal(result.autoTriggerHoldActive, true);
  assert.match(result.failures.join('\n'), /explicit redeploy can still rebuild/);
});

test('an arbitrary Dockerfile-path marker cannot turn an unsafe source into contained', () => {
  const result = assessSourceBoundDeployment({
    source: { ...source, checkSuites: false },
    variableNames: ['WFM_STAGING_PASSWORD'],
    branchSnapshot: branch({ protectedBranch: false, verified: false }),
    watchPatterns: ['__security_hold__/DO_NOT_MATCH'],
    dockerfilePath: '__security_hold__/NO_DOCKERFILE'
  });

  assert.equal(result.ok, false);
  assert.equal(result.contained, false);
  assert.equal(result.autoTriggerHoldActive, true);
});

test('requires checks even when the branch itself is protected and signed', () => {
  const result = assessSourceBoundDeployment({
    source: { ...source, checkSuites: false },
    variableNames: ['RAILWAY_TOKEN'],
    branchSnapshot: branch()
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /successful checks/);
});

test('passes an approved protected signed source that waits for checks', () => {
  const result = assessSourceBoundDeployment({
    source,
    variableNames: ['WFM_STAGING_PASSWORD'],
    branchSnapshot: branch()
  });

  assert.equal(result.ok, true);
  assert.equal(result.contained, false);
  assert.equal(result.autoTriggerHoldActive, false);
});

test('does not classify a source with no credential-like variables as a secret-bearing deployment', () => {
  const result = assessSourceBoundDeployment({
    source: { ...source, checkSuites: false },
    variableNames: ['NODE_ENV'],
    branchSnapshot: branch({ protectedBranch: false, verified: false })
  });

  assert.equal(result.ok, true);
  assert.equal(result.sensitiveVariables.length, 0);
});
