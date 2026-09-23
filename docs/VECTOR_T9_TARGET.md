# VECTOR T9 Target — Trust, Causal Learning and Extreme Support

## Decision

VECTOR will aim beyond a conventional T8 support system toward a **T9 candidate architecture**, while preserving the Friday 25 September 2026 delivery discipline.

T9 is a VECTOR-specific maturity target, not an industry standard.

The Friday objective is not to claim a finished production-grade T9 system. It is to make sure every development from this point is built on the architecture required to reach T9, so Friday work is not thrown away or replaced later.

## T8 vs T9

**Hardened T8** safely resolves known and certified incident classes, safely contains unknowns, keeps customers in the safest viable operating state, verifies recovery and learns regressions.

**T9** adds defensible knowledge accumulation:
- reconstruct what was known at decision time;
- distinguish observed fact, assertion, inference, prediction and recommendation;
- preserve rejected alternatives;
- bind exact actions to evidence and authority;
- verify technical and customer outcomes;
- form causal hypotheses;
- test counterfactuals or equivalent controls;
- create candidate playbooks/models;
- evaluate in shadow;
- canary under bounded authority;
- promote only through independent governance.

T9 **never grants itself more authority**.

## Canonical T9 spine

Every consequential action must pass through one path:

1. **Evidence Ledger**
   - provenance, source identity, event/effective/observation time;
   - confidence, source trust, expiry and contradictions;
   - tamper-evident append-only history;
   - no model output becomes business truth by assertion.

2. **Unknowns Engine**
   - detects missing evidence, contradictions, novel combinations, telemetry blindness, model disagreement and unbounded blast radius;
   - uncertainty reduces autonomy;
   - unfamiliar high-risk conditions move to shadow/containment, not production exploration.

3. **Customer Guardian**
   - non-negotiable customer, tenant, payroll, competence, compliance, safety and OT invariants;
   - an approver cannot override a hard safety or tenant boundary.

4. **Authority Kernel**
   - deny by default;
   - exact actor × tenant × resource × action × risk × blast-radius × time;
   - no wildcard self-expansion;
   - no self-grant;
   - consequential customer approval is scoped to a single bounded effect.

5. **Typed Action Gateway**
   - the only consequential write path;
   - versioned action schemas;
   - preconditions;
   - idempotency;
   - action budgets;
   - maximum blast radius;
   - simulation/dry run where appropriate;
   - compensation/rollback contract;
   - expected postconditions.

6. **Independent Verifier**
   - separate principal from proposer/executor;
   - independent read-back or reconciliation where practical;
   - HTTP 200 is never sufficient proof of customer recovery.

7. **Causal Episode / Evaluation Registry**
   - context, evidence, alternatives, chosen action, prediction, actual outcome;
   - customer override/correction;
   - causal hypothesis;
   - counterfactual status;
   - regression/eval generation;
   - candidate playbooks remain proposal-only until independently promoted.

## Extreme-support operating rule

Every incident must have a safe path even when it has no autonomous repair:

**detect or detect blindness → contain → preserve evidence → maintain minimum safe service → diagnose → simulate → repair if certified/authorised → independently verify → rollback/compensate if needed → communicate verified truth → learn**

“Fully covered” therefore means **no incident is allowed to force unsafe guessing**, not that every imaginable incident is already autonomously repairable.

## Friday target

By Friday the candidate should demonstrate representative paths for:

- payroll integrity failure;
- integration/provider outage;
- contradictory or stale data;
- clocking/device failure;
- identity/auth degradation;
- cross-tenant injection;
- agent/prompt/memory poisoning;
- bad autonomous action;
- rollback;
- telemetry blindness;
- unknown/cascading incident;
- Vecta/support subsystem degradation.

The customer-facing support UI should hide internal architecture terms and communicate:

**What happened → what is affected → what Vecta has already done → what is protected → what the customer must do, if anything → what remains uncertain → when it will be considered resolved.**

## T9 knowledge target

A reusable T9 episode should be able to answer:

- What evidence was available then?
- Which facts were authoritative and which were inferred?
- What options were considered and rejected?
- What prediction was made?
- What action was actually executed?
- Under which authority?
- What happened afterwards?
- Was that outcome independently verified?
- What alternative explanation remains?
- What counterfactual evidence exists?
- Under what conditions is the learning reusable?
- What new regression, evaluation or candidate playbook should be produced?

A successful incident or decision is not automatically a reusable causal rule.

## Non-negotiable boundaries

- No AI/model can grant or expand its own authority.
- No unverified memory can become a certified playbook.
- No cross-tenant raw customer knowledge is promoted into shared memory.
- No irreversible high-risk action is learned into automatic execution without explicit independent governance.
- No safety/OT interlock can be traded for optimisation.
- No “resolved” customer status without verified postconditions.
- No financial value is realised merely because it was predicted.
- No T9 claim from source code alone.

## Immediate implementation

The first T9 source increment is `trust/runtime/vector-trust-spine.cjs` with tests covering:
- append-only contradiction-aware evidence;
- self-grant denial;
- hard Guardian vetoes;
- uncertainty reducing autonomy;
- bounded typed actions;
- idempotency;
- independent verification;
- proposal-only causal episodes that cannot self-promote.

This is a **foundation**. It becomes PROVEN only when exact-candidate, hosted, restart/recovery and customer-like evidence pass.


## Zero Human Operational Effort — 24 September 2026

This decision is additive to the T9 trust spine and supersedes the earlier assumption that consequential incidents should fall back to a support person.

The target is **zero human operational effort**: VECTOR must implement, operate, support, repair, recover and continuously improve without a human operations/support team. Any human operational touch required to keep a customer running is treated as a product defect.

The operating loop becomes:

**predict → prevent → detect → isolate → reproduce → diagnose → simulate → machine-quorum authorise → execute → independently verify → rollback/compensate → learn → convert the resolved class into a tested reusable playbook**

### Machine quorum

A consequential autonomous repair must not rely on one model confidence score. It requires independent evidence from:
- diagnostic/proposer;
- deterministic policy engine;
- Customer Guardian / tenant invariants;
- isolated simulation;
- executor;
- independent verifier;
- independent security verifier;
- proven rollback or compensation where needed.

For governed high-risk actions, proposer, policy engine, executor, verifier and security verifier are distinct principals.

### No human escalation fallback

Insufficient proof does **not** create a support ticket for a person. VECTOR must move to the safest autonomous containment state, preserve evidence, reproduce the incident in isolation and continue the proof loop until a certified repair exists.

Novel incidents may not invent production repairs. They may execute only pre-authorised containment until a repair has passed reproduction, regression, security, rollback and canary evidence.

### Hard external mandates

If a law, regulator, identity provider or external contractual ceremony explicitly requires an identified person, VECTOR records that as an **external mandate boundary** rather than falsely claiming zero-touch. The architecture goal is to remove or replace that dependency wherever a lawful technical alternative exists.

### Release metric

**Human operational touches per 1,000 customer-days = 0.**

Any manual log inspection, reset, data correction, vendor chase, configuration fix, restart, integration repair or incident investigation is a `HUMAN_OPERATIONAL_TOUCH` release blocker for the zero-human claim until the recovery is generalised and proven.

The first executable contract is `trust/runtime/vector-zero-human-governance.cjs`. It is part of the existing T9 spine, not a separate product. Northstar remains isolated from VECTOR production control.
