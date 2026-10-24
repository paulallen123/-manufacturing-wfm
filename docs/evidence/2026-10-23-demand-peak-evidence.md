# Scoped demand peak evidence — 2026-10-23

## Requirement and source

Issue #202 lists energy tariffs and demand peaks as Savings Engine opportunities, with baseline, attribution period, evidence and double-counting requirements. This package reports a **declared site meter interval peak compared with one declared tariff threshold**. It does not calculate demand charges, savings, avoided peaks, causality, or a recommended action.

## Ownership and conflict check

Open PR title/body searches for energy and demand peak plus remote branch checks found no focused demand-peak evidence owner before this branch. Existing energy PRs own signal admission, confidence, overflow, economic ranking and maintenance energy windows. This package changes only its existing three files, creates no route, adapter, writer, runner or controller, and retains the canonical integration/release owner.

The bounded repair lease was accepted on PR #510 in comment `6390872433` and recorded in the execution register #288 comment `6390872571`. Its scope is only the assessor, its focused test, and this evidence record. It grants no canonical, deployment, provider or customer-state authority.

## Exact predecessor and changed files

Predecessor: `feature/vector-demand-peak-evidence-20261023@90de1905f5195a9ab2c19132f6c8d038ff6db14f` (base `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`).

Predecessor blobs:

- `operations/runtime/demand-peak-evidence.cjs`: `cb94c66088fc84c8525def31750d28453b43dafd`
- `operations/runtime/demand-peak-evidence.test.cjs`: `3d9d29270fc039485fbad977d9a8bd205da6100f`
- `docs/evidence/2026-10-23-demand-peak-evidence.md`: `ba3da37c0715e7962dc263736db26424aeff335d`

The repair changes only those three paths.

## Implementation

The read-only assessor still binds tenant/site, a completed period of at most 31 days, a declared complete and observed meter snapshot, and a tariff revision effective over the entire period. It requires every 15, 30 or 60 minute sample in chronological order with exact nonoverlapping coverage, meter identity and revision, bounded numeric kW and unique evidence references/digests. It reports peak kW, threshold excess kW and contributing sample references.

The repair rejects active and revoked `Proxy` objects at every accepted object/array boundary before any reflective or array operation can invoke attacker-controlled traps. It captures the mutable validation, collection and freezing intrinsics used by the module, and uses direct numeric comparisons for the supported interval set, so later ambient replacement cannot relax validation or make returned evidence mutable. Caller data remains untrusted: `sourceAuthenticated:false`, `claimedSavingsPence:null`, `actionAuthority:false`.

## Verification

All commands ran in isolated reconstruction; no tenant, provider, deployment or business state was used.

1. Exact predecessor baseline on Node `v24.22.1`:
   `node --check demand-peak-evidence.cjs && node --test demand-peak-evidence.test.cjs`
   — 4/4 pass.
2. Fail-first held-out regressions against the exact predecessor:
   `node --test heldout.test.cjs`
   — 0/3 pass, 3 fail. Active proxies were accepted, revoked proxies leaked native `TypeError`, and replaced ambient `Array.isArray` was invoked.
3. Independent review found the first repair still reached mutable `RegExp.prototype.test`, `String.prototype.replace` and `Array.prototype.includes`. The added regression failed first:
   `node --test demand-peak-evidence.test.cjs`
   — 6/7 pass, 1 fail with `ambient regex test called`.
4. Final committed focused suite after capturing regex/string operations and replacing `includes` with direct supported-value comparisons:
   `node --check demand-peak-evidence.cjs && node --test demand-peak-evidence.test.cjs`
   — 7/7 pass, 0 fail/skip/cancel.
5. Final focused plus separately retained held-out suite:
   `node --check demand-peak-evidence.cjs && node --test demand-peak-evidence.test.cjs heldout.test.cjs`
   — 10/10 pass, 0 fail/skip/cancel.

Final local blobs before publication:

- assessor: `d01bb4917e95d4c9b9baeffa0fcc02c12b82c382`
- focused test: `4e5c195a922b8b9b79e84b5fba96eae62cc2a540`

The previous 377/377 operations-suite result belongs to predecessor bytes and is not transferred to this changed identity. This workspace does not contain the full repository or pinned Node 22.23.2, so no changed-byte full-suite, Node 22, CircleCI, exact-image, hosted or customer test is claimed.

## State and next action

The repair is built and tested in isolation. Independent exact-byte review, canonical/current-base contract reconciliation, admission, deployment enablement, authenticated intended-role action, durable readback, downstream reconciliation and audit remain pending. No measured saving, operational action, customer use or customer proof exists for this scope.

The canonical owner must independently review the exact repaired bytes, reconcile them with existing energy admission/ranking/maintenance contracts and authenticated meter/tariff/role-site sources, run the affected suite under the supported Node 22/current image, and only then progress through exact-artifact release and hosted proof gates.
