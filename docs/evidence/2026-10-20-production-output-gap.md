# Scoped production output-gap evidence — 2026-10-20

## Requirement and source

Issue #202 lists missed output as a Savings Engine opportunity and requires evidence, an attribution period and double-count prevention. This bounded package compares a complete production plan with complete accepted-output evidence for one exact production order and period. It reports a **planned output gap in units**, without interpreting the gap as missed sales, realised loss or savings.

## Ownership and conflict check

Open PR title/body searches for missed output, production shortfall and output gap, plus remote branch searches, found no focused owner. PR #502 owns QMS rework/scrap cost evidence; this package uses plan and MES accepted-output evidence and changes different files. Existing Capacity Rescue uses target/projected/current units for shadow planning but does not bind complete plan/MES output snapshots. Canonical implementation/integration/release ownership remains unchanged.

## Exact base and changed files

Base `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. Package files: `operations/runtime/production-output-gap.cjs`, its test and this evidence record. The existing non-deploy admission trigger remains unchanged by the repair. No route, writer, controller, frozen artifact or deployment manifest is changed.

## Result and tests

The read-only assessor binds tenant/site/line/product/order, the exact period, separate source revisions/digests and distinct evidence references. Both source snapshots must declare a complete period observed after its end and before as-of. Invalid, foreign, duplicate, inherited or coerced measurement evidence fails closed. Output separates gap units and units over plan, with `cause:null`, `claimedSavingsPence:null`, `sourceAuthenticated:false` and `actionAuthority:false`.

Initial TDD run failed as expected on the missing module. Focused tests passed 3/3 after implementation. An inherited measurement regression then failed on the first implementation and passed after an explicit-own-field correction. The predecessor's full operations runtime passed 376/376 with the declared passkey dependency installed; local FORGE core passed. Those predecessor counts are historical and are not inherited by the repair.

## Snapshot-integrity repair — 2026-10-23

Independent review of head `19469a767a0be566a823b89ac50eba339db37317` reproduced five evidence-binding failures: root/source accessors could publish values different from those validated, the plan envelope could be replaced between provenance validation and unit calculation, requested tenant scope could be inherited, and the same declared source identity could serve as both plan and production.

The repair rejects proxies, accessors, inherited/hidden/Symbol/extra fields and non-plain envelopes. It snapshots the root, period and both source records exactly once from enumerable own data descriptors; validation, calculation and publication use only those snapshots. Plan and production must have both distinct evidence references and a genuinely distinct source-name/revision/digest identity.

TDD on Node `v24.19.0`: the predecessor-compatible committed regression run was **3 pass / 4 fail** across seven test groups. The repaired committed plus independent held-out run was **13/13 pass**, zero fail/skip; syntax checks passed. An available adjacent operations subset plus committed and held-out tests was **134/134 pass**, zero fail/skip. A complete repository checkout and supported Node 22.23.2 runtime were not available in this execution, so the prior 376/376 result is not promoted to the repaired bytes. Exact installed-image, hosted and customer tests remain outstanding.

## Review, integration and release

Fresh independent review of the repaired exact head remains required. The package is not canonically integrated, deployed, enabled or customer-proven. Plan and MES source identity/completeness are caller claims; no authenticated adapter or role/site route exists. The canonical owner must review and adopt the assessor, reconcile its source and cost attribution with Capacity Rescue, PR #502 and the Savings/Outcome Ledger, authenticate both source snapshots, then run supported-Node full operations, exact merged-image/security gates and synthetic hosted readback on one serving SHA. Production approval and customer-ready claims remain unchanged.
