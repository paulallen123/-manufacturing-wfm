# WFM UX scorecard — Cycle 11 r8–r10

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

## r10 — Performance value-order integrity and branch efficiency guard

### Journey reviewed
Manager/director → Performance → cost & efficiency decision desk → highest-value evidenced decision → more opportunities.

### New-UI lineage / reuse check
- Runtime work stayed on the canonical new role-first branch `ux/universal-action-queue-20260918-r1` / PR #80.
- The existing Cycle 4 Performance desk, cards, YES/NO controls, value fields and browser gate were extended; no replacement dashboard, decision engine, route or test harness was created.
- Time Review `Save & next` was inspected only to the extent supported by available source/test evidence. The source-owned action is preserved, but the sealed authoritative implementation is not visible in the overlay and the current browser infrastructure cannot execute, so no speculative duplicate continuation handler was added.
- A reuse/diff check found Cycle 12 PR #90 had diverged from the active Cycle 11 source owner. PR #90 is now explicitly marked **do not mutate until refreshed** so overlapping UX work is not developed twice.

### Research delta
No external research was repeated. The material issue was internal evidence integrity: Cycle 4 labelled its first card `Highest-value evidenced opportunity`, but the presentation code preserved source array order and did not itself guarantee that the focused waiting item had the highest structured value.

### Hypothesis
If the Performance desk deterministically ranks waiting opportunities by the existing source-provided `value.amountPence`, while preserving original order for ties and pushing unknown/unquantified values behind known values, the UI label `Highest-value evidenced opportunity` becomes true independent of source array order without changing any underlying value calculation or decision authority.

### Exact implementation/design delta
Runtime commit `45b3562ebaddc4495279b45f2cd822ca60f29410` extends only `ux-overlay/ux-reset-cycle4.js`:
- adds one presentation-only `opportunityValue()` helper reading the existing structured source amount;
- preserves card ↔ source-opportunity pairing and its original ordinal;
- sorts only the local `waiting` presentation rows by known value descending, then original ordinal for deterministic ties;
- ranks missing/unquantified values after known values rather than treating them as a reason to claim top value;
- leaves `predictedValueAwaitingPence`, avoidable-cost calculations, YES/NO actions, permissions and source statuses untouched.

Regression commit `755c690f34134937aeafa9153b38ecabca44aabd` extends the existing Cycle 4 gate instead of adding another test system:
- reverses the fixture so the £500 opportunity arrives before the £1,200 opportunity;
- requires `op-a` (£1,200) to become the focused card anyway;
- requires `op-b` (£500) to remain in `More opportunities`;
- retains the existing grouping, preserved YES/NO controls, desktop containment and 390 px mobile checks.

### Focused tests and observed result
- Exact revised Cycle 4 runtime source passes `node --check` in an isolated local syntax check.
- A focused deterministic ordering check returned `UX11_PERFORMANCE_VALUE_ORDER=PASS` for out-of-order, tie and unknown-value cases.
- GitHub workflow lookup for exact regression head `755c690f34134937aeafa9153b38ecabca44aabd` returned no workflow runs/statuses, consistent with the known repository runner pre-execution blocker. It was checked once after the meaningful gate change and not repeatedly retried.
- Full Docker composition, composed Chromium execution and screen-reader behaviour are therefore **not claimed green** for this delta.

### UX scorecard impact
- Calm by default: unchanged; no new visible UI or density.
- Dense on demand: unchanged; one focused decision plus disclosure remains.
- Explainability: improved; `Highest-value evidenced opportunity` is now backed by deterministic structured-value ranking rather than an unproven source-order assumption.
- Decision efficiency: likely improved when source order differs from value order because the largest quantified opportunity is surfaced first; real user time-on-task is still unmeasured.
- Accessibility/mobile: no interaction or layout change; existing controls and responsive rules are preserved.
- Capability preservation: green by design; only presentation ordering changed and no business calculation/write authority moved into UX code.

### Serious-idea decision log
- Add a second Performance queue or ranking service: **REJECT** — duplicate ownership.
- Recalculate savings/value in the presentation layer: **REJECT** — source authority must remain upstream.
- Keep the `Highest-value` label while trusting incidental source order: **REJECT** — explainability mismatch.
- Rank existing waiting cards by their existing structured value with stable ties: **BUILD NOW** — implemented.
- Add a speculative Time Review `Save & next` handler without observable source proof: **REJECT for now** — avoid duplicate or conflicting behaviour.
- Continue adding Cycle 12 changes while its branch is behind active Cycle 11: **REJECT until refreshed** — PR #90 marked accordingly.

### Still unverified
Exact composed Docker/browser pass for the revised Performance ranking, real screen-reader behaviour, representative manager/director time-on-task impact, Time Review post-`Save & next` focus in the sealed runtime, and Cycle 10 exact source-bound hosted proof.

### Single next highest-value new-UI action
Refresh/reconcile the Cycle 12 successor onto the latest Cycle 11 canonical state before doing further successor UX work. If that cannot be performed safely with the available branch tooling, keep PR #90 frozen and inspect the next unblocked current-lineage journey for an evidence-backed defect rather than creating parallel changes.
