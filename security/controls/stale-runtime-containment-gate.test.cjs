'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateStaleRuntimeContainment } = require('./stale-runtime-containment-gate.cjs');

const base = {
  latestDeployment: { status: 'FAILED', updatedAt: '2026-09-20T01:57:02Z' },
  previousSuccessfulDeployment: { status: 'SUCCESS', updatedAt: '2026-09-19T22:07:02Z' },
  variableNames: ['WFM_STAGING_PASSWORD', 'PORT'],
  telemetryComplete: true
};

test('blocks when an older successful credential-bearing runtime serves after a failed replacement', () => {
  const result = evaluateStaleRuntimeContainment({
    ...base,
    httpEvents: [{ timestamp: '2026-09-20T07:00:44Z', httpStatus: 200, path: '/' }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.includes('stale-runtime-still-serving'));
  assert.ok(result.findings.includes('stale-runtime-public-response'));
});

test('401 after failed replacement still proves the old auth surface is live', () => {
  const result = evaluateStaleRuntimeContainment({
    ...base,
    httpEvents: [{ timestamp: '2026-09-20T07:00:44Z', httpStatus: 401, path: '/api/bootstrap' }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.includes('stale-runtime-auth-surface-live'));
});

test('ignores traffic that happened before the failed replacement', () => {
  const result = evaluateStaleRuntimeContainment({
    ...base,
    httpEvents: [{ timestamp: '2026-09-20T01:50:00Z', httpStatus: 200, path: '/' }]
  });
  assert.equal(result.ok, true);
});

test('fails closed when failure timing cannot be verified', () => {
  const result = evaluateStaleRuntimeContainment({
    ...base,
    latestDeployment: { status: 'FAILED', updatedAt: 'not-a-time' },
    httpEvents: []
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.includes('failure-time-unverifiable'));
});

test('treats incomplete runtime telemetry as a containment blocker', () => {
  const result = evaluateStaleRuntimeContainment({ ...base, telemetryComplete: false, httpEvents: [] });
  assert.equal(result.ok, false);
  assert.ok(result.findings.includes('runtime-telemetry-incomplete'));
});

test('does not force this gate on a non-credential-bearing service', () => {
  const result = evaluateStaleRuntimeContainment({ ...base, variableNames: ['PORT'], httpEvents: [{ timestamp: '2026-09-20T07:00:44Z', httpStatus: 200 }] });
  assert.equal(result.ok, true);
});

test('does not block a credential-bearing service when the latest replacement succeeded', () => {
  const result = evaluateStaleRuntimeContainment({
    ...base,
    latestDeployment: { status: 'SUCCESS', updatedAt: '2026-09-20T08:00:00Z' },
    httpEvents: [{ timestamp: '2026-09-20T08:01:00Z', httpStatus: 200 }]
  });
  assert.equal(result.ok, true);
});
