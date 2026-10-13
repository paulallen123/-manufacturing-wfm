# Controlled-zone transition controls — 2026-10-13

## Requirement, ownership and exact base

The accepted `controlled-environment-flow` row (`release/research-convergence-ledger.json`, historical Frontier PR #216) requires controlled-zone staffing and intervention advice to respect site transition constraints. The current candidate already includes the advisory `intervention-transition-ledger` from canonical adoption commit `40d3e8f1`; this package hardens that engine's policy admission. At selection, the open-PR search for `intervention-transition-ledger` and `controlled environment flow`, branch/worktree scan and file history found no active writer for this narrow transition-control fix. The historical #216 prototype and broad #225 FORGE PR do not own this source delta. The sole canonical integration and release owner retains adoption authority.

Exact base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. Changed files: `frontier/controlled-environment-flow/intervention-transition-ledger.mjs`, its adjacent `.test.mjs`, `release/research-convergence-ledger.json`, and this evidence record. No route, runner, controller, schedule writer, access-control writer or deployment is added.

## Result and tests actually run

The existing policy gate accepted a transition `controlMinutes: -1` or `controlCost: -1` and could produce `ledger_ready` with misleading movement/control economics. It also coerced null controls to zero, silently treated malformed `gowningCycle` as false, and could sum individually finite costs/minutes to infinity. The existing transition index now rejects explicitly invalid control values and non-boolean gowning declarations, treats null controls as unknown in movement and aggregate metrics, and blocks non-finite aggregate metrics. Existing allowed movements, pairing and advisory-only consolidation remain in the same engine.

- Initial command from the repository root failed because it referenced the new worktree's relative test path. Re-run in `/workspace/vector-zone-work`: baseline **84/84 pass** on local Node v24.19.0.
- New focused regression before repair: **0/1 pass, 1 fail**; negative transition control produced `ledger_ready`.
- After repair: `node --test frontier/controlled-environment-flow/intervention-transition-ledger.test.mjs`: **85/85 pass, 0 fail/skip** on local Node v24.19.0. The new test covers negative, blank, boolean, array and infinite control values, malformed gowning declarations, null unknown cost/minutes, and aggregate overflow.
- `node --check` on both changed runtime/test files and `git diff --check`: **pass**. `node scripts/validate-research-convergence-ledger.mjs`: **PASS, 16 rows, 13 pending**.

## Review, integration, proof and risk

Independent read-only review found and verified a correction for unknown control minutes in the aggregate; no blocking code finding remains. Scoped state: **TESTED locally**. Canonical integration: pending sole owner reconciliation, including other active research-ledger drafts. Exact-candidate deployment/enablement: none. Hosted/customer proof: none. The existing `policy.authoritative`, task and presence provenance fields are assertions supplied by callers; this fix does not authenticate QMS/MES/access source custody, prove actual qualified presence, issue access permissions or validate a customer zone policy. No real personnel, production, access, payroll or customer state was changed.

Next action: canonical owner should reconcile the bounded fix into the one candidate, run approved Node 22/exact-image and shared transition tests, bind source receipts and freshness independently, then capture an authorised synthetic hosted controlled-zone journey with downstream readback and audit before raising proof state.
