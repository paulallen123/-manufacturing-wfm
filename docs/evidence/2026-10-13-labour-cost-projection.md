# Labour cost projection slice — 2026-10-13

## Requirement and ownership

Issue #202's employee-management target includes labour cost forecasting. The canonical demand engine already forecasts units and translates them to P50/P90 headcount; the shared `payroll-money.cjs` computes exact rounded GBP components. This slice combines those existing engines into a **read-only, projected base labour cost** for a bounded shift period. It does not calculate payroll, recommend/execute a schedule, or claim realised savings.

Before selection, open PR/title and remote branch searches found no focused labour-cost projection implementation. PR #357 owns related forecast source/service changes, PR #233 owns the broad scheduling foundation, and PR #313 owns runtime composition. This package adds separate files only and starts no writer, controller, route, runner, deployment or paid infrastructure. The sole canonical implementation/integration owner retains adoption and release.

## Exact package and behavior

Base `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` on `release/vector-customer-ready-candidate-20260925`. Changed files: `operations/runtime/labour-cost-projection.cjs`, `operations/runtime/labour-cost-projection.test.cjs`, `.github/workflows/labour-cost-projection-gate.yml`, this record.

The module re-derives the supplied demand forecast using `forecastDemand` and bounded, recent source observations, rejects an altered step under the same forecast ID, and reuses `toHeadcountForecast` and `payroll-money.components`. It checks matching forecast/shift duration, tenant/site scoped GBP rate evidence, freshness/effective dates, future period coverage, safe headcount/money bounds, and a deterministic rate-field hash. Output carries period starts, productivity, shift/rate assumptions, source references and an explicit no-execution/no-realised-savings boundary. Rate and demand source refs remain **caller supplied**; only an approved source adapter or attestation can establish authenticity.

## Tests, review and lifecycle

- TDD RED: first 4 tests failed for missing module (after correcting the negative tests so they could not pass from absence); later swapped-forecast, duration mismatch, future observation, altered-rate-hash, stale-history and unbounded-history cases each failed before their repairs.
- Focused local final suite: 10/10 passed, zero failures.
- Pinned Node 22.23.2 combined projection, existing forecast and shared money suites: 30/30 passed, zero failures.
- Repository `node scripts/run-forge-ci.mjs`: PASS after final evidence-binding repairs.
- Independent review: first pass found a forecast-substitution false PASS, absent runtime packaging, and missing reconstruction fields. Forecast and receipt defects were repaired; second pass found a rate-hash false PASS. Rate hash was bound to rate fields. Final reviewer reported no blocking correctness finding for the standalone module; authenticated sources and packaging remain explicit integration blockers.
- CI workflow added for exact PR head; its GitHub runner execution has not been observed.
- Canonical integration, Docker packaging, exact-candidate deployment, hosted/customer proof: **pending**. The current composer explicitly copies forecast/money engines but not this new module. Its shared-file changes are owned by active integration work, so the canonical owner must reconcile packaging and an authenticated rate source before product use.

**Status: TESTED locally as an isolated advisory library.** It is not integrated, deployed, proven or customer-ready. The Railway candidate service still serves an older SHA while the exact candidate source change is staged. A future externally reachable adapter must enforce request size and a bound on forecast adjustments before invoking this module.

## Next action

Canonical owner reviews this isolated package, reconciles it with PR #357 and the composer owner, binds rates and demand observations to an approved authenticated source, admits the module and tests into the one exact image, reruns combined gates, then proves a role-authorized synthetic manager cost view with source, refresh and audit readback on the serving candidate.
