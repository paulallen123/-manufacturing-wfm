const REQUIRED_BRANCHES = Object.freeze([
  'integration/canonical',
  'release/staging',
  'release/production',
  'main'
]);

const REQUIRED_RULE_TYPES = Object.freeze([
  'deletion',
  'non_fast_forward',
  'pull_request',
  'required_signatures',
  'required_status_checks'
]);

function assessBranchRules(branch, rules, failures) {
  if (!Array.isArray(rules)) {
    failures.push(`${branch}: active branch-rule evidence is missing`);
    return;
  }

  const byType = new Map(rules.map((rule) => [rule?.type, rule]));
  for (const type of REQUIRED_RULE_TYPES) {
    if (!byType.has(type)) {
      failures.push(`${branch}: required ${type} rule is missing`);
    }
  }

  const pullRequest = byType.get('pull_request');
  if (pullRequest) {
    const parameters = pullRequest.parameters ?? {};
    if (!Number.isInteger(parameters.required_approving_review_count) || parameters.required_approving_review_count < 1) {
      failures.push(`${branch}: pull requests do not require an independent approval`);
    }
    if (parameters.dismiss_stale_reviews_on_push !== true) {
      failures.push(`${branch}: stale approvals are not dismissed after new commits`);
    }
    if (parameters.require_last_push_approval !== true) {
      failures.push(`${branch}: the last reviewable push does not require fresh approval`);
    }
  }

  const statusChecks = byType.get('required_status_checks');
  if (statusChecks) {
    const parameters = statusChecks.parameters ?? {};
    if (parameters.strict_required_status_checks_policy !== true) {
      failures.push(`${branch}: required checks are not strict against the latest branch state`);
    }
    if (!Array.isArray(parameters.required_status_checks) || parameters.required_status_checks.length === 0) {
      failures.push(`${branch}: no required status checks are configured`);
    }
  }
}

export function assessReleaseAuthority(
  branchSnapshots,
  requiredBranches = REQUIRED_BRANCHES,
  branchRules = {}
) {
  const failures = [];

  for (const branch of requiredBranches) {
    const snapshot = branchSnapshots?.[branch];
    if (!snapshot) {
      failures.push(`${branch}: branch posture evidence is missing`);
      continue;
    }

    if (snapshot.protected !== true) {
      failures.push(`${branch}: branch is not protected`);
    }

    const verification = snapshot.commit?.commit?.verification;
    if (verification?.verified !== true) {
      failures.push(`${branch}: branch head is not cryptographically verified`);
    }

    assessBranchRules(branch, branchRules?.[branch], failures);
  }

  return {
    ok: failures.length === 0,
    failures,
    requiredBranches: [...requiredBranches]
  };
}

async function fetchJson(url, { token, fetchImpl, description }) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!response.ok) {
    throw new Error(`${description}: HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchBranch({ repository, branch, token, fetchImpl = fetch }) {
  return fetchJson(
    `https://api.github.com/repos/${repository}/branches/${encodeURIComponent(branch)}`,
    { token, fetchImpl, description: `GitHub branch posture read failed for ${branch}` }
  );
}

async function fetchBranchRules({ repository, branch, token, fetchImpl = fetch }) {
  return fetchJson(
    `https://api.github.com/repos/${repository}/rules/branches/${encodeURIComponent(branch)}`,
    { token, fetchImpl, description: `GitHub active-rule read failed for ${branch}` }
  );
}

export async function verifyReleaseAuthority({
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  branches = REQUIRED_BRANCHES,
  fetchImpl = fetch
} = {}) {
  if (!repository) throw new Error('GITHUB_REPOSITORY is required.');
  if (!token) throw new Error('A GitHub token is required for release-authority verification.');

  const snapshots = {};
  const rules = {};
  for (const branch of branches) {
    snapshots[branch] = await fetchBranch({ repository, branch, token, fetchImpl });
    rules[branch] = await fetchBranchRules({ repository, branch, token, fetchImpl });
  }

  const result = assessReleaseAuthority(snapshots, branches, rules);
  if (!result.ok) {
    throw new Error(`Release authority posture is unsafe:\n- ${result.failures.join('\n- ')}`);
  }

  return result;
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  verifyReleaseAuthority()
    .then(() => console.log('GITHUB_RELEASE_AUTHORITY=PASS'))
    .catch((error) => {
      console.error(`GITHUB_RELEASE_AUTHORITY=FAIL ${error.message}`);
      process.exitCode = 1;
    });
}
