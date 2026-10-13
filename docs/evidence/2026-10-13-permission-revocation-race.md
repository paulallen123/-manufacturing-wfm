# Issue #265 permission revocation race: bounded proof package

## Requirement and source

Issue #265 lists a permission revocation race as an unclosed exact-candidate security gate. `security/runtime/identity-survival-guard.cjs` and its tests cover sequential policy-version change, tenant session epoch, and privileged freeze. They do not establish what happens when a request overlaps a permission revocation. The 2026-10-13 canonical branch head checked for this package was `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` on `release/vector-customer-ready-candidate-20260925`.

## Owner and conflict check

The established sole canonical implementation/integration owner remains responsible for adoption, exact-image admission, deployment and hosted proof. Current issue #265 and #288 records, visible active VECTOR chats, open PR search, and branch searches for permission/race/revocation found no focused package for the in-flight gate when this work began. PR #398 appeared on recheck and binds **later** requests to current role/permissions; its description explicitly leaves the in-flight action race open. PR #390 tests logout session revocation; PRs #378 and #396 test payroll role/tenant denial. This branch adds only a pure, read-only oracle and synthetic tests. It creates no application route, writer, control-plane mutation, runner or deployment.

## Exact package

- Base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.
- Branch: `codex/permission-revocation-race-oracle-20261013`.
- Added: `scripts/permission-revocation-race-oracle.mjs`, `tests/permission-revocation-race-oracle.test.mjs`, and this evidence file.
- Result: the oracle requires one source SHA, tenant, principal, permission, operation and monotonic server sequence domain across five distinct captures. It checks a formerly allowed synthetic operation, an overlapping request, committed revocation, denial at the new permission revision with no applied effect, fresh-session denial, and independent state/audit readback. Missing, mismatched, reordered, stale-authority or effect-bearing receipts fail closed.

## Tests actually run

The exact oracle source and test source were loaded from the local package and executed in the available V8 runner with Node test/assert imports replaced by equivalent local test/assert shims; no Node binary was available in this workspace. A permissive baseline returning PASS failed 10 of 11 assertions; the package passed 11 of 11 assertions, with zero final failures. These are synthetic contract tests, not a Node 22 test run, final-image admission, concurrency test, or hosted proof.

## Status and remaining work

Status: **TESTED in a V8 source harness**, pending supported Node and final-image gates. Independent review: pending. Canonical integration: no. Exact-candidate deployment: no. Hosted or customer proof: no.

The oracle trusts supplied receipts; it cannot establish their provenance or the completeness of effect readback. The current runtime may not emit all required monotonic server events, so a real race capture might need bounded instrumentation by the canonical owner. Next: independently review the exact PR, run the test with supported Node, identify the approved synthetic operation and server sequence source, then perform an authorized barrier-controlled concurrent test on one serving SHA. Verify the revocation audit and absence of any post-revocation effect from the durable store before closing the security gate. Keep customer readiness blocked until the complete release evidence passes.

