'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EvidenceLedger,
  CustomerGuardian,
  AuthorityKernel,
  UnknownsEngine,
  TypedActionGateway,
  createCausalEpisode,
  digest,
} = require('./vector-trust-spine.cjs');

test('evidence ledger is append-only, tenant-bound and contradiction-aware', () => {
  const now = Date.parse('2026-09-23T08:00:00.000Z');
  const ledger = new EvidenceLedger({ now: () => now });

  const first = ledger.append({
    id: 'ev-1',
    tenant: 'tenant-a',
    subjectId: 'employee-1',
    claimKey: 'attendance.finish',
    value: '17:00',
    epistemicType: 'OBSERVED_FACT',
    sourceSystem: 'clocking',
    observedAt: '2026-09-23T07:55:00.000Z',
    sourceTrust: 0.95,
    confidence: 1,
  });
  assert.equal(first.contradictionRefs.length, 0);
  assert.equal(ledger.verifyChain(), true);

  const second = ledger.append({
    id: 'ev-2',
    tenant: 'tenant-a',
    subjectId: 'employee-1',
    claimKey: 'attendance.finish',
    value: '17:04',
    epistemicType: 'OBSERVED_FACT',
    sourceSystem: 'access-control',
    observedAt: '2026-09-23T07:56:00.000Z',
    sourceTrust: 0.9,
    confidence: 1,
  });
  assert.deepEqual(second.contradictionRefs, ['ev-1']);
  assert.equal(ledger.verifyChain(), true);

  const assessment = ledger.assess(['ev-1', 'ev-2'], { tenant: 'tenant-a' });
  assert.equal(assessment.complete, true);
  assert.equal(assessment.safe, false);
  assert.deepEqual(assessment.contradicted, ['ev-2']);

  const wrongTenant = ledger.assess(['ev-1'], { tenant: 'tenant-b' });
  assert.equal(wrongTenant.safe, false);
  assert.deepEqual(wrongTenant.wrongTenant, ['ev-1']);
});

test('authority kernel is deny-by-default and refuses self-grant', () => {
  const now = Date.parse('2026-09-23T08:00:00.000Z');
  const kernel = new AuthorityKernel({ now: () => now });

  assert.throws(() => kernel.issueGrant({
    issuer: 'agent-1',
    actor: 'agent-1',
    tenant: 'tenant-a',
    resource: 'shift-1',
    actionTypes: ['workforce.redeploy'],
    riskCeiling: 'MEDIUM',
    expiresAt: '2026-09-23T09:00:00.000Z',
    issuerAuthorityVerified: true,
  }), /cannot grant authority to themselves/i);

  const grant = kernel.issueGrant({
    grantId: 'grant-1',
    issuer: 'customer-policy-authority',
    actor: 'autopilot-worker',
    tenant: 'tenant-a',
    resource: 'shift-1',
    actionTypes: ['workforce.redeploy'],
    riskCeiling: 'MEDIUM',
    maxBlastRadius: 1,
    expiresAt: '2026-09-23T09:00:00.000Z',
    issuerAuthorityVerified: true,
    evidencePrerequisites: ['ev-1'],
  });

  const denied = kernel.evaluate({
    grantId: grant.grantId,
    actor: 'autopilot-worker',
    action: {
      tenant: 'tenant-a',
      targetTenant: 'tenant-a',
      resource: 'shift-1',
      actionType: 'workforce.redeploy',
      riskClass: 'HIGH',
      blastRadius: 1,
    },
    evidenceAssessment: { safe: true, refs: ['ev-1'] },
  });
  assert.equal(denied.allowed, false);
  assert.ok(denied.reasons.includes('RISK_EXCEEDS_GRANT'));
});

test('guardian blocks unsafe payroll and competence violations', () => {
  const guardian = new CustomerGuardian();

  const payroll = guardian.evaluate({
    tenant: 'tenant-a',
    targetTenant: 'tenant-a',
    domain: 'payroll',
    actionType: 'payroll.release',
    riskClass: 'HIGH',
  }, {
    highSeverityPayIntegrityExceptions: 2,
  });
  assert.equal(payroll.allowed, false);
  assert.equal(payroll.violations[0].code, 'PAYROLL_INTEGRITY');

  const redeploy = guardian.evaluate({
    tenant: 'tenant-a',
    targetTenant: 'tenant-a',
    domain: 'workforce',
    actionType: 'workforce.redeploy',
    riskClass: 'MEDIUM',
  }, {
    requiredCompetenceValid: false,
  });
  assert.equal(redeploy.allowed, false);
  assert.equal(redeploy.violations[0].code, 'COMPETENCE_REQUIRED');
});

test('unknowns engine reduces autonomy instead of guessing', () => {
  const engine = new UnknownsEngine();
  const uncertain = engine.assess({
    certifiedPlaybookMatch: false,
    evidenceAssessment: { safe: true, contradicted: [] },
    telemetryBlind: false,
    modelDisagreement: false,
    blastRadiusKnown: true,
  });
  assert.equal(uncertain.level, 'UNCERTAIN');
  assert.equal(uncertain.autonomyCeiling, 'SHADOW_OR_LOW_RISK');

  const novel = engine.assess({
    certifiedPlaybookMatch: false,
    evidenceAssessment: { safe: false, contradicted: ['ev-x'] },
    telemetryBlind: true,
    modelDisagreement: true,
    blastRadiusKnown: false,
  });
  assert.equal(novel.level, 'NOVEL_OR_COMPOUND');
  assert.equal(novel.autonomyCeiling, 'CONTAINMENT_ONLY');
});

test('typed action gateway requires evidence, authority, guardian approval and independent verification', async () => {
  const now = Date.parse('2026-09-23T08:00:00.000Z');
  const ledger = new EvidenceLedger({ now: () => now });
  ledger.append({
    id: 'ev-1',
    tenant: 'tenant-a',
    subjectId: 'employee-1',
    claimKey: 'skills.line-3',
    value: { valid: true },
    epistemicType: 'OBSERVED_FACT',
    sourceSystem: 'skills',
    observedAt: '2026-09-23T07:59:00.000Z',
    sourceTrust: 1,
    confidence: 1,
  });

  const guardian = new CustomerGuardian();
  const kernel = new AuthorityKernel({ now: () => now });
  const grant = kernel.issueGrant({
    grantId: 'grant-1',
    issuer: 'customer-policy-authority',
    actor: 'autopilot-worker',
    tenant: 'tenant-a',
    resource: 'shift-1',
    actionTypes: ['workforce.redeploy'],
    riskCeiling: 'MEDIUM',
    maxBlastRadius: 1,
    expiresAt: '2026-09-23T09:00:00.000Z',
    issuerAuthorityVerified: true,
    evidencePrerequisites: ['ev-1'],
  });

  let executions = 0;
  const gateway = new TypedActionGateway({
    evidenceLedger: ledger,
    guardian,
    authorityKernel: kernel,
  });

  gateway.register({
    actionType: 'workforce.redeploy',
    domain: 'workforce',
    riskClass: 'MEDIUM',
    maxBlastRadius: 1,
    reversible: true,
    executorId: 'executor-a',
    verifierId: 'verifier-b',
    maxEvidenceAgeMs: 10 * 60 * 1000,
    executor: async ({ action }) => {
      executions += 1;
      return {
        executorId: 'executor-a',
        executionDigest: digest({ actionId: action.actionId, result: 'applied' }),
        state: 'APPLIED',
      };
    },
    verifier: async ({ execution, executionDigest }) => ({
      verifierId: 'verifier-b',
      verified: true,
      executionDigest,
      verificationDigest: digest({ execution, independentlyObserved: true }),
    }),
    rollback: async () => ({ verified: true, rollbackDigest: digest('rollback') }),
  });

  const input = {
    actionId: 'action-1',
    actionType: 'workforce.redeploy',
    tenant: 'tenant-a',
    targetTenant: 'tenant-a',
    resource: 'shift-1',
    blastRadius: 1,
    evidenceRefs: ['ev-1'],
    requestedChange: { employeeId: 'employee-1', line: '3' },
    idempotencyKey: 'incident-1/action-1',
    certifiedPlaybookMatch: true,
    actor: 'autopilot-worker',
    grantId: grant.grantId,
    context: { requiredCompetenceValid: true },
  };

  const receipt = await gateway.execute(input);
  assert.equal(receipt.status, 'VERIFIED');
  assert.equal(receipt.executorId, 'executor-a');
  assert.equal(receipt.verifierId, 'verifier-b');
  assert.match(receipt.receiptDigest, /^[a-f0-9]{64}$/);

  const replay = await gateway.execute(input);
  assert.equal(replay.receiptDigest, receipt.receiptDigest);
  assert.equal(executions, 1);
});

test('typed gateway blocks consequential execution when the playbook is not certified', async () => {
  const now = Date.parse('2026-09-23T08:00:00.000Z');
  const ledger = new EvidenceLedger({ now: () => now });
  ledger.append({
    id: 'ev-1',
    tenant: 'tenant-a',
    subjectId: 'employee-1',
    claimKey: 'skills.line-3',
    value: { valid: true },
    epistemicType: 'OBSERVED_FACT',
    sourceSystem: 'skills',
    observedAt: '2026-09-23T07:59:00.000Z',
  });

  const kernel = new AuthorityKernel({ now: () => now });
  const grant = kernel.issueGrant({
    grantId: 'grant-1',
    issuer: 'customer-policy-authority',
    actor: 'autopilot-worker',
    tenant: 'tenant-a',
    resource: 'shift-1',
    actionTypes: ['workforce.redeploy'],
    riskCeiling: 'MEDIUM',
    maxBlastRadius: 1,
    expiresAt: '2026-09-23T09:00:00.000Z',
    issuerAuthorityVerified: true,
  });

  const gateway = new TypedActionGateway({
    evidenceLedger: ledger,
    guardian: new CustomerGuardian(),
    authorityKernel: kernel,
  });

  gateway.register({
    actionType: 'workforce.redeploy',
    domain: 'workforce',
    riskClass: 'MEDIUM',
    maxBlastRadius: 1,
    executorId: 'executor-a',
    verifierId: 'verifier-b',
    executor: async () => ({ executorId: 'executor-a', executionDigest: digest('x') }),
    verifier: async ({ executionDigest }) => ({ verifierId: 'verifier-b', verified: true, executionDigest }),
  });

  await assert.rejects(() => gateway.execute({
    actionType: 'workforce.redeploy',
    tenant: 'tenant-a',
    targetTenant: 'tenant-a',
    resource: 'shift-1',
    blastRadius: 1,
    evidenceRefs: ['ev-1'],
    idempotencyKey: 'incident-2/action-1',
    certifiedPlaybookMatch: false,
    actor: 'autopilot-worker',
    grantId: grant.grantId,
    context: { requiredCompetenceValid: true },
  }), (error) => error.code === 'VECTOR_ACTION_UNKNOWNS');
});

test('T9 causal episodes can propose learning but can never self-promote authority', () => {
  const episode = createCausalEpisode({
    episodeId: 'episode-1',
    tenant: 'tenant-a',
    observedAt: '2026-09-23T08:00:00.000Z',
    contextRevision: 'factory-twin-r17',
    evidenceRefs: ['ev-1', 'ev-2'],
    alternatives: [
      { id: 'redeploy', predictedCost: 80 },
      { id: 'overtime', predictedCost: 260 },
      { id: 'agency', predictedCost: 450 },
    ],
    selectedActionId: 'redeploy',
    prediction: { planAttainmentPct: 96, labourCost: 80 },
    outcomeRefs: ['outcome-1'],
    causalHypothesis: {
      statement: 'Qualified redeployment restored line coverage at lower labour cost.',
      status: 'HYPOTHESIS_REQUIRES_COUNTERFACTUAL_SUPPORT',
    },
    counterfactualStatus: 'PENDING',
  });

  assert.equal(episode.promotion.mode, 'PROPOSAL_ONLY');
  assert.equal(episode.promotion.mayGrantAuthority, false);
  assert.equal(episode.promotion.maySelfPromote, false);
  assert.equal(episode.promotion.requiresIndependentEvaluation, true);
  assert.match(episode.episodeDigest, /^[a-f0-9]{64}$/);
});
