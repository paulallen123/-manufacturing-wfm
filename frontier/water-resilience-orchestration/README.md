# Frontier experiment: Water-Resilience Workforce & Production Orchestration

## New connection
Combine authoritative water availability/restrictions/tariffs, onsite reserve and effluent capacity with production task water demand, approved water-source rules and workforce skills so the platform can compare already-feasible plans by water-resilience exposure.

The core question is not simply "how do we use less water?" It is: **when water becomes scarce, expensive or constrained, can the same authorised work be sequenced differently so the factory protects production while keeping every quality, permit, reserve and workforce rule intact?**

Examples:
- move a flexible high-water wash/CIP task out of a temporary restriction window while keeping a qualified worker available;
- use low-water packaging/inspection/training/maintenance work during a stressed water period;
- avoid scheduling water-intensive work when effluent capacity is already constrained;
- prefer approved reclaimed-water windows where the task/process explicitly permits that source.

## Why this is distinct
Production schedulers commonly optimise machine, material, labour and due-date constraints. Water systems and sustainability tools commonly monitor/reduce water use. Public examples also show water-aware production scheduling in specific industries such as textiles. The novel hypothesis here is narrower: **make external/site water constraints, process water-source rules, effluent capacity and qualified labour part of one deterministic manufacturing decision layer** rather than treating water as a dashboard KPI after the schedule has been made.

## Evidence checked 20 September 2026
- European Commission Water Resilience Strategy: EU water-efficiency ambition of at least 10% by 2030 and common benchmarks under development.
- European Environment Agency: around 30% of EU land experiences seasonal water scarcity annually; high-water industries can face slowdowns/shutdowns; steel, pulp/paper and food/beverage are materially water-dependent.
- US EPA Water Reuse Action Plan 2.0 (released April 2026) explicitly supports industrial reuse.
- TSMC identifies electricity/water shortage as an operational interruption risk and has invested heavily in reclaimed-water infrastructure for fabs.
- South African municipalities in 2026 imposed industrial/business restrictions and emergency tariffs during drought conditions, demonstrating that water constraints can become an operational planning input rather than a long-range ESG issue.
- GEA shows process-level CIP/flush optimisation can materially reduce water/time, but that optimises equipment/process operation rather than workforce/production orchestration.

These sources support the problem. They do not prove this product will save water or prevent downtime.

## Smallest safe reusable increment
The deterministic engine accepts candidate production/workforce schedules and authoritative site water-policy slots. It:
1. rejects stale/non-authoritative policy;
2. keeps workers/tasks site-scoped;
3. enforces worker skill and no-double-booking rules;
4. enforces task flexibility windows;
5. enforces approved water-source compatibility;
6. enforces restriction-specific task permission;
7. enforces minimum site water reserve and effluent-capacity limits as hard constraints;
8. ranks only remaining safe plans by restriction exposure, scarcity-weighted water, modeled water tariff cost and lateness penalty;
9. keeps predicted vs realised water outcomes separate for later calibration.

It never changes recipes, quality limits, permits, water treatment controls, pumps/valves, staffing rules, production schedules or payroll directly.

## Scale inversion
- **1 employee / 1 site:** if no alternative sequence exists, the engine returns an honest no-improvement result. A tiny manufacturer could still get a simple recommendation such as "do packaging during the restriction; run the approved wash later" where the task window genuinely permits it.
- **10,000+ employees / many sites/countries:** calculations remain site-local and policy-local. Water rights, tariffs, reuse rules, effluent limits and quality requirements are never silently copied across countries or legal entities. Enterprise analytics may aggregate de-identified resilience metrics only.

## Global/future relevance
The design remains useful across different maturity levels:
- water-scarce regions where municipal/industrial restrictions or tariffs change quickly;
- semiconductor, food/beverage, chemicals, pulp/paper, textile/dyeing, mining/mineral processing and other water-intensive manufacturing;
- high-reuse factories where water-source quality matters more than absolute volume;
- low-connectivity sites where a local cached policy can still constrain scheduling;
- highly automated factories where the workforce layer may mainly coordinate qualified maintenance, cleaning and recovery tasks around water/reuse windows.

## Local falsification
Node verification on the isolated prototype:
- 8/8 deterministic tests passed.
- 3,000 random synthetic scenarios were generated; 2,444 produced both a baseline and a water-aware feasible plan, while 556 were deliberately infeasible under random skill/capacity combinations and were excluded rather than forced.
- In the 2,444 comparable cases, the water-aware heuristic had lower scarcity-weighted water in ~99.96% of scenarios.
- Mean scarcity-weighted water fell by ~32.3%.
- Mean modeled fresh-water exposure during stressed/restriction slots fell by ~77.2%.

This dataset was intentionally constructed with flexible tasks and stressed time windows. These are simulation results only, not customer savings, drought-proofing, production proof or environmental claims.

## Aggressive disproof / stop criteria
This concept should be stopped or redesigned if:
- real plants cannot provide trustworthy task-level water/effluent demand or flexibility windows;
- water constraints are mostly non-shiftable process requirements, making schedule optimisation irrelevant;
- a simple rule such as "move high-water tasks out of restriction windows" performs within 10-15% of the full engine on customer-like replay;
- the integration burden is greater than realised operational value;
- quality, sanitation, permit, reserve, worker-rest, due-date or minimum-staffing rules would need to be weakened;
- real replay fails to reduce water-constraint exposure by at least 15% without worsening on-time production.

## Self-learning loop
Recommendation -> accepted/rejected decision -> approved schedule -> observed water/effluent use -> production outcome -> financial outcome -> calibration update.

Predicted, simulated and realised results remain separate. Outcome learning can calibrate demand estimates and ranking weights but cannot automatically rewrite permits, water-quality rules, recipes, qualifications or labour rules.

## Handoff
- **Product Evolution:** future manager/Vector UX and canonical optimisation integration.
- **Integration & Data Fabric:** utility/SCADA, meters, wastewater/effluent, MES/recipe, QMS, tariffs/restrictions and workforce semantics.
- **Autonomous Implementation & Support:** discovery/mapping of water sources, meters, policy and fallback modes.
- **Trust/Proof/Release:** provenance, stale-data handling, safe fail-closed behaviour and customer-like replay.
- **Frontier:** retains discovery ownership and continues testing cross-domain water + labour + production opportunities.
