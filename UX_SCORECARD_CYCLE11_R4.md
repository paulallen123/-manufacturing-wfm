# WFM UX scorecard — Cycle 11 running record

## r4 — shared source-context browser gate

### Journey reviewed
Manager Today → Universal Action Queue → exact Absence request / exact Time Review team / exact Weekly Sign-off team → existing new-UI owning workflow → return to the originating queue action.

### New-UI lineage
All work remains on `ux/universal-action-queue-20260918-r1` / PR #80. No legacy/0.6.139 UX mutation and no production, staging or customer-proof mutation.

### Reuse / duplicate check
- Reused the existing Cycle 11 `sourceId`, return marker, `selectSourceScope()`, destination focus and return-focus behaviour.
- Reused the established Cycle 3/7/10 Chrome DevTools Protocol browser-test pattern.
- Added one shared browser regression rather than three route-specific harnesses.
- No runtime approval, payroll, leave, tenant, audit or calculation logic was duplicated.

### Research delta
No external competitor/general UX research was repeated because the unresolved issue was execution evidence for an already-designed context-preservation primitive; more market research would not change the test decision.

### Hypothesis
A single browser regression covering all three current Universal Action Queue destinations should protect exact source-context selection and return-focus with less duplicated test code and catch regressions before further navigation abstraction.

### Implementation delta
- Added `.github/scripts/ux-cycle11-context-browser.mjs` as the single Cycle 11 source-context browser harness.
- The harness uses the real Cycle 11 model/UI/CSS with one generic `exercise()` path for Absence, Time Review and Weekly Sign-off.
- It checks structured source IDs, exact scope selection, destination focus, return-to-origin focus, 390px containment and mobile return-focus.
- Wired it into `.github/workflows/ux-cycle11-gate.yml` before Docker composition so focused interaction validation precedes broader build validation.
- Commits: `82aa98ffdebf858d5d51b6c144cf278958f99650`, `e1e9c4d22acca6a35313cd8674f20549f6101f46`.

### Validation observed
GitHub exposed no executable workflow run for the r4 head; this matched the already-recorded zero-step CI infrastructure blocker. It was checked once because the workflow materially changed and was not repeatedly retried. The browser regression was therefore implemented but not execution-proven; no browser-pass claim was made.

### UX scorecard impact
- Calm by default: unchanged; no runtime UI was added.
- Dense on demand: unchanged; existing source workflows remain the detail owners.
- Explainability: unchanged in product; test coverage protects the source-context contract.
- Navigation predictability: stronger structurally across all three current queue destinations.
- Accessibility: focus continuation is explicitly covered by the regression design; execution and screen-reader announcement quality remain unverified.
- Mobile/tablet: 390px containment/mobile return-focus is included; tablet execution remains unverified.
- Capability preservation: green by design; test-only change plus workflow wiring.

### Decision log
- One shared browser regression for all current queue destinations: **BUILD NOW** — implemented.
- Three route-specific harnesses: **REJECT** — duplicate test ownership.
- Further navigation abstraction before this regression executes: **BUILD NEXT** only after evidence.
- Repeat generic competitor research: **REJECT** this run.

### Still unverified
Actual execution of the new browser regression, full screen-reader behaviour, tablet end-to-end focus, real manager first-click/time-on-task/error delta, and hosted source-bound proof. Cycle 10 promotion remains gated on exact hosted proof.

## r5 — source-confirmed decisions separated from automation

### Journey reviewed
Manager action leaves Today, the authoritative owning workflow reaches a terminal source state, then the manager returns to Today and sees a source-confirmed receipt rather than an automation receipt.

### Reuse / duplicate check
- Reused the existing Cycle 11 lifecycle model, `sourceResolution()` contract, return marker and collapsed receipt pattern.
- Did not create a second receipt system or move source authority into the queue.
- Kept `Handled automatically` exclusive to explicit automation receipts.

### Implementation / design delta
- Added a separate collapsed `Recently confirmed` lane for source-confirmed human decisions.
- Confirmation is accepted only from structured source workflow state: terminal Absence request status, zero open Time Review exceptions for the exact team, or `signed` Weekly Sign-off status for the exact team.
- A disappearing queue item alone is not confirmation.

### Validation / remaining gap
Focused model/source-state validation was completed in the branch logic, but composed browser execution remained infrastructure-blocked. No confirmation SLA was invented.

## r6 — source-confirmed return regression extension

### Journey reviewed
Manager Today → Absence priority → exact existing request → authoritative source state changes to approved → Back to priority queue → same human decision appears in `Recently confirmed`, the receipt lane opens, focus moves to that receipt, and it does not appear under `Handled automatically`.

### New-UI lineage
All implementation remains on the single canonical Cycle 11 branch `ux/universal-action-queue-20260918-r1` / PR #80. Head after the test delta is `717371f40614d7cee21a9bb9514aefef21d3d580`. No legacy UI, customer-proof, staging or production mutation.

### Reuse / duplicate check
- Extended the existing `.github/scripts/ux-cycle11-context-browser.mjs`; no second browser harness was created.
- Reused the existing Absence fixture, source-bound return marker, source-confirmation resolver, resolved-receipt lane, accessibility focus helper and live-region message.
- Did not add route-specific confirmation logic to the test runner beyond changing the existing authoritative fixture state.
- Did not add a timer/SLA model because no structured confirmation SLA was found in the repository/source contract checked this run.

### Research delta
No competitor/general UX research was repeated. The unresolved question was deterministic verification of the already-approved cross-domain confirmation semantics, not a market-pattern question. Repository search for an existing structured confirmation SLA returned no source contract to reuse; therefore `Needs verification` remains dormant rather than being driven by an invented timeout.

### Hypothesis
Extending the one shared browser regression with a true source-confirmed round trip will protect the most consequential lifecycle distinction—human confirmation versus automation—without adding runtime complexity or duplicate test infrastructure.

### Exact implementation delta
Commit `717371f40614d7cee21a9bb9514aefef21d3d580` extends the existing shared browser regression to:
- open the existing Absence priority;
- mutate only the test fixture's authoritative request state to `approved`;
- return through the existing queue navigation;
- require the matching `Recently confirmed` receipt to exist and receive focus;
- require its collapsed lane to open;
- require the live-region message `The source workflow confirmed the decision.`;
- require zero copies of that human decision under `Handled automatically`.

### Tests and observed result
- Source file update committed successfully to PR #80.
- Post-write fetch confirms the new source-confirmed-return assertions are present in the one existing browser harness.
- GitHub workflow lookup for exact head `717371f40614d7cee21a9bb9514aefef21d3d580` returned no workflow runs, so the known CI execution blocker remains. It was checked once because the test materially changed and was not repeatedly retried.
- Browser execution is therefore **not claimed green**.

### UX scorecard impact
- Calm by default: unchanged; no new runtime surface.
- Dense on demand: unchanged.
- Explainability: stronger test protection for the distinction between source-confirmed human action and automation.
- Navigation predictability: stronger contract around post-decision return and focus.
- Accessibility: deterministic focus/live-region expectations are now encoded in the shared regression; execution and screen-reader quality remain unverified.
- Mobile/tablet: existing 390px path remains in the same harness; no duplicate mobile suite.
- Capability preservation: green by design; test-only delta, no write authority or deterministic calculation change.

### Decision log
- Extend the one shared browser harness with source-confirmed return: **BUILD NOW** — implemented.
- Create a second confirmation-specific browser harness: **REJECT** — duplicate ownership.
- Invent a generic confirmation timeout: **REJECT** until an owning workflow provides a structured SLA.
- Add `Needs verification` timing later from an authoritative source field: **BUILD NEXT** only when such a field exists.
- Repeat external UX research for this already-settled lifecycle rule: **REJECT** this run.

### Still unverified
Execution of the composed browser regression, real screen-reader behaviour, tablet end-to-end focus, real manager first-click/time-on-task/error metrics, and Cycle 10 exact hosted source-bound proof.

### Single next highest-value action
Move to the next unblocked high-value manager journey in the new UI—prefer Weekly Sign-off exception resolution speed—while preserving this one browser harness as the sole queue context/confirmation regression. Do not add confirmation SLA behaviour until the authoritative owning workflow exposes a structured SLA field.

## r7 — Weekly Sign-off continuation focus

### Journey reviewed
Manager opens Weekly Sign-off and selects the existing primary next action (`Resolve exceptions`, `Continue review` or `Check employee totals`).

### New-UI lineage
The change was applied only on `ux/universal-action-queue-20260918-r1` / PR #80, extending the existing Cycle 3 sign-off component inside the canonical new-UI lineage. No legacy UI, customer-proof, staging or production mutation.

### Reuse / duplicate check
- Reused the existing Cycle 3 condensed sign-off desk, its single primary next-action button and existing progressive-disclosure sections.
- Did not create a second exception queue, decision card, sign-off workflow, copied payroll logic or new route.
- Kept the source workflow and existing controls as the only write authority.
- No external UX research was repeated because the unresolved issue was local continuation/focus behaviour, not a market-pattern question.

### Hypothesis
When the manager presses the sign-off desk's existing next action, opening the correct disclosure and moving focus to the first existing unresolved/actionable control should reduce scanning and keyboard travel without changing any decision logic or hiding capability.

### Exact implementation delta
Commit `f349cd3474eb2c6cabdb8148f20b0268f9d92e84` extends `ux-overlay/ux-reset-cycle3.js` with one reusable `openSignoffDetail()` continuation helper. It validates the existing `checks` / `people` / `controls` targets, opens only the existing owning disclosure, prefers an existing exception/resolve/review control, falls back to the first existing interactive control, then to the disclosure summary, and moves scroll/focus there. The existing primary sign-off button now calls this helper instead of only opening and scrolling the disclosure. `window.WFMUXCycle3` exposes the helper for deterministic testing; no authoritative state is mutated.

### Tests and observed result
- Focused isolated helper test: **`UX_SIGNOFF_NEXT_DECISION_FOCUS=PASS`**. It verified that the checks disclosure opens, a structured exception action is preferred over a generic button, focus moves to it, and an invalid target is rejected.
- Post-write branch fetch confirms the exact helper and event wiring are present in the source-owned Cycle 3 component.
- GitHub workflow lookup for exact implementation head `f349cd3474eb2c6cabdb8148f20b0268f9d92e84` returned no workflow runs. The known CI execution blocker was checked once because runtime code changed and was not repeatedly retried.
- Full composed-browser execution and real screen-reader announcement quality are therefore **not claimed green**.

### UX scorecard impact
- Calm by default: unchanged; no new surface or persistent information added.
- Dense on demand: improved continuation into the exact existing detail only when the manager asks for it.
- Explainability: unchanged; existing evidence and controls remain the source owners.
- Navigation predictability: improved within Weekly Sign-off because the primary next action now continues into the opened work rather than stopping at the container.
- Accessibility: improved by deterministic focus continuation; screen-reader quality remains unverified.
- Capability preservation: green by design; no permissions, payroll, sign-off eligibility, tenant, audit or recovery logic changed.

### Decision log
- Reuse the existing sign-off next action and progressive disclosure, adding focus continuation: **BUILD NOW** — implemented.
- Create a new exception panel/queue for sign-off: **REJECT** — duplicate workflow and unnecessary UI.
- Add external research this cycle: **REJECT** — it would not change the bounded continuation fix.

### Still unverified
Full composed-browser execution against the real application, screen-reader behaviour, tablet/mobile end-to-end focus, representative manager time-on-task/error delta, and Cycle 10 exact hosted source-bound proof.

### Single next highest-value action
Extend the existing single composed-browser sign-off check to assert this focus continuation against the real rendered Cycle 3 sign-off fixture, then move to the next unblocked manager journey rather than adding another sign-off abstraction.
