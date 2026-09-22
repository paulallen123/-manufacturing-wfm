# VECTOR FORGE — Manufacturing Asset, Decision & Value Operating System

Status: DESIGN APPROVED IN CHAT — implementation not started  
Target lineage: `feature/vector-eow-convergence-20260925` / VECTOR FORGE  
Date: 2026-09-22

## 1. Purpose

VECTOR should evolve from workforce optimisation into the operating intelligence layer that helps a manufacturer manage its most important assets together and continuously choose the safest, highest-value use of them.

The product question becomes:

> Given the organisation's current assets, constraints, commitments and authority boundaries, what is the highest-value safe action it can take now, what optionality should it preserve, and did the action create the value predicted?

This is not a replacement product, a new UI shell, an all-in-one autonomous optimizer or a new source of operational authority. It extends the existing FORGE lineage and composes existing workforce, factory, finance, energy, resilience, integration and outcome capabilities.

## 2. Outcome

Create three reusable platform primitives underneath existing FORGE experiences:

1. **Asset Intelligence Graph** — a tenant/site-scoped model of important manufacturing assets, their state, capability, cost, constraints, dependencies and provenance.
2. **Constraint Value Engine** — calculates comparable economic signals for constrained assets and identifies which constraint currently limits value.
3. **Decision & Outcome Ledger** — records recommendation -> authorised action -> operational outcome -> financial outcome -> forecast error so the system learns without rewriting deterministic rules.

Together these allow existing Autopilot, Cost & Value, Plan, Factory and Improve experiences to reason across people, machines, materials, energy, tooling, facilities, inventory, supply capacity, cash and operational knowledge.

## 3. Non-goals

The first release must NOT:
- create a second dashboard or navigation hierarchy;
- replace MES, ERP, APS, CMMS/EAM, QMS or WFM authority;
- let an LLM change payroll, safety, quality, qualification, access or machine-control rules;
- invent production, cost, savings or capacity values;
- optimise every asset type in one solver;
- require new hardware;
- move or rewrite existing Frontier experiments before their own proof gates pass;
- make autonomous production changes.

## 4. Core asset model

### 4.1 Asset classes

The initial canonical model supports:

- **People** — individual workers, teams, skills, qualifications, availability, fatigue/rest state, labour cost, scarce capability.
- **Machines / automation** — work centres, machines, robots, automation cells, capacity, condition, maintenance state, recovery dependency.
- **Materials / WIP** — lots, batches, components, usable-time windows, expiry, quantity, quality state, WIP location and production dependency.
- **Energy / utilities** — electricity, gas, steam, compressed air, water, storage, tariff/flexibility windows and site constraints.
- **Tooling / facilities** — dies, moulds, gauges, fixtures, rooms, cleanrooms, dry rooms, specialist equipment, permits and shared spaces.
- **Inventory / supply capacity** — stock, suppliers, alternates, lead-time capacity and logistics availability.
- **Cash / commitments** — invoice milestones, working-capital exposure, customer due dates, penalties, order contribution assumptions and approved cost-of-capital inputs.
- **Knowledge / capability** — SOP/process references, recovery procedures, engineering knowledge and approved competence dependencies.

Asset classes are extensible. Unknown classes must not be coerced into a known class.

### 4.2 Required fields

Every asset record carries:

- tenant;
- legal entity where applicable;
- site;
- stable asset id;
- type;
- source authority;
- source revision/digest;
- observed time;
- effective time;
- state;
- capacity/capability facts when authoritative;
- cost/value inputs with units/currency and provenance;
- constraints;
- dependencies;
- confidence/verification state;
- lifecycle state.

No recommendation may use a stale or unproven field as authoritative without explicitly degrading the recommendation.

## 5. Asset Intelligence Graph

The Asset Intelligence Graph extends the existing FORGE/Digital Twin direction rather than creating a parallel graph implementation.

### 5.1 Relationships

Examples:

- person -> qualified-for -> task / machine / zone;
- machine -> requires -> skill / tooling / energy / maintenance state;
- order -> requires -> material / machine / labour / quality release;
- material -> expires-at / usable-until -> time;
- site -> constrained-by -> utility / labour / permit / room;
- task -> creates -> WIP / invoice milestone / quality evidence;
- action -> consumes -> capacity;
- action -> preserves -> optionality;
- outcome -> updates-confidence-for -> decision rule.

Relationships must be tenant/site/legal-entity scoped and source-bound.

### 5.2 Read model, not authority

The graph is an evidence-bearing decision model. It references authoritative source records and does not become the source of truth for payroll, production execution, qualifications, finance ledgers, QMS limits or machine controls.

## 6. Constraint Value Engine

### 6.1 Objective

Translate operational constraints into comparable economic signals so VECTOR can answer:

- What is limiting value now?
- What is the marginal value of one more unit/hour of this constrained asset?
- Which safe action creates the most value?
- Which option should be preserved because it has resilience value?

### 6.2 Constraint value contract

A constraint signal contains:

- constraint id and asset;
- scope;
- limiting horizon;
- marginal unit;
- estimated operational consequence;
- estimated financial consequence;
- source evidence;
- freshness;
- confidence;
- assumptions;
- reversible / irreversible flag;
- alternative baseline;
- claim class: predicted / simulated / realised;
- authority required.

Examples:
- one additional qualified operator hour;
- one hour of bottleneck-machine capacity;
- one additional maintenance window;
- one MWh of energy at a different tariff window;
- one hour of material usable life;
- one unit of supplier reserve capacity;
- one day of invoice acceleration.

### 6.3 No fake precision

The engine must:
- return ranges where inputs are uncertain;
- keep cash, avoided variable cost, released capacity, working capital, risk and non-financial value separate;
- refuse comparison across incompatible units until translated through explicit economic assumptions;
- preserve the simple alternative/do-nothing baseline;
- never represent time saved as cash without a supported conversion;
- never represent extra output as financial value without supported demand/economic evidence.

## 7. Decision composition

The first implementation should NOT build a monolithic optimiser.

Each domain keeps its deterministic candidate generator:
- workforce;
- energy;
- maintenance;
- material timing;
- agency;
- cash-to-capacity;
- sensitive-zone;
- production recovery;
- resilience.

Each candidate is normalised into a common **Decision Option Contract**:

- option id;
- scope;
- requested changes;
- prerequisite evidence;
- hard constraints checked;
- predicted operational outcomes;
- predicted financial outcomes;
- confidence;
- alternatives;
- side effects;
- authority required;
- rollback/recovery route;
- expiration/staleness time;
- originating engine/version.

The Decision Composer compares only candidates that already passed their own domain safety/policy gates.

AI may explain, summarise, ask for missing evidence and generate hypotheses. It cannot convert an unsafe candidate into a safe candidate or create authority.

## 8. Optionality and resilience value

VECTOR should represent spare capacity and alternatives as assets with possible option value.

Examples:
- cross-trained worker;
- backup machine;
- alternate supplier;
- unused production slot;
- spare tooling;
- backup utility route;
- human fallback for automation;
- inventory buffer.

Optionality is not automatically a benefit. It must have:
- carrying cost;
- event/scenario it protects against;
- expected operational consequence if unavailable;
- evidence/confidence;
- expiry or review horizon.

The first release should expose optionality as an advisory value component, not as a stochastic financial guarantee.

## 9. Decision & Outcome Ledger

Every material recommendation should support the chain:

1. baseline state;
2. recommendation;
3. human/system decision;
4. authorised action;
5. operational outcome;
6. financial/customer outcome;
7. side effects;
8. forecast error;
9. confidence update.

The ledger must distinguish:
- predicted;
- simulated;
- accepted but not executed;
- executed;
- operationally observed;
- financially reconciled.

Learning may adjust confidence, ranking priors and explanation quality. It must never automatically rewrite safety, quality, payroll, qualification, security or site policy.

## 10. FORGE UX integration

No new top-level surface.

### Today
Show the highest-value current constraint only when evidence supports it:
- “Assembly skill coverage is the largest current constraint.”
- “Protecting one extra qualified hour has greater value than shifting this energy load.”

### Plan
Show constrained options before schedule publication:
- labour;
- machine;
- material;
- energy;
- optionality effects.

### Factory
Show:
- current limiting asset;
- affected production;
- approved recovery options;
- evidence freshness;
- operational trade-offs.

### Improve / Cost & Value
Use the existing future model:
**Saved -> Avoided -> At risk -> Opportunity -> Evidence**

Add:
- value constrained by asset;
- realised vs predicted;
- preserved optionality;
- forecast accuracy.

### Executive
Explain why value is constrained and what intervention changes it without exposing operational clutter.

## 11. Data flow

1. Integration/Data Fabric supplies source-bound observations.
2. Domain services normalise observations into Asset Intelligence records.
3. Deterministic domain engines generate safe candidate actions.
4. Constraint Value Engine estimates comparable operational/financial consequences.
5. Decision Composer ranks eligible options without changing their authority.
6. Existing FORGE UI presents the decision and evidence.
7. Existing authoritative systems execute approved actions.
8. Outcome Ledger records operational and financial results.
9. Learning updates confidence only within permitted boundaries.

## 12. Failure behaviour

Fail closed or degrade visibly when:
- required source authority is missing;
- evidence is stale;
- tenant/site/legal-entity scope conflicts;
- currencies/units cannot be reconciled;
- duplicate asset identities exist;
- source revisions conflict;
- two engines disagree about a hard constraint;
- outcome attribution is ambiguous;
- financial assumptions are unavailable;
- recommendation expires before action;
- a customer policy forbids cross-domain optimisation.

On failure, VECTOR should surface:
- what is unknown;
- why it matters;
- what evidence is required;
- which lower-risk decision remains possible.

## 13. Security / privacy / safety

- tenant and site isolation are mandatory;
- least-privilege source access;
- no model-visible reusable credentials;
- workforce attributes used only where relevant and lawful;
- no covert surveillance or new biometric requirement;
- no OT control write-back in this layer;
- deterministic authority for safety, payroll, quality, permissions and production execution;
- immutable decision/outcome audit evidence for consequential recommendations.

## 14. Scale inversion

### 1 employee / 1 site
The graph may contain only a person, one machine/workbench, key material and current job. VECTOR should produce an honest simple answer or no-op, not require enterprise configuration.

### 10,000+ employees / 50+ sites
- partition by tenant/site/entity;
- local policy remains authoritative;
- aggregate economic signals only after unit/currency/provenance reconciliation;
- do not borrow qualifications, policies or machine state across sites;
- support regional decision autonomy and group-level portfolio views.

## 15. Smallest safe implementation slice

The first build should contain only four reusable modules:

1. **asset-intelligence-contract**
   - validate/normalise asset records and relationships;
   - reject ambiguous identity/scope/provenance.

2. **constraint-value-contract**
   - represent value signals, units, confidence, horizon and claim class;
   - no optimisation yet.

3. **decision-option-contract**
   - normalise outputs from existing deterministic engines;
   - preserve safety/authority status and originating evidence.

4. **decision-outcome-ledger**
   - record predicted -> decided -> action -> operational -> financial states;
   - deterministic append/audit semantics.

The first proof scenario should reuse already-known capabilities rather than invent new business logic:

**workforce bottleneck + energy window + material clock + customer due-date/cash consequence**

Expected result:
- safe domain engines generate alternatives;
- common contracts make trade-offs visible;
- no domain rule is weakened;
- VECTOR identifies which constraint currently limits value;
- the same inputs produce deterministic results;
- predicted value remains explicitly un-realised until outcomes arrive.

## 16. Test strategy

### Contract tests
- malformed asset identity;
- duplicate identities;
- stale source;
- cross-tenant/site reference;
- unsupported currency/unit;
- conflicting revisions;
- unverified claim incorrectly marked realised;
- unsafe option incorrectly admitted;
- expired option;
- audit mutation attempt.

### Scale tests
- 1 person / 1 site;
- 100 employees;
- 10,000 employees / 50 sites;
- multi-entity / multi-currency;
- low-connectivity stale-evidence case.

### Decision tests
- same decision with changed labour scarcity;
- same decision with changed energy tariff;
- material-clock expiry flips preferred option;
- expensive worker becomes cheapest total-system option;
- deliberate machine idle becomes preferred because it avoids WIP/material/energy loss;
- preserved optionality outranks maximum utilisation when evidence justifies it.

### Outcome tests
- predicted value but no action;
- action executed but no outcome evidence;
- operational outcome exists but financial reconciliation missing;
- realised result differs from prediction;
- confidence update does not mutate deterministic rule.

## 17. Acceptance criteria for first implementation

BUILT requires:
- all four modules implemented in the FORGE branch;
- deterministic contract tests pass;
- no new top-level UI;
- no production/customer mutation;
- one composite synthetic scenario proves cross-domain comparison without weakening source rules;
- 1-person and 10,000/50-site scope tests;
- exact source identity and evidence saved.

PROVEN is not available from source tests alone. Hosted exact-candidate evidence and the normal FORGE release gates remain required.

## 18. Handoffs

- **Product Evolution** — existing Today / Plan / Factory / Improve presentation.
- **Integration & Data Fabric** — source authority, semantics, unit/currency/time alignment and identity.
- **Autonomous Implementation & Support** — zero-touch mapping/setup and missing-data diagnosis.
- **Trust / Proof / Release** — isolation, provenance, adversarial tests, release evidence.
- **Frontier** — new cross-domain candidate generators, optionality research and economic challenge.

## 19. Commercial hypothesis

The commercial value is not another analytics module. It is reducing total manufacturing cost and increasing asset effectiveness by making cross-domain decisions that individual systems cannot see.

Potential packaging:
- core Asset Intelligence included in FORGE;
- Decision & Value intelligence as a premium capability;
- sector-specific packs for energy-intensive, controlled-environment, high-automation and high-material-value manufacturing.

No pricing or savings claim should be finalised until customer-like outcome evidence exists.

## 20. Stop / redesign criteria

Redesign or reject the layer if:
- a competent existing APS/MES/ERP decision rule produces the same decisions with materially less setup;
- value cannot be reconciled without high manual data preparation;
- rankings are too sensitive to weak financial assumptions;
- site policy must be weakened to create benefit;
- the layer creates more management work than it removes;
- cross-domain ranking does not improve measurable outcomes over strong domain baselines.

## 21. Implementation order

1. contracts and invariants;
2. deterministic outcome ledger;
3. adapters from two existing engines;
4. composite synthetic proof;
5. 1-person and 10,000/50-site proof;
6. existing FORGE UI decision-card integration;
7. hosted exact-candidate proof;
8. only then expand to additional asset classes and optionality valuation.
