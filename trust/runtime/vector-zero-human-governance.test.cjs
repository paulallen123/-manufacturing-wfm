'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decideZeroHumanAction,
  evaluateHumanTouchReleaseGate
} = require('./vector-zero-human-governance.cjs');

function base(overrides = {}) {
  return {
    incident: { knownFailureClass: true, novel: false },
    action: {
      class: 'REPAIR',
      actionType: 'integration.adapter.switch',
      riskClass: 'HIGH',
      reversibility: 'REVERSIBLE',
      blastRadius: 1
    },
    policy: {
      preAuthorised: true,
      externalHumanActionRequired: false,
      allowedActionTypes: ['integration.adapter.switch'],
      riskCeiling: 'HIGH',
      maxBlastRadius: 1
    },
    principals: {
      proposerId: 'diagnostic-agent',
      policyEngineId: 'policy-engine',
      executorId: 'repair-executor',
      verifierId: 'independent-verifier',
      securityVerifierId: 'security-control-plane'
    },
    evidence: {
      simulationPassed: true,
      policyEnginePassed: true,
      tenantInvariantPassed: true,
      independentVerifierPassed: true,
      securityVerifierPassed: true,
      rollbackOrCompensationProved: true,
      certifiedPlaybookMatch: true,
      certifiedContainmentPlaybookMatch: true
    },
    ...overrides
  };
}

test('high-risk reversible repair can execute with machine quorum and no human fallback', () => {
  const decision = decideZeroHumanAction(base());
  assert.equal(decision.terminal, 'AUTONOMOUS_EXECUTION');
  assert.equal(decision.allowed, true);
  assert.equal(decision.humanOperationalTouchBudget, 0);
  assert.equal(decision.humanEscalationFallbackAllowed, false);
  assert.equal(decision.quorum.passed, true);
});

test('insufficient evidence contains rather than escalating to a person', () => {
  const decision = decideZeroHumanAction(base({
    evidence: {
      ...base().evidence,
      securityVerifierPassed: false
    }
  }));
  assert.equal(decision.terminal, 'AUTONOMOUS_CONTAINMENT');
  assert.equal(decision.allowed, false);
  assert.equal(decision.humanEscalationFallbackAllowed, false);
  assert.ok(decision.reasons.includes('SECURITY_VERIFICATION_NOT_PROVED'));
});

test('novel incident cannot invent a repair but can execute proven containment', () => {
  const repair = decideZeroHumanAction(base({
    incident: { knownFailureClass: false, novel: true },
    evidence: { ...base().evidence, certifiedPlaybookMatch: false }
  }));
  assert.equal(repair.terminal, 'AUTONOMOUS_CONTAINMENT');
  assert.equal(repair.allowed, false);
  assert.ok(repair.reasons.includes('NOVEL_INCIDENT_REPAIR_BLOCKED'));

  const contain = decideZeroHumanAction(base({
    incident: { knownFailureClass: false, novel: true },
    action: {
      class: 'CONTAINMENT',
      actionType: 'tenant.write.fence',
      riskClass: 'HIGH',
      reversibility: 'REVERSIBLE',
      blastRadius: 1
    },
    policy: {
      ...base().policy,
      allowedActionTypes: ['tenant.write.fence']
    },
    evidence: { ...base().evidence, certifiedPlaybookMatch: false, certifiedContainmentPlaybookMatch: true }
  }));
  assert.equal(contain.terminal, 'AUTONOMOUS_EXECUTION');
  assert.equal(contain.allowed, true);
});

test('containment can never bypass failed machine authority or safety checks', () => {
  const containment = () => base({
    incident: { knownFailureClass: false, novel: true },
    action: {
      class: 'CONTAINMENT',
      actionType: 'tenant.write.fence',
      riskClass: 'HIGH',
      reversibility: 'REVERSIBLE',
      blastRadius: 1
    },
    policy: {
      ...base().policy,
      allowedActionTypes: ['tenant.write.fence']
    },
    evidence: {
      ...base().evidence,
      certifiedPlaybookMatch: false,
      certifiedContainmentPlaybookMatch: true
    }
  });

  const cases = [
    [input => { input.policy = { ...input.policy, preAuthorised: false }; }, 'POLICY_NOT_PREAUTHORISED'],
    [input => { input.policy = { ...input.policy, allowedActionTypes: undefined }; }, 'ACTION_NOT_ALLOWLISTED'],
    [input => { input.action = { ...input.action, blastRadius: 2 }; }, 'BLAST_RADIUS_EXCEEDS_POLICY'],
    [input => { input.evidence = { ...input.evidence, securityVerifierPassed: false }; }, 'SECURITY_VERIFICATION_NOT_PROVED'],
    [input => { input.evidence = { ...input.evidence, certifiedContainmentPlaybookMatch: false }; }, 'CONTAINMENT_PLAYBOOK_NOT_CERTIFIED']
  ];

  for (const [mutate, reason] of cases) {
    const input = containment();
    mutate(input);
    const decision = decideZeroHumanAction(input);
    assert.equal(decision.terminal, 'AUTONOMOUS_CONTAINMENT', reason);
    assert.equal(decision.allowed, false, reason);
    assert.ok(decision.reasons.includes(reason), reason);
  }
});

test('external legal or identity ceremony is surfaced as a hard boundary, never disguised as zero-touch', () => {
  const decision = decideZeroHumanAction(base({
    policy: { ...base().policy, externalHumanActionRequired: true }
  }));
  assert.equal(decision.terminal, 'EXTERNAL_MANDATE_BLOCKED');
  assert.equal(decision.allowed, false);
  assert.equal(decision.zeroHumanOperationalEffortAchievable, false);
  assert.ok(decision.reasons.includes('EXTERNAL_HUMAN_ACTION_MANDATED'));
});

test('machine quorum requires independent principals', () => {
  const decision = decideZeroHumanAction(base({
    principals: {
      proposerId: 'same',
      policyEngineId: 'policy-engine',
      executorId: 'same',
      verifierId: 'independent-verifier',
      securityVerifierId: 'security-control-plane'
    }
  }));
  assert.equal(decision.terminal, 'AUTONOMOUS_CONTAINMENT');
  assert.ok(decision.reasons.includes('INDEPENDENT_PRINCIPALS_REQUIRED'));
});

test('any human operational touch is a release-blocking defect', () => {
  assert.deepEqual(evaluateHumanTouchReleaseGate({ humanTouches: 0, customerDays: 100 }).passed, true);
  const failed = evaluateHumanTouchReleaseGate({ humanTouches: 1, customerDays: 100 });
  assert.equal(failed.passed, false);
  assert.equal(failed.releaseBlocker, true);
  assert.equal(failed.defectClass, 'HUMAN_OPERATIONAL_TOUCH');
  assert.equal(failed.humanTouchesPer1000CustomerDays, 10);
});
