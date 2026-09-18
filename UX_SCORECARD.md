# WFM UX scorecard

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
