'use strict';

const { createHash } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function clean(value, max = 180) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
}

function validGitSha(value) {
  return /^[a-f0-9]{40}$/.test(String(value ?? '').toLowerCase());
}

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

const REQUIRED_TRUE_RULES = Object.freeze([
  'featureBranchesMayDeployOnlyToDisposablePreviewServices',
  'canonicalStagingAcceptsOnlyReleaseStagingBranch',
  'canonicalProductionAcceptsOnlyReleaseProductionBranch',
  'productionMustUseExactStagingCommit',
  'legacyPinnedShaWorkflowsAreProofOnly',
  'deletePreviewAfterMergeOrClose',
  'mainIsStagingMirrorOnly',
  'mainMustMatchReleaseStagingBeforeCanonicalDeploy',
  'canonicalRailwayCliOnlyFromReleaseWorkflow',
  'mainPromotionRequiresReleasePr',
]);

function validateCanonicalTrustAnchorGovernance(governance) {
  if (!governance || typeof governance !== 'object' || Array.isArray(governance)) {
    deny('WFM_CANONICAL_TRUST_ANCHOR_INPUT', 'Canonical trust-anchor governance evidence object is required.');
  }

  const required = {
    protected: governance.protected === true,
    pullRequestRequired: governance.pullRequestRequired === true,
    requiredApprovingReviewCount: Number.isInteger(governance.requiredApprovingReviewCount) && governance.requiredApprovingReviewCount >= 1,
    dismissStaleReviews: governance.dismissStaleReviews === true,
    requiredStatusChecksEnforced: governance.requiredStatusChecksEnforced === true,
    requiredStatusChecksStrict: governance.requiredStatusChecksStrict === true,
    requiredStatusCheckCount: Number.isInteger(governance.requiredStatusCheckCount) && governance.requiredStatusCheckCount >= 1,
    enforceAdmins: governance.enforceAdmins === true,
    allowForcePushes: governance.allowForcePushes === false,
    allowDeletions: governance.allowDeletions === false,
    bypassActorCount: governance.bypassActorCount === 0,
  };

  const failed = Object.entries(required).filter(([, passed]) => !passed).map(([key]) => key);
  if (failed.length) {
    deny('WFM_CANONICAL_TRUST_ANCHOR_GOVERNANCE', `Canonical trust anchor is not release-grade: ${failed.join(', ')}`);
  }

  const core = {
    schemaVersion: 1,
    proof: 'canonical-trust-anchor-governance',
    governanceVerified: true,
    requiredApprovingReviewCount: governance.requiredApprovingReviewCount,
    requiredStatusCheckCount: governance.requiredStatusCheckCount,
    releaseAuthorityGranted: false,
    deploymentAuthorityGranted: false,
    productionAuthorityGranted: false,
    modelAuthorityGranted: false,
    customerMutation: false,
    productionMutation: false,
  };
  return { ...core, governanceDigest: digest(core) };
}

function countNamedActors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let total = 0;
  for (const key of ['users', 'teams', 'apps']) {
    if (!Array.isArray(value[key])) return null;
    total += value[key].length;
  }
  return total;
}

function deriveCanonicalTrustAnchorGovernanceEvidence({
  branch,
  protection,
  branchReadStatus = 0,
  protectionReadStatus = 0,
  rulesetsReadStatus = 0,
  applicableRulesetCount = 0,
} = {}) {
  const branchObject = branch && typeof branch === 'object' && !Array.isArray(branch) ? branch : null;
  const protectionObject = protection && typeof protection === 'object' && !Array.isArray(protection) ? protection : null;
  const branchName = clean(branchObject?.name, 160);
  const branchSha = clean(branchObject?.commit?.sha, 40).toLowerCase();
  const protectedByBranch = branchObject?.protected === true;
  const reviews = protectionObject?.required_pull_request_reviews;
  const checks = protectionObject?.required_status_checks;
  const bypassActorCount = countNamedActors(reviews?.bypass_pull_request_allowances);
  const requiredStatusCheckCount = Array.isArray(checks?.checks)
    ? checks.checks.length
    : Array.isArray(checks?.contexts)
      ? checks.contexts.length
      : null;

  const governance = {
    protected: protectedByBranch,
    pullRequestRequired: Boolean(reviews),
    requiredApprovingReviewCount: Number.isInteger(reviews?.required_approving_review_count)
      ? reviews.required_approving_review_count
      : null,
    dismissStaleReviews: reviews?.dismiss_stale_reviews === true,
    requiredStatusChecksEnforced: Boolean(checks) && Number.isInteger(requiredStatusCheckCount) && requiredStatusCheckCount >= 1,
    requiredStatusChecksStrict: checks?.strict === true,
    requiredStatusCheckCount,
    enforceAdmins: protectionObject?.enforce_admins?.enabled === true,
    allowForcePushes: protectionObject?.allow_force_pushes?.enabled === true,
    allowDeletions: protectionObject?.allow_deletions?.enabled === true,
    bypassActorCount,
  };

  let governanceVerified = false;
  let governanceReceipt = null;
  let validationCode = null;
  let validationMessage = null;
  const completeInputs = Number(branchReadStatus) === 200
    && branchName === 'integration/canonical'
    && validGitSha(branchSha)
    && protectedByBranch
    && Number(protectionReadStatus) === 200
    && Number(rulesetsReadStatus) === 200
    && Number(applicableRulesetCount) === 0
    && Number.isInteger(bypassActorCount)
    && Number.isInteger(requiredStatusCheckCount);

  if (completeInputs) {
    try {
      governanceReceipt = validateCanonicalTrustAnchorGovernance(governance);
      governanceVerified = true;
    } catch (error) {
      validationCode = clean(error?.code || 'WFM_CANONICAL_TRUST_ANCHOR_GOVERNANCE', 120);
      validationMessage = clean(error?.message || error, 240);
    }
  } else {
    validationCode = 'WFM_CANONICAL_TRUST_ANCHOR_GOVERNANCE_EVIDENCE_INCOMPLETE';
    validationMessage = 'Canonical governance evidence is incomplete or inaccessible; release-grade governance must remain unverified.';
  }

  const core = {
    schemaVersion: 1,
    proof: 'canonical-trust-anchor-governance-evidence',
    source: 'github-rest',
    branchName,
    branchSha: validGitSha(branchSha) ? branchSha : null,
    branchReadStatus: Number(branchReadStatus) || 0,
    protectionReadStatus: Number(protectionReadStatus) || 0,
    rulesetsReadStatus: Number(rulesetsReadStatus) || 0,
    applicableRulesetCount: Number.isInteger(applicableRulesetCount) && applicableRulesetCount >= 0 ? applicableRulesetCount : null,
    governance,
    governanceVerified,
    governanceReceipt,
    validationCode,
    validationMessage,
    releaseAuthorityGranted: false,
    deploymentAuthorityGranted: false,
    productionAuthorityGranted: false,
    modelAuthorityGranted: false,
    customerMutation: false,
    productionMutation: false,
  };
  return { ...core, governanceEvidenceDigest: digest(core) };
}

function verifyCanonicalTrustAnchorGovernanceEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.schemaVersion !== 1 || value.proof !== 'canonical-trust-anchor-governance-evidence') return false;
  if (value.source !== 'github-rest' || value.branchName !== 'integration/canonical') return false;
  if (value.releaseAuthorityGranted !== false || value.deploymentAuthorityGranted !== false || value.productionAuthorityGranted !== false || value.modelAuthorityGranted !== false) return false;
  if (value.customerMutation !== false || value.productionMutation !== false) return false;
  if (value.branchSha !== null && !validGitSha(value.branchSha)) return false;
  if (!/^[a-f0-9]{64}$/.test(String(value.governanceEvidenceDigest || ''))) return false;
  const core = { ...value };
  const suppliedDigest = core.governanceEvidenceDigest;
  delete core.governanceEvidenceDigest;
  if (digest(core) !== suppliedDigest) return false;

  if (value.governanceVerified === true) {
    if (value.branchReadStatus !== 200 || value.protectionReadStatus !== 200 || !validGitSha(value.branchSha)) return false;
    try {
      const strictReceipt = validateCanonicalTrustAnchorGovernance(value.governance);
      if (!value.governanceReceipt || value.governanceReceipt.governanceDigest !== strictReceipt.governanceDigest) return false;
    } catch {
      return false;
    }
    return true;
  }

  return value.governanceReceipt === null;
}

function validateCanonicalReleasePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) deny('WFM_RELEASE_POLICY_INPUT', 'Canonical release policy object is required.');
  if (policy.schemaVersion !== 1) deny('WFM_RELEASE_POLICY_SCHEMA', 'Unsupported canonical release policy schema.');
  if (policy.sourceOfTruth !== 'github') deny('WFM_RELEASE_POLICY_SOURCE', 'GitHub must remain the release source of truth.');
  if (policy.executionProvider !== 'railway') deny('WFM_RELEASE_POLICY_PROVIDER', 'Railway must remain the canonical execution provider.');

  const branches = policy.canonicalBranches || {};
  for (const key of ['integration', 'staging', 'production']) {
    if (!clean(branches[key])) deny('WFM_RELEASE_POLICY_BRANCH', `Missing canonical ${key} branch.`);
  }
  if (new Set([branches.integration, branches.staging, branches.production]).size !== 3) {
    deny('WFM_RELEASE_POLICY_BRANCH', 'Canonical release branches must be distinct.');
  }
  if (branches.stagingDeployMirror !== 'main') deny('WFM_RELEASE_POLICY_MIRROR', 'main must remain the staging deploy mirror.');

  const rules = policy.rules || {};
  for (const key of REQUIRED_TRUE_RULES) {
    if (rules[key] !== true) deny('WFM_RELEASE_POLICY_RULE', `Required release rule is disabled: ${key}`);
  }
  if (rules.manualRailwayUpToCanonicalServices !== false) {
    deny('WFM_RELEASE_POLICY_MANUAL_DEPLOY', 'Manual Railway uploads to canonical services must remain disabled.');
  }
  if (!Number.isInteger(rules.previewTtlHours) || rules.previewTtlHours < 1 || rules.previewTtlHours > 72) {
    deny('WFM_RELEASE_POLICY_PREVIEW_TTL', 'Preview TTL must remain between 1 and 72 hours.');
  }

  const staging = policy.canonicalRailway?.staging;
  if (!staging?.projectId || !staging?.environmentId || !staging?.serviceId || !staging?.deploymentAuthority) {
    deny('WFM_RELEASE_POLICY_STAGING', 'Canonical staging target or authority is incomplete.');
  }
  if (staging.sourceBranch !== 'main') deny('WFM_RELEASE_POLICY_STAGING', 'Canonical staging must remain bound to main mirror.');
  if (staging.authorityAlias !== 'wfm-canonical-staging') deny('WFM_RELEASE_POLICY_STAGING', 'Canonical staging authority alias drifted.');

  return {
    valid: true,
    policyDigest: digest(policy),
    integrationBranch: branches.integration,
    stagingBranch: branches.staging,
    productionBranch: branches.production,
    stagingAuthority: staging.deploymentAuthority,
    productionConfigured: Boolean(policy.canonicalRailway?.production),
  };
}

function createCanonicalReleaseBoundary({ policy, sourceRef, sourceBaseSha, sourcePolicyBlobSha } = {}) {
  const validation = validateCanonicalReleasePolicy(policy);
  const baseSha = clean(sourceBaseSha, 40).toLowerCase();
  const policyBlobSha = clean(sourcePolicyBlobSha, 40).toLowerCase();
  if (!validGitSha(baseSha) || !validGitSha(policyBlobSha)) {
    deny('WFM_RELEASE_POLICY_PROVENANCE', 'Canonical policy requires git base and policy blob SHAs.');
  }
  const ref = clean(sourceRef || validation.integrationBranch, 120);
  if (ref !== validation.integrationBranch) {
    deny('WFM_RELEASE_POLICY_REF', 'Canonical release policy must be read from the integration branch.');
  }

  function assess(input = {}) {
    const actorBranch = clean(input.actorBranch, 160);
    const requestedTarget = clean(input.requestedTarget, 80);
    const executionPath = clean(input.executionPath, 220);
    const requestedCommitSha = clean(input.requestedCommitSha, 40).toLowerCase();
    const stagedCommitSha = clean(input.stagedCommitSha, 40).toLowerCase();
    const isDisposablePreview = input.isDisposablePreview === true;
    const modelAuthorityRequested = input.modelAuthorityRequested === true;

    if (!actorBranch || !requestedTarget) deny('WFM_RELEASE_REQUEST_INPUT', 'actorBranch and requestedTarget are required.');
    if (modelAuthorityRequested) {
      return receipt(false, 'model-authority-denied', { actorBranch, requestedTarget });
    }

    const branches = policy.canonicalBranches;
    const featureBranch = ![branches.integration, branches.staging, branches.production, 'main'].includes(actorBranch);

    if (requestedTarget === 'proof-only') {
      return receipt(true, 'proof-only-no-deploy-authority', { actorBranch, requestedTarget });
    }

    if (featureBranch) {
      const allowed = requestedTarget === 'disposable-preview' && isDisposablePreview;
      return receipt(allowed, allowed ? 'feature-preview-allowed' : 'feature-branch-canonical-deploy-denied', {
        actorBranch,
        requestedTarget,
        isDisposablePreview,
      });
    }

    if (requestedTarget === 'canonical-staging') {
      const allowed = actorBranch === branches.staging
        && executionPath === policy.canonicalRailway.staging.deploymentAuthority;
      return receipt(allowed, allowed ? 'canonical-staging-policy-authorised' : 'canonical-staging-authority-denied', {
        actorBranch,
        requestedTarget,
        executionPath,
      });
    }

    if (requestedTarget === 'canonical-production') {
      const production = policy.canonicalRailway?.production;
      if (!production) {
        return receipt(false, 'canonical-production-unconfigured', { actorBranch, requestedTarget });
      }
      const exactCommit = validGitSha(requestedCommitSha)
        && validGitSha(stagedCommitSha)
        && requestedCommitSha === stagedCommitSha;
      const allowed = actorBranch === branches.production
        && exactCommit
        && executionPath === production.deploymentAuthority;
      return receipt(allowed, allowed ? 'canonical-production-policy-authorised' : 'canonical-production-authority-denied', {
        actorBranch,
        requestedTarget,
        executionPath,
        exactCommit,
      });
    }

    return receipt(false, 'target-not-allowlisted', { actorBranch, requestedTarget });
  }

  function receipt(allowed, reason, detail) {
    const core = {
      schemaVersion: 1,
      allowed: allowed === true,
      reason,
      detail,
      sourceRef: ref,
      sourceBaseSha: baseSha,
      sourcePolicyBlobSha: policyBlobSha,
      policyDigest: validation.policyDigest,
      deploymentAuthorityGranted: false,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      productionMutation: false,
    };
    return { ...core, receiptDigest: digest(core) };
  }

  function verifyReceipt(value) {
    if (!value || value.deploymentAuthorityGranted !== false || value.productionAuthorityGranted !== false || value.modelAuthorityGranted !== false) return false;
    if (value.customerMutation !== false || value.productionMutation !== false) return false;
    if (value.sourceRef !== ref || value.sourceBaseSha !== baseSha || value.sourcePolicyBlobSha !== policyBlobSha || value.policyDigest !== validation.policyDigest) return false;
    const core = { ...value };
    const receiptDigest = core.receiptDigest;
    delete core.receiptDigest;
    return receiptDigest === digest(core);
  }

  return { assess, verifyReceipt, policyDigest: validation.policyDigest, validation };
}

module.exports = {
  canonical,
  digest,
  validateCanonicalTrustAnchorGovernance,
  deriveCanonicalTrustAnchorGovernanceEvidence,
  verifyCanonicalTrustAnchorGovernanceEvidence,
  validateCanonicalReleasePolicy,
  createCanonicalReleaseBoundary,
};
