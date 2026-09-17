# WFM UX scorecard

## 2026-09-17 — Cycle 10

Journey: manager schedule publication.

- Role/job clarity: improved in candidate — schedule publication now leads with resolve risk before publish.
- Navigation predictability: unchanged — canonical navigation is preserved.
- Action visibility: improved in candidate — the existing publish control remains visible and is linked from the focus strip.
- Cognitive load: structurally reduced in the browser harness — the wide planner is disclosed on demand only when a real risk panel is present. Real-user cognitive-load/time-on-task improvement is not yet measured.
- Error prevention/recovery: unchanged — authoritative schedule and publish logic is untouched.
- Evidence/explainability: improved in candidate — the existing risk panel remains primary and no AI-generated workforce facts are introduced.
- Accessibility: explicit `aria-expanded` disclosure state and focusable local planner are present; the desktop/mobile browser interaction gate passed. Full accessibility audit remains open.
- Mobile/tablet quality: 390px browser containment passed with no page-wide horizontal overflow and the publish control preserved.
- Expert depth: preserved — the full planner remains one action away and stays in its original DOM ownership.
- Capability preservation: passed in the bounded gate — no existing controls are removed or replaced.

Verification status: Cycle 10 source-safety, exact Docker/sealed-runtime composition, desktop browser interaction, one-action planner disclosure, original DOM ownership, publish-control preservation and 390px mobile containment all passed on branch run `35267288833`. The overlapping role-first UX gate also passed on the same candidate line. No failure was returned in the branch Actions page reviewed for this cycle.

Latest verified platform state: main now contains the promoted role-first/Cycle 9 UX. PR #49 records successful outside-in proof against the customer-proof host (Railway deployment `6a21fea9-4dd5-4911-aa17-c792250879bb`, Live Host Proof run `35284796510`) for health, public surfaces, role-first/Cycle 9 JS/CSS markers and unauthenticated fail-closed behavior. Cycle 10 is NOT included in that live proof and remains isolated in draft PR #50.

Unverified: Cycle 10 on the hosted customer-proof runtime; real-user first-click success, time-on-task, error rate and accessibility audit.

Next highest-value action: prove Cycle 10 visually and interactively on an isolated hosted runtime, then compare schedule-publication first-click success and interaction count against the current promoted Cycle 9 experience before any promotion.
