# WFM UX scorecard — Cycle 11 r4

## Journey reviewed
Manager Today → Universal Action Queue → exact Absence request / exact Time Review team / exact Weekly Sign-off team → existing new-UI owning workflow → return to the originating queue action.

## New-UI lineage
All work remains on `ux/universal-action-queue-20260918-r1` / PR #80. No legacy/0.6.139 UX mutation and no production, staging or customer-proof mutation.

## Reuse / duplicate check
- Reused the existing Cycle 11 `sourceId`, return marker, `selectSourceScope()`, destination focus and return-focus behaviour.
- Reused the established Cycle 3/7/10 Chrome DevTools Protocol browser-test pattern.
- Added one shared browser regression rather than three route-specific harnesses.
- No runtime approval, payroll, leave, tenant, audit or calculation logic was duplicated.

## Research delta
No external competitor/general UX research was repeated because the unresolved issue was execution evidence for an already-designed context-preservation primitive; more market research would not change the test decision.

## Hypothesis
A single browser regression covering all three current Universal Action Queue destinations should protect exact source-context selection and return-focus with less duplicated test code and catch regressions before further navigation abstraction.

## Implementation delta
- Added `.github/scripts/ux-cycle11-context-browser.mjs` as the single Cycle 11 source-context browser harness.
- The harness uses the real Cycle 11 model/UI/CSS with one generic `exercise()` path for Absence, Time Review and Weekly Sign-off.
- It checks structured source IDs, exact scope selection, destination focus, return-to-origin focus, 390px containment and mobile return-focus.
- Wired it into `.github/workflows/ux-cycle11-gate.yml` before Docker composition so focused interaction validation precedes broader build validation.
- Commits: `82aa98ffdebf858d5d51b6c144cf278958f99650`, `e1e9c4d22acca6a35313cd8674f20549f6101f46`.

## Validation observed
GitHub currently exposes no workflow run for head `e1e9c4d22acca6a35313cd8674f20549f6101f46`; this is the same previously recorded zero-step CI infrastructure blocker. It was checked once because the workflow materially changed and was not repeatedly retried. The browser regression is therefore implemented but not execution-proven; no browser-pass claim is made.

## UX scorecard impact
- Calm by default: unchanged; no runtime UI was added.
- Dense on demand: unchanged; existing source workflows remain the detail owners.
- Explainability: unchanged in product; test coverage now protects the source-context contract.
- Navigation predictability: stronger structurally across all three current queue destinations.
- Accessibility: focus continuation is explicitly covered by the regression design; execution and screen-reader announcement quality remain unverified.
- Mobile/tablet: 390px containment/mobile return-focus is included; tablet execution remains unverified.
- Capability preservation: green by design; test-only change plus workflow wiring.

## Decision log
- One shared browser regression for all current queue destinations: **BUILD NOW** — implemented.
- Three route-specific harnesses: **REJECT** — duplicate test ownership.
- Further navigation abstraction before this regression executes: **BUILD NEXT** only after evidence.
- Repeat generic competitor research: **REJECT** this run.

## Still unverified
Actual execution of the new browser regression, full screen-reader behaviour, tablet end-to-end focus, real manager first-click/time-on-task/error delta, and hosted source-bound proof. Cycle 10 promotion remains gated on exact hosted proof.

## Single next highest-value action
Continue with the next unblocked new-UI manager journey while keeping this regression as the only source-context browser gate; do not add another navigation test path unless it protects a distinct failure mode.

## Record note
The canonical `UX_SCORECARD.md` prepend timed out through the connector, so this bounded r4 delta file and the PR #80 conversation record are the authoritative record for this run until the canonical file can be updated without overwriting history.