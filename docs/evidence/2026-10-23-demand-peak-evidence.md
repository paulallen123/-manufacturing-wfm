# Scoped demand peak evidence — 2026-10-23

## Requirement and source

Issue #202 lists energy tariffs and demand peaks as Savings Engine opportunities, with baseline, attribution period, evidence and double-counting requirements. This package reports a **declared site meter interval peak compared with one declared tariff threshold**. It does not calculate demand charges, savings, avoided peaks, or a recommended action.

## Ownership and conflict check

Open PR title/body searches for energy and demand peak plus remote branch checks found no focused demand-peak evidence owner before this branch. Existing energy PRs own signal admission, confidence, overflow, economic ranking and maintenance energy windows. This package changes new files only, creates no route, adapter, writer, runner or controller, and retains the canonical integration/release owner.

## Exact base and changed files

Base: `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.

- `operations/runtime/demand-peak-evidence.cjs`
- `operations/runtime/demand-peak-evidence.test.cjs`
- `docs/evidence/2026-10-23-demand-peak-evidence.md`

## Implementation and verification

The read-only assessor binds tenant/site, a completed period of at most 31 days, a declared complete and observed meter snapshot, and a tariff revision effective over the entire period. It requires every 15, 30 or 60 minute sample in chronological order with exact nonoverlapping coverage, meter identity and revision, bounded numeric kW and unique evidence references/digests. It reports peak kW, threshold excess kW and contributing sample references. Caller data is untrusted: `sourceAuthenticated:false`, `claimedSavingsPence:null`, `actionAuthority:false`.

Focused synthetic suite: 4/4 pass on Node 24.19.0; full operations runtime 377/377 pass; local FORGE core gate `VECTOR_FORGE_CORE_CI=PASS`; syntax and diff checks pass. No local test failures. CircleCI, external image and hosted proof are pending. No customer or personnel data, payroll mutation or tenant write was used.

## State and next action

Built and locally tested. Independent review, canonical integration, exact-image deployment and hosted/customer proof are pending. A complete meter snapshot and tariff revision are caller declarations, so the canonical owner must bind authenticated interval meter and tariff sources, independently review against existing energy ranking/admission PRs, and validate site/role access. Only after exact integrated-image security and release gates may the approved process deploy and run synthetic hosted readback on one serving SHA. Production approval and customer-ready claims remain unchanged.
