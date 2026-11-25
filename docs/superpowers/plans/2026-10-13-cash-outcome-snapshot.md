# Cash outcome snapshot integrity implementation plan

> Execute inline using Superpowers executing-plans; request one independent reviewer after the bounded fix.

**Goal:** Prevent mutable/active evidence objects from manufacturing improved cash-to-capacity calibration.

**Architecture:** Keep the existing reconciler and serialized-record consistency comparison. At learning admission capture only plain data by own descriptors, reject accessors/proxies/custom objects without executing their behavior, then use the detached immutable snapshot throughout validation, identity and aggregation.

**Tech Stack:** Node built-in modules and node:test; no dependencies.

**Spec:** Accepted F4.6 cash-to-capacity prediction-versus-realised evidence; canonical release/vector-eow-convergence.json noInventedSavings and noProductionAuthorityFromAI; reservation #265 comment 6150643781.

## Constraints

- Base 48dce8f697825c8cd5f99b3e5aeea3953647f8c2; only outcome source/test plus scoped evidence/CI.
- Keep Continue customer proof as sole integrator and release owner.
- Synthetic data; no business writes, provider calls, deployments or new runners.
- Local tests do not establish hosted proof.

## Review focus

Accessor/proxy execution, custom JSON serialization, array entry accessors/iteration, legitimate persisted/frozen records and replay/scope regression must be tested.

## Task 1: learning snapshot admission

- [x] Pin source/test Git blob identities and reproduce accessor false zero; existing 48 pass, new regression fails.
- [x] Add denial cases and preserve ordinary JSON roundtrip/frozen/key-order behavior.
- [x] Snapshot descriptor-owned plain data before reading status or calibration; reject active objects.
- [x] Run full outcome tests on local Node24 and available Node22, plus four cash suites and syntax/diff checks.
- [x] Independent review with adversarial tests, repair material findings, then draft canonical adoption PR.
- [ ] Record exact identities, test failures/results and integration/deployment/proof blockers in evidence and authoritative intake.

Ruling: User explicitly requests immediate implementation without stopping for plan approval; proceed within the bounded isolated scope.
