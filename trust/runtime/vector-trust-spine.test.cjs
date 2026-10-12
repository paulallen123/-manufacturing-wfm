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

// Keep the real evidence, Guardian and authority checks; only execution effects
// and independent observation are fakes. No customer state is touched.
function receiptFixture({ evidenceExpiresAt = null } = {}) {
  let now = Date.parse('2026-09-23T08:00:00.000Z');
  let policyAllowed = true;
  const ledger = new EvidenceLedger({ now: () => now });
  for (const id of ['ev-1', 'ev-2']) {
    ledger.append({
      id, tenant: 'tenant-a', subjectId: 'employee-1', claimKey: id,
      value: { valid: true }, epistemicType: 'OBSERVED_FACT', sourceSystem: 'skills',
      observedAt: '2026-09-23T07:59:00.000Z', expiresAt: evidenceExpiresAt,
    });
  }
  const kernel = new AuthorityKernel({ now: () => now });
  const grantInput = {
    grantId: 'grant-1', issuer: 'customer-policy-authority', actor: 'autopilot-worker',
    tenant: 'tenant-a', resource: 'shift-1',
    actionTypes: ['workforce.redeploy', 'workforce.reassign'], riskCeiling: 'MEDIUM',
    maxBlastRadius: 1, expiresAt: '2026-09-23T08:05:00.000Z',
    issuerAuthorityVerified: true, evidencePrerequisites: ['ev-1'],
  };
  kernel.issueGrant(grantInput);
  const guardian = new CustomerGuardian({ invariants: [(_action, context) => ({
    allowed: policyAllowed && context.site === 'site-a' && context.policyRevision === 'policy-1',
    code: 'SITE_POLICY', message: 'Current site policy rejected the action.',
  })] });
  const effects = { executions: 0, verifications: 0, audit: [] };
  const gateway = new TypedActionGateway({ evidenceLedger: ledger, guardian, authorityKernel: kernel });
  for (const actionType of ['workforce.redeploy', 'workforce.reassign']) {
    gateway.register({
      actionType, domain: 'workforce', riskClass: 'MEDIUM', maxBlastRadius: 1,
      executorId: 'executor-a', verifierId: 'verifier-b', maxEvidenceAgeMs: 10 * 60 * 1000,
      executor: async ({ action }) => {
        effects.executions += 1;
        effects.audit.push({ actionId: action.actionId, tenant: action.tenant });
        return { executorId: 'executor-a', executionDigest: digest(action), state: 'APPLIED' };
      },
      verifier: async ({ executionDigest }) => {
        effects.verifications += 1;
        return { verifierId: 'verifier-b', verified: true, executionDigest };
      },
    });
  }
  const input = {
    actionId: 'action-1', actionType: 'workforce.redeploy', tenant: 'tenant-a',
    targetTenant: 'tenant-a', resource: 'shift-1', blastRadius: 1,
    evidenceRefs: ['ev-1', 'ev-2'], requestedChange: { employeeId: 'employee-1', line: '3' },
    idempotencyKey: 'incident-1/action-1', certifiedPlaybookMatch: true,
    actor: 'autopilot-worker', grantId: 'grant-1',
    context: { requiredCompetenceValid: true, site: 'site-a', policyRevision: 'policy-1' },
  };
  return {
    gateway, input, ledger, kernel, guardian, effects, grantInput,
    setNow: (value) => { now = Date.parse(value); },
    rejectPolicy: () => { policyAllowed = false; },
  };
}

function historySnapshot(f) {
  return JSON.stringify({
    receipts: [...f.gateway.idempotency.entries()],
    evidence: f.ledger.records,
    evidenceHead: f.ledger.headDigest,
  });
}

for (const [name, change, code] of [
  ['tenant', { tenant: 'tenant-b', targetTenant: 'tenant-b' }, 'VECTOR_ACTION_UNKNOWNS'],
  ['target tenant', { targetTenant: 'tenant-b' }, 'VECTOR_ACTION_GUARDIAN'],
  ['resource', { resource: 'shift-2' }, 'VECTOR_ACTION_AUTHORITY'],
  ['actor', { actor: 'other-worker' }, 'VECTOR_ACTION_AUTHORITY'],
  ['missing grant', { grantId: 'missing-grant' }, 'VECTOR_ACTION_AUTHORITY'],
  ['missing evidence', { evidenceRefs: ['missing'] }, 'VECTOR_ACTION_UNKNOWNS'],
  ['uncertified playbook', { certifiedPlaybookMatch: false }, 'VECTOR_ACTION_UNKNOWNS'],
  ['blind telemetry', { telemetryBlind: true }, 'VECTOR_ACTION_UNKNOWNS'],
  ['model disagreement', { modelDisagreement: true }, 'VECTOR_ACTION_UNKNOWNS'],
  ['site', { context: { requiredCompetenceValid: true, site: 'site-b', policyRevision: 'policy-1' } }, 'VECTOR_ACTION_GUARDIAN'],
  ['policy context', { context: { requiredCompetenceValid: true, site: 'site-a', policyRevision: 'policy-2' } }, 'VECTOR_ACTION_GUARDIAN'],
  ['competence', { context: { requiredCompetenceValid: false, site: 'site-a', policyRevision: 'policy-1' } }, 'VECTOR_ACTION_GUARDIAN'],
]) {
  test(`cached receipt cannot authorize changed ${name}; fresh-key control also denies`, async () => {
    const f = receiptFixture();
    const historical = await f.gateway.execute(f.input);
    const snapshot = JSON.stringify(historical);
    const history = historySnapshot(f);
    const changed = { ...f.input, ...change };
    await assert.rejects(() => f.gateway.execute({ ...changed, idempotencyKey: 'fresh-control' }), { code });
    await assert.rejects(() => f.gateway.execute(changed), { code });
    assert.deepEqual(f.effects, { executions: 1, verifications: 1, audit: [{ actionId: 'action-1', tenant: 'tenant-a' }] });
    assert.equal(JSON.stringify(historical), snapshot);
    assert.deepEqual(await f.gateway.execute(f.input), historical);
    assert.equal(historySnapshot(f), history);
  });
}

for (const [name, change] of [
  ['action type', { actionType: 'workforce.reassign' }],
  ['action id', { actionId: 'action-2' }],
  ['requested change', { requestedChange: { employeeId: 'employee-1', line: '4' } }],
  ['evidence set', { evidenceRefs: ['ev-1'] }],
  ['blast radius', { blastRadius: 0 }],
  ['additional context', { context: { requiredCompetenceValid: true, site: 'site-a', policyRevision: 'policy-1', revision: 'r2' } }],
]) {
  test(`cached receipt rejects changed authorized ${name}; a fresh key executes its own request`, async () => {
    const f = receiptFixture();
    const historical = await f.gateway.execute(f.input);
    const history = historySnapshot(f);
    await assert.rejects(() => f.gateway.execute({ ...f.input, ...change }), { code: 'VECTOR_ACTION_IDEMPOTENCY_CONFLICT' });
    assert.equal(f.effects.executions, 1);
    assert.equal(f.effects.verifications, 1);
    assert.equal(f.effects.audit.length, 1);
    assert.equal(historySnapshot(f), history);
    const fresh = await f.gateway.execute({ ...f.input, ...change, idempotencyKey: 'fresh-control' });
    assert.equal(fresh.status, 'VERIFIED');
    assert.notEqual(fresh.receiptDigest, historical.receiptDigest);
    assert.equal(f.effects.executions, 2);
    assert.equal(f.effects.verifications, 2);
    assert.equal(f.effects.audit.length, 2);
    assert.deepEqual(await f.gateway.execute(f.input), historical);
  });
}

for (const [name, setup, drift, code] of [
  ['expired evidence', { evidenceExpiresAt: '2026-09-23T08:02:00.000Z' }, (f) => f.setNow('2026-09-23T08:02:00.001Z'), 'VECTOR_ACTION_UNKNOWNS'],
  ['aged evidence', {}, (f) => f.setNow('2026-09-23T08:10:00.001Z'), 'VECTOR_ACTION_UNKNOWNS'],
  ['expired authority', {}, (f) => f.setNow('2026-09-23T08:05:00.000Z'), 'VECTOR_ACTION_AUTHORITY'],
  ['revoked authority', {}, (f) => f.kernel.grants.delete('grant-1'), 'VECTOR_ACTION_AUTHORITY'],
  ['current Guardian policy', {}, (f) => f.rejectPolicy(), 'VECTOR_ACTION_GUARDIAN'],
]) {
  test(`cached historical receipt is not current authority after ${name} drift`, async () => {
    const f = receiptFixture(setup);
    const historical = await f.gateway.execute(f.input);
    const snapshot = JSON.stringify(historical);
    drift(f);
    const history = historySnapshot(f);
    await assert.rejects(() => f.gateway.execute({ ...f.input, idempotencyKey: 'fresh-control' }), { code });
    await assert.rejects(() => f.gateway.execute(f.input), { code });
    assert.equal(f.effects.executions, 1);
    assert.equal(f.effects.verifications, 1);
    assert.equal(f.effects.audit.length, 1);
    assert.equal(JSON.stringify(historical), snapshot);
    assert.equal(historySnapshot(f), history);
  });
}

test('same key is isolated between independently authorized tenants', async () => {
  const f = receiptFixture();
  const first = await f.gateway.execute(f.input);
  f.ledger.append({
    id: 'ev-b', tenant: 'tenant-b', subjectId: 'employee-b', claimKey: 'skills', value: true,
    epistemicType: 'OBSERVED_FACT', sourceSystem: 'skills', observedAt: '2026-09-23T07:59:00.000Z',
  });
  f.kernel.issueGrant({ ...f.grantInput, grantId: 'grant-b', tenant: 'tenant-b', evidencePrerequisites: ['ev-b'] });
  const secondInput = { ...f.input, tenant: 'tenant-b', targetTenant: 'tenant-b', evidenceRefs: ['ev-b'], grantId: 'grant-b' };
  await assert.rejects(() => f.gateway.execute({ ...secondInput, grantId: 'grant-1' }), { code: 'VECTOR_ACTION_AUTHORITY' });
  assert.equal(f.effects.executions, 1);
  assert.equal(f.effects.verifications, 1);
  const second = await f.gateway.execute(secondInput);
  assert.equal(second.action.tenant, 'tenant-b');
  assert.notEqual(second.receiptDigest, first.receiptDigest);
  assert.deepEqual(await f.gateway.execute(f.input), first);
  assert.deepEqual(await f.gateway.execute(secondInput), second);
  assert.equal(f.effects.executions, 2);
  assert.equal(f.effects.verifications, 2);
  assert.equal(f.effects.audit.length, 2);
});

test('canonical authorized replay preserves generated identity and has no duplicate effects', async () => {
  const f = receiptFixture();
  delete f.input.actionId;
  const inputSnapshot = JSON.stringify(f.input);
  const first = await f.gateway.execute(f.input);
  const snapshot = JSON.stringify(first);
  const history = historySnapshot(f);
  const replayInput = {
    ...f.input, tenant: ' tenant-a ', actor: ' autopilot-worker ',
    evidenceRefs: ['ev-2', 'ev-1', 'ev-1'],
    requestedChange: { line: '3', employeeId: 'employee-1' },
    context: { policyRevision: 'policy-1', site: 'site-a', requiredCompetenceValid: true },
  };
  f.setNow('2026-09-23T08:01:00.000Z');
  assert.deepEqual(await f.gateway.execute(replayInput), first);
  assert.equal(JSON.stringify(f.input), inputSnapshot);
  assert.equal(JSON.stringify(first), snapshot);
  first.action.requestedChange.line = 'tampered';
  first.action.evidenceRefs.push('tampered');
  const replay = await f.gateway.execute(f.input);
  assert.equal(JSON.stringify(replay), snapshot);
  assert.equal(f.effects.executions, 1);
  assert.equal(f.effects.verifications, 1);
  assert.equal(f.effects.audit.length, 1);
  assert.equal(historySnapshot(f), history);
});

test('current admission sees the original generated action identity on replay', async () => {
  const f = receiptFixture();
  delete f.input.actionId;
  const first = await f.gateway.execute(f.input);
  f.guardian.invariants.push((action) => ({
    allowed: action.actionId === first.action.actionId,
    code: 'ACTION_ID_SCOPE', message: 'Only the originally admitted action is allowed.',
  }));
  assert.deepEqual(await f.gateway.execute(f.input), first);
  assert.equal(f.effects.executions, 1);
  assert.equal(f.effects.verifications, 1);
});

test('deeply frozen caller input remains unchanged through admission and replay', async () => {
  const f = receiptFixture();
  Object.freeze(f.input.requestedChange);
  Object.freeze(f.input.evidenceRefs);
  Object.freeze(f.input.context);
  Object.freeze(f.input);
  const snapshot = JSON.stringify(f.input);
  const first = await f.gateway.execute(f.input);
  assert.deepEqual(await f.gateway.execute(f.input), first);
  assert.equal(JSON.stringify(f.input), snapshot);
});

test('reissued changed authority cannot reuse a receipt even when the request remains allowed', async () => {
  const f = receiptFixture();
  const historical = await f.gateway.execute(f.input);
  f.kernel.issueGrant({ ...f.grantInput, customerApprovalRef: 'replacement-approval' });
  await assert.rejects(() => f.gateway.execute(f.input), { code: 'VECTOR_ACTION_IDEMPOTENCY_CONFLICT' });
  assert.equal(f.effects.executions, 1);
  assert.equal(f.effects.verifications, 1);
  const fresh = await f.gateway.execute({ ...f.input, idempotencyKey: 'fresh-control' });
  assert.equal(fresh.status, 'VERIFIED');
  assert.notEqual(fresh.receiptDigest, historical.receiptDigest);
});

function replacementInput(overrides = {}) {
  return {
    id: 'replacement', tenant: 'tenant-a', subjectId: 'employee-1', claimKey: 'ev-1',
    value: { valid: false }, epistemicType: 'OBSERVED_FACT', sourceSystem: 'skills',
    observedAt: '2026-09-23T08:00:00.000Z', effectiveAt: '2026-09-23T08:00:00.000Z',
    supersedes: 'ev-1', ...overrides,
  };
}

test('current supersession withdraws evidence for cached and fresh-key admission without rewriting history', async () => {
  const f = receiptFixture();
  const receipt = await f.gateway.execute(f.input);
  const originalEvidence = JSON.stringify(f.ledger.get('ev-1'));
  const originalReceipts = JSON.stringify([...f.gateway.idempotency]);
  const before = f.ledger.assess(['ev-1'], { tenant: 'tenant-a' });
  f.ledger.append(replacementInput());
  const current = f.ledger.assess(['ev-1'], { tenant: 'tenant-a' });
  assert.equal(current.safe, false);
  assert.equal(current.complete, true);
  assert.deepEqual(current.superseded, ['ev-1']);
  assert.notEqual(current.assessmentDigest, before.assessmentDigest);
  const history = historySnapshot(f);
  await assert.rejects(() => f.gateway.execute({ ...f.input, idempotencyKey: 'fresh-control' }), { code: 'VECTOR_ACTION_UNKNOWNS' });
  await assert.rejects(() => f.gateway.execute(f.input), { code: 'VECTOR_ACTION_UNKNOWNS' });
  assert.equal(historySnapshot(f), history);
  assert.equal(JSON.stringify(f.ledger.get('ev-1')), originalEvidence);
  assert.equal(JSON.stringify([...f.gateway.idempotency]), originalReceipts);
  assert.equal(receipt.status, 'VERIFIED');
  assert.equal(f.effects.executions, 1);
  assert.equal(f.effects.verifications, 1);
  assert.equal(f.effects.audit.length, 1);
  assert.equal(f.ledger.verifyChain(), true);
});

for (const [name, overrides] of [
  ['future observation', { observedAt: '2026-09-23T08:02:00.000Z' }],
  ['future effectivity', { effectiveAt: '2026-09-23T08:02:00.000Z' }],
]) {
  test(`${name} supersession is inactive until both times are current`, async () => {
    const f = receiptFixture();
    const receipt = await f.gateway.execute(f.input);
    const before = f.ledger.assess(['ev-1'], { tenant: 'tenant-a' });
    f.ledger.append(replacementInput(overrides));
    const pending = f.ledger.assess(['ev-1'], { tenant: 'tenant-a' });
    assert.equal(pending.safe, true);
    assert.deepEqual(pending.superseded, []);
    assert.equal(pending.assessmentDigest, before.assessmentDigest);
    assert.deepEqual(await f.gateway.execute(f.input), receipt);
    f.setNow('2026-09-23T08:02:00.000Z');
    const current = f.ledger.assess(['ev-1'], { tenant: 'tenant-a' });
    assert.equal(current.safe, false);
    assert.deepEqual(current.superseded, ['ev-1']);
    await assert.rejects(() => f.gateway.execute(f.input), { code: 'VECTOR_ACTION_UNKNOWNS' });
    assert.equal(f.effects.executions, 1);
    assert.equal(f.effects.verifications, 1);
    const historical = f.ledger.assess(['ev-1'], { tenant: 'tenant-a', now: Date.parse('2026-09-23T08:00:00.000Z') });
    assert.equal(historical.safe, true);
    assert.equal(historical.assessmentDigest, before.assessmentDigest);
  });
}

for (const [name, overrides] of [
  ['tenant', { tenant: 'tenant-b' }],
  ['subject', { subjectId: 'employee-b' }],
  ['claim', { claimKey: 'other-claim' }],
  ['missing predecessor', { supersedes: 'missing' }],
  ['self reference', { supersedes: 'replacement' }],
]) {
  test(`supersession rejects ${name} misuse before publishing any ledger state`, () => {
    const f = receiptFixture();
    const before = historySnapshot(f);
    assert.throws(() => f.ledger.append(replacementInput(overrides)), { code: 'VECTOR_EVIDENCE_SUPERSEDE' });
    assert.equal(historySnapshot(f), before);
    assert.equal(f.ledger.get('replacement'), null);
    assert.equal(f.ledger.verifyChain(), true);
    assert.equal(f.ledger.assess(['ev-1'], { tenant: 'tenant-a' }).safe, true);
  });
}

test('unrelated records cannot withdraw a predecessor without a valid supersession link', () => {
  const f = receiptFixture();
  const before = f.ledger.assess(['ev-1'], { tenant: 'tenant-a' });
  f.ledger.append(replacementInput({ tenant: 'tenant-b', supersedes: null }));
  f.ledger.append(replacementInput({ id: 'other-subject', subjectId: 'employee-b', supersedes: null }));
  f.ledger.append(replacementInput({ id: 'other-claim', claimKey: 'other-claim', supersedes: null }));
  assert.deepEqual(f.ledger.assess(['ev-1'], { tenant: 'tenant-a' }), before);
});

test('current supersession chains withdraw each predecessor and never revive it after replacement expiry', () => {
  const f = receiptFixture();
  f.ledger.append(replacementInput({ value: { valid: true }, expiresAt: '2026-09-23T08:01:00.000Z' }));
  f.ledger.append(replacementInput({ id: 'replacement-2', supersedes: 'replacement', value: { valid: true }, expiresAt: '2026-09-23T08:01:00.000Z' }));
  const current = f.ledger.assess(['ev-1', 'replacement', 'replacement-2'], { tenant: 'tenant-a' });
  assert.deepEqual(current.superseded, ['ev-1', 'replacement']);
  assert.equal(current.safe, false);
  assert.equal(f.ledger.assess(['replacement-2'], { tenant: 'tenant-a' }).safe, true);
  f.setNow('2026-09-23T08:02:00.000Z');
  const expired = f.ledger.assess(['ev-1'], { tenant: 'tenant-a' });
  assert.equal(expired.safe, false);
  assert.deepEqual(expired.superseded, ['ev-1']);
  assert.equal(f.ledger.assess(['replacement-2'], { tenant: 'tenant-a' }).safe, false);
  assert.equal(f.ledger.verifyChain(), true);
});
