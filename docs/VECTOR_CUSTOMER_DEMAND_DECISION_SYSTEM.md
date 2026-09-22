# VECTOR Customer Demand & Decision Intelligence

## Objective

Extend the current VECTOR FORGE architecture so product development and Factory Autopilot improve measurable customer decisions rather than accumulate features.

This design builds on the existing FORGE candidate and does not create a new UI, runtime authority path or competing product architecture.

## Existing components reused

- **Implementation Digital Twin**: deterministic, provenance-bound revision identity for customer/site/configuration context.
- **Workflow Action Evidence Contract**: source-owned authority, freshness and confirmation boundary for operational actions.
- **FORGE Experience Evolution**: role/job/friction model and existing blue-and-white Vector UI.
- **Realised Value / outcome direction**: actual payroll, cost and production evidence remains the source of realised-value claims.

## New primitives

### 1. Customer Demand Intelligence

A deterministic demand signal records:
- customer/account reference where available;
- segment, persona, manufacturing archetype and geography;
- operational decision being improved;
- signal source and evidence type;
- severity, frequency, economic/production/admin impact;
- evidence confidence, strategic fit, differentiation and reuse;
- integration readiness, effort, adoption burden, risk and reversibility;
- measurable outcome KPIs;
- an explicit falsification criterion.

Repeated independent-account evidence increases confidence. A single loud customer is deliberately evidence-limited unless the item is a mandatory safety/regulatory requirement.

### 2. Decision Episode

Each operational decision binds:

context -> source evidence -> candidate actions -> predictions -> uncertainty -> hard constraints -> policy eligibility -> recommendation -> authority state -> selected action -> observed outcome -> prediction error.

Rules:
- a do-nothing alternative is mandatory;
- unsafe, infeasible or policy-blocked options cannot be recommended;
- missing weighted metrics prevents a confident recommendation;
- recommendation is not authority;
- SHADOW mode can never execute;
- human or policy approval remains explicit;
- outcome evidence is required before predicted-versus-actual learning is recorded.

### 3. Absence Recovery Shadow

The first Factory Autopilot slice is:
absence / qualified labour shortage -> skills/production context -> simulated candidate actions -> safe ranking -> shadow recommendation.

It intentionally consumes predictions from simulation/digital-twin services rather than manufacturing output invented by the decision layer.

## Promotion ladder

1. BUILT: source + deterministic unit proof.
2. BUILT_HOSTED: exact Docker candidate includes and tests the modules.
3. SHADOW PROVED: historical/customer-like replay demonstrates useful ranking with zero hard-constraint escape.
4. HUMAN-APPROVED PROVED: authorised manager approves a reversible action and downstream systems reconcile.
5. POLICY-BOUNDED PROVED: only narrow pre-authorised actions can execute, with rollback and independent verification.
6. CUSTOMER-OUTCOME PROVED: predicted and realised labour/production/economic outcomes reconcile over an appropriate horizon.

## Next wiring

- feed authorised absence/lifecycle evidence into the shadow decision builder;
- attach real Digital Twin revision IDs;
- connect existing simulation outputs as candidate predictions;
- expose a read-only role-first Decision Card in Factory/Today;
- record manager override reasons;
- bind actual payroll/MES/production evidence into the outcome ledger;
- add shadow replay benchmarks and calibration thresholds;
- keep write authority behind existing workflow/security gates.

## Claim boundary

The source increment is **BUILT** when committed and locally deterministic. It is not hosted, customer-proven or autonomous until exact-candidate Docker and subsequent Trust/Proof evidence pass.
