# UX Cycle 10 — Schedule publication focus

## Journey reviewed
Manager schedule publication, including the important no-risk state: identify genuine coverage/skills risk, inspect the plan only when needed, and preserve the authoritative publish control.

## New verified product evidence — 18 Sep 2026
The exact hosted r4 candidate was source-bound to `6de9a93c9e622ae3a4f5092d97b83090de6be1bf` and deployed successfully to the isolated Railway proof service. The authenticated browser proof then failed for a useful product reason rather than infrastructure: the Cycle 10 detector treated the generic text `Build the week around demand, skills and actual decisions` as a risk signal because it contained the word `skills`. That incorrectly activated the risk-first focus card on a calm/no-draft schedule. The same proof also showed that the real weekly planner was visible but not identified by the narrow table-only detector. `Export published week` was correctly rejected as publish authority.

## Current/emerging pattern
Microsoft Dynamics 365 Next Best Action (updated 27 Aug 2026) is explicitly designed to surface the most time-critical and impactful actions and explain why they matter, not to turn every contextual signal into an action. UK HSE workload guidance likewise notes that people have limited capacity to process displays, alarms, documentation and communications; excessive information can slow performance and increase error. For this WFM design the practical implication is strict: exception-first presentation must be activated by verified actionable exception evidence, not keyword presence.

## Hypothesis
If Cycle 10 uses a high-confidence exception detector and a broader structural planner detector, then a calm schedule will stay calm while a true coverage exception still becomes the primary decision surface. This should reduce false urgency without removing planner depth.

## Acceptance criteria
- Only applies to manager/supervisor/director schedule-publication route.
- No-risk fixture produces `calm`, no duplicate focus card, zero added jump controls, and leaves the planner visible.
- Generic planning copy containing words such as `skills` or `risk` cannot on its own activate focus mode.
- Genuine exception fixture with quantified/actionable coverage evidence produces `active` and keeps the issue visible.
- Existing authoritative publish control is preserved; `Export published week` is never tagged as publish authority.
- Full planner remains in original DOM ownership, is detected even when implemented as a non-table weekly surface, and can be revealed in one action when focus mode is active.
- No page-level horizontal overflow at desktop or 390px mobile in the browser gate.
- Keyboard focus moves to evidence/planner/publish destinations when their jump controls are used.
- Sealed runtime/server checksum contract remains unchanged.

## Evidence strength / risk
Evidence strength: medium-high for the detector correction because it is based on an observed hosted false positive plus synthetic risk/no-risk gates. Real-user task-time evidence remains absent. Primary risk is now false-negative exception detection; therefore the safe fallback is calm mode with the existing planner visible rather than hiding planning capability.

## Decision
BUILD NOW as a bounded correction on an isolated UX branch. Do not promote until the risk and no-risk browser gates plus exact hosted proof pass. Real-user first-click/time-on-task/error measurement and a full accessibility audit remain required before claiming measured superiority.
