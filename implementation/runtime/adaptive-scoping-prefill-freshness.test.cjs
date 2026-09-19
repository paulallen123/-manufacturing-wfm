'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compileGraph, evaluateGraph } = require('./adaptive-scoping-graph.cjs');

function graphWithPolicy(policy) {
  return compileGraph({
    version: '2026-09-19.prefill-freshness.1',
    questions: [
      {
        id: 'payroll-system',
        prompt: 'Which payroll system is authoritative?',
        scope: ['payroll'],
        prefillPolicy: policy,
        options: [
          { value: 'api', effects: [{ type: 'CONFIG', key: 'payroll.integrationMode', value: 'api' }] },
          { value: 'file', effects: [{ type: 'CONFIG', key: 'payroll.integrationMode', value: 'file' }] }
        ]
      }
    ]
  });
}

function prefill(overrides = {}) {
  return {
    value: 'api',
    trust: 'AUTHORITATIVE',
    source: 'signed-order',
    evidenceId: 'order-42',
    observedAt: 900_000,
    ...overrides
  };
}

test('fresh prefill from an approved source suppresses the question and emits machine configuration', () => {
  const graph = graphWithPolicy({ maxAgeMs: 200_000, allowedSources: ['signed-order'] });
  const result = evaluateGraph(graph, {
    purchasedScope: ['payroll'],
    nowMs: 1_000_000,
    prefills: { 'payroll-system': prefill() }
  });

  assert.equal(result.questions.length, 0);
  assert.equal(result.answers['payroll-system'], 'api');
  assert.equal(result.provenance['payroll-system'].evidenceId, 'order-42');
  assert.ok(result.operations.some(op => op.type === 'CONFIG' && op.key === 'payroll.integrationMode' && op.answerSource === 'PREFILL'));
});

test('stale prefill cannot suppress a needed question', () => {
  const graph = graphWithPolicy({ maxAgeMs: 50_000, allowedSources: ['signed-order'] });
  const result = evaluateGraph(graph, {
    purchasedScope: ['payroll'],
    nowMs: 1_000_000,
    prefills: { 'payroll-system': prefill({ observedAt: 900_000 }) }
  });

  assert.equal(result.questions[0].id, 'payroll-system');
  assert.equal(Object.prototype.hasOwnProperty.call(result.answers, 'payroll-system'), false);
  assert.ok(result.operations.some(op => op.type === 'DECISION' && op.key === 'payroll-system'));
});

test('missing observation time cannot satisfy a freshness-controlled prefill', () => {
  const graph = graphWithPolicy({ maxAgeMs: 200_000 });
  const candidate = prefill();
  delete candidate.observedAt;
  const result = evaluateGraph(graph, {
    purchasedScope: ['payroll'],
    nowMs: 1_000_000,
    prefills: { 'payroll-system': candidate }
  });
  assert.equal(result.questions[0].id, 'payroll-system');
});

test('a prefill from a non-approved source cannot suppress a question', () => {
  const graph = graphWithPolicy({ maxAgeMs: 200_000, allowedSources: ['signed-order'] });
  const result = evaluateGraph(graph, {
    purchasedScope: ['payroll'],
    nowMs: 1_000_000,
    prefills: { 'payroll-system': prefill({ source: 'unverified-import' }) }
  });
  assert.equal(result.questions[0].id, 'payroll-system');
});

test('future-dated evidence beyond allowed clock skew is rejected', () => {
  const graph = graphWithPolicy({ maxAgeMs: 200_000, maxFutureSkewMs: 5_000 });
  const result = evaluateGraph(graph, {
    purchasedScope: ['payroll'],
    nowMs: 1_000_000,
    prefills: { 'payroll-system': prefill({ observedAt: 1_006_000 }) }
  });
  assert.equal(result.questions[0].id, 'payroll-system');
});

test('prefill policy changes alter the graph fingerprint so active sessions cannot silently inherit new trust rules', () => {
  const shortLived = graphWithPolicy({ maxAgeMs: 60_000, allowedSources: ['signed-order'] });
  const longLived = graphWithPolicy({ maxAgeMs: 3_600_000, allowedSources: ['signed-order'] });
  assert.notEqual(shortLived.graphFingerprint, longLived.graphFingerprint);
});

test('invalid freshness policies fail during graph compilation', () => {
  assert.throws(() => graphWithPolicy({ maxAgeMs: 0 }), /positive number/);
  assert.throws(() => graphWithPolicy({ allowedSources: [] }), /non-empty source names/);
  assert.throws(() => graphWithPolicy({ maxFutureSkewMs: -1 }), /zero or a positive number/);
});
