# Zero-Engineer Support Tier Contract

**Date:** 18 September 2026  
**Scope:** Existing Manufacturing WFM platform. This does not replace the application or weaken the frozen customer-proof/release lane.

## Objective

The operational goal is **zero vendor-engineer involvement across every support scenario class**.

That is deliberately different from claiming that every possible future failure is already known. Unknown failures must have a complete autonomous terminal path: protect/contain first, preserve evidence, keep safe service running where possible, reproduce in isolation, and route any novel software repair through the independently verified Tier 2 factory.

A support case is not considered covered merely because a chatbot answered it. It is covered only when it reaches one of the machine-defined terminal outcomes in `resilience/support-tier-contract.json`.

## Tier model

- **T0 — Guidance/self-service:** answer correctly from approved version/role-bound evidence or abstain safely.
- **T1 — Known technical recovery:** execute only allowlisted reversible/idempotent runbooks after deterministic corroboration and independent proof.
- **T2 — Novel software/config repair:** reproduce, patch only inside an isolated worktree, independently verify, build/sign once, stage/replay, canary, and roll back automatically on declared tripwires. The patching agent never receives production authority.
- **T3 — Consequential workforce/business state:** no vendor engineer is required. The system diagnoses, calculates and simulates the exact change. A mutation may execute automatically only after that action class has separately graduated; otherwise the terminal state is an explicit customer-authorised decision, not a vendor escalation.
- **T4 — Novel/security-critical:** automatically contain, freeze risky authority, quarantine the narrow affected session/credential/workload when proven, preserve evidence and restore a compatible signed known-good state when independently safe. Any novel patch returns through T2. Legal/customer/security authority may remain irreducible, but no vendor engineer is required in the operational loop.

## Non-negotiables

1. Customer text, retrieved content and model output are evidence/proposals, never authority.
2. No cross-tenant action.
3. No reusable production/provider credential is model-visible.
4. The component that writes a patch cannot approve it.
5. Unknown faults never trigger production experimentation.
6. Consequential actions are deterministic, policy-bound and auditable.
7. Every tier must be able to stop safely; refusal/containment is a valid success state when evidence is insufficient.
8. Graduation is per action class and proof envelope, never a blanket permission for an AI.

## Incident-learning continuity

A zero-engineer terminal path must not forget previously learned failures merely because a newer CI artifact is incomplete, corrupted or unavailable. Prior incident-regression evidence is therefore selected newest-first but accepted only after deterministic, provider-neutral verification of the proof envelope, exact-runtime proof, corpus digest, snapshot bytes, continuity receipt and zero-authority invariants. A bad newer candidate may be skipped in favour of an older verified predecessor. If durable incident history is evidenced but no candidate authenticates, the support proof must fail closed rather than bootstrap from an empty history. Partial evidence that still proves a durable corpus previously existed is also treated as known history and cannot silently reset the corpus.

Accepted predecessor evidence must also agree across every independently carried corpus identity: the workflow envelope corpus digest and snapshot SHA, the portable proof snapshot SHA, corpus digest and entry count, and the continuity digest must all bind back to the same snapshot bytes. A self-consistent but cross-layer contradictory artifact is rejected rather than used as learning history.

This incident-history verifier is read-only, receives no production credentials, cannot grant action/release authority, and is itself a protected repair-authority surface. Its adversarial proof is mandatory inside the provider-neutral portable autonomy gate.

## Fast-track sequence

The next few days should focus on the shortest critical chain:

1. **Lock this contract into CI and prevent regression of the safety boundary.**
2. **Close the existing provider recovery handoff gap** using the already-proven one-shot server-side continuation contract.
3. **Create the isolated T2 repair cell**: source worktree only, network default-deny, no secrets, bounded attempts.
4. **Create an independent verifier** that cannot edit candidate source and re-runs regression/security/browser/invariant checks from clean state.
5. **Build exact-artifact staging + rollback proof** before any live promotion claim.
6. **Run T3 in shadow/simulation** while graduating low-impact action classes one by one.
7. **Run T4 containment chaos** including prompt/memory/tool poisoning, credential exfiltration, provenance tamper and bad-release rollback.

The target is not an unsupported \"100% AI repair\" claim. The target is **100% of scenario classes reaching a safe terminal outcome without one of our engineers**.
