'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { diagnoseReadinessGaps } = require('./readiness-gap-diagnostic.cjs');

const requirement = (key, status) => ({ key, status, satisfied: status === 'PASS' });

test('missing response remains an explicit blocker', () => {
  assert.equal(diagnoseReadinessGaps().status, 'UNCLASSIFIED_BLOCKER');
});

test('fixture source absence is a possible fixture gap and remains blocking', () => {
  const result = diagnoseReadinessGaps({ runtimeIdentity: { fixtureOnly: true }, sourceDataSummary: null,
    requirements: [requirement('source-systems', 'MISSING'), requirement('people-data', 'MISSING')] });
  assert.deepEqual(result.gaps.map(g => g.classification),
    ['POSSIBLE_PROOF_FIXTURE_DATA_GAP', 'POSSIBLE_PROOF_FIXTURE_DATA_GAP']);
  assert.equal(result.blocking, true);
  assert.ok(result.gaps.every(g => g.blocking));
});

test('same absent source on nonfixture runtime is not dismissed as fixture data', () => {
  const result = diagnoseReadinessGaps({ runtimeIdentity: { fixtureOnly: false }, sourceDataSummary: null,
    requirements: [requirement('source-systems', 'MISSING')] });
  assert.equal(result.gaps[0].classification, 'UNCLASSIFIED_BLOCKER');
});

test('source present but customer scope missing needs customer authority', () => {
  const result = diagnoseReadinessGaps({ runtimeIdentity: { fixtureOnly: true }, sourceDataSummary: { batchId: 'synthetic' },
    requirements: [requirement('configuration-scope', 'MISSING')] });
  assert.equal(result.gaps[0].classification, 'CUSTOMER_SCOPE_AUTHORITY_BLOCKER');
});

test('failed and stale evidence remain confirmed blockers even in fixture mode', () => {
  const result = diagnoseReadinessGaps({ runtimeIdentity: { fixtureOnly: true }, sourceDataSummary: null,
    requirements: [requirement('people-data', 'REVALIDATION_REQUIRED'), requirement('organisation-model', 'FAIL')] });
  assert.deepEqual(result.gaps.map(g => g.classification),
    ['CONFIRMED_CONTRACT_BLOCKER', 'CONFIRMED_CONTRACT_BLOCKER']);
});

test('launch boundary is retained even when requirements pass', () => {
  const result = diagnoseReadinessGaps({ requirements: [requirement('people-data', 'PASS')],
    launchBoundary: { blockers: ['RUNTIME_FIXTURE_ONLY', 'WHOLE_GOLDEN_JOURNEY_UNPROVEN'] } });
  assert.equal(result.blocking, true);
  assert.deepEqual(result.gaps.map(g => g.key), ['RUNTIME_FIXTURE_ONLY', 'WHOLE_GOLDEN_JOURNEY_UNPROVEN']);
});

test('diagnostic emits keys and codes without source or personnel payloads', () => {
  const result = diagnoseReadinessGaps({ runtimeIdentity: { fixtureOnly: true },
    sourceDataSummary: { employeeKeys: ['private-employee'], batchId: 'private-batch' },
    requirements: [{ ...requirement('people-data', 'MISSING'), detail: { email: 'private@example.test' } }] });
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('unexplained not-ready response cannot look clear', () => {
  const result = diagnoseReadinessGaps({ operationalReady: false, requirements: [] });
  assert.equal(result.blocking, true);
  assert.equal(result.gaps[0].key, 'UNEXPLAINED_NOT_READY');
});
