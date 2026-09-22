'use strict';

const { createHash } = require('node:crypto');
const {
  verifyCanonicalTrustAnchorGovernanceEvidence,
} = require('./canonical-release-boundary.cjs');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isAccessDenied(status) {
  return status === 401 || status === 403;
}

function classifyGovernanceEvidence(evidence) {
  if (!verifyCanonicalTrustAnchorGovernanceEvidence(evidence)) {
    deny('WFM_CANONICAL_GOVERNANCE_OBSERVATION_EVIDENCE', 'Verified canonical governance evidence is required.');
  }

  if (evidence.governanceVerified === true) {
    return {
      assessment: 'verified-release-grade-governance',
      blockerClass: 'none',
      confidence: 'evidence-bound',
    };
  }

  const branchStatus = Number(evidence.branchReadStatus) || 0;
  const protectionStatus = Number(evidence.protectionReadStatus) || 0;
  const rulesetsStatus = Number(evidence.rulesetsReadStatus) || 0;
  const applicableRulesetCount = Number.isInteger(evidence.applicableRulesetCount)
    ? evidence.applicableRulesetCount
    : null;

  if ([branchStatus, protectionStatus, rulesetsStatus].some(isAccessDenied)) {
    return {
      assessment: 'provider-access-denied',
      blockerClass: 'provider-permission',
      confidence: 'evidence-bound',
    };
  }

  if (branchStatus === 404) {
    return {
      assessment: 'canonical-branch-not-found',
      blockerClass: 'canonical-branch',
      confidence: 'evidence-bound',
    };
  }

  if (branchStatus === 200 && evidence.governance?.protected !== true) {
    return {
      assessment: 'canonical-branch-unprotected',
      blockerClass: 'branch-governance',
      confidence: 'evidence-bound',
    };
  }

  if (rulesetsStatus === 200 && Number.isInteger(applicableRulesetCount) && applicableRulesetCount > 0) {
    return {
      assessment: 'ruleset-governance-unvalidated',
      blockerClass: 'verifier-capability',
      confidence: 'evidence-bound',
    };
  }

  if (protectionStatus === 404) {
    return {
      assessment: 'classic-protection-not-established',
      blockerClass: 'branch-governance',
      confidence: 'evidence-bound',
    };
  }

  if (evidence.validationCode === 'WFM_CANONICAL_TRUST_ANCHOR_GOVERNANCE') {
    return {
      assessment: 'governance-policy-noncompliant',
      blockerClass: 'branch-governance',
      confidence: 'evidence-bound',
    };
  }

  if (branchStatus !== 200 || protectionStatus !== 200 || rulesetsStatus !== 200) {
    return {
      assessment: 'provider-evidence-incomplete',
      blockerClass: 'provider-evidence',
      confidence: 'evidence-bound',
    };
  }

  return {
    assessment: 'governance-evidence-incomplete',
    blockerClass: 'governance-evidence',
    confidence: 'evidence-bound',
  };
}

function createCanonicalGovernanceObservation(evidence) {
  const classification = classifyGovernanceEvidence(evidence);
  const core = {
    schemaVersion: 1,
    proof: 'canonical-governance-observation',
    evidenceDigest: evidence.governanceEvidenceDigest,
    branchName: evidence.branchName,
    branchSha: evidence.branchSha,
    governanceVerified: evidence.governanceVerified === true,
    assessment: classification.assessment,
    blockerClass: classification.blockerClass,
    confidence: classification.confidence,
    releaseAuthorityGranted: false,
    deploymentAuthorityGranted: false,
    productionAuthorityGranted: false,
    modelAuthorityGranted: false,
    automaticGovernanceMutation: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    productionMutation: false,
  };
  return { ...core, observationDigest: digest(core) };
}

function verifyCanonicalGovernanceObservation(evidence, observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return false;
  if (!verifyCanonicalTrustAnchorGovernanceEvidence(evidence)) return false;
  let expected;
  try {
    expected = createCanonicalGovernanceObservation(evidence);
  } catch {
    return false;
  }
  return canonical(expected) === canonical(observation);
}

module.exports = {
  classifyGovernanceEvidence,
  createCanonicalGovernanceObservation,
  verifyCanonicalGovernanceObservation,
};
