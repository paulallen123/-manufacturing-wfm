# WFM UX scorecard — Cycle 12 r2

## Journey reviewed
Canonical new-UI development lineage: Cycle 11 r10 → Cycle 12 unified operating experience → governed future-capability signals → existing Action Queue / owning source workflow.

## Reuse / duplicate check
- Compared the original Cycle 12 base `6bd0092f...` with latest Cycle 11 head `75d3ab19...`: Cycle 11 was 11 commits ahead and none of those intervening commits touched the Cycle 12 delta-owned files.
- Rebuilt Cycle 12 directly on exact Cycle 11 r10 instead of continuing a stale parallel branch.
- PR #80 is now explicitly the predecessor/proof owner; PR #90 is the single forward successor lineage for new UX/CX capability work.
- No legacy/0.6.139 UI was used as an implementation surface.

## Exact implementation delta
- Refreshed PR #90 onto exact parent `75d3ab19243b2145e66fe69f2a8e23d05704e9b5` while preserving all 11 newer Cycle 11 commits.
- Preserved the Cycle 12 governed provider contract, implementation-status adapter, future-capability design, CSS and sealed composition as one successor delta.
- Removed a second action-card renderer from Cycle 12. Cycle 11 now exports the existing authoritative presentation primitive as `renderCard`, and Cycle 12 specialist/system queues reuse that same renderer and existing `.ux11-open` navigation path.
- Extended the existing UX quality gate to fail if Cycle 12 reintroduces its own card renderer/navigation action.
- Kept workflow execution owner-push/manual rather than adding another pull-request execution surface.

## Focused validation
- Local syntax check of the revised Cycle 12 UI: `UX12_SHARED_CARD_SYNTAX=PASS`.
- Static duplicate guard: `UX12_NO_DUPLICATE_CARD_RENDERER=PASS`.
- GitHub compare after refresh: Cycle 12 is ahead of exact Cycle 11 r10 and zero commits behind; no parallel/stale lineage remains.
- The first exact refreshed head produced the known GitHub pre-execution failure signature (`steps: []`, `runner_id: 0`, no runner). The latest quality-gate head exposed no workflow run at check time, so hosted/browser proof is not claimed green and the unchanged blocker was not repeatedly retried.

## UX scorecard impact
- Calm by default: unchanged.
- Dense on demand: unchanged; new capability still enters through the existing action grammar.
- Explainability: preserved; provider identity and source evidence remain bound and write authority stays in owning workflows.
- Consistency: improved; one Decision Card renderer/navigation path now serves Cycle 11 and Cycle 12 instead of two near-duplicates.
- Development efficiency: materially improved; one forward branch and one shared action-card primitive reduce drift, repeated fixes and duplicated regression work.
- Accessibility/mobile: no new visual layout was introduced by the dedupe; hosted composed-browser/screen-reader proof remains unavailable.
- Capability preservation: green by design; no payroll, schedule, leave, approval, tenant, audit or production authority moved into presentation.

## Serious-idea decisions
- Continue Cycle 11 and Cycle 12 as parallel active UX branches: **REJECT**.
- Refresh Cycle 12 onto latest Cycle 11 and make it the single forward successor: **BUILD NOW — completed**.
- Keep a separate Cycle 12 Decision Card renderer: **REJECT — removed**.
- Reuse the Cycle 11 card and navigation primitive across newer capability signals: **BUILD NOW — completed**.
- Claim CI/browser proof from zero-step/no-run evidence: **REJECT**.

## Still unverified
Exact composed Docker/browser execution on the refreshed successor, specialist-role round-trip return focus, screen-reader behaviour, representative role/task timing, and Cycle 10 source-bound hosted promotion proof.

## Single next highest-value action
Inspect the refreshed Cycle 12 specialist-role round trip (system action → owning workflow → return) against the existing Cycle 11 context primitive. Reuse/generalise that primitive only if a real return-context gap exists; do not create a second navigation lifecycle.