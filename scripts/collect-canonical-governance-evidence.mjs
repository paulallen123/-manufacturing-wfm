import fs from 'node:fs';
import path from 'node:path';
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

const apiBase = String(process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
const token = String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
const branchName = 'integration/canonical';
const outputPath = path.resolve(
  process.env.WFM_CANONICAL_GOVERNANCE_EVIDENCE_OUTPUT
    || path.join(process.cwd(), 'canonical-governance-evidence.json'),
);
const observationPath = path.resolve(
  process.env.WFM_CANONICAL_GOVERNANCE_OBSERVATION_OUTPUT
    || path.join(path.dirname(outputPath), 'canonical-governance-observation.json'),
);
const exportEnv = process.env.WFM_CANONICAL_GOVERNANCE_EXPORT_ENV !== 'false';

function safeStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : 0;
}

async function requestJson(relativePath) {
  if (!repository || !token) {
    return { status: 0, body: null, error: 'github-provider-context-unavailable' };
  }

  try {
    const response = await fetch(`${apiBase}${relativePath}`, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'wfm-zero-engineer-governance-evidence',
      },
      redirect: 'error',
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: safeStatus(response.status), body, error: null };
  } catch (error) {
    return { status: 0, body: null, error: String(error?.message || error) };
  }
}

function appendGithubEnv(name, value) {
  const envPath = process.env.GITHUB_ENV;
  if (!exportEnv || !envPath) return;
  fs.appendFileSync(envPath, `${name}=${String(value)}\n`);
}

const encodedBranch = encodeURIComponent(branchName);
const [branchResult, protectionResult, rulesResult] = await Promise.all([
  requestJson(`/repos/${repository}/branches/${encodedBranch}`),
  requestJson(`/repos/${repository}/branches/${encodedBranch}/protection`),
  requestJson(`/repos/${repository}/rules/branches/${encodedBranch}`),
]);

const applicableRulesetCount = Array.isArray(rulesResult.body) ? rulesResult.body.length : -1;
// Preserve the requested canonical branch identity when GitHub cannot return the branch body.
// This allows a denied/not-found provider read to remain a signed, fail-closed negative observation
// instead of causing the evidence verifier itself to discard the diagnostic context.
const branchForEvidence = branchResult.status === 200
  ? branchResult.body
  : { name: branchName, protected: false, commit: { sha: null } };
const evidence = deriveCanonicalTrustAnchorGovernanceEvidence({
  branch: branchForEvidence,
  protection: protectionResult.body,
  branchReadStatus: branchResult.status,
  protectionReadStatus: protectionResult.status,
  rulesetsReadStatus: rulesResult.status,
  applicableRulesetCount,
});

if (!verifyCanonicalTrustAnchorGovernanceEvidence(evidence)) {
  throw new Error('Derived canonical governance evidence failed self-verification.');
}
const observation = createCanonicalGovernanceObservation(evidence);
if (!verifyCanonicalGovernanceObservation(evidence, observation)) {
  throw new Error('Derived canonical governance observation failed self-verification.');
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.dirname(observationPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
fs.writeFileSync(observationPath, `${JSON.stringify(observation, null, 2)}\n`);

appendGithubEnv('WFM_CANONICAL_GOVERNANCE_EVIDENCE_FILE', outputPath);
appendGithubEnv('WFM_CANONICAL_GOVERNANCE_EVIDENCE_DIGEST', evidence.governanceEvidenceDigest);
appendGithubEnv('WFM_CANONICAL_GOVERNANCE_OBSERVATION_FILE', observationPath);
appendGithubEnv('WFM_CANONICAL_GOVERNANCE_OBSERVATION_DIGEST', observation.observationDigest);
appendGithubEnv('WFM_CANONICAL_GOVERNANCE_ASSESSMENT', observation.assessment);
appendGithubEnv('WFM_CANONICAL_GOVERNANCE_BLOCKER_CLASS', observation.blockerClass);
appendGithubEnv('WFM_CANONICAL_TRUST_ANCHOR_PROTECTED', evidence.governance?.protected === true ? 'true' : 'false');
appendGithubEnv('WFM_CANONICAL_TRUST_ANCHOR_GOVERNANCE_VERIFIED', evidence.governanceVerified === true ? 'true' : 'false');

console.log(JSON.stringify({
  proof: evidence.proof,
  branchName: evidence.branchName,
  branchSha: evidence.branchSha,
  branchReadStatus: evidence.branchReadStatus,
  protectionReadStatus: evidence.protectionReadStatus,
  rulesetsReadStatus: evidence.rulesetsReadStatus,
  applicableRulesetCount: evidence.applicableRulesetCount,
  protected: evidence.governance?.protected === true,
  governanceVerified: evidence.governanceVerified === true,
  governanceEvidenceDigest: evidence.governanceEvidenceDigest,
  validationCode: evidence.validationCode,
  governanceObservation: {
    assessment: observation.assessment,
    blockerClass: observation.blockerClass,
    confidence: observation.confidence,
    observationDigest: observation.observationDigest,
  },
  providerErrors: {
    branch: branchResult.error,
    protection: protectionResult.error,
    rules: rulesResult.error,
  },
  releaseAuthorityGranted: false,
  deploymentAuthorityGranted: false,
  productionAuthorityGranted: false,
  modelAuthorityGranted: false,
}, null, 2));
