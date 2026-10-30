# V023/V048: Staffology lifecycle adoption with conservative dated-change hold

This draft stacks the complete PR512 four-file lifecycle donor and the reviewed missing-status corrections onto exact PR545 `2d0f4e41e3b0463386b2887f39afa064068f9166` (tree `b6e21c4afa9880c651fe0898235cd4695ce4bfca`). A separate follow-on to initial draft commit `1ba304718ca2f1eca1cb63d16fdc2a8d617fdb4f` fixes the independently observed loss of end-date evidence during staging. PR512/domain and sole PR501 integration/release owners retain acceptance. Their refs, PR535 and PR545 are unchanged.

## Final behavior

The mapper preserves explicit provider `hasLeft`, status and effective end date in revision-bound acquired data. The bridge rejects contradictory or insufficient lifecycle evidence. Confirmed Former records retain the existing delete/application hold; no deletion is inferred from an end date or wall clock.

The follow-on changes only the bridge and its existing tests: after computing the provider-backed Former classification, `if(effectiveTo&&!former)` refuses with `STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED` before constructing the staged record or calling staging. Missing/null/Current/Upcoming status with `hasLeft:false` and either past or future end dates cannot silently become an undated upsert. Inputs remain unchanged. No-end-date records retain existing handling, and confirmed Former records still require the separately reviewed employee-change workflow.

The mapper's original PR512 contract remains intact: Current + explicit false + future leave date still maps with source end date/revision retained. That source-acquisition contract does not authorize an onboarding transition. The previous bridge test expecting an upsert that omitted the date is intentionally changed to refusal, with its no-end positive and confirmed-Former hold controls retained. Existing `REVIEW_5925613376_RESOLUTION.md:51-56` documents that end-dated employees require the employee-change workflow; `OWNERSHIP_AND_APPROVAL_REGISTER.md:88` also separates later lifecycle actions. No accepted scheduled-end onboarding path was found. See `evidence/followon-contract-trace.json`.

This is a conservative stop, not implemented scheduled-leaver handling or accepted live provider/customer policy. The owner must still specify and approve the actual effective-dated transition. Owner semantics acceptance and business/customer completion remain false.

## Exact scope and source custody

Relative to PR545, only `integrations/staffology/{canonical-runtime-bridge.cjs,canonical-runtime-bridge.test.cjs,staffology-adapter.cjs,staffology-adapter.test.cjs}` change: 115 insertions, 4 deletions. The initial complete donor was retained with two missing-status guard expansions and two regressions. The follow-on adds one bridge guard, updates one bridge expectation and adds one grouped regression. Adapter and adapter-test bytes are unchanged from initial draft `1ba3047`.

The verified materialization had the exact remote PR545 tree. Initial publication read back all 15 changed/evidence files and all 1,725 blobs/modes; no unexpected changes. The source-identities receipts distinguish initial and follow-on bytes. Protected principal, approval/one-shot authority, payroll dispatch/UNKNOWN/recovery/readback, provider transport, other product paths, Docker/CI selectors, source seals and freeze marker are unchanged. This code grants no authority or readiness.

## Fresh verification

Node22.23.2; all green runs have zero skips:

| Check | Result | Scope |
| --- | --- | --- |
| Initial PR545 source + initial final tests | 56/60, 4 intended failures | Original loss and missing-status gaps |
| Original PR512 source + initial final tests | 58/60, 2 intended failures | Missing-status donor gap |
| Initial corrected draft | 60/60 | Independently rerun by coordinator `/root` |
| Initial composed affected suite | 335/335 | Author local runtime; historical pre-hold behavior |
| Follow-on tests before new bridge guard | 59/61, 2 intended failures | Dated upsert/date-loss boundary reproduced |
| Follow-on corrected focused suite | 61/61 | Mapper contract preserved; bridge holds |
| Follow-on full composed affected suite | 336/336 across 28 files | Author local runtime, no actual provider calls |
| Revised independent heldout on old draft | 7/8, 1 intended failure | Explicit-false dated source reached staging |
| Revised independent heldout on final source and composed copy | 8/8 each | Independent `/root/image_ci_gate`, zero skips |

The reviewer independently checks missing/null/Current/Upcoming + false with past/future dates, no stage callback or input mutation, source date/revision retention, no-end positives, confirmed-Former hold, missing review approval and zero injected provider-client calls for an unauthorized POST. It found no new material issue in the bounded follow-on. Earlier eight-case permissive-upsert observations are preserved as **historical** pre-hold receipts and intentionally superseded, not current acceptance. All four syntax checks and final four-path diff check pass. Counts overlap; technical review is not formal release approval.

Reproduce the final independent heldout from a checkout:

```sh
V023_REVIEW_ROOT="$PWD" node --test docs/execution/vector-v023-lifecycle-adoption-20261030/evidence/independent-followon-heldout.cjs
```

The unchanged composer generated a separate `runtime-followon`; its corrected module bytes match source. Cached passkey dependencies matched declared lock SHA256 `8a21dada89673eb721a2200c4e64444b4d583a7df5df5d0add52d3ca2546229d`; no install or lockfile change. Local `TAR_OPTIONS=--no-same-owner` is not release configuration. Full tests use explicit source/runtime/private-evidence paths, `STAFFOLOGY_RUNTIME_MODE=full` and an all-`a` synthetic fixture source binding. Composition provenance says `sourceCommit:null`. The HTTP fixture performs a simulated provider POST through its preload and local persistence/readback; it never contacts Staffology. Private fixture directory contents are not published.

## Remaining gates

No real provider request, protected grant creation, hosted business action, personnel mutation, deployment, admitted image, canonical adoption or customer acceptance occurred. V023/V048 remain integration/review pending, with actual effective-dated employee-change handling still open. V053/V055 remain blocked. Old source/CI/image statuses do not transfer.

PR512/domain owner reviews the complete donor and conservative hold; the sole integrator reconciles the resulting exact candidate with PR545 and other accepted work, independently reviews it and runs full image/archive/security/recovery admission. Approved future lifecycle transitions and separately authorized provider/customer durable fresh-login/readback/audit proof remain owner-controlled gates. Current source, draft and test evidence do not authorize those actions.
