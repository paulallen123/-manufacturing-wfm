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

## 2026-09-18 — Cycle 10 accessibility hardening / future-interface review

Journey reviewed: schedule-publication keyboard/disclosure path, plus the future cross-workflow manager entry layer.

New implementation on draft PR #50:
- The full-planner disclosure now exposes a programmatic `aria-controls` relationship to the planner it shows/hides.
- `Coverage & risks` now moves keyboard focus to the existing evidence panel instead of only scrolling visually.
- `Go to publish` now moves keyboard focus to the original authoritative publish control instead of only scrolling visually.
- No server-side permission, schedule, payroll, tenant or publish logic moved into the UX layer.

Research / competitive insight: official SAP 2026 Joule/Joule Work material is moving enterprise UX toward intent-based, adaptive workspaces and guided action rather than forcing users to locate the correct application first. Official UKG 2026 material similarly emphasizes real-time workforce intelligence turning into frontline action in the flow of work. This is directional vendor evidence rather than independent usability proof. It supports the planned universal Action Queue / optional intent entry, but not AI-only navigation.

Hypothesis: adding explicit disclosure semantics and destination focus to the Cycle 10 focus strip will reduce keyboard ambiguity without changing the task model; a later optional intent/action entry should reduce route hunting only if it preserves stable canonical navigation and deterministic authority.

Validation result: exact branch run `35293777490` on code head `0ae0c6a881117c5b8233f05e6e3fac28fde08378` passed source safety, exact Docker/sealed-runtime composition and the browser interaction gate. Observed browser evidence included `UX_CYCLE10_KEYBOARD_NAVIGATION=PASS`, `aria-expanded=false/true` with `aria-controls=planner`, zero page-wide overflow at desktop and 390px mobile, and preservation of the original `Publish schedule` control.

Hosted proof attempt: an isolated Railway service `wfm-ux-cycle10-proof` was created against branch `ux/planner-focus-20260917`, but Railway currently reports no first deployment for that service. Existing customer-proof and Cycle 9 UX services were not modified. Hosted Cycle 10 visual/interaction proof therefore remains open.

Reconciliation and exact-current-main validation: current main `d68ef1e920fdb25d41e754341f5a403810fe6700` was merged into the isolated Cycle 10 branch via PR #56. The reconciled candidate then reran Cycle 10 gate `35293936668` on head `7bdbe8ec9311f0b58809a97cd149b6607d368a1b` and completed successfully. PR #50 is again mergeable but remains draft. This validation keeps the Cycle 10 presentation changes aligned with the latest hosted tenant-isolation proof work without promoting them.

UX scorecard delta:
- Role/job clarity: preserved after reconciliation.
- Navigation predictability: preserved.
- Action visibility: preserved.
- Cognitive load: not newly measured with real users.
- Accessibility: improved and browser-verified for disclosure semantics and destination focus; full audit still open.
- Mobile/tablet: exact reconciled run retained zero page-wide overflow at 390px and the publish control.
- Explainability: future intent/action layer remains BUILD NEXT / EXPERIMENT, not default authority.
- Capability preservation: exact reconciled gate passed; authoritative publish and sealed runtime remain unchanged.

Single next highest-value UX action: obtain isolated hosted browser proof of the exact reconciled Cycle 10 candidate. Only after that should the universal Action Queue / optional intent-entry experiment begin, with stable navigation as the control condition and first-click success, route switches and task completion measured rather than assumed.
