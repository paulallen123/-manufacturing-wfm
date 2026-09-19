# UX scorecard — Cycle 12 r5

## Journey reviewed
Specialist/system priority on the approved Vector NEW-UI lineage → existing owning workflow → return to the originating priority.

## NEW-UI lineage confirmation
All work in this cycle was applied only to `feature/one-day-enterprise-implementation-v1`, the approved Vector Workforce Operations presentation lineage. The superseded Cycle 12 concept branch and legacy/0.6.139 presentation lineage were not mutated.

## Reuse / duplicate-work check
- Reused the existing Cycle 11 Decision Card renderer, `.ux11-open` route action, `openRoute`, return marker and focus-restoration lifecycle.
- Reused the existing Cycle 12 provider registry, source poller, provider-route binding and specialist queue container.
- Removed the Cycle 12 duplicate card renderer and duplicate `.ux12-open` click/navigation path instead of maintaining a second specialist interaction grammar.
- No new branch, PR, queue model, route, permission path, source calculation or business rule was created.

## Research delta
No external research was repeated. The unresolved issue was implementation drift inside the current NEW UI, and repository evidence was sufficient to decide the change.

## Hypothesis
If managers and specialist/system roles render the same authoritative Decision Card and use one return-to-context lifecycle, interaction behaviour should remain more predictable and cheaper to maintain without adding visible density or moving source authority into presentation.

## Exact implementation delta
- Cycle 11 now exports `renderCard`, `returnMarker`, `restoreFocus`, `addBackLink` and `focusNode` as shared presentation primitives.
- Return-to-context is no longer artificially limited to manager roles; any role that entered an owning workflow from an authenticated priority marker can receive the existing `Back to priority queue` continuation.
- Cycle 12 specialist queues now render via `WFMUXCycle11.renderCard` and restore origin focus via `WFMUXCycle11.restoreFocus`.
- The Cycle 12 specialist-specific card function, source/state label duplication and `.ux12-open` click handler were removed.
- Existing source-owned writes, permissions, payroll/compliance calculations, audit behaviour and route ownership remain unchanged.

## Focused validation
- The existing Cycle 12 signal-contract regression was extended rather than replaced.
- New guards fail if Cycle 12 reintroduces its own card renderer or `.ux12-open` route path.
- New guards require Cycle 12 to use the shared Cycle 11 card and return-focus primitive and require return-context observation to remain available outside manager-only workflows.
- GitHub reports PR #79 as `mergeable_state: clean` at the changed head after recomputation.
- No executable GitHub workflow run was exposed for the changed head, so hosted browser, screen-reader, mobile/tablet and real time-on-task proof are not claimed green.

## UX scorecard impact
- Calm by default: unchanged; no additional permanent surface or control was added.
- Dense on demand: unchanged visually; specialist actions now inherit the same disclosure grammar as manager actions.
- Explainability: improved structurally through one evidence/authority card contract.
- Navigation predictability: improved structurally because manager and specialist roles now use the same open/return lifecycle.
- Development efficiency: improved materially by deleting a parallel card/navigation implementation and protecting against its return.
- Capability preservation: green by design; presentation only.

## Serious-idea decision
**BUILD NOW** — one shared Decision Card + one return-context lifecycle across roles. Evidence strength: high repository-level implementation evidence. Main residual risk: composed runtime focus behaviour is not executable in the currently blocked hosted CI path.

## Single next highest-value NEW-UI action
Inspect the approved Vector shell's actual heading/navigation containers for specialist-owned routes and add a focused rendered-DOM regression for `Integrations priority → Integrations workflow → Back to priority queue → exact originating card focus`, reusing the existing Cycle 11 browser harness if executable. Do not create another harness or navigation primitive.