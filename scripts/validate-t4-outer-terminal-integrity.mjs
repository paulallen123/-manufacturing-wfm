import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAutonomyControlLoop, digest } = require('../resilience/autonomy-control-loop.cjs');

const d = (value) => createHash('sha256').update(String(value)).digest('hex');
const contract = {
  tiers: {
    T0: { allowed_terminal_outcomes: ['answered', 'safe_abstention', 'contained'] },
    T1: { allowed_terminal_outcomes: ['recovered', 'contained', 'external_provider_authorisation_required'], allowlisted_action_prefixes: [] },
    T2: { allowed_terminal_outcomes: ['contained', 'verified_candidate_staged'] },
    T3: { allowed_terminal_outcomes: ['contained', 'customer_authorisation_required'] },
    T4: { allowed_terminal_outcomes: ['contained', 'rolled_back_to_known_good', 'security_or_legal_authority_required'] },
  },
  scenario_tier_overrides: { 'data-integrity-mismatch': 'T4' },
  category_defaults: {},
};
const failureScenarios = {
  scenarios: [{ id: 'data-integrity-mismatch', category: 'security' }],
};
const base = {
  tenant: 'tenant-a',
  scenarioId: 'data-integrity-mismatch',
  evidenceDigest: d('t4-terminal-evidence'),
};
let tick = 1000;

const verifiedController = {
  handle: async () => ({
    safeTerminal: true,
    outcome: 'contained',
    productionAuthorityGranted: false,
    modelAuthorityGranted: false,
    customerMutation: false,
    crossTenantMutation: false,
    requestedActionExecuted: false,
    receiptDigest: d('verified-inner-t4-receipt'),
  }),
  verifyReceipt: (receipt) => receipt?.receiptDigest === d('verified-inner-t4-receipt'),
};
const verifiedLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  t4ContainmentController: verifiedController,
  now: () => ++tick,
});
const verified = await verifiedLoop.run({ ...base, incidentId: 'inc-t4-verified' });
assert.equal(verified.safeTerminal, true);
assert.equal(verifiedLoop.verifyReceipt(verified), true);

const failedForensicsController = {
  handle: async () => {
    const error = new Error('forensic read-back failed');
    error.code = 'WFM_T4_FORENSICS_VERIFY';
    throw error;
  },
  verifyReceipt: () => false,
};
const failedForensicsLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  t4ContainmentController: failedForensicsController,
  now: () => ++tick,
});
const failedForensics = await failedForensicsLoop.run({ ...base, incidentId: 'inc-t4-forensics-failed' });
assert.equal(failedForensics.outcome, 'contained');
assert.equal(failedForensics.safeTerminal, false);
assert.equal(failedForensics.containedErrorCode, 'WFM_T4_FORENSICS_VERIFY');
assert.equal(failedForensicsLoop.verifyReceipt(failedForensics), true);
assert.ok(failedForensics.trace.some((event) => event.type === 't4-safe-terminal-not-established'));

const missingControllerLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  now: () => ++tick,
});
const missingController = await missingControllerLoop.run({ ...base, incidentId: 'inc-t4-controller-missing' });
assert.equal(missingController.outcome, 'contained');
assert.equal(missingController.safeTerminal, false);
assert.equal(missingControllerLoop.verifyReceipt(missingController), true);

const authorityEscapeController = {
  handle: async () => ({
    safeTerminal: true,
    outcome: 'contained',
    productionAuthorityGranted: true,
    modelAuthorityGranted: false,
    customerMutation: false,
    crossTenantMutation: false,
    requestedActionExecuted: false,
    receiptDigest: d('hostile-inner-t4-receipt'),
  }),
  verifyReceipt: () => true,
};
const authorityEscapeLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  t4ContainmentController: authorityEscapeController,
  now: () => ++tick,
});
const authorityEscape = await authorityEscapeLoop.run({ ...base, incidentId: 'inc-t4-authority-escape' });
assert.equal(authorityEscape.safeTerminal, false);
assert.equal(authorityEscape.containedErrorCode, 'WFM_AUTONOMY_T4_AUTHORITY');
assert.equal(authorityEscapeLoop.verifyReceipt(authorityEscape), true);

const forged = structuredClone(missingController);
forged.safeTerminal = true;
const forgedCore = { ...forged };
delete forgedCore.receiptDigest;
forged.receiptDigest = digest(forgedCore);
assert.equal(missingControllerLoop.verifyReceipt(forged), false, 'Semantic verification must reject a recomputed T4 safe-terminal claim without a verified inner T4 receipt.');

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 't4-outer-terminal-integrity',
  status: 'PASS',
  verifiedT4MayClaimSafeTerminal: true,
  failedForensicsCannotClaimSafeTerminal: true,
  missingControllerCannotClaimSafeTerminal: true,
  authorityEscapeCannotClaimSafeTerminal: true,
  recomputedSemanticForgeryRejected: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
