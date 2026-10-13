'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createDecisionEpisode, selectDecisionOption, recordDecisionOutcome} = require('./decision-episode.cjs');
const {createDecisionOutcomeProof, toAdaptiveOutcomeInput} = require('./decision-outcome-proof.cjs');
const {assessResearchCandidate} = require('../../resilience/research-convergence-theory-simulator.cjs');

function snapshot(overrides = {}) {
  return {
    tenant: 'factory-a', site: 'site-1', decisionType: 'factory-playback',
    triggerId: 'incident-1', triggeredAt: '2026-10-13T08:00:00Z',
    contextRevision: 'factory-snapshot-1', mode: 'SHADOW',
    sourceEvidence: ['incident:1', 'production-plan:1'],
    objective: {delayMinutes: 1},
    options: [
      {id: 'do-nothing', feasible: true, policyAllowed: true, hardConstraintsPassed: true,
        prediction: {delayMinutes: 40}, evidenceRefs: ['simulation:baseline']},
      {id: 'reschedule', feasible: true, policyAllowed: true, hardConstraintsPassed: true,
        prediction: {delayMinutes: 20}, evidenceRefs: ['simulation:alternative']}
    ],
    ...overrides
  };
}

test('normal: a frozen factory snapshot replays deterministically without execution authority', () => {
  const first = createDecisionEpisode(snapshot());
  const replay = createDecisionEpisode(snapshot({options: [...snapshot().options].reverse()}));
  assert.equal(first.episodeId, replay.episodeId);
  assert.equal(first.recommendation.optionId, 'reschedule');
  assert.equal(first.recommendation.executionPermitted, false);
  assert.equal(first.recommendation.authorityRequired, 'NO_EXECUTION');
});

test('edge: missing evidence abstains and changed factory revision gets a different identity', () => {
  assert.throws(() => createDecisionEpisode(snapshot({sourceEvidence: []})), /source evidence/);
  const prior = createDecisionEpisode(snapshot());
  const changed = createDecisionEpisode(snapshot({contextRevision: 'factory-snapshot-2'}));
  assert.notEqual(prior.episodeId, changed.episodeId);
});

test('adversarial: infeasible intervention and simulated savings cannot become execution or learning', () => {
  const episode = createDecisionEpisode(snapshot({options: [
    snapshot().options[0],
    {...snapshot().options[1], feasible: false, prediction: {delayMinutes: 0}}
  ]}));
  assert.equal(episode.recommendation.optionId, 'do-nothing');
  assert.throws(() => selectDecisionOption(episode, {
    optionId: 'reschedule', selectedAt: '2026-10-13T08:01:00Z', authorityDecision: 'SHADOW_OBSERVED'
  }), /not eligible/);
  const selected = selectDecisionOption(createDecisionEpisode(snapshot()), {
    optionId: 'reschedule', selectedAt: '2026-10-13T08:01:00Z', authorityDecision: 'SHADOW_OBSERVED'
  });
  assert.equal(selected.selection.executionPermitted, false);
  const observed = recordDecisionOutcome(selected, {
    observedAt: '2026-10-13T09:00:00Z', evidenceRefs: ['synthetic:observation'], actual: {delayMinutes: 20}
  });
  const proof = createDecisionOutcomeProof({episode: observed, metric: 'delayMinutes',
    direction: 'MINIMIZE', classification: 'SIMULATED'});
  assert.equal(proof.learningEligible, false);
  assert.equal(proof.verifiedOperationalOutcome, false);
  assert.throws(() => toAdaptiveOutcomeInput(proof), /verified decision outcome/);
});

test('research gate admits theory only, leaving implementation and hosted proof open', () => {
  const result = assessResearchCandidate({
    item: {id: 'factory-playback', tags: ['simulation', 'recovery']},
    design: {
      customerProblem: 'Factory incidents need reproducible decision context.',
      hypothesis: 'Existing snapshot-bound Decision Episodes can replay advisory alternatives.',
      canonicalOwners: ['decision-episode', 'simulation', 'resilience'],
      evidenceInputs: ['factory snapshot revision', 'incident', 'production plan'],
      failureModes: ['missing evidence', 'changed revision', 'infeasible action'],
      securityAuthorityBoundaries: ['tenant scope', 'shadow has no execution authority'],
      rollbackOrSafeAbstention: 'Retain the prior episode and abstain on missing evidence.',
      nonGoals: ['second replay engine', 'customer outcome claim'],
      valueMetric: 'incident decision time'
    },
    theory: {
      baseline: 'manual incident reconstruction',
      falsificationCriteria: 'A changed snapshot reuses the old identity or replay grants authority.',
      counterfactual: 'The do-nothing option on the same incident snapshot.',
      noCustomerMutation: true,
      scenarios: ['normal', 'edge', 'adversarial'].map(kind => ({id: kind, kind, result: 'PASS'}))
    },
    implementation: {attempted: false}
  });
  assert.equal(result.theoryPass, true);
  assert.equal(result.implementationAdmitted, false);
  assert.equal(result.convergenceProven, false);
});
