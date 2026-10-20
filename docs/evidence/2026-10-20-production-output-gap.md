# Scoped production output-gap evidence — 2026-10-20

## Requirement and source

Issue #202 lists missed output as a Savings Engine opportunity and requires evidence, an attribution period and double-count prevention. This bounded package compares a complete production plan with complete accepted-output evidence for one exact production order and period. It reports a **planned output gap in units**, without interpreting the gap as missed sales, realised loss or savings.

## Ownership and conflict check

Open PR title/body searches for missed output, production shortfall and output gap, plus remote branch searches, found no focused owner. PR #502 owns QMS rework/scrap cost evidence; this package uses plan and MES accepted-output evidence and changes different files. Existing Capacity Rescue uses target/projected/current units for shadow planning but does not bind complete plan/MES output snapshots. Canonical implementation/integration/release ownership remains unchanged.

## Exact base and changed files

Base `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. New files: `operations/runtime/production-output-gap.cjs`, its test and this evidence record. No existing engine, route, writer, controller, frozen artifact or deployment manifest is changed.

## Result and tests

The read-only assessor binds tenant/site/line/product/order, the exact period, separate source revisions/digests and distinct evidence references. Both source snapshots must declare a complete period observed after its end and before as-of. Invalid, foreign, duplicate, inherited or coerced measurement evidence fails closed. Output separates gap units and units over plan, with `cause:null`, `claimedSavingsPence:null`, `sourceAuthenticated:false` and `actionAuthority:false`.

Initial TDD run failed as expected on the missing module. Focused tests passed 3/3 after implementation. An inherited measurement regression then failed on the first implementation and passed after an explicit-own-field correction. Full operations runtime passed 376/376 with the declared passkey dependency installed; local FORGE core gate passed; diff check passed. Exact external image and hosted tests have not run. Synthetic data only.

## Review, integration and release

Independent review and formal GitHub approval pending. The package is not canonically integrated, deployed, enabled or customer-proven. Plan and MES source identity/completeness are caller claims; no authenticated adapter or role/site route exists. The canonical owner must review and adopt the assessor, reconcile its source and cost attribution with Capacity Rescue, PR #502 and the Savings/Outcome Ledger, authenticate both source snapshots, then run exact merged-image/security gates and synthetic hosted readback on one serving SHA. Production approval and customer-ready claims remain unchanged.
