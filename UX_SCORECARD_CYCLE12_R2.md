# WFM UX scorecard — Cycle 12 r3

## Journey reviewed
Specialist/system role on Overview → Cycle 12 System Action Queue → existing source-owned workflow → Back to priority queue → exact originating Cycle 12 action regains focus.

## Reuse / duplicate check
- Work remained on the canonical Cycle 12 successor branch based on Cycle 11 r10; no legacy/0.6.139 UI was changed.
- Reused Cycle 11 `openRoute`, return marker, back-link and return-focus lifecycle instead of creating a Cycle 12 navigation lifecycle.
- Reused the existing Cycle 12 provider contract, specialist queue and existing signal-contract test script.
- No new page, drawer, route, Decision Card renderer, approval flow or test harness was created.

## Hypothesis
If specialist/system actions use the same return-context primitive as manager actions, a user can open an implementation/integration/operating-control source workflow and return to the exact originating action without losing context, while keeping all write authority in the source workflow.

## Exact implementation delta
- Generalised the existing Cycle 11 return-link observer so it activates for any role that has an active queue return marker, not managers only.
- Kept manager-only queue rendering unchanged; the generalisation affects only return-context handling after an action has already been opened.
- Exported the existing `restoreFocus`, `addBackLink` and `returnMarker` helpers as the shared navigation/context primitive.
- Cycle 12 `renderSpecialistQueue()` now calls the existing Cycle 11 `restoreFocus()` after rendering, so the originating system action regains focus on return.
- Unknown specialist source workflows do not receive guessed in-page focus selectors; when no verified source-specific target exists, the source route opens normally and the user still gets a deterministic return path.
- Added static regression guards to the existing Cycle 12 signal-contract script so specialist return context cannot silently become manager-only or forked again.

## Focused validation
- Local `node --check` passed for revised Cycle 11 UI source.
- Local `node --check` passed for revised Cycle 12 UI source.
- Local `node --check` passed for the extended existing Cycle 12 signal-contract test script.
- New regression contract is expected to emit `UX12_SPECIALIST_RETURN_CONTEXT=PASS` when the existing gate executes.
- Hosted/browser proof is not claimed green until GitHub executes the existing gate on the exact changed head.

## UX scorecard impact
- Calm by default: unchanged; no new visible permanent navigation was added.
- Dense on demand: improved; specialist actions return to the same compact queue rather than requiring route hunting.
- Explainability: preserved; source provider and evidence remain bound to the existing card and source workflow.
- Navigation predictability: improved structurally; manager and specialist queues now share one return-context lifecycle.
- Accessibility: improved structurally through focus restoration to the exact originating action; screen-reader/composed-browser behaviour remains unverified.
- Development efficiency: improved; one navigation lifecycle and one existing regression script cover both role families.
- Capability preservation: green by design; no payroll, approval, attendance, implementation, tenant, audit or source-write authority changed.

## Serious-idea decisions
- Add a second Cycle 12 back/return subsystem: **REJECT** — duplicate lifecycle and future drift risk.
- Reuse/generalise Cycle 11 return context for specialist/system actions: **BUILD NOW — completed**.
- Guess source-specific focus selectors for unverified future workflows: **REJECT** — source structure is not yet authoritative.
- Extend the existing Cycle 12 contract regression rather than create another harness: **BUILD NOW — completed**.
- Repeat generic competitor research this run: **REJECT** — no unresolved external design question affected the implementation decision.

## Still unverified
Exact sealed-runtime browser round trip for a real specialist route, screen-reader announcement/focus order, mobile/tablet return behaviour, and Cycle 10 exact source-bound hosted promotion proof.

## Single next highest-value action
Run the existing focused gate on the exact Cycle 12 head if infrastructure executes it; otherwise inspect the next highest-value new-UI specialist journey for a verified source-specific destination target and add exact in-workflow focus only where a stable authoritative selector/ID already exists. Do not guess selectors or create a second navigation path.
