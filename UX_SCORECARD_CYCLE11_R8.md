# WFM UX scorecard — Cycle 11 r8

## Journey reviewed
Manager Today → Universal Action Queue → exact Weekly Sign-off team → existing Cycle 3 condensed sign-off desk → existing primary next action → exact existing review/exception control → return to originating queue action.

## New-UI lineage
All work is on the single canonical new role-first branch `ux/universal-action-queue-20260918-r1` / PR #80. No legacy/0.6.139 UX work and no customer-proof, staging or production mutation.

## Reuse / duplicate check
- Extended the existing `.github/scripts/ux-cycle11-context-browser.mjs`; no second browser harness was created.
- Loaded and exercised the existing `ux-reset-cycle3.js` sign-off component rather than recreating sign-off behaviour in the test fixture.
- Reused the existing Cycle 11 `sourceId`, exact team selector, destination focus, `Back to priority queue` and return-focus behaviour.
- Reused the existing Cycle 3 `openSignoffDetail()` continuation helper and the owning workflow's existing `data-act` controls.
- No payroll, sign-off eligibility, permission, tenant, audit, calculation or source-state logic was copied into the queue or test.

## Research delta
No external competitor/general UX research was repeated. The unresolved question was whether the already-built Weekly Sign-off focus continuation works when reached through the composed new-UI queue and the real Cycle 3 renderer. Additional market research would not change that validation decision.

## Hypothesis
If the shared browser regression composes the actual Cycle 3 sign-off renderer, then a manager entering Weekly Sign-off from a structured queue priority should be able to continue from the sign-off desk's existing primary action directly into the first existing actionable review/exception control without a second interaction model or duplicated workflow.

## Exact implementation/design delta
Commit `66bfb8d27df4bcd37ec16a567dfdf19715d2c841` updates only the existing shared Cycle 11 browser regression. It:
- loads the real `ux-reset-cycle3.js` before Cycle 11, matching product composition order;
- replaces the previous synthetic pre-built sign-off desk with a minimal source-owned weekly-review fixture that Cycle 3 actually condenses;
- preserves structured `#review-team` rerender behaviour so Cycle 11 can select the exact team by `sourceId`;
- uses a returned-week fixture so the existing sign-off desk exposes its current `Continue review` action;
- after queue → exact Weekly Sign-off team focus, clicks that existing primary action and requires the `checks` disclosure to open;
- requires focus to move to the existing structured `data-act="review-exceptions"` control, proving continuation reaches the owning work rather than only a container;
- then continues through the existing return-focus regression.

## Tests and observed result
- `node --check` passed for the revised browser regression before commit.
- Local source assembly and syntax checks passed for the Cycle 3, Cycle 11 model and Cycle 11 UI files used by the composed test.
- A local Chromium execution attempt was made once. The managed browser replaced the localhost fixture with the organisation-policy page `127.0.0.1 is blocked`, so browser execution is environment-blocked rather than a product pass/fail.
- GitHub workflow lookup for exact implementation head `66bfb8d27df4bcd37ec16a567dfdf19715d2c841` returned no workflow runs. The known zero-step/no-execution CI blocker therefore remains and was not repeatedly retried.
- Composed-browser behaviour is **not claimed green** until executable browser evidence exists.

## UX scorecard impact
- Calm by default: unchanged; no runtime UI was added.
- Dense on demand: protected; the existing sign-off desk still reveals detail only when the manager asks to continue.
- Explainability: unchanged in runtime; validation now protects the hand-off from queue context to source-owned work.
- Navigation predictability: stronger test contract from queue → exact team → sign-off desk → exact existing next-decision control → return.
- Accessibility: focus-continuation expectations are now encoded end-to-end in the single shared regression; real screen-reader behaviour remains unverified.
- Mobile/tablet: the same harness still contains the 390 px containment/return-focus path; this run added no duplicate responsive suite.
- Capability preservation: green by design; test-only delta with no source authority or business-rule mutation.

## Serious-idea decision log
- Create a second sign-off-specific browser harness: **REJECT** — duplicate test ownership.
- Keep using a synthetic pre-built sign-off desk: **REJECT** — would not validate the real Cycle 3 continuation path.
- Compose the real Cycle 3 renderer inside the existing shared queue regression: **BUILD NOW** — implemented.
- Add more sign-off abstraction before this path executes: **REJECT for now** — validation first.
- Repeat generic UX/competitor research: **REJECT this run** — no unresolved external design question.

## Still unverified
Executable composed-browser pass, real screen-reader behaviour, tablet end-to-end focus, representative manager first-click/time-on-task/error-rate delta, and Cycle 10 exact source-bound hosted proof.

## Single next highest-value new-UI action
Inspect the next unblocked high-friction manager journey for a measurable interaction-cost reduction, starting with Time Review exception resolution. Reuse the existing queue/source-context/focus primitives and existing Time Review controls; do not create another queue, route or test harness. If the Time Review owner already provides a direct actionable control, extend the same continuation pattern and add it to this one browser regression only after the implementation delta is justified.
