# Independent review: Nango donor reconciliation

Date: 2026-11-01 UTC  
Reviewer: `/root/nango_release_reconcile`  
Repository: `paulallen123/-manufacturing-wfm`

## Decision

**ACCEPT the bounded three-file source reconciliation for publication to the existing draft PR #569, subject to the parent and protected-file invariants below.** No blocking finding was identified within this scope. This accepts source preparation, not canonical admission, a freeze, release, deployment, or live provider connectivity.

The reviewed source is in `/workspace/scratch/9c262827f7fd/vector-nango-reconcile-20261101`. The writer had finished editing before this final review. This reviewer made no source changes or remote mutations.

## Exact inputs and preservation

- Original donor base: `b26bb6f0fc30e33b6f4c31e05608368a45fd00a4`.
- Existing PR #569 donor head: `e2cf7f7295e783abaf6d6464e70331dc71368c98`.
- Bounded canonical PR #501 checkpoint: `ca6e36b4efd1099b56250fb790943db4b533fee5`.
- Canonical tree: `a41002fd2ee0846f5229b9c26118d3cbd3d2f626`.

The primary GitHub comparison from the original base to this canonical checkpoint contains 24 commits and 80 changed paths. The intersection with the donor delta is exactly the three files below; the 26 donor-added paths are disjoint. This review does not claim that the canonical owner branch remains at this checkpoint indefinitely.

Before inspecting the writer's result, the reviewer independently reconstructed the source union from primary-API file contents and the original additive donor hunks. Applying those hunks to the original base reproduced the donor bytes exactly. Each of the six original context blocks occurred exactly once in the canonical checkpoint. Applying those additions to canonical bytes produced the expected union; reversing the additions restored the complete canonical file bytes. The actual candidate and baseline copies then matched these independent expectations, including line endings.

| Path | Canonical Git blob | Accepted candidate Git blob | Additions / deletions |
| --- | --- | --- | --- |
| `Dockerfile` | `b8370243a1dedd0b22dfa8943734ea8515337791` | `42da319ca83461546cee6fef1149fcf30a801ef1` | 9 / 0 |
| `scripts/compose-vector-local-runtime.mjs` | `84ee795c35434faea2a22c8aaa539b7a5842247f` | `cf9d2e05ad8eeb76d74cc3ddddfe3ad70cabd519` | 13 / 0 |
| `scripts/run-forge-ci.mjs` | `2b8ada2ef7c454e900f2401f23ac6d70937e61ee` | `2994e733d73d770130c6c6b16dd0d832548485d1` | 3 / 0 |

Candidate SHA-256 digests:

- `Dockerfile`: `337e129e2b1b2e84e3d61e81c9e02de916401cd5c74c2aa9e984dfc62ce64ab7`.
- `scripts/compose-vector-local-runtime.mjs`: `756626eee69a6924991ddf269a041104151ffdd78809e94f32c2fff729710d28`.
- `scripts/run-forge-ci.mjs`: `91e2d8f54778a9abdb36d932d324cf8036dcb03baf8367d11916ae409276045d`.

## Wiring and dispatcher review

The Docker additions retain the canonical build steps and introduce the existing Nango source tests, copy the resolver into the composition workspace, and run the resolver/broker suites against installed runtime paths. No existing Docker instruction was removed or rewritten.

The composer adds the existing Nango resolver through the metadata broker's credential-provider callback. It preserves the broker's profiles, permit verifier, permit provider, and provider transport. Unique-anchor checks reject source drift, duplicate anchors, and repeat application. The common `composeStaffology` path invokes the hook before writing the server; both existing assembly entry paths still reach that common path. Canonical calendar, dated-leave, kiosk, and other composition changes remain byte-for-byte intact.

The Forge change prepends precisely the three existing Nango suites. It preserves all 16 current canonical commands, their order, complete argument lists, inherited environment, current Node executable, and fail-fast behavior. The success marker remains after the entire loop.

## Independent execution

The following checks were executed by this reviewer against the actual combined candidate under Node.js `v24.22.1`:

| Check | Result | Boundary |
| --- | --- | --- |
| Exact source reconstruction and candidate comparison | All 3 files match; all canonical baseline bytes preserved | Primary-source reconstruction and local byte/hash comparison |
| Current Forge dispatcher | 19 commands, 16 canonical commands preserved, 3 Nango suites selected | Actual dispatcher evaluated with only the child-process boundary stubbed |
| Forge failure propagation | 57/57 injected cases passed | Nonzero status, null status/signal, and spawn error at every one of 19 command positions; immediate stop and no success marker |
| Actual composer wiring suite | 3 passed, 0 failed, 0 skipped; exit 0 | `VECTOR_TEST_ARCHIVE=/tmp/vector-nango-audit-archive.tar.gz node scripts/nango-metadata-wiring.test.cjs` |

The wiring execution verifies the actual composer hook, emitted constructor/callback, exact installed resolver bytes, disabled/enabled modes, drift and duplicate rejection, both assembly entry paths, and Docker selectors. The archive override selects the existing local fixture; the helper verifies its expected digest. No live service or credentials were used.

The writer separately recorded resolver 64/64, broker 7/7, wiring 3/3, installed-runtime replay 71/71, selector checks, and syntax checks, all exit 0. Those are writer evidence, not additional executions claimed by this reviewer. The 71 installed cases replay the resolver and broker cases; they are not 71 new distinct source cases. See the candidate's `evidence/reconciliation-manifest.json` and `evidence/reconciliation-source-receipt.json` for those receipts.

## Required publication and freeze invariants

The new proposal commit must use these ordered parents:

1. First parent: canonical `ca6e36b4efd1099b56250fb790943db4b533fee5`.
2. Additional parent: existing donor `e2cf7f7295e783abaf6d6464e70331dc71368c98`.

Its tree must start from the canonical checkpoint, carry the existing Nango additions, use the three accepted source blobs above, and retain these protected canonical blobs unchanged:

| Path | Required Git blob |
| --- | --- |
| `.circleci/config.yml` | `65f5647b94271f9bed8649aff9791b8d7e2273fa` |
| `artifact/vector-proof-freeze.trigger` | `31981cef7e79ebf505b477316393995a4d442490` |
| `scripts/require-frozen-candidate.sh` | `b14ccaa1f3826a579b175e20010cd5dccb95437c` |
| `scripts/require-frozen-candidate.test.mjs` | `671792fa420d4dbe3ea03d47aefb92b75d0d77d1` |

The existing gate explicitly compares the committed trigger against `HEAD^1`. With canonical as first parent and the trigger unchanged, this proposal does not acquire freeze authority: the gate must refuse admission with `unchanged_trigger`, assuming its preceding SHA and cleanliness checks pass. An ordinary donor-first-parent merge would import a changed canonical marker relative to that parent and could falsely satisfy this gate; it is therefore outside this acceptance.

Update only the existing donor branch, expecting its old head to remain `e2cf7f7295e783abaf6d6464e70331dc71368c98`, with `force=false`. The old donor remains an ancestor through the additional parent. The actual new commit and branch read-back did not yet exist during this review; the coordinator must verify the ordered parents and protected blobs after creation. If the donor head changes, this acceptance does not authorize overwriting it.

## Limits and outstanding admission

No full composer run, Docker image build, pinned Node 22 run, full Forge child suite, live provider call, deployment, or canonical merge was performed for this review. The local workspace is a source overlay, not a complete repository checkout. The first-parent conclusion is derived from the inspected gate source and the required publication graph, not a claim that a new GitHub job has already run.

At the inspected canonical checkpoint, runtime check 1536 had failed and job/artifact evidence remained unavailable; that owner release hold is separate from this bounded donor reconciliation. The source proposal remains subject to canonical-owner admission. Nango account setup and backend key presence do not establish live NetSuite, SAP, or payroll connections, and no such connectivity is claimed by this review.
