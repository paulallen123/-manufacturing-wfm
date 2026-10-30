# V007 cumulative owner-ready source/test patch

The ten-file `cumulative-source-tests.patch` concretely composes the reviewed V014 setup containment repair with the Gusto HTTP/process regression and the complete V067/V103 assessor source/test additions on exact PR501 `61718e1862fa650136e1952f622c9d8dd4c22af8`. It closes the previously untested composition gap. The independent root source/composition review found no Important in-scope issue and accepted the bounded test evidence; this is not formal GitHub approval. It has **not** been adopted on PR501, built into an image, deployed or customer-proven. Existing sole integration/release and domain owners retain all authority.

## Selected exact donors

| Donor | Exact head | Selected behavior |
| --- | --- | --- |
| #531 | `e20a4c0cddaea85b2661b42a1c6165220a29eb93` | Apply its existing three-file owner-ready source patch and its existing red heldout together. |
| #529 | `2afb04d18801f0e43d3291a8e55917dee4701f5d` | Add both Gusto real loopback HTTP/process-restart test/fixture files. |
| #521 | `c6ded217c9d53cf19d3df66b8d85ee0c53aa382f` | Add complete repaired training/shift source and test, including original implementation omitted by cherry-picking only its latest repair commit. |
| #526 | `1cb72ddd39c8ce3789f77f3a1bc667443b5db0e1` | Add complete repaired maintenance permit source and test, including original implementation. |

The original donor evidence documents remain at the named donor heads; the cumulative patch contains only executable source/tests. No scheduler, reporting UI, Docker, bootstrap, schema, lockfile, runtime configuration, tenant or provider surface was edited. PR533 stays outside this package because its scheduler dependency has another current writer. AGENTS search of the complete, untruncated PR501 tree found none. Existing `inventory/ownership.json`, current issue527 and PR501 ownership comments were read; no canonical write lease is claimed. Fresh raw heads were unchanged at 2026-10-30T01:26:50Z; see `remote-heads.json`.

## Fresh verification

All commands used supported Node `v22.23.2`. These test executions belong to one executor; the independent root reviewed source/composition and the raw receipts without claiming a separate test execution.

| Check | Exit | Result |
| --- | --- | --- |
| Exact current source + unchanged V014 heldout | 1 | 0/1; returned 200 and persisted one operational person instead of required 403/zero. |
| Exact current source + unchanged V088 HTTP/process test | 0 | 3/3. |
| Cumulative candidate focused tests | 0 | 20/20, zero skipped; V014 green, V088 still green, training10 and permit6 green. |
| Initial cumulative affected run | 1 | 623/636; thirteen executor-preparation failures: one missing passkey dependency, twelve archive extraction attempts to an unavailable gid1001. Original TAP retained. |
| Unchanged archive evidence suites after local extraction preparation | 0 | 88/88; `TAR_OPTIONS=--no-same-owner`, preserving exact archive bytes. This is not installed-image admission. |
| Unchanged composed scheduling suite after dependency preparation | 0 | 51/51. |
| Full identical affected file selection after local preparation | 0 | **646/646**, zero failed/skipped. Successful composed scheduling reaches ten additional nested checks compared with the failed run. |
| Focused tests using copied flat runtime directories | 0 | 20/20. Exercises `integration-runtime`/`implementation-runtime` require layout with exact source bytes; no Docker image build. |
| Clean-base patch application and exact output comparison | 0 | All ten source/test files reproduce candidate bytes exactly; source/test diff check clean. |

Local dependency preparation: offline `npm ci` failed `ENOTCACHED` for tsyringe. An existing local installation was reused only after package-lock exact-byte equality and all26 package versions plus cached-lock resolved/integrity entries matched. See `dependency-provenance.json`; no fresh registry/tarball integrity proof is claimed. The original package-lock and every candidate source/test byte remained unchanged. The full command is retained in `affected-command.txt`; lossless deterministic `.tap.gz` logs and original/packed hashes are listed in `result.json`.

## Owner application and remaining gates

On a clean checkout of the exact reviewed PR501 head, inspect all ten files, then run `git apply --check cumulative-source-tests.patch` and apply it once through the sole integrator. The patch SHA-256 is `221ebc1d4b5a0b3d17dc182162749318ffce41ff560a0f8ab9109194dc3e6f4f`; all exact preimages/postimages are in `source-test-hashes.json`. Stop and reconcile on any newer head or conflicting claim. Do not cherry-pick only the #521/#526 repair commits and do not adopt the #531 red test without its source patch.

Retain/recheck the independent root review on the exact published bytes; rerun affected tests in the supported environment, exact-image/archive/security/recovery admission, and authorized hosted intended-role durable readback. The additive training/permit helpers still have no authenticated runtime consumer in this package and keep all source/operational/safety authority flags false. V014 covers the integration-hub effect seam, not every product operation. Gusto I/O is synthetic, loopback only, seeded-session readback is not fresh login, and no real provider/customer proof follows. No merge, provider activation, customer promotion or readiness claim is made.
