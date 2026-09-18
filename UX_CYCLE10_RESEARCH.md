# UX Cycle 10 — Schedule publication focus

## Journey reviewed
Manager schedule publication: identify coverage/skills risk, inspect the plan only when needed, preserve authoritative publish control.

## Current/emerging pattern
Microsoft Dynamics 365's 2026 Next Best Action direction prioritises work and places the context needed to execute beside the suggested action, reducing context switching. Industrial human-factors guidance from HSE similarly stresses clear priorities, task analysis, and limiting operator overload under abnormal/peak conditions.

## Hypothesis
On schedule publication, putting coverage/risk first and making the wide planning grid an on-demand disclosure when a genuine issue panel exists will reduce visual load and page width while preserving all scheduling and publish capability.

## Acceptance criteria
- Only applies to manager/supervisor/director schedule-publication route.
- Existing coverage/risk panel is preserved and remains visible.
- Existing publish control is preserved; no replacement write action is invented.
- Full planner remains in its original DOM ownership and can be revealed in one action.
- Planner is only collapsed when a real issue/risk panel is detected; otherwise the grid remains visible.
- No page-level horizontal overflow at desktop or 390px mobile in the browser harness.
- Sealed runtime/server checksum contract remains unchanged.

## Decision
BUILD NOW as a bounded presentation-layer experiment on an isolated UX branch. Do not promote until exact composition and browser gates pass. Live/staging task-time improvement remains unverified until hosted visual proof is available.

## UX scorecard intent
Expected improvement: cognitive load, action visibility, responsive containment, predictable progressive disclosure. No claim of measured real-user improvement yet.
