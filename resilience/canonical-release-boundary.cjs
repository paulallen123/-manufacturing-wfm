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
  validateCanonicalReleasePolicy,
  createCanonicalReleaseBoundary,
};
