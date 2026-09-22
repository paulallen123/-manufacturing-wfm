import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  deriveCanonicalTrustAnchorGovernanceEvidence,
  verifyCanonicalTrustAnchorGovernanceEvidence,
} = require('../resilience/canonical-release-boundary.cjs');
const {
  createCanonicalGovernanceObservation,
  verifyCanonicalGovernanceObservation,
} = require('../resilience/canonical-governance-observation.cjs');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function reseal(observation) {
  const core = { ...observation };
  delete core.observationDigest;
  return {
    ...core,
    observationDigest: createHash('sha256').update(canonical(core)).digest('hex'),
  };
}

const branch = {
  name: 'integration/canonical',
  protected: true,
  commit: { sha: 'a'.repeat(40) },
};
const protection = {
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
    bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
  },
  required_status_checks: {
    strict: true,
    checks: [{ context: 'WFM zero-engineer support contract', app_id: 1 }],
  },
  enforce_admins: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
};

function evidence(overrides = {}) {
  return deriveCanonicalTrustAnchorGovernanceEvidence({
    branch,
    protection,
    branchReadStatus: 200,
    protectionReadStatus: 200,
    rulesetsReadStatus: 200,
    applicableRulesetCount: 0,
    ...overrides,
  });
}

let cases = 0;
function check(name, fn) {
  fn();
  cases += 1;
  process.stdout.write(`PASS ${name}\n`);
}

check('verified governance is observed without authority', () => {
  const input = evidence();
  const receipt = createCanonicalGovernanceObservation(input);
  assert.equal(input.governanceVerified, true);
  assert.equal(receipt.assessment, 'verified-release-grade-governance');
  assert.equal(receipt.blockerClass, 'none');
  assert.equal(receipt.releaseAuthorityGranted, false);
  assert.equal(receipt.productionAuthorityGranted, false);
  assert.equal(receipt.modelAuthorityGranted, false);
  assert.equal(verifyCanonicalGovernanceObservation(input, receipt), true);
});

check('branch provider denial survives as negative evidence', () => {
  const input = evidence({
    branch: { name: 'integration/canonical', protected: false, commit: { sha: null } },
    protection: null,
    branchReadStatus: 403,
    protectionReadStatus: 0,
  });
  assert.equal(verifyCanonicalTrustAnchorGovernanceEvidence(input), true);
  const receipt = createCanonicalGovernanceObservation(input);
  assert.equal(receipt.assessment, 'provider-access-denied');
  assert.equal(receipt.blockerClass, 'provider-permission');
  assert.equal(verifyCanonicalGovernanceObservation(input, receipt), true);
});

check('missing canonical branch is diagnosable without release authority', () => {
  const input = evidence({
    branch: { name: 'integration/canonical', protected: false, commit: { sha: null } },
    protection: null,
    branchReadStatus: 404,
    protectionReadStatus: 0,
  });
  const receipt = createCanonicalGovernanceObservation(input);
  assert.equal(receipt.assessment, 'canonical-branch-not-found');
  assert.equal(receipt.releaseAuthorityGranted, false);
  assert.equal(verifyCanonicalGovernanceObservation(input, receipt), true);
});

check('unprotected branch is distinct from provider failure', () => {
  const input = evidence({
    branch: { ...branch, protected: false },
    protection: null,
    protectionReadStatus: 404,
  });
  const receipt = createCanonicalGovernanceObservation(input);
  assert.equal(receipt.assessment, 'canonical-branch-unprotected');
  assert.equal(receipt.blockerClass, 'branch-governance');
});

check('applicable ruleset remains unvalidated rather than trusted', () => {
  const input = evidence({ applicableRulesetCount: 1 });
  const receipt = createCanonicalGovernanceObservation(input);
  assert.equal(input.governanceVerified, false);
  assert.equal(receipt.assessment, 'ruleset-governance-unvalidated');
  assert.equal(receipt.blockerClass, 'verifier-capability');
  assert.equal(receipt.releaseAuthorityGranted, false);
});

check('missing classic protection is explicit', () => {
  const input = evidence({ protection: null, protectionReadStatus: 404 });
  const receipt = createCanonicalGovernanceObservation(input);
  assert.equal(receipt.assessment, 'classic-protection-not-established');
  assert.equal(receipt.blockerClass, 'branch-governance');
});

check('noncompliant classic protection is explicit', () => {
  const weak = structuredClone(protection);
  weak.enforce_admins.enabled = false;
  const input = evidence({ protection: weak });
  const receipt = createCanonicalGovernanceObservation(input);
  assert.equal(input.validationCode, 'WFM_CANONICAL_TRUST_ANCHOR_GOVERNANCE');
  assert.equal(receipt.assessment, 'governance-policy-noncompliant');
  assert.equal(receipt.blockerClass, 'branch-governance');
});

check('provider evidence failure remains fail closed', () => {
  const input = evidence({ rulesetsReadStatus: 500 });
  const receipt = createCanonicalGovernanceObservation(input);
  assert.equal(receipt.assessment, 'provider-evidence-incomplete');
  assert.equal(receipt.governanceVerified, false);
  assert.equal(receipt.releaseAuthorityGranted, false);
});

check('protection access denial is distinct from policy failure', () => {
  const input = evidence({ protection: null, protectionReadStatus: 403 });
  const receipt = createCanonicalGovernanceObservation(input);
  assert.equal(receipt.assessment, 'provider-access-denied');
  assert.equal(receipt.blockerClass, 'provider-permission');
});

check('tampered source evidence is rejected', () => {
  const input = evidence();
  input.governance.requiredApprovingReviewCount = 0;
  assert.equal(verifyCanonicalTrustAnchorGovernanceEvidence(input), false);
  assert.throws(
    () => createCanonicalGovernanceObservation(input),
    (error) => error?.code === 'WFM_CANONICAL_GOVERNANCE_OBSERVATION_EVIDENCE',
  );
});

check('assessment substitution is rejected', () => {
  const input = evidence({ applicableRulesetCount: 1 });
  const receipt = createCanonicalGovernanceObservation(input);
  const forged = reseal({ ...receipt, assessment: 'verified-release-grade-governance', blockerClass: 'none' });
  assert.equal(verifyCanonicalGovernanceObservation(input, forged), false);
});

check('authority escalation remains rejected even after reseal', () => {
  const input = evidence();
  const receipt = createCanonicalGovernanceObservation(input);
  const forged = reseal({ ...receipt, releaseAuthorityGranted: true, modelAuthorityGranted: true });
  assert.equal(verifyCanonicalGovernanceObservation(input, forged), false);
});

check('observation cannot be replayed against different evidence', () => {
  const first = evidence();
  const second = evidence({ applicableRulesetCount: 1 });
  const receipt = createCanonicalGovernanceObservation(first);
  assert.equal(verifyCanonicalGovernanceObservation(second, receipt), false);
});

console.log(JSON.stringify({
  proof: 'canonical-governance-observation-validator',
  cases,
  pass: true,
  releaseAuthorityGranted: false,
  deploymentAuthorityGranted: false,
  productionAuthorityGranted: false,
  modelAuthorityGranted: false,
  automaticGovernanceMutation: false,
}, null, 2));
