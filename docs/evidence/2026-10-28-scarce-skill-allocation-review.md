# Scarce-skill allocation review — 2026-10-28

## Requirement and source

Backlog #202 calls for employee decisions to consider skill, availability, cost, fatigue and production impact, and lists poor skill allocation in the Savings Engine. This slice identifies one published single-slot assignment where an eligible replacement without a scarce skill could free the incumbent for an overlapping declared skill shortage. It does not claim that the worker can fill another slot, that savings are real, or that the supplied evidence is authenticated.

## Ownership and conflict check

At selection, the canonical candidate was `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. Open PRs and remote branches were searched for skill allocation, required skills and truncation. PR #233 owns scheduling parity, #352 owns scheduler source changes, #418 owns ranking proof, #521 owns mandatory training on published shifts, and #394 owns maintenance workforce preflight. No focused scarce-skill release comparison owner was found. This package adds new files and calls the existing scheduler; it does not edit its source, start a runner, publish a roster, or change the Railway service. Canonical integration/release ownership remains with the established owner.

## Exact package and result

- Base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.
- Branch: `feature/vector-scarce-skill-allocation-20261028`.
- Changed: `operations/runtime/scarce-skill-allocation.cjs`, `operations/runtime/scarce-skill-allocation.test.cjs`, this record, and `artifact/vector-proof-freeze.trigger` for a nondeploy exact-head CI run.
- The pure assessor binds tenant/site, one published slot and incumbent, roster revision, distinct evidence refs and exact overlapping demand. It requires a declared shortage, checks the incumbent has the scarce skill, then uses the existing scheduler to find an eligible replacement without it. It rejects oversized requirement arrays that the scheduler would truncate. Output has `executionPermitted:false`, `sourceAuthenticated:false` and `expectedSaving:null`.

## Tests actually run

- Initial TDD test: failed as expected because the module did not exist.
- First implementation: 1/5 passed; four failed because canonical `Z` instants were compared to scheduler-normalized `.000Z` instants. Corrected by normalizing both windows.
- Boundary edit initially broke the full operations run: 375/379 passed, four new cases failed because an omitted optional certification list was rejected. Fixed to allow omission while rejecting malformed or oversized supplied arrays.
- Final focused: 6/6 pass on Node 24.19.0.
- Final operations suite: 379/379 pass on Node 24.19.0 after `npm ci --prefix security/runtime --ignore-scripts --no-audit --no-fund`.
- Local `node scripts/run-forge-ci.mjs`: `VECTOR_FORGE_CORE_CI=PASS`; release manifest remained `productionApproved:false`, `stagingOnly:true`.
- Syntax and `git diff --check`: pass.

## Review, integration, deployment and proof

Self-review corrected the time representation and optional-array mistakes. Independent PR review and exact-head CI remain pending at publication. State: **TESTED locally**. The package is not integrated into the canonical candidate, is not wired to authenticated roster/skills/demand adapters or a route, and has no hosted or customer proof. Railway's latest candidate deployment `d9112b19-7e46-4eab-8873-9a51826870b6` failed building commit `48dce8f`; the last successful deployment `057e19a2-7d49-4390-8705-63e71ea79a89` serves older `90ad90f`. No deployment was started for this isolated branch.

## Remaining risk and next action

Source refs and coverage counts are caller supplied. A shortage may be resolved by another decision; this result only suggests review, never a swap, a saving or an employee action. The canonical owner should independently review the package, reconcile it with the scheduling PRs, authenticate current source revisions and role/site access, run exact combined image/security gates, integrate once, and verify a synthetic hosted manager readback on the serving SHA before use.
