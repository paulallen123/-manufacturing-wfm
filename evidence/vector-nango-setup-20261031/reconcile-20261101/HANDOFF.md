# Nango donor reconciliation — fixed checkpoint

The three shared source files are reconciled locally against canonical checkpoint `ca6e36b4efd1099b56250fb790943db4b533fee5`, using the exact Nango donor at `e2cf7f7295e783abaf6d6464e70331dc71368c98`. No later owner commits were inspected or pursued. No production resolver or security-contract change was needed.

## Publication inputs

Use the combined files at the proposal root:

- `Dockerfile`
- `scripts/compose-vector-local-runtime.mjs`
- `scripts/run-forge-ci.mjs`

All other donor files are carried by the root's planned tree union; the local copied test/runtime files were checked against donor Git blobs and remain byte-identical. This task did not edit `vector-nango-publish` or any documentation file.

Recommended new evidence prefix: `evidence/vector-nango-setup-20261031/reconcile-20261101/`. Publish the new reconciliation manifest/source receipt, command results and five focused logs there. Local `baseline/`, fetched source dumps, preparation script and patch views are review aids, not runtime or publication requirements. Previous donor evidence remains historical and unchanged.

## Exact source changes

| Path | Checkpoint Git blob | Combined Git blob | Delta |
| --- | --- | --- | --- |
| `Dockerfile` | `b8370243a1dedd0b22dfa8943734ea8515337791` | `42da319ca83461546cee6fef1149fcf30a801ef1` | +9 / −0 |
| `scripts/compose-vector-local-runtime.mjs` | `84ee795c35434faea2a22c8aaa539b7a5842247f` | `cf9d2e05ad8eeb76d74cc3ddddfe3ad70cabd519` | +13 / −0 |
| `scripts/run-forge-ci.mjs` | `2b8ada2ef7c454e900f2401f23ac6d70937e61ee` | `2994e733d73d770130c6c6b16dd0d832548485d1` | +3 / −0 |

The six insertion blocks come directly from the verified donor files. Every current checkpoint anchor occurs exactly once. Removing only these blocks restores all three checkpoint files byte for byte, including mixed line endings. No owner line is removed or replaced. The newer dated-leave, tenant-local-time, kiosk, operational-module and validation changes are retained.

The metadata broker seam remains unchanged: both composer paths still call `composeStaffology`, and the added hook inserts the existing resolver callback before writing the assembled server. The existing sealed archive and corrected provider adapter contract retain their prior Git blobs. The complete canonical tree contained 1,998 entries, was not truncated, and had zero Nango paths. No `AGENTS.md` was present in that tree or the inspected workspace ancestry. The checkpoint's `STATE.md` and its referenced execution manifest were read; their older hosted/deployment data was not treated as current evidence.

## Protected owner source and freeze semantics

These canonical files are unchanged and excluded from the proposal's source changes:

| Path | Required canonical Git blob |
| --- | --- |
| `.circleci/config.yml` | `65f5647b94271f9bed8649aff9791b8d7e2273fa` |
| `artifact/vector-proof-freeze.trigger` | `31981cef7e79ebf505b477316393995a4d442490` |
| `scripts/require-frozen-candidate.sh` | `b14ccaa1f3826a579b175e20010cd5dccb95437c` |
| `scripts/require-frozen-candidate.test.mjs` | `671792fa420d4dbe3ea03d47aefb92b75d0d77d1` |

For the root's planned donor refresh commit, the first parent must be canonical `ca6e36b4efd1099b56250fb790943db4b533fee5`, with donor `e2cf7f7295e783abaf6d6464e70331dc71368c98` as the additional parent. The marker must equal the canonical first-parent marker. The existing gate compares the committed marker with `HEAD^1` and refuses `unchanged_trigger` when they match. This source refresh therefore does not create freeze admission. That conclusion follows from the inspected unchanged gate and required tree/parent construction; this local task did not create or execute a merge commit.

## Focused verification

Runtime: Node.js `v24.22.1`. Every command returned exit status 0. No tests were skipped.

| Check | Result | Log |
| --- | --- | --- |
| Resolver | 64/64 | `resolver.log` |
| Real sealed metadata broker | 7/7 | `broker.log` |
| Actual composer hook and Docker wiring | 3/3 | `wiring.log` |
| Hook-installed resolver and broker replay | 71/71 | `installed-hook.log` |
| Actual Forge dispatch with child execution stubbed | PASS; all 16 prior commands preserved; 3 required suites dispatched exactly once; 3 failure cases stop dispatch with exit 17 and no success marker | `forge-selector.log` |
| Composer and Forge syntax | PASS | Exact command/exit recorded in `command-results.json` |

There are 74 focused source test cases and 71 repeated against the installed layout. The installed resolver has unchanged SHA-256 `4a9959044cfc350b09b5f163a8032346c9c6d3f6b71836421303e4abab3fa15b`. The installed-hook driver uses the actual copied module and verified sealed broker, with synthetic Nango/provider responses. The archive is validated against SHA-256 `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`.

The Forge check preserves the current dispatcher and stubs only `spawnSync`; it does not run or certify the complete validation command list. The complete composer, Docker image, Node 22 image runtime, signed-permit lifecycle and live provider connection were not tested. No new independent boundary suite was spawned or rerun by this task; the root's designated reviewer will review the final combined candidate.

No GitHub or Railway mutation, secret file, credential access, live API call, deployment, merge or activation occurred. Root-owned key authorization/storage and account setup remain outside this reconciliation's evidence.
