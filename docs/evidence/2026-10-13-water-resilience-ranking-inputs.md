# Water resilience ranking input repair — 2026-10-13

## Requirement, ownership and base

The accepted `water-resilience-orchestration` research row comes from Frontier PR #218. Its advisory planner ranks already-feasible production and staffing plans by restriction exposure, scarcity-weighted water, tariff cost and lateness. Those ranking inputs must be valid so a negative weight, tariff or penalty cannot make a harmful plan look beneficial. Current candidate source already contains this engine and tests, adopted in `40d3e8f1`; this change reuses them.

At selection, an open-PR search for `water-resilience-orchestration`, historical PR #218, local worktrees and candidate file history showed no active package owner for this narrow input repair. There is no second planner, runner, source writer, controller or release lease. Exact base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. Changed files: `frontier/water-resilience-orchestration/water-resilience-orchestration.mjs`, its adjacent `.test.mjs`, this record and `release/research-convergence-ledger.json`.

## Implementation and test evidence

The existing evaluator previously accepted `scarcityWeight: -1`, yielding `safe_candidate` with `scarcityWeightedWater: -7` for the synthetic fixture. The new regression first failed **0/1**, showing that result. Independent review then found null/nonnumeric coercions and overflow. The repair rejects a present negative, blank, boolean, array or non-finite scarcity weight or tariff as `water_slot_economics_invalid`; invalid task penalty/demand and required capacity values also fail closed. Omitted scarcity weight remains at the existing default of 1; null now also uses 1 instead of zero. Omitted/null tariff remains zero. Required task water/effluent demand and slot availability/effluent capacity may not be null. Accumulated metrics must remain finite, including when individually finite inputs multiply to infinity. Validation happens inside the existing advisory evaluator before scoring; no execution authority changes.

- Initial test command from repository root failed because the path was relative to the new worktree. Re-running in `/workspace/vector-water-work` gave baseline **25/25 pass**.
- Focused new regression before repair: **0/1 pass, 1 fail**, with negative scarcity weight producing a `safe_candidate` and negative weighted score.
- After repair and review corrections: `node --test frontier/water-resilience-orchestration/water-resilience-orchestration.test.mjs`: **26/26 pass, 0 fail/skip** on local Node v24.19.0.
- `node --check` on both changed runtime/test files and `git diff --check`: **pass**.
- Research ledger validation and final independent review are recorded in the PR handoff after execution.

## Boundaries and next action

The existing source is an advisory, in-memory planner. This local fix is **TESTED** within its scoped synthetic suite and is not yet adopted by the sole canonical owner. Independent read-only review found and verified fixes for null and coercion gaps, required demand/capacity gaps and finite-input overflow; no blocking code issue remains. Exact-candidate integration: pending. Deployment/enablement: none. Hosted or customer proof: none. The existing `policy.authoritative` and source references are caller-provided; this repair does not establish authenticated utility, MES, recipe, effluent or workforce truth, nor measured savings. No customer, production, personnel, payroll, recipe or control-system state was changed.

The canonical owner should reconcile this fix with current candidate work, run exact-image and shared regressions, bind authoritative source receipts and valid time ranges, then collect hosted/customer-like Golden Journey and measured outcome evidence before raising readiness.
