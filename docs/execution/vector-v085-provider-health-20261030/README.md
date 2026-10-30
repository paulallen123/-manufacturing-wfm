# V085: refuse future-dated provider runtime health evidence

This isolated donor follows existing provider gate owner PR142 at `b9698ec0816ba6286a29af3174987bc77a9602c3` (tree `b11d0c141976ce0800b0ba1532f317f3fdfc48af`). It does not modify the canonical/union source or refs. V085 is still BLOCKED for actual required customer/provider connections; no provider certification or operating authority follows from this work.

## Reproduced defect and repair

`evaluateRuntimeHealth` previously clamped negative sync age to zero and did not reject a future reconciliation time. Exact-review synthetic runtime evidence dated tomorrow could therefore return `HEALTHY`. The existing public `summarizeConnectionHealth` helper could return `canSync:true`, despite those impossible observation times. Its `CLAIM_EXPIRED` and `COMPLETION_UNCERTAIN` maintenance continuations also returned before considering runtime blockers.

The runtime health helper now refuses sync or reconciliation timestamps beyond the existing five-second clock-skew allowance used by this provider-proof lineage, and refuses a non-finite evaluation clock. The summary evaluates runtime health before a maintenance continuation and does not use that continuation when runtime is BLOCKED. This also preserves pre-existing authority/reconciliation refusals during unfinished maintenance. Healthy and within-skew cases keep existing behavior. The change does not alter authentication, approval generation/validation, provider response verification, maintenance scheduling, credentials or transport.

Independent review also reproduced a second user-facing error: stale data, high latency or pending retries could leave the overall maintenance summary DEGRADED while its runtime signal incorrectly said HEALTHY. Six fail-first cases cover each condition under CLAIM_EXPIRED and COMPLETION_UNCERTAIN. The summary now reports runtime DEGRADED and adds a truthful reviewed-target degradation sentence to the existing specific maintenance message, preserving overall DEGRADED and canSync true on valid proof.

Exactly four existing paths change: `integration/runtime/{connection-proof-gate.cjs,connection-proof-gate.test.cjs,connection-health-summary.cjs,connection-health-summary.test.cjs}`; +81/-4. The tests use fictional reviews, local approval-model objects and synthetic metadata only. No protected record/key/reference was resolved, no approval was issued to a real actor and no provider client was called.

## Source and verification

All 29 PR142 source/test/workflow files were retrieved at the exact owner head and matched local Git blobs. No AGENTS.md was present in that source tree. The local materialization contains only that reviewed footprint; it is not a reconstruction or admission of the full application.

Node22.23.2:

| Check | Result |
| --- | --- |
| Original owner's fourteen test files | 104/104, zero skips, exit0 |
| Added temporal/consumer checks against unchanged owner source | 21/24, three intended failures, exit1 |
| Corrected fourteen-file affected suite | 107/107, zero skips, exit0 |
| Six degradation-signal tests before signal repair | 11/17, six intended failures, exit1 |
| Final fourteen-file affected suite | 113/113, zero skips, exit0 |

Tests cover future reconciliation alone, both future timestamps, the 5,000/5,001ms boundary, next-day evidence, invalid clocks, ordinary and unfinished-maintenance summaries, unchanged input and retained current/in-skew positives. Four syntax checks and the exact four-path diff check passed. Raw failures, success, exact command and before/after source hashes are retained under `evidence`.

The primary inherited model is not exposed and is not attributed to Sol. The coordinator explicitly dispatched independent `/root/v085_xhigh_peer` as Sol xhigh; the runtime does not expose its model identifier. Its final independent rereview passed 217/217 future/blocker heldouts, 6/6 separately asserted degradation cases and the full 113/113 owner suite, with zero skips. The same six independent degradation cases fail 0/6 against the SHA-verified prior summary. The coordinator separately inspected the final four-file delta and reported fresh 113/113 owner and 217/217 heldout reruns. Both final scoped verdicts were PASS before publication. Their technical review is not formal owner acceptance, GitHub approval or release approval.

Initial temporal-only review passed 217/217 against baseline 92/217; it discovered the signal defect that the final source now repairs. The final independent report and receipt supersede that historical temporal-only verdict for the published four-file bytes. Primary and independent counts overlap; they are not a count of distinct customer requirements.

To reproduce from a checkout of the published commit using Node22.23.2, run `node --test integration/runtime/*.test.cjs` from the repository root. Run the independent scripts with `V085_TEST_ROOT="$PWD" node --test docs/execution/vector-v085-provider-health-20261030/independent/heldout.test.cjs docs/execution/vector-v085-provider-health-20261030/independent/degradation.test.cjs`. The degradation test invokes its adjacent observation fixture in the same directory. The retained raw TAP logs and receipts use the original local absolute paths; no local path is required by the ordinary source suite or the independent scripts when V085_TEST_ROOT is set to the checkout root.

The programmatic evaluation-clock contract is a numeric Date.now-style value. Independent observation of Symbol/BigInt clock arguments produces TypeError in both baseline and candidate, without a healthy/canSync result. No actual caller supplying those types was identified. This separate out-of-contract limitation remains unchanged; the patch does not claim a structured refusal for every JavaScript value.

## Proof and ownership boundary

PR142 owns these provider activation/health helpers; PR194 owns catalog/spec evidence and PR501 retains sole canonical integration/release ownership. Initial #527/open-PR/ref/source checks showed no newer dedicated V085 writer; external leases/chats/jobs are not visible. No exclusive external lease is claimed.

These PR142 helpers are an unadopted owner lineage. A synthetic `canSync` result is neither evidence of runtime wiring nor a real authorization. No actual provider request, customer consent, credential readiness, tenant/personnel write, deployment, admitted image, protected approval, genuine provider readback or customer acceptance is established. V085 and V090 remain BLOCKED. Targeted provider-specific proof still requires the existing owner's approved exact environment, identity, credentials, scope, controlled operations and independent durable readback.

Next, the PR142 owner reviews/adopts the exact bounded delta and reruns its affected suite. Canonical integration requires separately reviewed consumer wiring and full exact-image/security/recovery gates; source status does not establish those gates. Actual authenticated customer/provider certification and separately authorized write proof remain owner-controlled work.
