# V123 durable outcome replay adoption candidate

This adopts the already reviewed [V123 durable replay packet](https://github.com/paulallen123/-manufacturing-wfm/pull/354#issuecomment-6512317426) as product-code changes on an isolated branch targeting the existing PR354 owner branch. It covers repeated learning outcome evidence across process restart. V123 remains DEVELOPMENT; incident memory, authenticated outcomes and customer completion are not inferred.

## Exact source and behavior

Parent PR354 remains `3e4c721307abec96a1830f1b5e9fbb44c5310873`, engine Git blob `620fbc1d3f4aaf9bc31559b70a28bb857ee1a138`. Its original 263 engine tests are unchanged.

The two engine changes use the triggering receipt timestamp for derived regression/candidate records, so replay reconstructs identical advisory metadata. The opt-in `DurableOutcomeLedger` adapter stores normalized outcome records in local SQLite transactions, replays committed records through that engine, deduplicates tenant/source/evidence identity, rejects conflicting reuse before commit and retains the configured win threshold across reopen. It requests WAL and FULL synchronous mode. Candidate knowledge retains `authority:'none'`.

The engine and adapter are byte-identical to the reviewed packet:
- Engine SHA-256: `82a48bfbca0905ef542c7a2fb3e094786e43a23a3cd8d94a0be4d90a00a61a1f`.
- Adapter SHA-256: `22e4b5f6276bbb8487f36a442ba9a314fae963cc1e6cd0d6b35ddc7206afc6a2`.
- Original reviewed patch SHA-256: `97d92dfe80f639eba5c1f1b329b7ce7f8344eb8067a7f235db9a30c4b73bdbbd`.

The original seven adapter tests are unchanged. Seven earlier independent heldouts now derive their module path from the colocated adapter rather than a scratch environment variable; their behavioral assertions are unchanged.

## Fresh evidence

Node `v22.23.2`:

```sh
node --test --test-reporter=tap adaptive-intelligence/engine.test.mjs adaptive-intelligence/durable-outcome-ledger.test.mjs adaptive-intelligence/durable-outcome-ledger-heldouts.test.mjs
```

| Source | Exit | Pass | Fail | Skip | TAP SHA-256 |
|---|---:|---:|---:|---:|---|
| Exact old engine + proposed adapter/tests | 1 | 275 | 2 | 0 | `7871658a2bbf03e3322d94e9caf78ed4260efbf93afd16a3af1cd80781b05f25` |
| Reviewed engine repair + adapter/tests | 0 | 277 | 0 | 0 | `f661455e3cf73974fda4c5ae0df30745934f515b76ad1ee25647489fd8d17ccd` |

Both old-engine failures concern derived timestamps changing after reopen. The suite also checks committed reopen/process replay, two-handle idempotence, conflicting replay, tenant/source identity isolation, accessor rejection, corrupt row refusal, threshold mismatch and an uncommitted manual SQLite writer killed in a child process. These are synthetic local database checks. Killing the manual writer is not fault injection inside the adapter. The local check of the original patch first failed because the test fixture already contained its new files; a separate exact preimage with those files absent passed `git apply --check`. Candidate syntax checks pass.

The Node runtime reports SQLite as experimental. This draft does not select an approved production transaction store. Earlier independent 277/277 evidence remains linked in the reviewed packet; fresh independent review of this adoption candidate is pending at publication.

## Ownership and remaining acceptance

PR354 retains donor ownership; PR501 retains canonical integration/release control. Fresh PR354/#527 comments and exact adapter PR/branch searches found no newer adoption or specific conflicting writer. Existing pool C automation retains manufacturing/learning routing, with no explicit V123 source writer in the visible records. External chats/leases are not observable. No applicable AGENTS.md was found in the exact inspected source paths. This branch changes no existing owner ref, controller, route, schema, lockfile, image contract or live tenant.

The adapter still requires an owner-approved supported store/path and volume/backup custody, authenticated tenant/source/evidence binding, integration through the actual current consumer, current-base/whole-image/security/recovery gates and hosted restart/audit/readback. It is not an HTTP endpoint or default-enabled workflow. This source change does not inherit the original donor's older image admission. No external source authenticity, independent real-world measurement, customer financial benefit, incident recurrence prevention, deployed state or customer proof is claimed.
