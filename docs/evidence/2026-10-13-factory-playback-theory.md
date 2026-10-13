# Factory playback isolated theory package — 2026-10-13

## Requirement and source

`factory-playback` in `release/research-convergence-ledger.json`, sourced from PR #230, requires factory state and decision replay through the existing simulation, Decision Episode and resilience owners. The ledger called for normal, edge and adversarial theory retests before implementation.

## Ownership and conflict check

The exact product base is `90ad90fcf60adaca9abacdd4ad14bf392f95e585` on `release/vector-customer-ready-candidate-20260925`. GitHub open-PR search found historical research PR #230 and no dedicated factory-playback implementation PR. Remote branch search found no factory-playback branch. Current `autonomy/adaptive-outcome-replay-20261012` concerns outcome replay; this package changes no autonomy execution or product runtime file. The sole canonical integration/release owner retains adoption, review, exact-candidate testing and deployment authority. Off-platform ownership cannot be independently observed here; recheck before adoption.

## Design and result

The bounded theory uses the existing `createDecisionEpisode`, `selectDecisionOption`, `recordDecisionOutcome`, `createDecisionOutcomeProof` and research lifecycle gate. A synthetic incident snapshot is represented by `contextRevision` and source evidence. The do-nothing option is the counterfactual. Three scenarios demonstrate deterministic replay without execution authority, abstention when evidence is absent and a new identity when the snapshot revision changes, and rejection of an infeasible alternative with simulated value excluded from learning. This does **not** connect real factory snapshot storage, build a playback UI, verify actual incident reconstruction, or establish a customer outcome.

Changed files from the exact base:

- `operations/runtime/factory-playback.theory.test.cjs` — isolated normal, edge, adversarial and lifecycle checks.
- `release/research-convergence-ledger.json` — `factory-playback` theory status and evidence references only.
- `docs/evidence/2026-10-13-factory-playback-theory.md` — this receipt.

## Tests and review

- `node --test operations/runtime/factory-playback.theory.test.cjs resilience/research-convergence-theory-simulator.test.cjs` — 9 passed, 0 failed, Node `v24.19.0`.
- `node --test operations/runtime/decision-episode.test.cjs operations/runtime/decision-outcome-proof.test.cjs operations/runtime/demand-decision-service.test.cjs operations/runtime/factory-playback.theory.test.cjs` — 17 passed, 0 failed, Node `v24.19.0`.
- `node scripts/validate-research-convergence-ledger.mjs` — PASS, 16 items and 13 pending.
- `git diff --check` — pass.
- Independent review: pending. The package has not been adopted into the canonical candidate.

## State and next action

Status: **TESTED, isolated theory only**. Integration: pending canonical-owner review. Deployment: none. Hosted/customer proof: none. Exact Node 22 image admission: pending. Risk: the synthetic snapshot binding has not been connected to authoritative, tenant-isolated factory state, and scenario results are not proof of persistence or live replay. Next: canonical owner reviews the package, implements the read-only snapshot binding in the existing replay path, and runs exact-candidate image and hosted Golden Journey proof before raising the claim.
