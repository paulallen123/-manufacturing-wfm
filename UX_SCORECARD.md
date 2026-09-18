# WFM UX scorecard

## 2026-09-18 — Cycle 10 r3 reconciliation + Cycle 11 workload-density research

### Journey reviewed
Manager schedule publication on the latest verified main baseline, with a governance check on the planned cross-workflow Action Queue.

### New research / competitive insight
- Microsoft Dynamics 365 Next Best Action (updated 27 August 2026; September 2026 availability) prioritises the most important actions across agent/workflow sources and places execution context beside the suggested action so users do not need to context-switch.
- HSE human-factors guidance says operator workload should be assessed for both normal and peak/abnormal conditions, priorities must remain clear, and inexperienced operators can require more cognitive effort than experienced operators for the same task.
- Design implication: keep one deterministic priority order and one canonical workflow owner, but EXPERIMENT later with two presentation densities for the universal Action Queue: guided Decision Cards for new/occasional users and a compact expert view. Density must never hide mandatory blockers or change authority.

### Hypotheses
1. Cycle 10: putting verified coverage/skills risk ahead of the wide schedule grid, while keeping the grid one action away and preserving the original publish control, should reduce visual load without removing capability.
2. Cycle 11 experiment: different presentation density can improve novice scan/comprehension without slowing experts, provided ranking, mandatory visibility, permissions and workflow ownership remain identical.

### Implementation completed this run
- Detected that main advanced 14 commits beyond PR #64's base. PR #64 therefore became non-mergeable; no attempt was made to force the stale branch over current work.
- Created isolated branch `ux/planner-focus-20260918-r3` from current main `5a1502edebadc8d1bcec3972a54de5eacb49def3`.
- Reapplied only the bounded Cycle 10 presentation files and Docker composition after Cycle 9. The 14 newer main commits remain in the branch because r3 starts from current main.
- Opened draft PR #66 against current main. Server-side tenant, payroll, schedule, permission and publish-write authority remain untouched.

### Validation observed
- Git compare confirms current main is 14 commits ahead of the r2 base; those commits affect live-host/deployment proof tooling rather than the Cycle 10 UI files.
- Exact Cycle 10 r3 functional head `0c38f54dee63090d2c408daf742259f67cc29f4a` passed GitHub Actions run `35309376503`.
- Source-safety checks: PASS.
- Exact Docker/sealed composition after Cycle 9: PASS; sealed runtime/server checksum contract unchanged.
- Browser hierarchy/disclosure: PASS.
- Keyboard focus destinations for Coverage & risks and authoritative Publish schedule: PASS.
- 390px mobile containment/original publish-control preservation: PASS.
- A fresh isolated Railway service `wfm-ux-cycle10-r3-proof` was created from the r3 branch. At the time of this record Railway had not yet materialised a first deployment, so hosted proof is not claimed.

### UX scorecard impact
- Role/job clarity: candidate structurally improves schedule publication by putting risk ahead of grid density; no real-user improvement claim yet.
- Navigation predictability: preserved; existing schedule route and publish control remain canonical.
- Action visibility: preserved; no write action is cloned.
- Cognitive load: structurally reduced by progressive disclosure; real-user impact remains unmeasured.
- Explainability: Cycle 11 research strengthens the need for identical deterministic ordering across novice/expert density modes.
- Accessibility: keyboard/disclosure behavior is browser-verified on r3; full accessibility audit remains open.
- Mobile/tablet: 390px containment is browser-verified on r3.
- Expert depth: preserved; full planner remains available on demand.
- Capability preservation: source/build/browser gates passed and authoritative write logic remains outside the presentation layer.

### Still unverified
Exact isolated hosted Cycle 10 runtime proof, full accessibility audit, real-user first-click/time-on-task/error metrics, and Cycle 11 novice-vs-expert density measurements.

### Single next highest-value action
Materialise and prove the exact r3 branch in the fresh isolated Railway service, verify served Cycle 10 markers and interactions, then close the superseded r2 PR. Only after hosted proof should Cycle 11 implementation begin.
