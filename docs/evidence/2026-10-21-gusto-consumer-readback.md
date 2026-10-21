# Gusto consumer denial and recovery contract — lane7

Status: TESTED and independently reviewed in isolation. Proof-only delta; no product source change, canonical integration, image admission, deployment, provider acceptance or customer-readiness claim.

## Requirement and ownership

Issue #202 integration evidence standard and #265 integration/source binding/reconnect requirements motivate this composed consumer gate. #288 intake was inspected; its historical frozen identities do not replace the freshly verified canonical base. PR #369 reconciliation proof and lane1 identity/batch work were excluded.

Reservation: https://github.com/paulallen123/-manufacturing-wfm/issues/288#issuecomment-6315220390 . Only two new files are reserved: this report and `integration/runtime/gusto-consumer-readback.test.cjs`. Open Gusto PR search found #278; its actual seven-file diff concerns Integration Fabric provider certification, not this hub consumer contract. No focused reservation was found in checked intake. No AGENTS.md or .agents skill files were present in this worktree; /workspace/.agents was empty. This is a bounded check, not a claim of visibility into all external workers.

Sole integration/release owner: task `01a15e4a-0bc0-7093-84bf-e963f7750039`. No protected freeze trigger, canonical branch, provider credential, real personnel/payroll record or hosted service was changed.

## Exact source and runtime

Canonical branch `release/vector-customer-ready-candidate-20260925` was freshly verified with `git ls-remote origin refs/heads/release/vector-customer-ready-candidate-20260925` before tests and again afterward: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.

Git blobs under test:
- Existing hub: `6fe9175c52be2bfe94e2e78a2002e9666fe49fe9`.
- Existing Gusto connector: `b53fb02bb707f876b579294ffa93c978fd41da97`.
- New consumer test: `e5b7aae020638f010afe79b5dcd874ddae11fb6d`.

Runtime: Node `v24.19.0`, Linux local workspace. The test reuses the fixture approach from existing `gusto-integration-hub.test.cjs`, exercises the actual hub/connector code with injected synthetic provider responses, and stores data in temporary SQLite removed at test teardown. Provider I/O never leaves the injected function. The only synthetic POST provider path is the fixture OAuth exchange; company reads use GET.

## Added proof

For each token-info denial (403, wrong company UUID, missing companies-read scope):
1. Establish a synthetic authorized connection and validated mapping/sync through existing handlers; verify readiness true.
2. Invoke the Gusto verification handler and assert the precise safe 403 error.
3. Read status through a separately seeded authenticated session; require REAUTH_REQUIRED, absent verified Gusto metadata and readiness false while preserving the historical sync timestamp.
4. Close/reopen the real hub and SQLite file and repeat that readback; another tenant sees no connections.
5. Reject a healthy worker attestation from restoring readiness without provider verification.
6. Restore the synthetic provider response; verification succeeds but returns dataSynced=false/payrollProof=false and remains VALIDATING after reopening.

Existing connector tests cover revocation in isolation. Existing hub tests cover initial authorization and configuration drift. Neither already covers this complete denial-to-consumer-state-to-recovery transition.

## Commands and results

- `node --test integration/runtime/gusto-consumer-readback.test.cjs`: initial 3/3 pass, 0 fail/skip; after second-session handler readback was added, the combined suite below passed.
- `node --test integration/runtime/gusto-consumer-readback.test.cjs integration/runtime/gusto-company-connector.test.cjs integration/runtime/gusto-integration-hub.test.cjs`: 40/40 pass, 0 fail/skip, exit 0; 10.34 seconds. Raw local log `/tmp/lane7-combined.tap`.
- Mutation probe: copied runtime files into `/tmp/lane7-consumer-mutant` and removed only the hub's persisted `updateConnectionState.run('REAUTH_REQUIRED', ...)` call in that disposable copy. `node --test /tmp/lane7-consumer-mutant/gusto-consumer-readback.test.cjs`: 0/3 pass, 3 expected failures, exit 1, each detects missing admin-action transition (0 !== 1). Raw local log `/tmp/lane7-mutant.tap`. Repository source was never mutated.
- `git diff --check`: pass.
- Independent read-only reviewer `/root/review_lane7` reviewed the exact new-test blob above and actual source. Its separate focused run on Node v24.19.0 passed 3/3, no failures/skips, exit 0. No material defect found; composed coverage confirmed distinct. No formal GitHub approval claimed.

Tool/access failures: initial git status from /workspace failed because it was not the repository. GitHub CLI issue/PR reads were Forbidden; connected GitHub tools supplied issue/PR evidence instead. Initial connector calls with mismatched argument names failed before execution; corrected calls succeeded. #265 comments retrieval had a transport failure; its authoritative issue body and relevant #288 ownership evidence were read. These did not affect test execution. There were no unexpected test failures.

## Limits and handoff

This is in-process HTTP-handler execution, not actual HTTP transport. Closing/reopening the hub/database is not a process/container restart. The second session is preseeded, not a fresh login. Fixture source records and OAuth values do not establish real provider authentication or payroll accuracy. No Node 22, image, hosted, browser, live provider, or customer test ran.

The release owner may adopt these two new files, rerun on the exact composed candidate/runtime, then perform approved transport/image/fresh-login/audit and provider evidence gates. This package cannot close #202/#265 or confer release authority. No approval is pending for this completed local proof; canonical adoption and broader proof remain outside lane7 scope.
