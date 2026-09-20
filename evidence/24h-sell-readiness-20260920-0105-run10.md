# 24h sell-readiness evidence — 2026-09-20 01:05 BST

## Scope and controls
- Repository: `paulallen123/-manufacturing-wfm`
- Candidate branch: `feature/one-day-enterprise-implementation-v1`
- Exact current verified candidate: `79e29f3989b2ca4ecb9276ef190addcf74aa76c3`
- No new Railway resources created.
- Frozen customer-proof release not modified.
- Production/readiness flags not elevated.
- Existing one-day and integration security holds not removed or weakened.

## Railway private GitHub source-access evidence
Existing `wfm-built-ui-audit` service automatically fetched branch commit `a42f59ada285d33e13487f1d84f4204fd95d3695` and deployment `7293286e-58fc-4c9f-bb25-abb59c33b7bc` completed SUCCESS. This demonstrates that Railway can currently fetch the private repository through an existing linked service.

The fresh Railway Chromium run passed the five hosted role journeys against the currently deployed one-day runtime, but the receipt identified that target runtime as `c9878364b02dffb77c21702d58af35c344e5ff68`; therefore this is not claimed as exact-head browser proof for `79e29f...`.

Observed receipts included:
- `CURRENT_ACTION_QUEUE_GROUPING=PASS|needsSource=0|awaitingSource=0|viewports=3`
- `CURRENT_TIME_REVIEW_EMPTY_STATE=PASS|active=0|invented=0`
- manager, employee, payroll, company-admin, and isolation-manager browser journey PASS receipts
- `CURRENT_CANDIDATE_ROLE_BROWSER_MATRIX=PASS|roles=5|navClicks=4|activeActionJourneys=0|emptyStateJourneys=1|sha=c9878364b02dffb77c21702d58af35c344e5ff68`
- `BROWSER_PROOF_SERVER=PASS`

## Release-authority blocker cleared safely
The branch head immediately before this control fix was unsigned (`a42f59ada285d33e13487f1d84f4204fd95d3695`). An isolated release branch changed only one comment in `.github/workflows/integration-proof-exact-gated-release.yml` and PR #184 was merged with a normal GitHub merge commit.

Resulting merge commit: `79e29f3989b2ca4ecb9276ef190addcf74aa76c3`.
GitHub reports this merge commit as cryptographically verified. The merge delta is exactly one file and one comment line; no product runtime, role-first Vector UX, Railway resource, readiness flag, security hold, or provider claim changed.

## Exact integration release failure
Workflow run: `35480415953`
Workflow: `Integration proof exact gated release`
Exact head: `79e29f3989b2ca4ecb9276ef190addcf74aa76c3`

Attempt 1 job `105997086863`:
- conclusion: failure
- steps: `[]`
- runner_id: `0`
- runner label: `ubuntu-22.04`

Attempt 2 job `105997143963`:
- conclusion: failure
- steps: `[]`
- runner_id: `0`
- runner label: `ubuntu-22.04`

Therefore checkout, exact-SHA verification, manifest checks, Railway CLI installation, Railway credentials, source upload, health verification and application code were never executed. The integration security hold was retained.

## One-day exact release lane corroboration
Earlier product/UX commit `5548f243a9eb5c0cb16b4dc4cd821fdd68504858` triggered one-day exact staging workflow run `35475230940`, job `105983227642`.
- conclusion: failure
- steps: `[]`
- runner_id: `0`
- runner label: `ubuntu-24.04`

This independently demonstrates the same pre-execution GitHub Actions runner-allocation failure on a different hosted-runner label.

## Current evidence boundary
The exact current candidate is not yet deployed to either target service. Last successful one-day runtime remains `c9878364b02dffb77c21702d58af35c344e5ff68`; integration proof remains on its previously safe runtime. Existing scale/payroll/T0-T4/security evidence remains historical baseline evidence only, not exact-head proof after the later role-first UX change.

No authorised non-fixture external-provider sandbox/API proof was produced in this run. The visible variable names on the two target Railway services do not expose provider-specific sandbox credentials. This does not prove none exist elsewhere; it means none were available through these target-service configurations.

Genuine autonomous customer/environment provisioning also remains unproven; prior timing evidence remains explicitly synthetic rather than customer-style real provisioning proof.

## Readiness decision
Sell-readiness remains `CONDITIONAL`. Do not promote readiness until exact current candidate deployment and exact-head regression/browser proof are complete, authorised non-fixture provider evidence exists, and genuine zero-human provisioning is demonstrated.
