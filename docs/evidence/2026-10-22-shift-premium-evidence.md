# Scoped shift-premium evidence — 2026-10-22

## Requirement and source

Issue #202 lists shift premiums as a Savings Engine opportunity and requires attribution-period and evidence discipline. This bounded package totals **declared planned shift-premium cost**, using the existing `operations/runtime/payroll-money.cjs` calculation and rounding. It is not a payroll run, realised cost or savings claim.

## Ownership and conflict

Open PR title/body searches for shift premium, premium cost and premium evidence, plus remote branch checks, found no focused owner. PR #494 owns shared payroll factor admission; #496 owns scheduler wage shape; #431 owns forecast labour cost. This package changes none of those files and passes only primitive factors to the existing money helper. Canonical implementation/integration/release ownership stays unchanged.

## Exact base and changed files

Base `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. New files: `operations/runtime/shift-premium-evidence.cjs`, its test, and this evidence record. No route, writer, scheduler, payroll ledger, frozen artifact or deployment manifest is modified.

## Result and tests

The read-only assessor requires an exact tenant/site and completed period, source tenant/site/name/revision/digest/completeness, policy revision and bounded segments. Each segment binds assignment/evidence references, the policy revision and a premium code. It rejects duplicate refs, overlap within the same assignment, foreign scope, invalid intervals, coercible rates/multipliers, missing or accessor-backed fields and unsafe pence totals. Different assignments may legitimately overlap. It reports aggregate base, gross and premium pence, omits assignment identifiers and keeps `claimedSavingsPence:null`, `sourceAuthenticated:false` and `actionAuthority:false`.

Initial TDD failed on the missing module as expected. Focused tests passed 3/3. The adjacent shared money suite passed 16/16. Full operations runtime passed 376/376 with the declared passkey dependency installed; local FORGE core gate passed; diff check passed. Subsequent source tenant/site regressions failed on the first commit and passed after source binding was added. Exact external image and hosted tests have not run. Synthetic data only.

## State and next action

Built and locally tested; independent review, canonical integration, exact image proof, deployment and hosted/customer proof pending. Source completeness, hourly rates, policy revision and premium codes are caller declarations. The canonical owner must authenticate WFM schedule and pay-policy evidence, reconcile PRs #494/#496/#431, verify tenant/site and payroll role controls in the existing FORGE path, then run exact merged-image gates and approved synthetic hosted readback. Production approval and customer-ready claims remain unchanged.
