# UX Cycle 10 — Schedule publication focus

## Journey reviewed
Manager schedule publication: identify coverage/skills risk, inspect the plan only when needed, preserve authoritative publish control.

## Current/emerging pattern
Exception-first operational workspaces increasingly separate urgent action from dense planning detail. Oracle's 26C Workforce Operations Command Center is a useful adjacent benchmark: it focuses top priorities across scheduling, absences and timecards, orders urgent items by severity/domain, and keeps recommended actions connected to the owning workforce workflow. Treat this as first-party product evidence rather than independent usability proof.

## Hypothesis
On schedule publication, putting coverage/risk first and making the wide planning grid an on-demand disclosure when a genuine issue panel exists will reduce visual load and page width while preserving all scheduling and publish capability.

## Acceptance criteria
- Only applies to manager/supervisor/director schedule-publication route.
- Existing coverage/risk panel is preserved and remains visible.
- Existing publish control is preserved; no replacement write action is invented.
- Full planner remains in its original DOM ownership and can be revealed in one action.
- Planner is only collapsed when a real issue/risk panel is detected; otherwise the grid remains visible.
- No page-level horizontal overflow at desktop or 390px mobile in the browser harness.
- Keyboard focus moves to evidence/publish destinations when their jump controls are used.
- Sealed runtime/server checksum contract remains unchanged.

## Evidence strength / risk
Evidence strength: medium. The design is supported by current enterprise/WFM direction and our own structural/browser gates, but not yet by real-user task-time data. Primary risk is over-collapsing the planner when the issue detector misclassifies content, so the grid is hidden only when a genuine risk panel is detected and remains one action away.

## Decision
BUILD NOW as a bounded presentation-layer experiment on an isolated UX branch. Do not promote until exact composition, browser gates and isolated hosted proof pass. Live/staging task-time improvement remains unverified until hosted visual proof and user measurements are available.

## UX scorecard intent
Expected improvement: cognitive load, action visibility, responsive containment and predictable progressive disclosure. No claim of measured real-user improvement yet.
