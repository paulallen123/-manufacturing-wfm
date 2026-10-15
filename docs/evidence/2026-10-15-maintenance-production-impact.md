# Maintenance production impact advisory, 2026-10-15

## Requirement and source

Issue #202 calls for production impact and maintenance scheduling around production constraints. This bounded slice assesses overlap between one open, scoped CMMS work order's proposed window and a complete, scoped MES production schedule. It reports affected order IDs and scheduled overlap minutes. It does not estimate output loss, cost, savings, causality or workforce action.

## Ownership and conflict check

The sole canonical implementation and release owner remains responsible for adoption. On 2026-10-15, open PR title/body searches for `maintenance production impact`, `maintenance-production-impact`, `work-order priority` and `production impact maintenance` found no focused package. Remote branch searches for `maintenance`, `work-order` and `production-impact` found no owner for this exact slice. Related open PRs #394 (workforce/parts), #415 (preventive due), #421 (reliability), #430 (inspection) and #449 (meter context) own distinct requirements and files. The only visible live collaboration agent was this run; no shared runner, writer or release lane was claimed.

## Exact base and changed files

Base `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`, the staged canonical candidate (not serving). Isolated branch `feature/maintenance-production-impact-20261015` changes only:

- `operations/runtime/maintenance-production-impact.cjs`
- `operations/runtime/maintenance-production-impact.test.cjs`
- `docs/evidence/2026-10-15-maintenance-production-impact.md`

## Implementation and verification

The pure read-only assessor requires exact tenant/site/asset binding on the work order, production snapshot and each run. The work order must be open, current and explicitly own the assessed planned window. The production snapshot must be complete and current through the full window. Both sources require revision and evidence references. It accepts valid UTC instants, a bounded window and run count, and non-overlapping machine runs. It uses half-open intervals and returns `BLOCKED` without an impact figure on invalid or stale input. Its refs, completeness, source clock and status remain caller claims (`sourceAuthenticated: false`).

TDD: initial test command failed because the module was absent; with a stub, 1/3 passed and two expected advisory assertions failed. After first implementation, `node --test operations/runtime/maintenance-production-impact.test.cjs` passed 3/3 on Node v24.19.0; the adjacent Capacity Rescue plus focused suite passed 42/42. Independent read-only review reproduced false advisories for a different work-order window, expired work order, and foreign run. Added regression cases failed 2/3 before the correction, then passed 3/3 after the work-order window/freshness and per-run scope checks. Reviewer also identified the caller-claimed source and clock boundary; the package stays unexposed until a trusted adapter supplies independently authenticated records and server time.

The first full `node --test operations/runtime/*.test.cjs` attempt was 365 pass/1 fail because the fresh worktree lacked `@simplewebauthn/server`, which the existing composed scheduling route test requires. `npm ci --prefix security/runtime --ignore-scripts` installed the declared test dependencies locally. The full-suite rerun passed 376/376 on Node v24.19.0. Focused source and test syntax checks and `git diff --check` passed. No Docker or pinned Node 22 run occurred.

## State and next action

The module is locally tested only. It has no route, connector, job, writer or deployment. Independent review and canonical integration are pending. The current Railway customer-ready service's last successful deployment `faca24a2-10b9-4289-bc49-3406e44f7272` serves `90ad90fcf60adaca9abacdd4ad14bf392f95e585`; the candidate `48dce8f` is staged in patch `b453aa80-4763-4a08-a4f5-d5d27534b2c8`. The frozen artifact is untouched. Hosted/customer proof is absent.

The canonical owner should authenticate CMMS and MES source records, reconcile this API with the existing maintenance and Capacity Rescue paths, run exact-candidate image/security gates, and collect approved synthetic hosted work-order/schedule readback on one serving SHA before exposing the advisory to a tenant. Missing source authentication and release approval block deployment.
