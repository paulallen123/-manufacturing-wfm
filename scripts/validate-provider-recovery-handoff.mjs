import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Handoff = require(path.resolve(process.cwd(), 'resilience/provider-recovery-handoff.cjs'));
const supportContract = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'resilience/support-tier-contract.json'), 'utf8'));
const t1AllowedTerminals = new Set(supportContract?.tiers?.T1?.allowed_terminal_outcomes || []);
const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : Handoff.canonical(value)).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expect = async (fn, code) => {
  try { await fn(); } catch (error) {
    assert(error.code === code, `Expected ${code}, got ${error.code || 'none'}: ${error.message}`);
    return;
  }
  throw new Error(`Expected ${code}`);
};

assert(t1AllowedTerminals.has('recovered') && t1AllowedTerminals.has('contained'), 'T1 support contract lost required safe provider terminal states.');
assert(!t1AllowedTerminals.has('review-required'), 'T1 support contract must not admit an ambiguous vendor-engineer review terminal.');

let now = 1_800_000_000_000;
const db = new DatabaseSync(':memory:');
const store = Handoff.createProviderRecoveryHandoffStore(db, {
  key: 'synthetic-ci-handoff-key-0123456789abcdef',
  now: () => now,
  maxTtlMs: 120000,
});
const tenant = 'tenant-a';
const otherTenant = 'tenant-b';
const runId = 'run-42';
const workerId = 'normal-adapter-worker-7';
const evidenceDigest = sha({ runId, evidence: 'verified-provider-failure' });
const verificationDigest = sha({ verifier: 'independent', status: 'pass' });
const stateDigest = sha({ runId, leaseOwner: workerId, checkpoint: { offset: 2, limit: 2 } });
const nextRequest = { offset: 2, limit: 2 };
const targetDigest = sha({ tenant, runId, action: 'integration.retry' });
const safetyDecision = {
  allowed: true,
  type: 'integration.retry',
  tenant,
  targetTenant: tenant,
  decisionDigest: sha({ tenant, action: 'integration.retry', policy: 'deterministic' }),
};

const issued = store.issueInternal({
  actorType: 'deterministic-recovery-executor',
  tenant,
  providerRunId: runId,
  workerId,
  actionType: 'integration.retry',
  targetDigest,
  evidenceDigest,
  verificationDigest,
  safetyDecision,
  actionGrantJti: 'grant-42',
  idempotencyKey: 'provider-page-2',
  nextRequest,
  stateDigest,
  ttlMs: 60000,
});

const publicText = JSON.stringify(issued.publicReceipt);
assert(!publicText.includes('offset') && !publicText.includes('limit') && !publicText.includes('internalToken'), 'Public receipt leaked continuation/token.');
const tokenPayload = JSON.parse(Buffer.from(issued.internalToken.split('.')[0], 'base64url').toString());
assert(!Object.hasOwn(tokenPayload, 'nextRequest') && !JSON.stringify(tokenPayload).includes('offset'), 'Capability token leaked continuation.');

await expect(() => store.consumeInternal({ token: issued.internalToken, tenant: otherTenant, providerRunId: runId, workerId, currentStateDigest: stateDigest }), 'WFM_PROVIDER_HANDOFF_SCOPE');
await expect(() => store.consumeInternal({ token: `${issued.internalToken}x`, tenant, providerRunId: runId, workerId, currentStateDigest: stateDigest }), 'WFM_PROVIDER_HANDOFF_SIGNATURE');
await expect(() => store.consumeInternal({ token: issued.internalToken, tenant, providerRunId: runId, workerId, currentStateDigest: sha({ changed: true }) }), 'WFM_PROVIDER_HANDOFF_STALE');

let adapterCalls = 0;
let firstSeenRequest = null;
const adapter = {
  async resumeFromCheckpoint(input) {
    adapterCalls += 1;
    firstSeenRequest = input.nextRequest;
    return {
      acceptedContinuationDigest: input.continuationDigest,
      sourceCount: 2,
      stagedCount: 2,
      heldCount: 0,
    };
  },
};
const orchestrator = Handoff.createProviderResumeOrchestrator({ store, adapter });
const outcome = await orchestrator.resume({
  token: issued.internalToken,
  tenant,
  providerRunId: runId,
  workerId,
  currentStateDigest: stateDigest,
});
assert(Handoff.canonical(firstSeenRequest) === Handoff.canonical(nextRequest), 'Normal adapter did not receive exact committed continuation.');
assert(firstSeenRequest.offset === 2, 'Adapter restarted from page one instead of committed checkpoint.');
assert(outcome.status === 'recovered' && outcome.providerCompletionGreen === true, 'Reconciled recovery did not reach green terminal state.');
assert(t1AllowedTerminals.has(outcome.status) && outcome.safeTerminal === true, 'Recovered provider outcome is outside the T1 safe terminal contract.');
assert(outcome.autonomousBusinessApply === false && outcome.productionAuthorityGranted === false && outcome.vendorEngineerRequired === false, 'Recovery incorrectly granted business/production authority or required a vendor engineer.');
await expect(() => orchestrator.resume({ token: issued.internalToken, tenant, providerRunId: runId, workerId, currentStateDigest: stateDigest }), 'WFM_PROVIDER_HANDOFF_REPLAY');
assert(adapterCalls === 1, 'Single-use handoff allowed duplicate adapter execution.');

const issue = (overrides = {}) => store.issueInternal({
  actorType: 'deterministic-recovery-executor', tenant, providerRunId: overrides.providerRunId || `run-${Math.random()}`,
  workerId, actionType: 'integration.retry', targetDigest, evidenceDigest, verificationDigest, safetyDecision,
  actionGrantJti: overrides.actionGrantJti || `grant-${Math.random()}`, idempotencyKey: overrides.idempotencyKey || `key-${Math.random()}`,
  nextRequest: overrides.nextRequest || nextRequest, stateDigest, ttlMs: overrides.ttlMs || 60000,
});

const duplicate1 = issue({ providerRunId: 'dup-run', actionGrantJti: 'grant-dup-1', idempotencyKey: 'stable-key' });
const duplicateOrchestrator = Handoff.createProviderResumeOrchestrator({ store, adapter });
const dupFirst = await duplicateOrchestrator.resume({ token: duplicate1.internalToken, tenant, providerRunId: 'dup-run', workerId, currentStateDigest: stateDigest });
assert(dupFirst.duplicateSuppressed === false, 'First idempotent resume was marked duplicate.');
const duplicate2 = issue({ providerRunId: 'dup-run', actionGrantJti: 'grant-dup-2', idempotencyKey: 'stable-key' });
const dupSecond = await duplicateOrchestrator.resume({ token: duplicate2.internalToken, tenant, providerRunId: 'dup-run', workerId, currentStateDigest: stateDigest });
assert(dupSecond.duplicateSuppressed === true, 'Identical idempotent replay was not suppressed.');
assert(adapterCalls === 2, 'Duplicate replay called provider adapter again.');

const drift = issue({ providerRunId: 'dup-run', actionGrantJti: 'grant-dup-3', idempotencyKey: 'stable-key', nextRequest: { offset: 4, limit: 2 } });
await expect(() => duplicateOrchestrator.resume({ token: drift.internalToken, tenant, providerRunId: 'dup-run', workerId, currentStateDigest: stateDigest }), 'WFM_PROVIDER_RESUME_IDEMPOTENCY_DRIFT');
assert(adapterCalls === 2, 'Changed payload under same idempotency key reached provider adapter.');

const held = issue({ providerRunId: 'held-run', actionGrantJti: 'grant-held', idempotencyKey: 'held-key' });
const heldOrchestrator = Handoff.createProviderResumeOrchestrator({ store, adapter: {
  async resumeFromCheckpoint(input) {
    return { acceptedContinuationDigest: input.continuationDigest, sourceCount: 2, stagedCount: 1, heldCount: 1 };
  },
} });
const heldOutcome = await heldOrchestrator.resume({ token: held.internalToken, tenant, providerRunId: 'held-run', workerId, currentStateDigest: stateDigest });
assert(heldOutcome.status === 'contained' && heldOutcome.providerCompletionGreen === false, 'Held records did not reach the T1 contained terminal.');
assert(t1AllowedTerminals.has(heldOutcome.status) && heldOutcome.safeTerminal === true, 'Held provider records are outside the T1 safe terminal contract.');
assert(heldOutcome.terminalReason === 'provider-reconciliation-held-records', 'Held-record containment reason is not deterministic.');
assert(heldOutcome.autonomousBusinessApply === false && heldOutcome.productionAuthorityGranted === false && heldOutcome.vendorEngineerRequired === false, 'Held records received authority or vendor-engineer dependency.');

const badRecon = issue({ providerRunId: 'bad-recon-run', actionGrantJti: 'grant-bad-recon', idempotencyKey: 'bad-recon-key' });
const badReconOrchestrator = Handoff.createProviderResumeOrchestrator({ store, adapter: {
  async resumeFromCheckpoint(input) {
    return { acceptedContinuationDigest: input.continuationDigest, sourceCount: 3, stagedCount: 1, heldCount: 1 };
  },
} });
await expect(() => badReconOrchestrator.resume({ token: badRecon.internalToken, tenant, providerRunId: 'bad-recon-run', workerId, currentStateDigest: stateDigest }), 'WFM_PROVIDER_RESUME_RECONCILIATION');

const badCheckpoint = issue({ providerRunId: 'bad-checkpoint-run', actionGrantJti: 'grant-bad-checkpoint', idempotencyKey: 'bad-checkpoint-key' });
const badCheckpointOrchestrator = Handoff.createProviderResumeOrchestrator({ store, adapter: {
  async resumeFromCheckpoint() {
    return { acceptedContinuationDigest: sha({ offset: 0, limit: 2 }), sourceCount: 2, stagedCount: 2, heldCount: 0 };
  },
} });
await expect(() => badCheckpointOrchestrator.resume({ token: badCheckpoint.internalToken, tenant, providerRunId: 'bad-checkpoint-run', workerId, currentStateDigest: stateDigest }), 'WFM_PROVIDER_RESUME_CHECKPOINT_MISMATCH');

const expired = issue({ providerRunId: 'expired-run', actionGrantJti: 'grant-expired', idempotencyKey: 'expired-key', ttlMs: 1000 });
now += 1001;
await expect(() => store.consumeInternal({ token: expired.internalToken, tenant, providerRunId: 'expired-run', workerId, currentStateDigest: stateDigest }), 'WFM_PROVIDER_HANDOFF_EXPIRED');
now -= 1001;

await expect(() => Promise.resolve(store.issueInternal({
  actorType: 'language-model', tenant, providerRunId: 'llm-run', workerId, actionType: 'integration.retry', targetDigest,
  evidenceDigest, verificationDigest, safetyDecision, actionGrantJti: 'grant-llm', idempotencyKey: 'llm-key', nextRequest, stateDigest,
})), 'WFM_PROVIDER_HANDOFF_ACTOR');
await expect(() => Promise.resolve(store.issueInternal({
  actorType: 'deterministic-recovery-executor', tenant, providerRunId: 'payroll-run', workerId, actionType: 'payroll.write', targetDigest,
  evidenceDigest, verificationDigest, safetyDecision, actionGrantJti: 'grant-payroll', idempotencyKey: 'payroll-key', nextRequest, stateDigest,
})), 'WFM_PROVIDER_HANDOFF_ACTION');

const events = store.events({ tenant, handoffId: issued.publicReceipt.handoffId });
const eventText = JSON.stringify(events);
assert(!eventText.includes('offset') && !eventText.includes('limit'), 'Audit events leaked raw continuation.');
assert(events.map((e) => e.type).join(',') === 'handoff-issued,handoff-consumed', 'Expected append-only handoff audit events were not recorded.');

const proof = {
  status: 'PASS',
  tierAdvanced: 'T1-provider-recovery-handoff',
  canonicalExecutableSource: true,
  frozenCustomerProofArtifactMutated: false,
  exactCheckpointForwardedToNormalAdapter: true,
  pageOneRestartPreventedByContract: true,
  sameTenantEnforced: true,
  oneShotCapabilityEnforced: true,
  expiryEnforced: true,
  stateChangeInvalidatesHandoff: true,
  continuationNotExposedToPublicReceiptTokenOrAudit: true,
  duplicateBusinessOutcomeSuppressed: true,
  changedPayloadSameIdempotencyKeyDenied: true,
  reconciliationRequired: true,
  supportTierContractBound: true,
  heldRecordsReachContainedSafeTerminal: true,
  ambiguousVendorEngineerReviewTerminalDenied: true,
  directModelAuthorityDenied: true,
  payrollActionDenied: true,
  productionAuthorityGranted: false,
  claimBoundary: 'Canonical autonomy-lane executable source and synthetic Node proof only; not yet wired into or deployed with the frozen customer-proof runtime.',
};
console.log(JSON.stringify(proof, null, 2));
db.close();