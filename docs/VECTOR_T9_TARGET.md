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
