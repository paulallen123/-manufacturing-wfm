'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VectorToolFoundry } = require('./vector-tool-foundry.cjs');
const { VectorEngineeringLearningBridge } = require('./vector-engineering-learning-bridge.cjs');

test('a regression becomes an eval candidate without execution authority', () => {
  const bridge = new VectorEngineeringLearningBridge({ now: () => 1_800_000_000_000 });
  const candidate = bridge.propose({
    signal: 'REGRESSION',
    evidenceClass: 'DERIVED',
    evidenceRefs: ['proof:regression-17'],
    confidence: 0.98,
    patternCount: 1,
    summary: 'Hosted proof exposed a deterministic regression.',
    sourceCommit: 'a'.repeat(40),
  });
  assert.equal(candidate.route, 'PERSISTENT_EVAL_CANDIDATE');
  assert.equal(candidate.governance.proposalOnly, true);
  assert.equal(candidate.governance.mayExecute, false);
  assert.equal(candidate.governance.mayMutateProduction, false);
  assert.equal(candidate.productFactory.reviewRequired, true);
  assert.equal(bridge.verify(candidate), true);
});

test('a repeated verified win can propose a new immutable tool version but cannot self-certify it', () => {
  const foundry = new VectorToolFoundry();
  foundry.registerTool({
    id: 'vector.integration.replay',
    version: '1.0.0',
    lifecycle: 'SHADOW',
    handler: async () => ({ pass: true }),
  });
  const bridge = new VectorEngineeringLearningBridge({ foundry });
  const candidate = bridge.propose({
    signal: 'REPEATED_VERIFIED_WIN',
    evidenceClass: 'SANITISED',
    evidenceRefs: ['proof:win-1', 'proof:win-2'],
    confidence: 0.94,
    patternCount: 2,
    summary: 'The same repair succeeded twice under independent proof.',
    sourceRef: 'branch:frontier',
    toolRevision: {
      toolId: 'vector.integration.replay',
      fromVersion: '1.0.0',
      proposedVersion: '1.1.0',
      changes: ['capture the verified repair as a reusable replay rule'],
    },
  });
  assert.equal(candidate.route, 'VERSIONED_SKILL_OR_TOOL_CANDIDATE');
  assert.equal(candidate.toolRevisionProposal.governance.mode, 'PROPOSAL_ONLY');
  assert.equal(candidate.toolRevisionProposal.governance.maySelfRegister, false);
  assert.equal(candidate.toolRevisionProposal.governance.maySelfCertify, false);
});

test('repeated signals fail closed when only one occurrence exists', () => {
  const bridge = new VectorEngineeringLearningBridge();
  assert.throws(() => bridge.propose({
    signal: 'REPEATED_MANUAL_WORK',
    evidenceClass: 'SYNTHETIC',
    evidenceRefs: ['proof:manual-1'],
    confidence: 0.9,
    patternCount: 1,
    sourceRef: 'ci:test',
  }), (error) => error.code === 'VECTOR_LEARNING_REPEAT_REQUIRED');
});

test('raw customer data and authority material are rejected from engineering learning', () => {
  const bridge = new VectorEngineeringLearningBridge();
  for (const forbidden of ['rawCustomerData', 'rawSecret', 'executionToken', 'unsignedProductionAuthority']) {
    assert.throws(() => bridge.propose({
      signal: 'REGRESSION',
      evidenceClass: 'SANITISED',
      evidenceRefs: ['proof:boundary'],
      confidence: 0.9,
      sourceRef: 'ci:test',
      [forbidden]: true,
    }), (error) => error.code === 'VECTOR_LEARNING_BOUNDARY');
  }
});

test('candidate digest detects tampering', () => {
  const bridge = new VectorEngineeringLearningBridge();
  const candidate = bridge.propose({
    signal: 'COMPETITOR_GAP',
    evidenceClass: 'SYNTHETIC',
    evidenceRefs: ['market-eval:gap-4'],
    confidence: 0.75,
    sourceRef: 'research:gap-4',
  });
  const tampered = { ...candidate, governance: { ...candidate.governance, mayExecute: true } };
  assert.equal(bridge.verify(candidate), true);
  assert.equal(bridge.verify(tampered), false);
});
