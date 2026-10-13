# Issue #265 bad-deployment rollback: bounded evidence package

## Requirement and source

Issue #265 requires bad-deployment rollback proof on the exact candidate. `scripts/validate-autonomous-recovery-matrix.mjs` has a disposable in-memory `bad-release` scenario; it does not bind a provider deployment transition to outside-in source/health checks and preserved durable state. `release/proof-lane-policy.json` requires exact-source evidence and prevents staging/fixture proof from becoming production promotion authority.

## Ownership and conflict

Canonical implementation, release approval, deployment and rollback remain with the sole owner. Current issue #265/#288 records, visible VECTOR chat work, open PR search for bad-deployment/rollback proof, and rollback branch search found no current focused exact-deployment proof package. Historical rollback branches and the existing in-memory matrix were retained. This package adds only a read-only receipt validator and synthetic test; it starts no deployment, rollback, runner, controller or tenant mutation.

## Exact package and result

- Base: `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.
- Added: `scripts/bad-deployment-rollback-oracle.mjs`, `tests/bad-deployment-rollback-oracle.test.mjs`, and this evidence file.
- The validator requires a disposable proof environment and a single service, environment, volume, synthetic tenant and monotonic sequence domain across six distinct receipts. It checks last-good source/semantic health and state digest; an actually serving bad build with observed source mismatch/semantic failure and no business mutation; a release-authorised rollback decision; a matching provider transition; restored outside-in source, health and protected fresh-session read; and identical durable state with linked rollback audit. Missing or mixed receipts fail closed.

## Tests actually run

Exact local oracle/test source was executed with the available V8 runner and local replacements for Node test/assert imports, because a Node binary is unavailable in this workspace. A permissive baseline returned 1 pass / 10 fail; the new package returned 11 pass / 0 fail. These are synthetic contract tests. No supported Node 22 run, final-image test, provider rollback, hosted readback or customer proof was executed.

## State, limits and next action

Status: **TESTED in local V8 source harness**. Independent review pending; canonical integration, exact-candidate deployment and hosted/customer proof: no. A supplied receipt is not independent provider evidence, and this validator does not authorise any rollback. The most recent Railway customer service read showed successful deployment `faca24a2-10b9-4289-bc49-3406e44f7272` serving `90ad90fcf60adaca9abacdd4ad14bf392f95e585`; canonical source `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` was not that serving deployment. Recheck before any real proof.

Next: independent exact-head review and supported Node/full-image tests, then the canonical owner selects an approved disposable, volume-backed service and synthetic fixture. Under existing release controls, obtain independent provider deployment metadata, source-bound HTTP responses, durable state/audit and fresh-session readbacks across an authorised bad-build/rollback exercise. Only an exact, independently checked receipt set can advance issue #265's rollback gate; it cannot by itself confer production or customer readiness.

