# Vector UI correction — 21 September 2026

Status: implemented and repeatedly verified in the local repair candidate. Not a hosted release, complete concept implementation or Golden Journey certification.

The agreed navigation is Today, People, Plan, Factory, Improve. The September 19 references use the blue Vector mark, compact operational screens and a workforce table; September 20 adds role-first Items to review and a review drawer. Their reference hashes and decision dates are in `ux-overlay/design-reference.json`.

## Root cause

The video and hosted service used commit `338e07b24d3096d30dcc97fe14c33a03261b7e86`. The canonical branch had advanced to `6667f4217e0c0a8a90cab8d4c7d79f8efd628662`, but its Vector shell JS/CSS were byte-identical to the recorded older shell. The agreed five-section layout was not implemented there. Hard-coded navigation also referenced nonexistent routes and sent People to organisation administration. Routes were not in browser history. The retired factory presentation still executed; the existing purge omitted its JS. Removing the file alone still allowed the server's SPA fallback to return 200 for its URL.

## Correction

- Implement the five sections in the existing Vector shell; retain business workflows as section tabs and role-authorised Settings & more destinations.
- Apply blue Vector branding and the compact reference layout. People uses scoped records, working search and existing person profiles.
- Add real history/reload routes; derive availability from existing role-specific routes and disable unavailable controls. Employees cannot open the manager People view or financial/factory sections.
- Preserve authoritative lifecycle grouping and neutral evidence states. A leave review drawer explains the source request and opens the existing coverage checks; opening it has no business effect.
- Keep the large leave-balance table available through disclosure, so pending requests remain accessible.
- Physically purge retired presentation assets and return 410 for stale or encoded retired URLs instead of serving the SPA fallback.
- Correct three pre-existing stale string checks in the source guard to match the already-present lifecycle grouping. Existing lifecycle behavior tests remain, with a browser-event stub and cross-VM array normalization in the harness.

## Evidence and limits

The immutable local runtime is `c72a44f6a94d568dd2020f8ace724acf0a2f413210d8d3090a27839b4cb0e7b4`. Its UI JS SHA-256 is recorded in the attached evidence manifest. The same 10 browser checks passed on three fresh fictional databases without retries. They cover five-section navigation, scoped People search/profile, back/forward/reload, retired assets, a read-only review drawer, every enabled section tab, persisted approval, phone overflow/navigation, browser errors and employee financial restrictions. The separate continuous narrated recording also verified saved approval, matching audit/request trace and SQLite integrity.

57 available local regression/contract tests passed, including presentation purge, provenance tampering and existing lifecycle semantics. The source guard passed on the materialized repository modules. This is not the entire canonical repository checkout or its hosted Docker/CI suite. The local runtime additionally includes the earlier reliability repair candidate; this PR publishes only the UI correction and narrow retired-asset handler against the current canonical branch, not those other runtime changes. Exact full-candidate and hosted proof are still required before promotion.

The original failing browser checks and subsequent passing runs are retained. The concept's advanced skills/training summaries, production forecasts, recommendations and savings must not be represented as implemented solely by this UI correction. Existing source workflows remain authoritative; missing evidence is labelled.

The latest successful hosted deployment remains `a2b4a0ca-83d3-4285-b16f-f8d0f9dbb97c` at `338e07b…`. Railway's `.security-hold-do-not-autodeploy` watch and the earlier full-candidate admission hold remain unchanged. No live data, payroll rules, identity permissions, provider credentials or deployment configuration were changed.

## Reproduction

Run `node --test scripts/compose-vector-presentation.regression.test.mjs ux-overlay/vector-action-queue.test.cjs` and `node scripts/validate-vector-only-ui.mjs` in the repository.

The browser regression is `scripts/vector-five-section-browser-regression.mjs <assembled-runtime> <fresh-output-directory>`. It starts only a local product process and uses fictional accounts. It requires Node with SQLite, Playwright (provided through `CODEX_PRIMARY_RUNTIME_NODE_MODULES` in the verified environment), and `PLAYWRIGHT_EXECUTABLE_PATH` when the local browser bundle is absent. The verified runtime contains the earlier `/api/release` identity endpoint. Do not substitute another runtime and present these results as proof for it.

Promote only after the exact combined candidate passes existing full-build, role/browser, source-asset and security admission controls. Revert this isolated change on the source branch if integration fails; do not roll back customer business data for a presentation correction.
