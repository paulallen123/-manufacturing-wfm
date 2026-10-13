# Energy flexibility confidence admission — 2026-10-13

## Requirement and ownership

The accepted `energy-intelligence` research row derives from historical Frontier PR #69. The energy-flexibility advisory engine is already in the canonical candidate (`a8e8ce2e` adoption) and ranks safe workforce/process flexibility options. A confidence field that is present but malformed must not silently become full certainty, and an invalid decision threshold must not lower the gate. At selection, open-PR search for `energy-flexibility`, branch/worktree scan and file history found no active owner for this exact module fix. PR #69 is historical and #75/#78 reference the module from separate prototype/reliability work. The sole canonical implementation/release owner retains adoption.

Exact base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. Changed files: `src/frontier/energy-flexibility.mjs`, `test/frontier/energy-flexibility.test.mjs`, `release/research-convergence-ledger.json`, this evidence record. No new planner, runner, external tool, grid/OT command or release path was created.

## Result and tests actually run

Before the fix, `num('unknown', 1)` made a malformed energy, process or workforce confidence act like `1`; `minimumDecisionConfidence: false` became zero. The existing evaluator now rejects a present malformed/out-of-range energy signal, process or workforce confidence through its hard-constraint reasons, including the event-reducer-selected signal. A present malformed threshold throws before evaluation. Omitted fields retain their existing defaults; valid finite numeric strings remain accepted for compatibility. Advisory-only action contracts remain unchanged.

- Baseline `node --test test/frontier/energy-flexibility.test.mjs`: **13/13 pass** on local Node v24.19.0, including existing 1,500-scenario benchmark and 500 replay/permutation cases.
- Focused new regression before repair: **0/1 pass, 1 fail**; malformed confidence lacked the expected rejection reason. A later threshold extension also failed **0/1** before its repair because no exception was thrown.
- After repair: adjacent suite **14/14 pass, 0 fail/skip**, including malformed signal/process/workforce values, selected event replay, threshold inputs and valid numeric-string compatibility.
- `node --check` on the changed module and test, `git diff --check`, and `node scripts/validate-research-convergence-ledger.mjs`: **pass** (16 research rows, 13 pending).

## Review, integration and proof boundary

Independent read-only review verified direct and event-sourced confidence guards and found no blocking issue. Scoped fix: **TESTED locally**, not yet canonically adopted. Exact-candidate deployment/enablement: none. Hosted/customer proof: none. The existing engine's `tenantId`, `siteId`, energy event, process and workforce evidence are caller-provided in this isolated test; this repair does not authenticate provider, MES or labour source custody, establish realised savings, approve schedule changes or actuate grid/OT systems. No real personnel, payroll, production, customer or infrastructure state changed.

Next action: sole canonical owner reconciles this fix with current candidate and other ledger edits, runs approved Node 22/final-image and shared regressions, verifies authoritative source/freshness and exact serving SHA, then collects hosted Golden Journey and measured outcome proof through the existing release controls.
