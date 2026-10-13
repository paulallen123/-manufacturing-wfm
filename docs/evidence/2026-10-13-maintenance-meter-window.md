# Source-scoped maintenance meter window — 2026-10-13

## Requirement and owner/conflict check

Issue #202 lists meter/condition signals, downtime history and source provenance in the maintenance target. The design in `docs/superpowers/specs/2026-09-22-manufacturing-asset-decision-value-os-design.md` requires a tenant/site/asset-bound read model and forbids stale or unproven source fields from becoming authoritative. Current open-PR searches found no focused cumulative meter assessment. PR #394 owns maintenance workforce/parts preflight, #415 preventive due, #421 reliability, and #442 the existing semantic-envelope timestamp correction. This package stacks on #442, reuses that shared envelope, and adds no connector, route, writer, work order, control action, job or deployment. The sole canonical owner retains integration authority.

## Exact package and result

- Base: local reviewed timestamp patch `a0e3d5947a0c762ff69805c341193717875b6f65`, itself based on canonical candidate `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. Remote target is draft PR #442's branch.
- Changed files in this stack: `integration-fabric/runtime/maintenance-meter-window.mjs`, its adjacent `.test.mjs`, and this record.
- The read-only assessor computes a candidate delta only for an explicit cumulative meter with two or more scope-matched, uniquely identified, revisioned, finite, nonnegative observations. It orders by source time, requires explicit ingestion chronology, rejects conflicting timestamps, declines/resets, stale or future readings, and malformed source times. It returns `admissionStatus: blocked`, `decisionAllowed: false`, and `writeBackAllowed: false` because a trusted source adapter and evidence attestation are unavailable. It does not diagnose machine condition, predict failure, create work orders or assert savings.

## Tests and independent review

Initial synthetic meter suite passed 5/5. The later cumulative-kind regressions reproduced two false admissions (4 pass/2 fail); the missing-ingestion regression failed (6 pass/1 fail) before correction. Final `node --test integration-fabric/runtime/semantic-envelope.test.mjs integration-fabric/runtime/maintenance-meter-window.test.mjs` on local Node 24: **15 pass/0 fail**. `node --check` and `git diff --check` passed. Independent read-only review found the ingestion-time hole, then found no remaining blocking false admission within this bounded contract after the fix.

## State, limitations and next action

**TESTED isolated.** No canonical integration, exact-candidate deployment, hosted exercise or customer proof occurred. The source record IDs/revisions and declared cumulative kind have structural checks only; neither authenticates provider bytes or confirms the meter's physical calibration or reset history. The canonical owner should review this stack after #442, bind source identity and completeness through the existing Integration/Data Fabric controls, reconcile with the asset graph and maintenance packages, test the exact candidate, and use approved hosted/customer-like proof before admitting a condition or maintenance decision. Railway's last successful candidate remains old SHA `90ad90fcf60adaca9abacdd4ad14bf392f95e585`; candidate `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` is only staged.
