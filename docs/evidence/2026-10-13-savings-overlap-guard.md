# F4.5 duplicate realised-evidence guard

Status: **TESTED locally and independently reviewed.** Isolated prototype correction only; no canonical integration, deployment or customer realised saving.

## Requirement and source

Accepted F4.5 in `VECTOR-Friday-release-backlog-2026-10-11.md` and issues [#196](https://github.com/paulallen123/-manufacturing-wfm/issues/196)/[#202](https://github.com/paulallen123/-manufacturing-wfm/issues/202) require projected and actual value to be separated with independent attribution and no double counting. Historical [PR #205](https://github.com/paulallen123/-manufacturing-wfm/pull/205) has an in-memory Savings Engine with a duplicate `attributionKey` check, but different keys could claim the same post-action evidence ref twice. This package only denies an exact same-ref replay within that one ledger instance. It is not full economic reconciliation or durable idempotency.

## Ownership and exact base

On 13 October, PR and branch searches for Savings Engine, `attributionKey`, savings and outcome ledger found only historical broad PR #205 for this module and no new exact overlap guard writer. This is a child package from PR #205 head `65fc59dadba377bce5fc68a88dc536261a5e68be`, source `platform/optimisation/savings-engine.mjs` blob `ebd801c481ddfbe623a6ad55bc3cb5071e924fac`. The release branch was separately checked unchanged at `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`; Continue customer proof retains sole canonical integration/release ownership.

## Changed files and result

- `platform/optimisation/savings-engine.mjs`: validate non-empty string post-action refs; trim reference boundaries; reject duplicate refs within one outcome and across outcomes in the same ledger before committing any ledger state. Preserve the existing duplicate attribution-key check and projected/actual separation.
- `platform/optimisation/savings-evidence-overlap.test.mjs`: synthetic separate effects, same-ref double claim under a different key, invalid source refs and no reservation after denial.
- `docs/evidence/2026-10-13-savings-overlap-guard.md`: this record.

## Actual tests and review

Node24.19.0 focused RED: 1 pass/2 expected failures (new attribution key reused evidence; object ref accepted). First correction 3/3 pass. Independent review then reproduced a sparse-array false acceptance (`new Array(1)` committed without a source ref); we added a regression and converted to a dense array before validation. Final `node platform/optimisation/savings-evidence-overlap.test.mjs`: 3/3 pass, including the new sparse-array check; final independent re-review found no remaining critical/important issue within exact-ref, single-ledger scope. Original `node scripts/validate-factory-decision-kernel.mjs`: PASS before and after the sparse fix, projected synthetic 7,300 GBP and realised synthetic 7,100 GBP, rejected unsafe option and duplicate key. That historical script writes a local receipt with `source_sha:null`, `deployment_id:null`, `deployment_proven:false`. No supported Node22/exact-head CI, image, route, hosted or real accounting readback was run.

## Integration/proof limits and next action

Draft only; not integrated into PR #205 or canonical, not enabled, deployed, proven, or customer-ready. The Map/Set is in-memory and resets on restart; different reference strings may represent the same real effect; the reverse is also possible. Baseline/alternative and post-action records need an authoritative identity, tenant/entity/currency/period and source custody. The canonical owner must reconcile one exact candidate, implement persistent transactional attribution/overlap rules and true observed baseline comparison, run release gates and approved hosted/customer proof. No real financial or personnel data changed.
