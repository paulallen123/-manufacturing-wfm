# WFM UX scorecard

## 2026-09-18 — Cycle 10 r4 + Cycle 11 competitive cross-check

### Journey reviewed
Manager schedule publication on the latest verified main baseline, with a governance cross-check for the planned cross-workflow manager Action Queue.

### New research / competitive insight
- Oracle HCM 26C Workforce Operations Command Center is an adjacent benchmark for exception-first work: it brings urgent scheduling, absence and timecard issues into a focused priority list, orders them by severity/domain and connects each priority to a workforce action. This is first-party product evidence, not independent proof of usability.
- Workday's 17 Sep 2026 WFM announcement reinforces the same direction: unify time, absence, scheduling and labour optimisation for frontline managers, use AI to reduce schedule-change/time-entry administration, and keep configured rules/approvals in the underlying system.

### Hypotheses
1. Cycle 10: putting verified coverage/skills risk ahead of the wide schedule grid, while keeping the grid one action away and preserving the original publish control, should reduce visual load without removing capability.
2. Cycle 11: one deterministic Action Queue that prioritises cross-domain exceptions by severity, deadline and verified operational consequence should reduce route-hunting; AI can explain/navigate but must not create a second authority or ranking path.

### Implementation completed this run
- Verified current main at `4e332475967e73b774f9171a53040ffe901ee403` (`Bound separate-role proof to browser session identity`).
- Confirmed the only changes between the prior Cycle 10 base and current main are separate-role/host-proof files, with no overlap in Cycle 10 UX files or Docker composition.
- Created isolated branch `ux/planner-focus-20260918-r4` directly from that exact current-main SHA.
- Reapplied the bounded Cycle 10 CSS/JS, exact Docker composition after Cycle 9, research record and browser gate without touching server/payroll/tenant/schedule authority logic.
- No production/customer service or authoritative publish write path was changed.

### Validation state
- Source/build/browser gate is wired to the r4 branch and will validate JavaScript syntax, sealed runtime checksum, exact Cycle 9 -> Cycle 10 composition, risk-first hierarchy, keyboard destination focus, ARIA disclosure semantics, one-action planner reveal and 390px page containment.
- Exact hosted proof remains pending until the r4 branch is deployed to a fresh isolated proof service and exercised end-to-end.

### UX scorecard impact
- Role/job clarity: expected improve; not yet re-measured on r4.
- Navigation predictability: preserved; canonical schedule route remains available.
- Action visibility: preserved/improved structurally; original authoritative publish action remains the write authority.
- Cognitive load: structurally reduced by risk-first progressive disclosure; no real-user improvement claim yet.
- Explainability: strengthened by explicit risk-first sequence and deterministic future Action Queue rules.
- Accessibility: keyboard focus and ARIA disclosure semantics are covered by the gate; full accessibility audit remains open.
- Mobile/tablet: 390px no-page-overflow assertion remains part of the gate; hosted tablet proof remains open.
- Expert depth: preserved; full planner remains one action away.
- Capability preservation: mandatory and enforced by source/build checks; server-side permissions, tenant isolation and workforce calculations remain untouched.

### Serious-idea decision log
- Cycle 10 exception-first schedule publication: BUILD NOW / gated from promotion pending exact hosted proof.
- Universal deterministic manager Action Queue: BUILD NEXT after Cycle 10 proof.
- AI-only or AI-reordered mandatory work queue: REJECT.
- Optional natural-language/voice entry into the same deterministic queue: EXPERIMENT only after the non-AI queue is proven.

### Still unverified
Fresh r4 workflow result, immutable hosted source identity, authenticated hosted schedule-publication interaction, full accessibility audit, and real-user first-click/time-on-task/error metrics.

### Single next highest-value action
Run the r4 gate, deploy the exact r4 branch to a fresh isolated Railway proof service, bind the deployment back to the branch/commit, and execute the authenticated hosted schedule-publication journey before beginning Cycle 11 code.
