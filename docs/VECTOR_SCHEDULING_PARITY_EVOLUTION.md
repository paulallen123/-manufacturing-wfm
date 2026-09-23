# VECTOR Scheduling Parity + Evolution

Status: **BUILT source foundation; not production-proven.**

This slice is additive and stacked on the current converged Launch + Training branch. It does not replace the Friday FORGE candidate, canonical VECTOR UI, Decision Episodes, Digital Twin, lifecycle guard, realtime events, agency controls, payroll controls, security holds, or Autopilot authority boundaries.

## Product rule

1. A customer moving from a mature WFM competitor must not lose core scheduling capability.
2. VECTOR must extend those capabilities into manufacturing economics and safe autonomous operations rather than becoming a copy of a generic WFM scheduler.

## Implemented in this slice

- P50/P90/confidence demand consumption without claiming a proven forecasting model.
- Skills/certifications, availability, rest, weekly hours, overtime, consecutive shift/night limits.
- Deterministic policy/union rule references that fail closed.
- Preferences, fairness, fatigue, multi-site/travel economics.
- Employee, contingent and agency labour in one candidate model.
- Open-shift and shift-swap feasibility.
- Schedule KPIs, explainable infeasibility and independent validation.
- Bounded exact search for smaller problems; explicit non-optimal deterministic repair for larger ones.
- Append-only shadow plans/repairs and no-show/production/demand repair.
- Manager what-if planning with no execution authority.

## VECTOR evolution

The objective can combine production/customer priority, margin at risk, late-order cost, overtime, agency premium, cross-site movement, travel, preferences, fairness, fatigue and schedule stability.

Target loop: demand -> production -> skills -> feasible labour -> economic optimisation -> schedule -> disruption -> repair -> approval -> execution -> actual time/pay/production -> outcome -> learning.

The current slice stops before approval/execution. It must pass replay, simulation, shadow comparison and authority-gate evidence before Autopilot execution.

## Non-claims

- global labour-law completeness;
- production-autonomous scheduling;
- large-instance mathematical optimality;
- forecast accuracy without customer data;
- payroll closure without authoritative reconciliation;
- worker mobile parity until canonical UX is wired and browser-proven.

## Next gates

1. ERP/MES/APS demand + freshness through Integration Fabric.
2. Country/site/union policy packs.
3. Authoritative employee availability/preferences/open-shift/swap UX.
4. Existing Decision Episode + Factory/Plan UI binding.
5. Schedule -> attendance -> exception -> pay reconciliation.
6. 10,000 employee / 50 site scale and adversarial testing.
7. Incumbent-vs-VECTOR replay/shadow scoring.
8. Proven low-risk actions only through existing Autopilot permit/verify/rollback.

Promotion remains evidence-bound: source code is not customer proof.