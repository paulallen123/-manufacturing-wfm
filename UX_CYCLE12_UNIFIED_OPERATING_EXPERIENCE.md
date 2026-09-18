# UX Cycle 12 - Unified Manufacturing Operating Experience

## Objective
Extend the approved role-first UX so autonomous implementation and new operating capabilities fit into one calm interface without creating new dashboard shells or duplicate write logic.

The UX remains an action surface over authoritative workflows. New capability enters through a governed read-only signal contract and deep-links to the workflow that owns evidence and write authority.

## Non-negotiables
- Preserve every existing authorised route and workflow.
- No feature creates its own navigation shell, approval logic or competing decision card.
- Stale or missing evidence cannot manufacture urgency.
- Presentation never becomes write authority.
- Role, site, manufacturer type and implementation phase can change what is surfaced, not the underlying control model.
- Default view stays calm; evidence and detail are progressive.
- Mobile and shared-device use remain first-class.

## One front door
`Today` / `My day` remains the front door. It should answer:
1. What needs me now?
2. What changed since I last checked?
3. What has the system handled safely?
4. What outcome did the last decision actually produce?

The existing Cycle 11 Universal Action Queue remains the single manager action surface. Cycle 12 adds governed providers for implementation, integrations, attendance, agency labour, manufacturing cost, energy, support, learning, handover, documents and payroll.

## Implementation is a temporary operating mode
During launch, authorised super users see implementation exceptions through the same action pattern. The implementation engine owns readiness; the UX only surfaces current evidence and required decisions.

Readiness stages:
- Environment ready
- Systems discovered and authorised
- People and organisation reconciled
- Policies and pay/scheduling rules validated
- Demand/schedule configuration proven
- Clocking and payroll handoff proven
- Role learning/mastery complete
- Go-live proof and handover complete

Completed stages collapse into evidence. After go-live, setup remains available under `Launch & configure` rather than competing with daily operations.

## Stable navigation
- Employee: My day / Time off / Shifts / My time / More
- Manager/Supervisor: Today / Absence / Sign off / Performance / More
- More groups: Run the week / Cost & efficiency / Launch & configure / Trust & support

## One decision-card grammar
Every consequential item uses the same pattern:
- What happened
- Why now
- Operational/financial consequence
- Evidence freshness
- Required authority
- Reversibility
- Deep link to owning workflow
- Source-confirmed result after action
- Verified actual outcome where available

## New functionality designed into the UX

### Shift Handover Intelligence
A short role-specific incoming-shift briefing sourced from authoritative data: staffing/skills, attendance and agency arrivals, safety/quality holds, machine/downtime state, material/delivery risk, target variance and carry-over actions. Critical items stay in the action queue until the owning source confirms resolution.

### Hands-free / voice
Informational queries can be direct. Consequential actions such as approvals, pay/time corrections, schedule publication or policy override require explicit confirmation and the existing authoritative write path.

### What changed
When fresh data changes a forecast, schedule, staffing plan or recommendation, show the source change, prior recommendation, new recommendation and impact instead of silently changing the answer.

### Manager-edit learning
Repeated overrides may trigger a configuration-review suggestion. Frequency alone is never evidence that the override was correct.

### Contextual document acknowledgement
Required policies and work instructions appear in the relevant workflow rather than a separate document dashboard. The document/control workflow remains the durable source.

### Outcome Ledger
Performance separates predicted savings from verified labour, energy and production outcomes, with evidence, confidence and variance explanation.

## Provider contract
Approved provider ids:
`implementation`, `integrations`, `attendance`, `agency`, `manufacturing-cost`, `energy`, `support`, `learning`, `handover`, `documents`, `payroll`.

Providers publish structured read-only presentation signals. Provider identity binds the source and cannot impersonate another capability. Unknown/malformed providers fail closed. The UX gains no new write authority.

## Current boundary
Cycle 12 is stacked on the existing Cycle 11 UX branch. This prepares the presentation contract; it does not claim the separate feature branches are merged or production-ready.

## Engineering sequence
1. Bind one-day implementation readiness to `implementation`.
2. Bind autonomous integration health to `integrations`.
3. Bind attendance coverage/certification exceptions to `attendance`.
4. Bind agency shortage/delivery reconciliation to `agency`.
5. Bind manufacturing cost and energy opportunities only on current evidence.
6. Bind support receipts/containment without misrepresenting human decisions as automation.
7. Build Shift Handover Intelligence as an authoritative workflow that publishes structured handover signals.
8. Extend the existing composed-browser regression for mixed-source priority ordering, deep links, mobile containment and role separation.