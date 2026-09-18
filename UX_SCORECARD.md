# WFM UX scorecard

## 2026-09-18 — Cycle 10 r2 + Cycle 11 authority disclosure

### Journey reviewed
Manager schedule publication on the latest verified main baseline, plus the future cross-workflow manager Action Queue trust/authority model.

### Research / competitive insight
- Microsoft Dynamics 365 2026 Next Best Action prioritises actions across workflows, surfaces them in the flow of work and provides reasoning for prioritisation. Treat this as directional first-party evidence, not independent WFM usability proof.
- UKG Frontline Assist's current AI transparency card explicitly separates view capabilities from state-changing action capabilities, scopes actions to existing user entitlements, identifies human approval for action capabilities and exposes an audit trail. Treat this as useful interaction/governance evidence, not proof of superior usability.

### Hypotheses
1. Cycle 10: putting verified coverage/skills risk ahead of the wide schedule grid, while keeping the grid one action away and preserving the original publish control, should reduce visual load without removing capability.
2. Cycle 11 experiment: an authority line on AI-assisted Decision Cards — `Source workflow · AI role · Authority required · Evidence freshness` — should reduce confusion between recommendation and executable authority without increasing scan-to-correct-action time by more than 10%.

### Implementation completed this run
- Rebuilt the existing Cycle 10 presentation layer from current main `dd63d3055ffb85cf55c7d745fcc76ba98d205eae` on isolated branch `ux/planner-focus-20260918-r2` rather than forcing the diverged older UX branch.
- Restored Cycle 10 CSS/JS, exact Docker composition after Cycle 9, keyboard destination focus, `aria-controls` / `aria-expanded` disclosure semantics and the bounded Cycle 10 gate.
- Opened draft PR #64 against main. No production/customer deployment, server logic, tenant isolation, payroll logic, schedule authority or original publish write path was changed.
- Added the Cycle 11 authority-disclosure acceptance concept to issue #54; implementation remains gated behind Cycle 10 proof.

### Validation observed
- Cycle 10 source-safety checks: PASS on run `35305280974`, attempt 1.
- Exact Docker/sealed composition: PASS; Cycle 10 was present after Cycle 9 and the sealed base runtime/server contract remained unchanged.
- Browser interaction attempt 1: NOT PROVEN. Chrome's DevTools endpoint never became reachable (`ECONNREFUSED 127.0.0.1:9261`) before any Cycle 10 browser assertion executed. This is classified as a browser-runner startup failure, not a product pass or product defect.
- A rerun of the failed job has been started. Promotion remains blocked until the browser gate is green and exact hosted proof is obtained.

### UX scorecard impact
- Role/job clarity: candidate preserved/improved by risk-first schedule publication; not newly measured with real users.
- Navigation predictability: preserved; canonical routes remain available.
- Action visibility: original authoritative publish action preserved; future Action Queue design strengthened with explicit source/authority semantics.
- Cognitive load: candidate structurally reduces planner density; no real-user improvement claim yet.
- Evidence/explainability: strengthened — future AI-assisted cards must identify source workflow, AI role, required authority and evidence freshness.
- Accessibility: Cycle 10 semantics are implemented, but browser re-verification on r2 and a full accessibility audit remain open.
- Mobile/tablet: prior Cycle 10 candidate proved 390px containment; r2 must re-prove it before promotion.
- Expert depth: preserved; full planner remains one action away.
- Capability preservation: source/build gates passed; no authoritative write logic moved into presentation.

### Still unverified
Exact Cycle 10 browser interaction on r2, isolated hosted Cycle 10 runtime proof, full accessibility audit, real-user first-click/time-on-task/error metrics, and the Cycle 11 mixed-signal/authority-comprehension experiment.

### Single next highest-value action
Get the Cycle 10 r2 browser gate green, then create a fresh isolated hosted service directly from the exact r2 GitHub branch/commit so the proof is not dependent on the previously stale source snapshot path. Only after that should the universal Action Queue be implemented and stress-tested.
