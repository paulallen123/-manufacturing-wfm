# GitHub / CI resilience runbook

## Objective

GitHub may remain the canonical source repository, but GitHub Actions must never be the only proof path and GitHub availability must never be confused with product correctness.

## Current enforced repository design

- The zero-useful-foothold proof command is provider-neutral: `node scripts/validate-zero-useful-foothold.mjs`.
- GitHub Actions and the CircleCI consolidated runner execute the same proof logic.
- Proof receipts bind the exact source commit.
- A run with zero executable steps is `INFRASTRUCTURE_UNAVAILABLE`, never product PASS or product FAIL.
- Same-provider retries do not count as independent release proof.
- Customer release requires two independent executed proof passes.
- Automatic paid retries remain disabled under the no-new-spend rule.
- Off-GitHub source backup and a clean restore drill are required before customer-release recovery can be claimed.

## GitHub admin settings still required

The connected automation can verify these settings but cannot currently create repository rulesets or authorize CircleCI's GitHub Checks App.

### 1. Enable CircleCI GitHub Checks

In CircleCI Cloud:

1. Open **Org**.
2. Open **VCS Connections**.
3. Choose **Manage GitHub Checks**.
4. Grant the CircleCI Checks GitHub App access to `paulallen123/-manufacturing-wfm`.
5. Trigger the branch once and confirm a CircleCI workflow check is reported on the exact commit SHA.

Do not guess the required-check name in GitHub. After CircleCI reports its first successful workflow check, select that exact check and its CircleCI App as the expected source.

### 2. Activate a ruleset for `main`

Create an **Active** branch ruleset targeting the default branch and require:

- pull request before merge;
- signed/verified commits;
- the independent CircleCI workflow check from the CircleCI App;
- no force pushes;
- no branch deletion;
- no bypass except an explicitly governed recovery authority;
- latest-commit status evidence before merge.

GitHub Actions should remain an additional proof provider, not the only required merge check while runner-admission reliability is degraded.

### 3. Independent source backup

From a clean checkout with all required refs available, run:

```bash
bash scripts/create-verified-repository-backup.sh ./backup-artifacts
```

Then move the bundle and receipt to storage that is operationally independent of GitHub. Do not store the only backup in GitHub Actions artifacts.

### 4. Restore drill

A backup does not count as recovery proof until a clean environment can:

1. retrieve the external bundle;
2. verify its SHA-256 receipt;
3. clone/restore from the bundle without using GitHub;
4. run `git fsck --full --strict`;
5. execute the canonical proof suite against the restored exact commit;
6. compare produced proof hashes with the expected release evidence.

Preserve the restore receipt outside GitHub.

## Failure classification

| Observation | Classification | Release effect |
|---|---|---|
| No executable CI steps | INFRASTRUCTURE_UNAVAILABLE | Does not count PASS or FAIL |
| Tests executed and failed | EXECUTED_FAIL | Blocks candidate |
| Tests pass but receipt missing | UNPROVEN | Blocks release proof |
| Receipt commit != candidate commit | EVIDENCE_IDENTITY_MISMATCH | Blocks candidate |
| One provider passes | UNPROVEN | Continue development; release quorum not met |
| Two independent providers pass exact candidate | PROVEN | CI quorum satisfied; other release gates still apply |

## Security boundary

Do not solve availability by adding a persistent privileged self-hosted runner. If a private runner is ever introduced, it must be single-job/ephemeral, start from a clean image, have minimal network reach, hold no reusable credentials, and export logs/evidence externally before destruction.
