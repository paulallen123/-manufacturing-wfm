const REQUIRED_BRANCHES = Object.freeze([
  'integration/canonical',
  'release/staging',
  'release/production',
  'main'
]);

export function assessReleaseAuthority(branchSnapshots, requiredBranches = REQUIRED_BRANCHES) {
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
  }

  return {
    ok: failures.length === 0,
    failures,
    requiredBranches: [...requiredBranches]
  };
}

async function fetchBranch({ repository, branch, token, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/branches/${encodeURIComponent(branch)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub branch posture read failed for ${branch}: HTTP ${response.status}`);
  }

  return response.json();
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
  for (const branch of branches) {
    snapshots[branch] = await fetchBranch({ repository, branch, token, fetchImpl });
  }

  const result = assessReleaseAuthority(snapshots, branches);
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
