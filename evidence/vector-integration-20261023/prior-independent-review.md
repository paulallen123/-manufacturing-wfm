# Independent donor-union review

Reviewer: `/root/review_combined`, 2026-10-23. Read-only product/source review; no remote mutation, branch movement, ownership transfer, deployment, provider call or customer data.

## Exact source

PR501 parent `4b79aeec360d64a54b732ac38dc38763163b7e0a`, inference donor `42d757a5a2bab7af2684fbdd55b5f02c48c645cb` plus Autopilot donor `2bd1a0addc88ed61e6fcd06c4b3c1369425c11bc`. The local union preserves both two-file deltas. After the parent corrected materialization newline drift, inspected local Git blob hashes match parent-retrieved identities:

- Inference source `baa120a0c16872c9b08c3b621a63e5efcd56c4c9`.
- Inference test `f4fdb8c188f052c84a1a1904c9d3c14e17092cf3`.
- Autopilot source `8f011b0fe0d1780c76b2b3c25d7f89c15f74c1e9`.
- Autopilot test `0801ea360bf86f53115c290980492f6fdec26ec6`.
- Unchanged Decision Episode dependency `a8a118ed8fc90a80272077213e1e6ad3956ac4c4`.

## Executed checks

1. Node v24.19.0: `node --test implementation/runtime/configuration-inference-engine.test.cjs operations/runtime/autopilot-execution-engine.test.cjs operations/runtime/decision-episode.test.cjs`: 114/114, no failures/skips. Log at `../reviewer-committed.tap`. This run preceded the parent's exact-byte materialization correction and is diagnostic-only, not exact-blob acceptance. It overlaps the parent's focused execution and must not be added as distinct acceptance coverage.
2. Confirmed existing `/tmp/node-v22.23.2-linux-x64/bin/node --version` returns v22.23.2.
3. Node v22.23.2: `/tmp/node-v22.23.2-linux-x64/bin/node --test heldout.test.cjs`: 10/10, no failures/skips. An initial run is retained in `heldout-node22-initial.tap`; after the parent confirmed reconstruction from original bytes, a fresh exact-source run also passed 10/10, zero fail/skip, in `heldout-node22-exact.tap`. Harness SHA-256 `6a565c38708d688932b1a5b9286fcb5131baea4630d26c9f24fbb1d1870946a9`.

Held-outs exercise revoked row/collection proxies, null-prototype proposal and caller-mutation detachment, array index accessor refusal, no partial assignment from seven malformed workforce fields, ignored diagnostic accessors with missing-identity review, a fresh-process retry of durable PREPARED state, APPLIED retry racing a later VERIFIED receipt, append rollback/lock release and retry, cross-tenant retry denial, and engine-restart idempotency. Synthetic adapter writes were forbidden and never dispatched.

The first held-out run was 5/10 because my fixture named its mandatory no-action option `keep`; Decision Episode correctly rejects it with `Decision episode requires a do-nothing option.` Corrected only fixture ID to `do-nothing`; retained original failure at `heldout-node22-fixture-failure.tap`. This was a test-fixture error, not a product defect or relaxed threshold.

## Verdict and limits

No new blocking finding in the bounded donor union. The workforce snapshot prevents active people fields/proxies/array traversal from producing inferred population or partial assignments. The retry reconciliation append remains inside the same write transaction as history inspection, before publication; an independently committed terminal event stays last. Both changes retain unknown external outcome and do not create compensation authority.

Accept for bounded source-level reconciliation by the existing sole integrator. This is not formal GitHub approval, exact combined commit/image/security acceptance, hosted/customer proof, or authority to move canonical/release references. Parent is separately evaluating legitimate inference fingerprint updates; this review does not cover uninspected changes to Dockerfile/proof machinery. Remaining pre-existing boundaries include historical VERIFIED receipt revalidation, expired-permit reconciliation, provider async contracts, independently authorised compensation, source authenticity, and direct role/timecard/punch inference hardening. A returned retry notification can be older than a subsequently committed event and remains a refetch hint, not action authority.

## Follow-up: two exact source-binding substitutions

Independently compared `binding-inputs.json` original content with the two local replay files. Original input blobs verified before comparison. Each file differs only by exactly one literal `b47687d87b56a41240e731cf4e2046edf5acfa68` → `baa120a0c16872c9b08c3b621a63e5efcd56c4c9` substitution, with unchanged byte length, line endings and every other byte. The Git-blob computation, mismatch exception, require-after-verification ordering and all fourteen assertions are unchanged.

- Dockerfile: base blob `afb49eacbbcb8c1f0f9eba5daf276194badb400a` → replay blob `a2daf4e6a681a87f18d2165b9653a55cff11fcdb`.
- Proof runner: base blob `f4c6b2e54d1aa2da3ad5a57914cb3223ccb2115a` → replay blob `74c4cfa22ba7275fadcc2d2aac18f2d1a5fbc453`.
- Engine bytes independently rehashed to the required donor blob `baa120a0c16872c9b08c3b621a63e5efcd56c4c9`.

Actual independent Node v22.23.2 execution, all with `WFM_PROOF_ONESHOT=true` and exact local engine path:

1. Default expected pin, no `WFM_CONFIG_ENGINE_GIT_BLOB_SHA` override: exit 0, PASS 14/14, exact identity true; 10,000 employees / 50 sites / 100,000 punches / 40,000 timecards.
2. Explicit correct pin override: exit 0, same 14/14 and exact identity. This repeats the same assertion set and is not additive coverage.
3. Explicit stale pin: exit 1 with `Configuration engine identity mismatch`, containing both actual donor and stale expected hashes; no proof receipt emitted.

Receipt: `binding-review.json`; exact stdout/stderr retained as `binding-default-positive.*`, `binding-explicit-positive.*`, and `binding-stale-negative.*`.

Verdict: accept these two legitimate binding substitutions together with the reviewed four donor files as an owner-ready six-file local replay. No source identity check or assertion was removed/weakened. This extends bounded source review only: no remote commit/ref, full Docker build, immutable image, security gate, hosted/provider/customer proof or release authority is established.
