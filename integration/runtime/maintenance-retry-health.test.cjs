'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  maintenanceErrorClass,
  retryExhaustionHealth
} = require('./maintenance-retry-health.cjs');

test('recognises durable retry exhaustion without exposing provider details', () => {
  const result = retryExhaustionHealth(
    { canUseForBusinessTraffic: true },
    {
      state: 'BLOCKED',
      durable: {
        lastErrorClass: 'retry-budget-exhausted',
        providerResponse: 'must-not-echo',
        credential: 'must-not-echo'
      }
    }
  );

  assert.equal(result.state, 'DEGRADED');
  assert.equal(result.canSync, true);
  assert.equal(result.providerSignal, 'RETRY_EXHAUSTED');
  assert.equal(result.retryExhausted, true);
  assert.equal(result.reconciliationRequiredBeforeResume, false);
  assert.equal(JSON.stringify(result).includes('must-not-echo'), false);
});

test('pauses safely when the retry window is exhausted and no trusted proof remains', () => {
  const result = retryExhaustionHealth(
    { canUseForBusinessTraffic: false },
    {
      state: 'BLOCKED',
      errorClass: 'retry-window-would-be-exceeded'
    }
  );

  assert.equal(result.state, 'ATTENTION_REQUIRED');
  assert.equal(result.canSync, false);
  assert.equal(result.providerSignal, 'RETRY_EXHAUSTED');
  assert.equal(result.runtimeSignal, 'PAUSED');
  assert.equal(result.reconciliationRequiredBeforeResume, true);
  assert.match(result.nextAction, /reconcile/i);
});

test('does not reinterpret permanent or unrelated maintenance failures', () => {
  assert.equal(retryExhaustionHealth(
    { canUseForBusinessTraffic: true },
    { state: 'BLOCKED', errorClass: 'permission-denied' }
  ), null);
});

test('prefers the explicit governed error class over nested durable metadata', () => {
  const execution = {
    errorClass: 'retry-budget-exhausted',
    durable: { lastErrorClass: 'permission-denied' }
  };

  assert.equal(maintenanceErrorClass(execution), 'retry-budget-exhausted');
});
