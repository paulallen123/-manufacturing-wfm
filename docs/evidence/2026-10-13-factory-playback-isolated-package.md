# Factory Playback isolated convergence package

Evidence time: 2026-10-13 07:49 UTC. Status: **TESTED** in an isolated worktree. This is not an integrated or hosted product claim.

## Requirement and source

`factory-playback` in `release/research-convergence-ledger.json` (source PR #230) requires a chronological, read only reconstruction of factory state and decisions by composing existing simulation, Decision Episode, realtime, outcome proof and recovery evidence. `docs/VECTOR_RESEARCH_ALIGNMENT_2026-09-23.md` specifies that it is an evidence projection, not a new historian, MES, machine control system, or source of operational authority.

## Owner and conflict check

The ledger assigns the existing orchestrator, product evolution, frontier, and trust proof release engines. Canonical integration remains owned by `integration/canonical`; this package does not move that ref or any release ref. Read only `git ls-remote --heads origin` on 2026-10-13 found no factory playback named branch. The latest inspected October source branch `feature/vector-report-claim-boundary-20261013` at `f34464f3a713bab8c381260c27320c7042dcd192` did not contain `operations/runtime/factory-playback.cjs`. A historical PR #230 source branch contains the prototype at `07bc5218c183049a8d7ab884b15cca6ef38375ec`. The GitHub connector confirmed issue #265 is open and assigned to the repository owner, but its full discussion fetch failed with a closed transport. The configured CLI token failed authentication, so the current issue/PR/actor and live lease picture is incomplete. Ownership is therefore clear only to the inspected Git refs and issue assignment, not all possible active chats or jobs. This work remains an isolated package pending owner reconciliation.

## Exact base and changes

Base: `90ad90fcf60adaca9abacdd4ad14bf392f95e585` (merged October product source; no canonical or staging ref modified).

- `operations/runtime/factory-playback.cjs`: port the existing PR #230 read only projection; require an intact Outcome Proof digest, matching tenant, site, decision type and selected option, and internally consistent classification before presenting realised financial value.
- `operations/runtime/factory-playback.test.cjs`: retain historical normal and tenant cases; add actual Outcome Proof engine integration and altered, wrong site, wrong option, and unsealed proof cases.
- `release/research-convergence-ledger.json`: advance only this research row to isolated implementation with the evidence pointer.
- This evidence file.

The projection accepts already tenant scoped realtime records from the existing service. It is an internal helper with no HTTP route or execution authority. A digest detects alteration; it is not an authenticity signature. The canonical owner must preserve authenticated tenant scoped retrieval when wiring the helper into a product route.

## Test and review evidence

Initial port: `node --test operations/runtime/factory-playback.test.cjs` — 2 passed, 0 failed.

After hardening: `node --test operations/runtime/factory-playback.test.cjs operations/runtime/decision-episode.test.cjs operations/runtime/decision-outcome-proof.test.cjs` — 14 passed, 0 failed. `node scripts/validate-research-convergence-ledger.mjs` — PASS, 16 items registered, 13 pending. `git diff --check` — PASS. No product test failure was observed. GitHub CLI and full discussion retrieval failed as described above.

Independent review: **PENDING**. Canonical integration: **PENDING**. Exact candidate deployment: **NOT RUN**. Hosted/customer proof: **NOT RUN**. No customer readiness or realised customer value is claimed.

## Remaining risk and next action

The helper is not yet connected to a role authorised, tenant scoped read path; its input records depend on that caller boundary. An independent reviewer should verify proof admission and event scoping against current source, then the canonical integration owner should adopt or reject this exact package, run full regression and exact image checks, and prove a synthetic hosted journey against the deployed SHA before advancing the row further.
