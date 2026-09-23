#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));

const contract = json('release/t9-trust-spine-contract.json');
assert.equal(contract.id, 'VECTOR_T9_TRUST_SPINE_V1');
assert.equal(contract.target, 'T9 candidate');
assert.equal(contract.principles.reasoningMayWriteDirectly, false);
assert.equal(contract.principles.authorityMaySelfExpand, false);
assert.equal(contract.principles.unknownsReduceAutonomy, true);
assert.equal(contract.principles.verificationIsIndependent, true);
assert.equal(contract.principles.learningMaySelfPromote, false);
assert.ok(contract.claimBoundary.fridayMustNotClaim.includes('production-grade T9'));

const trust = read('trust/runtime/vector-trust-spine.cjs');
for (const symbol of ['EvidenceLedger','UnknownsEngine','CustomerGuardian','AuthorityKernel','TypedActionGateway','createCausalEpisode']) {
  assert.match(trust, new RegExp('\\b' + symbol + '\\b'), 'T9 trust spine missing ' + symbol);
}
assert.match(trust, /Actors cannot grant authority to themselves/);
assert.match(trust, /Independent verifier identity mismatch/);
assert.match(trust, /CONTAINMENT_ONLY/);

const autopilot = read('operations/runtime/autopilot-execution-engine.cjs');
assert.match(autopilot, /require\('\.\/t9-autopilot-adapter\.cjs'\)/, 'Autopilot is not routed through T9 adapter.');
assert.match(autopilot, /executeT9AutopilotAction/, 'Autopilot T9 execution call is missing.');
assert.doesNotMatch(autopilot, /applied=lifecycle\.applyTrustedEvent\(/, 'Autopilot regained a direct lifecycle write bypass.');

const support = read('trust/runtime/vector-t9-support-adapter.cjs');
assert.match(support, /EvidenceLedger/);
assert.match(support, /createCausalEpisode/);
assert.match(support, /safeTerminal/);
assert.match(support, /HYPOTHESIS_REQUIRES_COUNTERFACTUAL_SUPPORT/);
assert.match(support, /may have contributed/, 'Support learning must remain hypothesis language.');

const dockerfile = read('Dockerfile');
for (const required of [
  'trust/runtime/vector-trust-spine.test.cjs',
  'operations/runtime/t9-autopilot-adapter.test.cjs',
  'trust/runtime/vector-t9-support-adapter.test.cjs',
  'operations/runtime/t9-autopilot-adapter.cjs',
  'trust/runtime/vector-trust-spine.cjs'
]) assert.ok(dockerfile.includes(required), 'Dockerfile T9 admission/runtime coverage missing: ' + required);

const ci = read('scripts/run-forge-ci.mjs');
for (const required of [
  'scripts/validate-t9-candidate.mjs',
  'trust/runtime/vector-trust-spine.test.cjs',
  'operations/runtime/t9-autopilot-adapter.test.cjs',
  'trust/runtime/vector-t9-support-adapter.test.cjs',
  'operations/runtime/autopilot-execution-engine.test.cjs'
]) assert.ok(ci.includes(required), 'Canonical CI T9 coverage missing: ' + required);

const supportContract = json('resilience/support-tier-contract.json');
assert.equal(supportContract.global_invariants.language_model_direct_authority, false);
assert.equal(supportContract.global_invariants.cross_tenant_action_allowed, false);
assert.equal(supportContract.global_invariants.production_experimentation_for_unknown_faults, false);

console.log(JSON.stringify({
  status: 'PASS',
  contract: contract.id,
  autopilotGoverned: true,
  supportEvidenceBound: true,
  unknownsFailClosed: true,
  selfAuthorityExpansion: false,
  independentVerificationRequired: true,
  claim: 'T9 candidate admission only; production-grade T9 remains outside this proof.'
}, null, 2));
