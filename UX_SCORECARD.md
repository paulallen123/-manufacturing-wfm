# WFM UX scorecard

## 2026-09-18 - Cycle 12 r1: unified implementation and future-capability experience

### Journey reviewed
Existing role-first shell -> Today / My day -> Cycle 11 Universal Action Queue -> implementation and new operating capability signals -> owning source workflow -> source-confirmed return.

### Reuse / duplicate check
- Cycle 11 remains the single manager action surface; no replacement dashboard or duplicate decision workflow was added.
- Existing role navigation and specialist routes are preserved.
- The existing UX gate was extended rather than creating another CI workflow.
- New capabilities publish read-only presentation signals and keep their own evidence/write authority.

### Research delta
- Current workforce platforms are moving toward contextual AI, frontline voice, natural-language payroll/time workflows and real-time action orchestration.
- Current manufacturing connected-worker products are making shift handover and in-context execution intelligence first-class workflows.
- The design response is one governed adaptive action surface, not more permanent navigation.

### Implementation completed this run
- Added Cycle 12 governed provider model and registry.
- Added provider slots for implementation, integrations, attendance, agency, manufacturing cost, energy, support, learning, handover, documents and payroll.
- Extended Cycle 11 reason/source taxonomy so those signals can use the existing deterministic ranking and stale-evidence protections.
- Added specialist-role queue reuse for cross-system setup/control tasks.
- Renamed More drawer groups to Launch & configure and Trust & support without changing route ownership.
- Composed Cycle 12 model/UI/CSS after Cycle 11 in the sealed presentation build.
- Added deterministic provider-contract proof and extended the existing UX gate.
- Added design specification covering temporary implementation mode, Shift Handover Intelligence, voice, What changed explanations, manager-edit learning, contextual acknowledgements and Outcome Ledger.

### Validation
- Local Node syntax checks passed for the new Cycle 12 model and UI.
- Deterministic contract proof passed: `UX12_SIGNAL_CONTRACT=PASS`.
- Repository structural checks confirmed Cycle 12 CSS and model -> UI composition after Cycle 11.
- PR #90 is mergeable and remains draft.
- Hosted PR run `35364950404` failed before execution: the only job returned `steps: []` and no downloadable log blob. No UX/product test step ran, so hosted proof remains unavailable rather than red.

### Capability preservation
- No server-side permission, tenant, payroll, schedule, leave, attendance or approval authority moved into presentation.
- Unknown/malformed providers fail closed.
- Provider identity binds signal source and cannot impersonate another capability.
- Separate feature branches are not claimed merged or production-ready.

### Serious-idea decision log
- Separate implementation dashboard: REJECT - becomes another permanent product area and recreates navigation density.
- Put implementation exceptions into the same action grammar: BUILD NOW - implemented contract.
- Add every new feature to primary navigation: REJECT - primary navigation remains role-first and stable.
- Shift Handover Intelligence: BUILD NEXT - strong manufacturing-specific value and fits the source-signal model.
- Voice/hands-free consequential approvals without confirmation: REJECT - voice may assist, but write authority and explicit confirmation remain.
- Outcome Ledger: BUILD NEXT - closes the learning loop between predicted and verified operational value.

### Next highest-value action
Bind the one-day implementation readiness engine to the `implementation` provider first, then use the same adapter pattern for integrations, attendance, agency, cost/energy and support. Do not fork the UI for any of them.
## 2026-09-18 — Cycle 11 r5: authoritative return confirmation without automation ambiguity

### Journey reviewed
Manager Today → Universal Action Queue → existing Absence / Time Review / Weekly Sign-off source workflow → decision completed in the source → return to Today.

### Reuse / duplicate check
- PR #80 and the existing Cycle 11 branch remain the single new-UI owner; no new branch, page, decision card or workflow was created.
- Reused the existing Cycle 11 lifecycle model, source-bound return marker, authoritative Absence request state, payroll/time-review report, weekly-sign-off report and existing receipt presentation.
- Reused the existing quality gate rather than creating another test workflow.
- No old-shell code was changed or used as a UX implementation surface.

### Research delta
No competitor/general UX research was repeated. The problem was a verified product-semantic gap: the existing model classified any resolved action in the same receipt bucket as automation, while the UI labelled that bucket `Handled automatically`. That could falsely imply a manager/payroll judgment had been automated. Internal authoritative source state was sufficient to resolve the design decision.

### Hypothesis
If source-confirmed human decisions are kept separate from automation receipts, and a returned manager receives confirmation only when the authoritative source explicitly reports a terminal state, the queue will be more explainable without adding dashboard density or moving write authority into the UI.

### Implementation completed this run
- Extended `ux-reset-cycle11-model.js` so unresolved actions, automated receipts and source-confirmed human resolutions are separate deterministic collections.
- `Handled automatically` now remains automation-only.
- Added a collapsed `Recently confirmed` lane for human decisions that the authoritative source explicitly confirms.
- Extended the existing return marker with structured source, reason and title context rather than creating a second context mechanism.
- Added one reusable `sourceResolution()` primitive:
  - Absence resolves only from explicit terminal request states (`approved`, `rejected`, `declined`, `cancelled`, `withdrawn`).
  - Time Review resolves only when the current source report shows zero open exceptions for the exact structured team `sourceId`.
  - Weekly Sign-off resolves only when the exact current source team reports `signed`.
- If the task remains active, focus returns to the existing action. If the source confirms resolution, the `Recently confirmed` receipt is opened/focused for continuity. If neither can be verified, no resolved claim is invented.
- No SLA was invented. `Needs verification` remains available in the model but will only be driven when a source workflow exposes an authoritative SLA/confirmation contract.
- Code commits this run: `0023e816897f2795917f42ee1f77e828bde6776e`, `b5b13468650dac93272b7ddb2bdead538286b868`, gate commit `b8838494e140adebe62e237173b9403736507aaf`.

### Focused validation
- `node --check` passed locally for the revised Cycle 11 model and UI source.
- Focused model test: automation receipt vs source-confirmed human decision separation passed: `UX11_RESOLUTION_MODEL=PASS`.
- Focused VM/source-state test passed for all three authoritative confirmation paths: pending Absence does not resolve; approved Absence resolves; open Time Review does not resolve; zero-open exact team resolves; unsigned Weekly Sign-off does not resolve; signed exact team resolves; human resolution remains outside automation receipts: `UX11_SOURCE_CONFIRMATION_VM=PASS`.
- Local headless Chromium composition could not run because the managed browser blocks both localhost and `file:` URLs by organisation policy. This is recorded as environment-blocked, not a product pass/fail.
- After the meaningful branch change, GitHub was checked once. Run `35360490269` at exact head `b8838494e140adebe62e237173b9403736507aaf` still failed before execution: the single job contains `steps: []`, `runner_id: 0`, and no runner name. The known zero-step infrastructure blocker was therefore not retried.

### UX scorecard impact
- Calm by default: preserved; both automation and resolved history remain collapsed.
- Dense on demand: improved; confirmation evidence appears only after the relevant source workflow has been visited and explicitly confirms resolution.
- Explainability: improved materially; human judgment can no longer be represented inside `Handled automatically`.
- Authority/audit semantics: improved; resolution is source-confirmed and source evidence is shown, while write authority remains in the owner workflow.
- Navigation predictability: improved; return focus now handles both still-active tasks and source-confirmed resolved tasks.
- Interaction count: unchanged for active work; resolution confirmation does not add a required navigation step.
- Accessibility: confirmation receipt receives programmatic return focus and live-region text; screen-reader announcement quality remains unverified.
- Mobile/tablet: no layout code changed; existing responsive containment remains unchanged.
- Capability preservation: green; no server-side permission, payroll, leave, sign-off, tenant, audit or recovery logic moved into the presentation layer.

### Serious-idea decision log
- Put all resolved actions under `Handled automatically`: **REJECT** — misrepresents human judgment.
- Create a second resolution/audit subsystem: **REJECT** — duplicates source ownership and existing lifecycle model.
- Reuse authoritative source state to create a separate `Recently confirmed` lane: **BUILD NOW** — implemented.
- Infer resolution because a card disappeared: **REJECT** — disappearance is not authoritative confirmation.
- Invent a generic confirmation SLA in the UI: **REJECT** — no structured source SLA is available.
- Add `Needs verification` only when the owning workflow exposes an authoritative SLA/confirmation contract: **BUILD NEXT**.

### Still unverified
Composed browser execution on the actual sealed runtime, screen-reader behaviour, 320/390/tablet return-focus after a real write, actual first-click/time-on-task/error-rate impact, source-provided confirmation SLA availability, and exact hosted proof. Cycle 10 promotion remains gated on exact source-bound hosted proof.

### Single next highest-value action
Extend the existing single Cycle 11 composed-browser regression with one source-confirmed resolution return case (do not create another harness), then inspect the owning workflows for an explicit structured confirmation/SLA signal. If none exists, do not invent one; move to the next unblocked new-UI manager journey.

## 2026-09-18 — Cycle 11 r3: source-team context continuation

### Journey reviewed
Manager Today → Universal Action Queue → team-level Time Review or Weekly Sign-off priority → existing new-UI owning workflow → return to the priority queue.

### Reuse / duplicate check
- PR #80 remains the canonical Cycle 11 new-UI owner; no replacement branch or parallel navigation mechanism was created.
- Existing `sourceId`, return marker, Cycle 7 `#tri-team` Time Review scope control, Cycle 3 `#review-team` Weekly Sign-off scope control, `.tr-list` decision surface and `.ux-signoff-desk` were reused.
- The previous Absence exact-card continuation remains unchanged; no second Decision Card, filter, write path or source calculation was created.
- Open reliability PR #81 is a separate proof/admission concern and does not overlap this UI source ownership.

### Research delta
No external competitor/general UX scan was repeated. The unresolved question was whether the existing new UI already exposes stable structured scope controls for Time Review and Sign-off. Existing Cycle 7 browser-harness evidence shows `#tri-team` and `.tr-list/.tr-person`; existing Cycle 3 source ownership uses `#review-team` to select the authoritative team and renders `.ux-signoff-desk`. That evidence was sufficient to make the implementation decision.

### Hypothesis
If a manager opens a team-level priority and the destination reuses the existing authoritative team selector before focusing the existing decision surface, the handoff should remove wrong-team hunting without duplicating workflow logic or guessing from presentation text.

### Implementation completed this run
- Extended only `ux-overlay/ux-reset-cycle11.js` on the canonical Cycle 11 branch.
- Added one reusable `selectSourceScope()` helper that changes an existing selector only when an exact option value matches the structured `sourceId`; no loose text/name matching is allowed.
- Time Review now aligns `#tri-team` to the queue item's structured team source before focusing the existing first actionable `.tr-person`, with `.tr-list` as the safe structural fallback.
- Weekly Sign-off now aligns `#review-team` to the queue item's structured team source before focusing the existing `.ux-signoff-desk`, with the original `.review-layout` as fallback during render transition.
- The existing change event is dispatched so the owning workflow performs its normal render/data selection; no Time Review or Sign-off write authority moved into Cycle 11.
- Focus handling now preserves naturally focusable controls instead of forcing `tabindex=-1`; non-focusable destination surfaces are made programmatically focusable only for context continuation.
- Commit: `a28ac91de985cc8fe3336ea446c3dcb91bc1ebab`.

### Focused validation
- Commit diff verified as a single-file Cycle 11 navigation delta; no model, business rule, server, payroll, tenant, approval or audit code changed.
- Reused source controls verified from existing new-UI evidence: Cycle 7 browser harness contains `#tri-team` and `.tr-list/.tr-person`; Cycle 3 sign-off source uses `#review-team` and owns `.ux-signoff-desk`.
- Isolated Node delta harness: exact source option selected, one bubbled `change` dispatched, duplicate same-scope dispatch suppressed, Time Review target focused after scope alignment, Weekly Sign-off decision surface focused safely: `UX11_CONTEXT_DELTA=PASS`.
- Current commit has no GitHub status/check result exposed. The known zero-step Cycle 11 CI infrastructure blocker was not manually retried.

### UX scorecard impact
- Calm by default: preserved; no new page or visible control was added.
- Dense on demand: improved structurally; the manager enters the already-filtered owning workflow rather than adding queue detail.
- Explainability: preserved; source workflow and reason remain in the queue, while source-specific evidence remains in the owner.
- Navigation predictability: improved structurally across all three current queue destinations — Absence exact request, Time Review team scope, Weekly Sign-off team scope.
- Interaction count: structurally removes the manual team-filter step where the structured team option exists; real browser/user time-on-task remains unmeasured.
- Accessibility: improved by preserving native focusability and moving programmatic focus to the destination; screen-reader announcement quality remains unverified.
- Mobile/tablet: no layout code changed; existing responsive containment remains unchanged, but composed end-to-end focus behaviour is still unverified.
- Capability preservation: green by design; existing selectors, render paths and decision authority are reused.

### Serious-idea decision log
- Create separate Time Review/Sign-off queue destination screens: **REJECT** — duplicate workflow ownership.
- Infer teams from visible text/name matching: **REJECT** — not sufficiently authoritative or deterministic.
- Reuse exact structured `sourceId` to align existing team selectors: **BUILD NOW** — implemented.
- Generalise the same exact-source continuation primitive to future queue sources: **BUILD NEXT** only when their stable source controls/identifiers are verified.
- Repeat competitor research: **REJECT** this run — no unresolved external design question.

### Still unverified
Exact composed-browser behaviour after the team-selector change event, async render timing on the sealed runtime, screen-reader announcement quality, 320/390/tablet end-to-end focus, actual first-click/time-on-task delta and hosted source-bound proof. Cycle 10 promotion remains gated on exact hosted proof.

### Single next highest-value action
Add one focused composed-browser regression covering queue → Absence exact request, queue → Time Review exact team, queue → Sign-off exact team, plus return-focus, using the existing Cycle 7/Cycle 3 harness assets rather than creating separate test harnesses; then use that evidence to decide whether Cycle 11 context continuation is structurally complete.

## 2026-09-18 — Cycle 11 r2: direct source-context continuation

### Journey reviewed
Manager Today → Universal Action Queue → a specific pending absence request → the existing new-UI Absence decision card → return to the priority queue.

### Reuse / duplicate check
- Confirmed the new role-first `ux-reset.js` already contains the rich manager Absence decision surface: annual entitlement, remaining balance, projected balance after approval, available balance after pending requests, approved/pending colleagues off, staffing/skill coverage, existing Review/Approve actions, and fresh-check messaging.
- Therefore did **not** rebuild or restyle the Absence card and did **not** reuse the legacy 0.6.139 experiment. The existing new-UI card remains the single owner.
- Existing Cycle 11 queue, return marker and source deep-link were extended rather than forked.

### Research delta
No new external scan was required. The unresolved problem was implementation-level context loss, and existing evidence already supports exception-first navigation plus progressive disclosure. Re-running competitor/general UX research would not change this decision.

### Hypothesis
If a manager opens an Absence priority from Today and lands on the exact existing request card, rather than only opening the Absence page, the journey should remove search/hunting interactions without duplicating evidence or moving decision authority into the queue.

### Implementation completed this run
- Updated the existing Cycle 11 queue on the canonical new-UI branch `ux/universal-action-queue-20260918-r1`; no new branch or replacement module was created.
- Queue action buttons now carry the existing structured `sourceId`.
- The existing return marker now preserves `sourceId` together with queue item and route.
- On the Absence route, Cycle 11 finds the matching existing `.ux-leave-card[data-request]`, scrolls it into view and programmatically focuses that exact card.
- Existing `Back to priority queue` behaviour and focus restoration to the originating queue action remain intact.
- Server-side permissions, approval logic, leave calculations, staffing/skill rules and audit authority remain unchanged.
- Commit: `ef6f8e2a64298d877fcdccfb2d22cef8e89affb1`.

### Focused validation
- Source ID emitted on the queue button: PASS.
- Source ID persisted through the route marker: PASS.
- Correct matching Absence card selected from multiple request cards: PASS.
- Target made programmatically focusable, scrolled to centre and focused: PASS.
- Focused Node harness result: `UX11_SOURCE_CONTEXT_FOCUS=PASS`.
- GitHub returned no workflow status/run for the new commit; the already-known Cycle 11 CI infrastructure blocker was not repeatedly retried.

### UX scorecard impact
- Calm by default: preserved; no new dashboard density or duplicate evidence.
- Dense on demand: improved structurally; rich Absence evidence remains only in the owning workflow.
- Explainability: preserved; queue reason/evidence/authority stays visible and source detail remains authoritative.
- Navigation predictability: improved structurally by maintaining exact task context across the deep link.
- Interaction count: expected to reduce by removing manual request search after opening Absence; not yet browser/user measured.
- Accessibility: programmatic focus continuation added; full screen-reader/browser validation remains open.
- Mobile/tablet: no layout code changed; existing Cycle 11 containment remains unchanged, but end-to-end responsive focus behaviour remains unverified.
- Capability preservation: green by design; existing Absence functionality was reused, not replaced.

### Serious-idea decision log
- Rebuild the rich Absence card in Cycle 11: **REJECT** — duplicate of the existing new-UI owner.
- Preserve exact source context from queue into existing Absence card: **BUILD NOW** — implemented.
- Generalise exact-card focus to Time Review and Weekly Sign-off: **BUILD NEXT** only after confirming stable authoritative target identifiers in those existing new-UI workflows.
- Re-run generic competitor research this cycle: **REJECT** — no unresolved decision justified the cost.

### Still unverified
Actual browser route transition/focus on the composed application, screen-reader announcement quality, 320/390/tablet end-to-end behaviour, first-click/time-on-task delta, and exact hosted proof. Cycle 10 promotion remains gated on its source-bound hosted proof.

### Single next highest-value action
Inspect the existing new-UI Time Review and Weekly Sign-off surfaces for stable source-bound target identifiers; if present, extend the same source-context primitive rather than creating route-specific duplicate navigation logic, then validate the three manager journeys in one focused browser pass when executable browser evidence is available.

## 2026-09-18 — Cycle 10 r5: calm-state false-positive correction

### Journey reviewed
Manager schedule publication on the latest verified main baseline, specifically the boundary between a genuine exception state and a calm/no-action schedule.

### New product evidence
- The source-bound r4 hosted proof deployed exact SHA `6de9a93c9e622ae3a4f5092d97b83090de6be1bf` successfully to the isolated Railway proof service.
- Authenticated browser proof failed because a generic operational-planner panel containing the word `skills` was misclassified as a risk panel. The UX therefore showed `Resolve risk before you publish` even though the schedule had no draft shifts requiring action.
- The same proof showed the visible weekly planner was not tagged by the previous table-oriented planner detector.
- `Export published week` was correctly not treated as the authoritative publish action.

### New research / competitive insight
- Microsoft Dynamics 365 Next Best Action (updated 27 Aug 2026) prioritises only the most time-critical/impactful actions and explains the prioritisation; this supports high-confidence action surfacing rather than keyword-driven urgency.
- UK HSE workload guidance states that people have limited capacity to process displays, alarms, documentation and communications and that excess workload can slow task performance and increase slips/lapses/mistakes. For WFM, a false exception is therefore a UX defect, not merely a cosmetic issue.

### Hypothesis
A conservative exception detector plus a broader structural weekly-planner detector will keep calm schedules calm while still promoting verified coverage/skills exceptions. Safe fallback is visibility of the original planner, never hidden capability.

### Implementation completed this run
- Verified current main moved to `cd2a34d83721d46a46cd3efad6b3632eeb589510`; the six commits since the previous r4 base change only separate-role browser proof files and do not overlap Cycle 10 UX/Docker files.
- Created `ux/planner-focus-20260918-r5` directly from that exact current-main SHA.
- Tightened issue detection so bare words such as `skills`/`risk` cannot activate exception mode; exception evidence must be specific and actionable or quantified.
- Expanded planner detection to recognise non-table weekly surfaces using week navigation + day structure while retaining existing table/scroll wrappers.
- Preserved original publish authority, server-side permissions, tenant isolation, payroll/compliance logic and sealed runtime contract.

### UX scorecard impact
- Calm-by-default: improved structurally; explicit no-risk acceptance gate added.
- Action visibility: expected improve through fewer false priorities; not yet real-user measured.
- Cognitive load: expected improve because false urgency is removed; no real-user speed claim yet.
- Explainability: improved because focus mode now requires verifiable exception evidence.
- Navigation predictability: preserved.
- Accessibility: keyboard/ARIA semantics retained; full audit still open.
- Mobile/tablet: 390px containment remains mandatory; hosted tablet proof still open.
- Expert depth: preserved; planner remains visible in calm state and one action away in genuine exception state.
- Capability preservation: green by design; no write authority was added or removed.

### Serious-idea decision log
- Conservative verified-exception activation: BUILD NOW.
- Non-table weekly-planner structural detection: BUILD NOW.
- Universal deterministic manager Action Queue: BUILD NEXT after Cycle 10 proof.
- AI-only or AI-reordered mandatory work queue: REJECT.
- Optional natural-language/voice entry into the same deterministic queue: EXPERIMENT after the deterministic queue is proven.

### Still unverified
Fresh r5 source/build/browser result, exact hosted r5 interaction, full accessibility audit, tablet-specific hosted proof, and real-user first-click/time-on-task/error metrics.

### Single next highest-value action
Run the r5 risk + no-risk browser gate, then deploy the exact r5 SHA to the isolated proof lane and verify that a no-draft schedule stays calm while a genuine exception fixture remains risk-first.
