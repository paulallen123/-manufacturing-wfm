'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { gateCircuit, recordCircuitObservation } = require('./provider-circuit-breaker.cjs');

function review(transport = 'api', digest = 'a'.repeat(64)) {
  return { transport, reviewedDigest: digest };
}

test('transient failures stay bounded before opening the provider circuit', () => {
  const r = review('api');
  let state = {};
  for (let i = 0; i < 3; i += 1) {
    const result = recordCircuitObservation(r, state, { outcome: 'FAILURE', failure: { status: 503 } }, 1000 + (i * 1000));
    assert.equal(result.action, 'RETRY_ALLOWED');
    state = result.state;
  }
  const opened = recordCircuitObservation(r, state, { outcome: 'FAILURE', failure: { status: 503 } }, 4000);
  assert.equal(opened.action, 'OPEN');
  assert.equal(opened.state.status, 'OPEN');
  assert.equal(gateCircuit(r, opened.state, 5000).action, 'PAUSE');
});

test('an open circuit allows only a bounded safe metadata probe after cooldown', () => {
  const r = review('read-only-db');
  let state = {};
  state = recordCircuitObservation(r, state, { outcome: 'FAILURE', failure: { status: 503 } }, 1000).state;
  state = recordCircuitObservation(r, state, { outcome: 'FAILURE', failure: { status: 503 } }, 2000).state;
  const opened = recordCircuitObservation(r, state, { outcome: 'FAILURE', failure: { status: 503 } }, 3000);
  assert.equal(opened.action, 'OPEN');
  assert.equal(gateCircuit(r, opened.state, 32000).action, 'PAUSE');
  const probe = gateCircuit(r, opened.state, 33000);
  assert.equal(probe.action, 'SAFE_PROBE_ONLY');
  assert.equal(probe.probeRequirements.metadataOnly, true);
  assert.equal(probe.probeRequirements.nonMutating, true);
  assert.equal(probe.probeRequirements.reconciliationRequired, true);
});

test('recovery closes only after a non-mutating safe probe reconciles', () => {
  const r = review('identity');
  const opened = {
    reviewedDigest: r.reviewedDigest,
    status: 'OPEN',
    failureCount: 3,
    windowStartedAt: 1000,
    openedAt: 3000,
    lastFailureAt: 3000,
    lastSuccessAt: null
  };

  const unsafe = recordCircuitObservation(r, opened, {
    outcome: 'SUCCESS',
    safeProbe: true,
    nonMutating: true,
    reconciled: false
  }, 40000);
  assert.equal(unsafe.action, 'KEEP_OPEN');
  assert.equal(unsafe.state.status, 'OPEN');

  const recovered = recordCircuitObservation(r, opened, {
    outcome: 'SUCCESS',
    safeProbe: true,
    nonMutating: true,
    reconciled: true
  }, 41000);
  assert.equal(recovered.action, 'CLOSE');
  assert.equal(recovered.state.status, 'CLOSED');
  assert.equal(recovered.state.failureCount, 0);
});

test('a failed half-open probe reopens the circuit and restarts cooldown', () => {
  const r = review('queue-stream');
  const halfOpen = {
    reviewedDigest: r.reviewedDigest,
    status: 'HALF_OPEN',
    failureCount: 5,
    windowStartedAt: 1000,
    openedAt: 2000,
    lastFailureAt: 2000,
    lastSuccessAt: null
  };
  const failed = recordCircuitObservation(r, halfOpen, { outcome: 'FAILURE', failure: { status: 429 } }, 50000);
  assert.equal(failed.action, 'OPEN');
  assert.equal(failed.state.status, 'OPEN');
  assert.equal(failed.state.openedAt, 50000);
});

test('credential failures require reauthorisation instead of opening a retry circuit', () => {
  const r = review('api');
  const result = recordCircuitObservation(r, {}, { outcome: 'FAILURE', failure: { status: 401 } }, 1000);
  assert.equal(result.action, 'REAUTHORIZE');
  assert.equal(result.state.status, 'CLOSED');
});

test('circuit evidence is bound to the exact reviewed connection and fails closed on mismatch', () => {
  const original = review('api', 'a'.repeat(64));
  const changed = review('api', 'b'.repeat(64));
  const state = recordCircuitObservation(original, {}, { outcome: 'FAILURE', failure: { status: 503 } }, 1000).state;
  const gate = gateCircuit(changed, state, 2000);
  assert.equal(gate.action, 'BLOCK');
  assert.match(gate.reason, /exact reviewed connection/);
});
