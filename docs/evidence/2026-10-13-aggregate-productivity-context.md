# Aggregate productivity context: isolated package

## Requirement and source

Issue #202, Employee management target, accepts “performance/productivity context without unsafe or opaque people scoring.” The Vector shell currently renders a Productivity placeholder (`ux-overlay/vector-shell.js`, `secondaryKpis`). This package computes only site, line, product and period level output context from synthetic MES good/rejected units and WFM direct hours. It does not score people or claim that labour alone caused output.

## Ownership and exact base

The canonical implementation and release owner retains all integration, UI, source adapter and deployment authority. Before work, the open PR, branch, active worktree and exact path checks found no focused aggregate productivity context lane. Existing agency labour performance, quality workforce shadow, labour cost projection and maintenance work have distinct scopes. This branch adds no shared UI, route, job, database writer, controller or deployment. Isolated base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` on `release/vector-customer-ready-candidate-20260925`.

Changed files:

- `operations/runtime/aggregate-productivity-context.cjs`
- `operations/runtime/aggregate-productivity-context.test.cjs`
- `.github/workflows/aggregate-productivity-context-gate.yml`
- `docs/evidence/2026-10-13-aggregate-productivity-context.md`

## Result and verification

The pure read-only module requires identical tenant, site, line, product and exact UTC period on both sources; past periods, bounded observation age, source references and revisions, and hashes matching the supplied aggregate payload. It rejects extra person fields and unsafe quantities. It returns no numeric metric if worker count is below five; otherwise it returns good units per direct hour and good unit yield, with `executionAuthority: false` and an explicit claim boundary. No person score, payroll action or savings claim is produced.

Tests were written first: the initial four focused tests failed 0/4 because the module did not yet exist. After implementation, `node --test operations/runtime/aggregate-productivity-context.test.cjs` passed 4/4 on local Node and in pinned Node 22.23.2 Docker image (`sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96`). Independent review found that tiny direct hours could yield `Infinity` and that a suppressed result leaked a hash of the small count. Regression tests were added and failed 2/4 before the correction, then passed 4/4 locally and 4/4 in pinned Node 22.23.2. The suppressed result now omits scope and source references/hashes, and the rate must be finite and bounded. `node scripts/run-forge-ci.mjs` returned `VECTOR_FORGE_CORE_CI=PASS` on the candidate base plus this package. `git diff --check` passed. The focused GitHub workflow is supplied; its remote run is pending.

## State and limits

**TESTED as an isolated library only.** Independent re-review confirmed the numeric and suppressed-output defects were fixed and found no further contract or workflow defect. No canonical integration, package wiring, exact candidate deployment, hosted test or customer proof has occurred. Review's remaining high severity integration blocker is the caller asserted worker count: a caller can recompute the unkeyed hash after changing it. A matching hash here is a self-consistency check, not source authentication or a publishable privacy gate. A trusted adapter must verify source identity, completeness and revision, and must define reliable direct-hour attribution for the same product and period. Group size alone does not prevent overlapping-query differencing; a future route needs access control, fixed aggregation windows and suppression policy. Mixed products cannot be combined as equal units. The UI placeholder remains unchanged.

Next: independent review, canonical owner adoption and source adapter contract, then exact candidate tests, approved deployment and role/site/tenant hosted proof before any customer-ready claim.
