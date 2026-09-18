# WFM UX scorecard

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
