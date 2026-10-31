# V082 cumulative current-base composition

This isolated integration proposal carries #563's in-app pause/receipt transaction and #568's final local-authority fence onto exact canonical #501 commit `b26bb6f0fc30e33b6f4c31e05608368a45fd00a4`, tree `a32ad01908703aa92f77a7fd5cf91e09b24396cd`. No new product behavior is introduced beyond those reviewed donors.

The exact current baseline has 1,748 tracked files; every Git blob and mode was checked against the untruncated remote b26 tree. The source-only candidate changes exactly two paths:

| Path | Current b26 blob | Cumulative blob |
|---|---|---|
| `reporting/runtime/vector-reporting-service.cjs` | `616639e58ab51abefa556a47fc26bc2cb43b2822` | `3db96ec47563db6f5e51904523d9e5530d6dd4ca` |
| `reporting/runtime/vector-reporting-service.test.cjs` | `0db8494e3eecad4d78c40864b232769119b9a631` | `371c722133794a70d40bfea3d4d7ee5b4aed82ce` |

All other 1,746 existing files/modes are unchanged, including the current #552/#553 reporting UI/export/lifecycle files, Dockerfile, Forge/CircleCI selectors, runtime manifest and proof-freeze marker. The independently computed source-only tree is `6f4609c7da90b9f1573f77413032021ad29872e8`; this excludes this evidence directory. The published tree adds only this README and `receipts.json` to those two source/test changes.

## Behavior retained from the donors

The final local authority, pause state and in-app receipt INSERT share `BEGIN IMMEDIATE`. A pause or relevant local revocation committed first blocks a new READY reference. Publication committed first permits a later successful pause/revocation to govern future slots. The deny-only local fence validates the current user/role, tenant freeze and every immutable report/source ancestor, with the same owner/tenant, cycle and 200-entry traversal bound as asynchronous access. No async identity callback, await, adapter or provider operation runs under the lock. Failed receipt insertion rolls back the transaction and releases the in-flight claim. External UNKNOWN quarantine remains unchanged.

Donor custody: #563 `3a1087c8d3003a4a837b42d2365787d9d1d221c9`; #568 `693a3b4f2da8423ef263e2382b14d5830567e255`. The cumulative production/test bytes are identical to #568's final accepted pair. Those donor branches remain separately owned and unchanged by this integration proposal.

## Fresh current-base evidence

| Check | Fresh result on Node 22.23.2 |
|---|---|
| Exact unchanged b26 reporting suites | 137/137; zero skips |
| Final cumulative reporting suites | 145/145; zero skips |
| Final admitted service test on unchanged b26 service | 42 pass / 7 intended failures / 0 skips: two pause and five authority regressions |
| Ordinary `scripts/run-forge-ci.mjs` | 840/840, zero skips, exit 0 and `VECTOR_FORGE_CORE_CI=PASS` |
| Rematerialized final tracked source, reporting suites | 145/145; zero skips |
| Independent final materialized-source review | ACCEPT; reporting 145/145 plus eight heldouts 8/8, zero skips |

Ordinary Forge does not select the reporting service test; it was run explicitly in the affected suite. Counts overlap. The Forge command used `TAR_OPTIONS=--no-same-owner` in the local root sandbox, preserving the repository's existing selectors and requirements. No installed image was built. Raw current-base controls, logs, source custody and independent review are retained losslessly in `receipts.json` as a gzip/base64 JSON payload with uncompressed byte/hash checks, alongside a readable summary and per-file hashes.

The local reuse fixture initially included four V071-owned source/selector edits and generated/dependency files. It was not accepted as b26: only the pinned tracked paths were materialized, and those four files were restored from exact b26 before verification or testing. Ordinary Forge then generated six untracked proof JSON outputs. They are excluded from publication; a separate final source directory was rebuilt from only the 1,748 verified tracked paths after Forge and checked again with no extras. These fixture details do not alter the proposed Git tree.

## Ownership and remaining gates

The root reviewer accepted the cumulative service/test diff before publication. The independent reviewer separately checked the full pinned baseline and cumulative tree, reran current reporting and authored/retained authority/pause boundary tests. The V071 selector owner confirmed disjoint paths. This proposal does not modify any selector or marker and does not adopt the separate CP/V071 changes.

V082 remains DEVELOPMENT, research NO. This is an isolated integration donor for the sole #501 owner to review and compose. No #501 ref movement, merge, deployment, provider action, protected-key access or live tenant mutation is authorized or performed by this proposal. Exact-head CI, installed artifact/image admission, independent browser/recovery proof and the remaining authority, recipient/provider acknowledgement, durable acknowledgement audit/replay, provider acceptance/readback and customer gates remain open. The pre-existing authority audit INSERT remains outside the receipt transaction; no atomic audit claim is made. V083's external uncertainty quarantine and #481's independent NO-GO remain.

The original #563/#568 donor tests, prior model/review statements and earlier CI receipts do not become current-image or customer proof. No DONE or customer-ready claim follows from this cumulative source composition.
