# Frontier experiment: Controlled-Environment Workforce Flow

## New connection
Combine authoritative controlled-environment rules with workforce qualifications, production tasks and authorised presence evidence so the platform can compare already-safe plans by personnel entries, zone transitions, gowning/control burden and exceptional human interventions.

This is not a cleanroom-control system and does not estimate contamination probability. It is a workforce decision primitive that asks whether an already-safe production plan can be completed with fewer unnecessary controlled-zone transitions without changing the validated process.

## Why this is materially different
QMS/CCS, facilities/EMS, access control and MES normally govern different pieces of the problem while WFM schedules qualified people. This experiment joins those layers without moving quality, access or process authority into WFM.

Research checked on 20 September 2026 supports the broader pattern:
- sterile pharmaceutical guidance explicitly minimises unnecessary personnel, entries/exits and manual interventions;
- medical-device manufacturing uses cleanrooms and controlled environments where contamination and environmental conditions matter;
- NASA spacecraft assembly cleanrooms treat people and human activity as major contamination sources;
- semiconductor manufacturers increasingly use automation and material-handling systems to reduce repeated human handling;
- radiation-controlled environments have hard access/training/dose rules, demonstrating that controlled-zone workforce orchestration must sometimes optimise exposure rather than contamination.

These sources justify a reusable Sensitive Zone model. They do not justify hard-coding one industry's rules into another.

## Intervention & Transition Ledger — implemented
Before optimisation, the product now measures what actually happened.

The ledger:
1. accepts only authoritative, site-scoped task and access/presence evidence;
2. pairs entry/exit events into observed controlled-zone sessions;
3. links sessions to overlapping authorised task windows without claiming badge evidence proves task execution;
4. reports unmatched presence as **needs review**, never **unnecessary**;
5. blocks optimisation when access evidence is inconsistent or an observed movement is not approved by site policy;
6. finds a consolidation candidate only when two separately observed entries for the same authorised worker/zone could fit one permitted session within the site's own maximum-continuous-time and exit rules;
7. keeps predicted, accepted and realised outcomes separate.

The ledger never changes access, publishes a schedule, changes an SOP, relaxes a qualification, attributes contamination to an individual, or requires cameras/biometrics.

## Existing plan-comparison engine
The original engine receives multiple candidate workforce plans from the canonical scheduler and:
1. rejects stale/non-authoritative site policy;
2. rejects missing skills/zone qualifications, cross-site evidence, double-booking, missing task coverage and zone occupancy breaches;
3. rejects transitions not explicitly approved by site policy;
4. scores only remaining safe candidates on gowning cycles, transition-control time, movements and validated control cost;
5. returns a ranked advisory result only.

## Scale inversion
- **1 employee / 1 site:** if only one valid plan exists the engine reports no optimisation rather than inventing capacity. The ledger can still show avoidable repeated entry patterns if site rules allow tasks to be combined.
- **10,000+ employees / many sites:** calculations remain site-local and policy-local. Enterprise analytics may aggregate de-identified metrics, but no site may silently borrow another site's qualifications, occupancy limits, transition rules or legal policy.

## Future horizon
As factories become more automated, the same primitive changes from routine operator routing to **human-intervention orchestration**:
- sterile/cleanroom production;
- semiconductor and precision clean manufacturing;
- spacecraft/satellite assembly;
- medical-device controlled environments;
- dry-room / humidity-controlled manufacturing where validated local rules exist;
- high-containment or hazardous areas;
- radiation-controlled areas, where the optimisation objective may be exposure/dose and authorised intervention windows rather than contamination.

Each module must have its own authoritative policy profile. Fewer people is never assumed to be safer.

## Synthetic falsification
Local Node verification:
- original controlled-environment engine: 7/7 deterministic tests passed;
- original 2,000-scenario plan comparison: same work/skills/site policy, with mean modelled gowning cycles 26.9505 baseline vs 8.4395 flow-aware and mean zone transitions 35.901 vs 8.455;
- Intervention & Transition Ledger: 7/7 deterministic tests passed;
- tightened 5,000-history ledger replay: 4,988 histories were internally consistent and 12 correctly fell to review;
- valid histories averaged 7.515 observed entries and 4.081 deterministic consolidation candidates;
- modelled potential entry/gowning reduction was ~54.3% of observed entries in this deliberately bundlable synthetic dataset.

This is simulation only. It does not prove contamination reduction, customer savings, compliance, yield, quality improvement, lower radiation dose or energy savings.

## Disproof / stop criteria
Stop or redesign if:
- authoritative local zone-transition, qualification, occupancy and task rules cannot be obtained;
- customer-like replay cannot beat simple same-zone task bundling materially;
- throughput, quality, breaks, workload balance, minimum staffing or safety deteriorate;
- the engine ever labels unexplained presence as unnecessary without authoritative context;
- policy authority would need to move into WFM;
- the integration burden costs more than realised transition/control savings.

## Learning loop
Recommendation -> accepted/rejected decision -> approved schedule -> authorised presence evidence -> production outcome -> quality/safety outcome -> financial outcome -> confidence/calibration update.

Predicted, simulated and realised outcomes remain separate. Outcome learning can calibrate future advice but cannot automatically rewrite quality, access, qualification, process or safety rules.

## Handoff
- **Product Evolution:** eventual Vector UX and canonical scheduler integration.
- **Integration & Data Fabric:** QMS/CCS, qualifications, MES/tasks, authorised access/presence, facilities/EMS and sector-specific zone-policy semantics.
- **Autonomous Implementation & Support:** mapping and site-policy onboarding.
- **Trust/Proof/Release:** provenance, privacy, site isolation, safe evidence handling and customer-like validation.
- **Frontier:** retains discovery ownership and continues testing which other manufacturing zones justify this primitive.
