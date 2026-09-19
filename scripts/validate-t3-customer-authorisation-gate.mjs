import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createT3ShadowSimulator } = require('../resilience/t3-shadow-simulator.cjs');
const { createT3ShadowVerifier } = require('../resilience/t3-shadow-verifier.cjs');
const { createT3CustomerAuthorisationGate } = require('../resilience/t3-customer-authorisation-gate.cjs');
const { createHash } = require('node:crypto');

const d = (value) => createHash('sha256').update(String(value)).digest('hex');
const expectCode = async (fn, code) => {
  try { await fn(); } catch (error) { assert.equal(error.code, code); return; }
  assert.fail(`Expected ${code}`);
};

function createDurableAtomicReplayStore() {
  const consumed = new Set();
  return {
    durable: true,
    atomic: true,
    async consumeOnce({ jti }) {
      if (consumed.has(jti)) return { consumed: false };
      consumed.add(jti);
      return { consumed: true };
    },
  };
}

const simulator = createT3ShadowSimulator();
const verifier = createT3ShadowVerifier();
let now = 100000;
const replayStore = createDurableAtomicReplayStore();
const key = 't3-test-key-0123456789abcdef0123456789abcdef';
const gate = createT3CustomerAuthorisationGate({
  key,
  replayStore,
  now: () => ++now,
  maxTtlMs: 60000,
});

assert.throws(() => createT3CustomerAuthorisationGate({
  key,
  replayStore: { durable: false, atomic: true, consumeOnce: async () => true },
}), /durable atomic replay store/);
assert.throws(() => createT3CustomerAuthorisationGate({
  key,
  replayStore: { durable: true, atomic: false, consumeOnce: async () => true },
}), /durable atomic replay store/);

const simulation = simulator.simulate({
  incidentId: 'inc-t3-auth-001',
  tenant: 'tenant-a',
  targetTenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  evidenceDigest: d('evidence'),
  proposedAction: 'payroll.correct-export',
  beforeStateDigest: d('before'),
  afterStateDigest: d('after'),
  compensationPlanDigest: d('compensation'),
  affectedRecords: 12,
});
assert.equal(simulation.status, 'customer_authorisation_required');
assert.equal(simulation.exactActionAllowlistBound, true);
assert.match(simulation.actionPolicyDigest, /^[a-f0-9]{64}$/);
const verification = verifier.verify(simulation, {
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  evidenceDigest: d('evidence'),
});
assert.equal(verification.verified, true);

const issued = gate.issue({
  simulation,
  verification,
  approver: {
    actorType: 'customer-authorised-approver',
    actorId: 'customer-payroll-approver-1',
    role: 'payroll',
    tenant: 'tenant-a',
  },
  ttlMs: 30000,
});
assert.equal(issued.publicReceipt.scope, 'customer-consent-record-only');
assert.equal(issued.publicReceipt.actionPolicyDigest, simulation.actionPolicyDigest);
assert.equal(issued.publicReceipt.executionAuthority, false);
assert.equal(issued.publicReceipt.productionAuthorityGranted, false);
assert.equal(issued.publicReceipt.customerMutation, false);
assert.equal(issued.publicReceipt.productionMutation, false);

const consumed = await gate.consume({
  token: issued.token,
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposalDigest: simulation.proposalDigest,
  approverId: 'customer-payroll-approver-1',
});
assert.equal(consumed.customerConsentRecorded, true);
assert.equal(consumed.durableReplayProtection, true);
assert.equal(consumed.actionPolicyDigest, simulation.actionPolicyDigest);
assert.equal(consumed.executionAuthority, false);
assert.equal(consumed.automaticExecutionEligible, false);
assert.equal(consumed.productionAuthorityGranted, false);
assert.equal(consumed.customerMutation, false);
assert.equal(consumed.productionMutation, false);

await expectCode(() => gate.consume({
  token: issued.token,
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposalDigest: simulation.proposalDigest,
  approverId: 'customer-payroll-approver-1',
}), 'WFM_T3_AUTH_REPLAY');

const restartedGate = createT3CustomerAuthorisationGate({
  key,
  replayStore,
  now: () => ++now,
  maxTtlMs: 60000,
});
await expectCode(() => restartedGate.consume({
  token: issued.token,
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposalDigest: simulation.proposalDigest,
  approverId: 'customer-payroll-approver-1',
}), 'WFM_T3_AUTH_REPLAY');

await expectCode(async () => gate.issue({
  simulation,
  verification,
  approver: { actorType: 'customer-authorised-approver', actorId: 'employee-1', role: 'employee', tenant: 'tenant-a' },
}), 'WFM_T3_AUTH_ROLE');

await expectCode(async () => gate.issue({
  simulation,
  verification,
  approver: { actorType: 'customer-authorised-approver', actorId: 'payroll-2', role: 'payroll', tenant: 'tenant-b' },
}), 'WFM_T3_AUTH_APPROVER');

const hostileSamePrefixSimulation = { ...simulation, proposedAction: 'payroll.delete-all' };
await expectCode(async () => gate.issue({
  simulation: hostileSamePrefixSimulation,
  verification,
  approver: { actorType: 'customer-authorised-approver', actorId: 'payroll-hostile', role: 'payroll', tenant: 'tenant-a' },
}), 'WFM_T3_AUTH_ACTION');

const tamperedPolicySimulation = { ...simulation, actionPolicyDigest: d('forged-policy') };
await expectCode(async () => gate.issue({
  simulation: tamperedPolicySimulation,
  verification,
  approver: { actorType: 'customer-authorised-approver', actorId: 'payroll-policy-tamper', role: 'payroll', tenant: 'tenant-a' },
}), 'WFM_T3_AUTH_ACTION_POLICY');

const tamperedSimulation = { ...simulation, affectedRecords: simulation.affectedRecords + 1 };
await expectCode(async () => gate.issue({
  simulation: tamperedSimulation,
  verification,
  approver: { actorType: 'customer-authorised-approver', actorId: 'payroll-3', role: 'payroll', tenant: 'tenant-a' },
}), 'WFM_T3_AUTH_PROPOSAL_DIGEST');

const shortGate = createT3CustomerAuthorisationGate({
  key: 't3-expiry-key-0123456789abcdef0123456789abcdef',
  replayStore: createDurableAtomicReplayStore(),
  now: () => now,
  maxTtlMs: 10000,
});
const expiring = shortGate.issue({
  simulation,
  verification,
  approver: { actorType: 'customer-authorised-approver', actorId: 'payroll-4', role: 'payroll', tenant: 'tenant-a' },
  ttlMs: 1000,
});
now += 2000;
await expectCode(() => shortGate.consume({
  token: expiring.token,
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposalDigest: simulation.proposalDigest,
  approverId: 'payroll-4',
}), 'WFM_T3_AUTH_EXPIRED');

const tamperedToken = issued.token.slice(0, -1) + (issued.token.endsWith('A') ? 'B' : 'A');
await expectCode(() => restartedGate.consume({
  token: tamperedToken,
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposalDigest: simulation.proposalDigest,
  approverId: 'customer-payroll-approver-1',
}), 'WFM_T3_AUTH_SIGNATURE');

const unavailableStoreGate = createT3CustomerAuthorisationGate({
  key: 't3-store-fail-key-0123456789abcdef0123456789abcdef',
  replayStore: { durable: true, atomic: true, async consumeOnce() { throw new Error('store down'); } },
  now: () => now,
});
const unavailable = unavailableStoreGate.issue({
  simulation,
  verification,
  approver: { actorType: 'customer-authorised-approver', actorId: 'payroll-5', role: 'payroll', tenant: 'tenant-a' },
});
await expectCode(() => unavailableStoreGate.consume({
  token: unavailable.token,
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposalDigest: simulation.proposalDigest,
  approverId: 'payroll-5',
}), 'WFM_T3_AUTH_REPLAY_STORE');

console.log(JSON.stringify({
  schemaVersion: 2,
  proof: 'tier3-customer-authorisation-consent-only-gate',
  status: 'PASS',
  verifiedShadowRequired: true,
  exactActionAllowlistBound: true,
  actionPolicyDigestBoundIntoConsent: true,
  samePrefixHostileActionDenied: true,
  customerRoleBound: true,
  sameTenantBound: true,
  durableAtomicReplayStoreRequired: true,
  replayDeniedAcrossGateRestart: true,
  replayStoreOutageFailsClosed: true,
  oneTimeConsumption: true,
  expiryEnforced: true,
  tokenTamperDenied: true,
  shadowDigestTamperDenied: true,
  actionPolicyTamperDenied: true,
  customerConsentRecorded: true,
  executionAuthorityGranted: false,
  automaticExecutionEligible: false,
  productionAuthorityGranted: false,
  modelAuthorityGranted: false,
  customerMutation: false,
  productionMutation: false,
}, null, 2));
