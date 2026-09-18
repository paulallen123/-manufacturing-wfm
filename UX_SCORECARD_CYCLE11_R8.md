# WFM UX scorecard — Cycle 11 r8–r9

## r8 — Weekly Sign-off composed continuation proof contract

### Journey reviewed
Manager Today → Universal Action Queue → exact Weekly Sign-off team → existing Cycle 3 condensed sign-off desk → existing primary next action → exact existing review/exception control → return to originating queue action.

### New-UI lineage
All work is on the single canonical new role-first branch `ux/universal-action-queue-20260918-r1` / PR #80. No legacy/0.6.139 UX work and no customer-proof, staging or production mutation.

### Reuse / duplicate check
- Extended the existing `.github/scripts/ux-cycle11-context-browser.mjs`; no second browser harness was created.
- Loaded and exercised the existing `ux-reset-cycle3.js` sign-off component rather than recreating sign-off behaviour in the test fixture.
- Reused the existing Cycle 11 `sourceId`, exact team selector, destination focus, `Back to priority queue` and return-focus behaviour.
- Reused the existing Cycle 3 `openSignoffDetail()` continuation helper and the owning workflow's existing `data-act` controls.
- No payroll, sign-off eligibility, permission, tenant, audit, calculation or source-state logic was copied into the queue or test.

### Research delta
No external competitor/general UX research was repeated. The unresolved question was whether the already-built Weekly Sign-off focus continuation works when reached through the composed new-UI queue and the real Cycle 3 renderer. Additional market research would not change that validation decision.

### Hypothesis
If the shared browser regression composes the actual Cycle 3 sign-off renderer, then a manager entering Weekly Sign-off from a structured queue priority should be able to continue from the sign-off desk's existing primary action directly into the first existing actionable review/exception control without a second interaction model or duplicated workflow.

### Exact implementation/design delta
Commit `66bfb8d27df4bcd37ec16a567dfdf19715d2c841` updates only the existing shared Cycle 11 browser regression. It:
- loads the real `ux-reset-cycle3.js` before Cycle 11, matching product composition order;
- replaces the previous synthetic pre-built sign-off desk with a minimal source-owned weekly-review fixture that Cycle 3 actually condenses;
- preserves structured `#review-team` rerender behaviour so Cycle 11 can select the exact team by `sourceId`;
- uses a returned-week fixture so the existing sign-off desk exposes its current `Continue review` action;
- after queue → exact Weekly Sign-off team focus, clicks that existing primary action and requires the `checks` disclosure to open;
- requires focus to move to the existing structured `data-act="review-exceptions"` control, proving continuation reaches the owning work rather than only a container;
- then continues through the existing return-focus regression.

### Tests and observed result
- `node --check` passed for the revised browser regression before commit.
- Local source assembly and syntax checks passed for the Cycle 3, Cycle 11 model and Cycle 11 UI files used by the composed test.
- A local Chromium execution attempt was made once. The managed browser replaced the localhost fixture with the organisation-policy page `127.0.0.1 is blocked`, so browser execution is environment-blocked rather than a product pass/fail.
- GitHub workflow lookup for exact implementation head `66bfb8d27df4bcd37ec16a567dfdf19715d2c841` returned no workflow runs. The known zero-step/no-execution CI blocker therefore remains and was not repeatedly retried.
- Composed-browser behaviour is **not claimed green** until executable browser evidence exists.

### UX scorecard impact
- Calm by default: unchanged; no runtime UI was added.
- Dense on demand: protected; the existing sign-off desk still reveals detail only when the manager asks to continue.
- Explainability: unchanged in runtime; validation now protects the hand-off from queue context to source-owned work.
- Navigation predictability: stronger test contract from queue → exact team → sign-off desk → exact existing next-decision control → return.
- Accessibility: focus-continuation expectations are now encoded end-to-end in the single shared regression; real screen-reader behaviour remains unverified.
- Mobile/tablet: the same harness still contains the 390 px containment/return-focus path; this run added no duplicate responsive suite.
- Capability preservation: green by design; test-only delta with no source authority or business-rule mutation.

### Serious-idea decision log
- Create a second sign-off-specific browser harness: **REJECT** — duplicate test ownership.
- Keep using a synthetic pre-built sign-off desk: **REJECT** — would not validate the real Cycle 3 continuation path.
- Compose the real Cycle 3 renderer inside the existing shared queue regression: **BUILD NOW** — implemented.
- Add more sign-off abstraction before this path executes: **REJECT for now** — validation first.
- Repeat generic UX/competitor research: **REJECT this run** — no unresolved external design question.

### Still unverified
Executable composed-browser pass, real screen-reader behaviour, tablet end-to-end focus, representative manager first-click/time-on-task/error-rate delta, and Cycle 10 exact source-bound hosted proof.

## r9 — Time Review selection-to-decision continuation

### Journey reviewed
Manager Today → Universal Action Queue → exact Time Review team → existing Cycle 7 `Needs my action` list → select employee exception → existing source-owned decision/evidence panel.

### New-UI lineage / reuse check
- Work remained on PR #80 and the same new role-first branch; no new branch, route, queue, Time Review screen or decision form was created.
- Reused Cycle 11 exact-team continuation (`#tri-team` + `.tr-person`) and the existing Cycle 7 `.tr-panel`, heading, decision form and source-owned `Save & next` control.
- Did not change payroll calculations, exception rules, write authority, permissions, audit or source data.
- Did not repeat generic UX/competitor research because the unresolved issue was an observed interaction hand-off inside an already-designed workflow.

### Hypothesis
If selecting an employee exception moves focus and viewport into the existing selected-employee decision/evidence panel, managers—especially on single-column/tablet/mobile layouts—should avoid the extra visual search/scroll step between choosing the exception and understanding the decision context, without automating or preselecting a consequential decision.

### Exact implementation/design delta
Runtime commit `dee74539ff0fb0f75117800c1bdc7b16791aa2e8` extends only `ux-overlay/ux-reset-cycle7.js`:
- adds one reusable `focusDecisionPanel()` helper;
- after an existing `.tr-person` selection, waits briefly for the owning workflow's render and then scrolls/focuses the existing `.tr-panel` heading;
- makes only that heading programmatically focusable when required (`tabindex="-1"`), preserving normal tab order;
- deliberately does **not** focus a decision input or click an action, so exception/evidence context remains visible before the manager decides;
- exports the helper through the existing `window.WFMUXCycle7` object for testability/reuse.

### Focused tests and observed result
- `node --check` passed for the exact revised Cycle 7 source used for the commit.
- Static preservation check passed and confirmed no source controls are removed: `UX11_TIME_REVIEW_CONTINUATION_SOURCE=PASS`.
- Focused VM interaction check exercised the actual revised source with a minimal DOM contract and confirmed `.tr-person` selection continues to the existing panel heading, scrolls it into view, applies programmatic-only focusability and preserves the existing form: `UX11_TIME_REVIEW_DECISION_CONTINUATION_VM=PASS`.
- A real local Chromium run was attempted once. The managed browser replaced localhost with the organisation policy page `127.0.0.1 is blocked`; this remains an environment blocker, not a product pass/fail.
- No second committed browser harness was created. The existing shared Cycle 11 composed-browser regression remains the correct owner for a future executable end-to-end assertion.

### UX scorecard impact
- Calm by default: unchanged; no visible controls or dashboard density added.
- Dense on demand: improved continuation into existing detail rather than adding detail to the queue.
- Navigation predictability: improved; queue → team → employee → decision context now has a consistent focus hand-off.
- Accessibility: improved structurally through deterministic programmatic focus on a contextual heading without polluting sequential tab order; screen-reader announcement quality remains unverified.
- Mobile/tablet: expected benefit is strongest when the Time Review layout collapses to one column; actual composed responsive browser proof remains blocked.
- Interaction count: removes a manual scroll/search step after employee selection in the intended flow; representative measured time-on-task is still unverified.
- Capability preservation: green by design; no source decision or business-rule authority moved into UX code.

### Serious-idea decision log
- Auto-click the first employee exception on queue arrival: **REJECT** — too implicit and could surprise users or select the wrong human task.
- Jump directly into the first decision input: **REJECT** — risks bypassing exception/evidence context.
- Focus the existing decision/evidence panel heading after explicit employee selection: **BUILD NOW** — implemented.
- Create a new Time Review drawer/card to mirror the panel: **REJECT** — duplicate source ownership.
- Add a second Time Review-specific browser harness: **REJECT** — reuse the shared Cycle 11 regression when executable browser infrastructure is available.

### Still unverified
Executable composed-browser proof on the real sealed runtime, screen-reader announcement quality, real 390/tablet focus behaviour, measured first-click/time-on-task/error-rate improvement and Cycle 10 exact source-bound hosted proof.

### Single next highest-value new-UI action
Inspect whether the existing Time Review `Save & next` source action already advances to the next unresolved employee with deterministic focus. If it already does, do not duplicate it and move to the next manager journey. If it leaves the manager at a dead focus/scroll position, extend the same `focusDecisionPanel()` continuation after the source-owned next-record render, then protect it in the existing shared browser regression only.
