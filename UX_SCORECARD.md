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

## 2026-09-18 — Cycle 11 action-queue human-factors guardrail / hosted-proof diagnosis

Journey reviewed: cross-workflow manager action discovery, with special attention to whether a future universal Action Queue could become an alert/event flood; in parallel, the exact hosted proof path for Cycle 10 schedule publication was re-validated.

Research / competitive insight:
- Industrial alarm-management guidance provides a stronger independent human-factors model than vendor dashboards: important signals should direct attention to conditions requiring timely action, have an identifiable priority and defined response, remain readable under high activity, and avoid operator overload.
- Microsoft 2026 Next Best Action direction independently supports cross-prioritising work and keeping relevant context beside the action, but this remains first-party product evidence rather than independent WFM usability proof.

Design decision for Cycle 11: BUILD NEXT, but treat the universal queue as a decision surface rather than an event feed. Distinguish ACTION from INFORMATION, keep hard blockers and imminent payroll/compliance/coverage decisions individually visible, group repetitive lower-level signals behind one explainable card without discarding underlying items, and keep consequential writes in their owning workflow until the exact same authority, stale-state, permission and audit semantics can be proven inline. AI may explain ranking or accept an optional intent query, but cannot suppress mandatory actions or become the only route to them.

Measurable hypothesis: on a synthetic burst of at least 50 mixed signals, deterministic prioritisation plus grouping will keep mandatory blockers visible and let a manager reach the correct owning decision in one primary action, while reducing scan-to-correct-action time versus the route-specific baseline. First-click success and decision error rate must be measured separately for novice and expert cohorts; no improvement is claimed yet.

Hosted Cycle 10 verification work completed this cycle:
- Isolated service `wfm-ux-pr37` was repointed from `ux/role-first-simplification-20260917-v2` to `ux/planner-focus-20260917`; customer-proof and staging runtime services were left untouched.
- Railway deployment `d41cb593-4a80-4202-a1bc-049df7cba8e5` completed and passed `/api/health`, but its build still contained UX layers only through Cycle 9.
- GitHub independently confirms the Cycle 10 branch contains `WFM_UX_RESET_CYCLE10` in the Dockerfile and `ux-overlay/ux-reset-cycle10.js` at head `a97eb7cd7243a0fee4bb1f64395b975ee1183de8`.
- The isolated Railway service accepted an exact source commit pin, but redeploy `b61e5431-8dcb-4bfa-9c14-9365f4b7f6d3` again fetched the same source snapshot and built only through Cycle 9 while passing health.
- A documentation-only branch commit `7ae695e41cdb03eb7ef37860b413ee1addc77a5a` was then created solely to force a fresh source revision; the isolated service was pointed at that revision and redeploy `4ba96e3e-4128-48a8-b250-9c40c3d14435` again returned the same source snapshot and Cycle-9-only build, while `/api/health` passed.

Observed conclusion: Cycle 10 code is present in GitHub but is still not being materialised into the isolated Railway build. The exact Railway/GitHub source-snapshot mechanism causing the stale source is not proven, so this is recorded as a source-synchronisation blocker rather than a product defect or a confirmed platform-cache rule. A successful healthcheck is explicitly not accepted as Cycle 10 UX proof when the Cycle 10 markers are absent.

UX scorecard delta:
- Role/job clarity: Cycle 10 candidate unchanged; Cycle 11 expected improvement remains unproven.
- Navigation predictability: preserved; canonical routes remain the control condition.
- Action visibility: Cycle 11 specification strengthened so mandatory actions cannot be buried by grouped informational signals.
- Cognitive load: stronger human-factors acceptance criteria added; no real-user improvement claimed.
- Evidence/explainability: improved governance — every priority card must expose why-now/reason context and a defined response; unknown impact remains unknown.
- Accessibility: no new hosted accessibility evidence this cycle; full audit remains open.
- Mobile/tablet: no regression evidence added this cycle; prior 390px candidate gate remains the latest proof.
- Capability preservation: no customer-facing runtime, permissions, payroll, schedule authority or tenant controls were changed in this cycle.

Still unverified: exact Cycle 10 hosted visual/interaction proof, full accessibility audit, real-user first-click/time-on-task/error metrics, and the Cycle 11 mixed-signal queue experiment.

Single next highest-value UX action: solve the isolated host's stale source-snapshot resolution or use another safe deterministic hosted proof route that can be tied to the exact Cycle 10 commit. Do not promote Cycle 10 until its markers and interactions are proven on that hosted candidate; after that, build and stress-test the deterministic universal Action Queue against mixed synthetic manager actions.
