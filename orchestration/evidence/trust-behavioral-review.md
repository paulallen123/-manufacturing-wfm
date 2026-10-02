# Qualified behavioral follow-up on published 93513c2

Exact source: `93513c250e3f0105a1fd019bf63a5a1674970b98`, tree `bc10211d06d1016b39a7b01f58a21596646c9acb`. The extraction receipt is verified=true. All four imported product modules were rehashed as Git blobs and matched their exact published connector blob identities after execution.

Official local Node **v22.23.2** executed the held-out suite: **10 tests, 4 controls passed, 6 failed, 0 skipped**, exit 1; TAP duration 1271.8218 ms, process duration 2326.4012 ms. These are expected red assertions against product safety invariants, not harness/dependency failures. Five distinct findings were reproduced:

| Finding | Actual observation |
| --- | --- |
| TR-02, 401 and 403 separately | One mocked POST rejected; transportAccepted=false; AUTH_REJECTED persisted; delivery still acknowledged with receipt and reconciled status. |
| TR-06, principal replacement | Replacement person at same email passes check and consumes the original person's approval. |
| TR-07, revoked acquisition authority | Permissions removed during the third mocked provider GET; old actor snapshot still stages one record into the held-out SQLite persistence sink. |
| TR-01, undispatched recovery | Original baseline remains intact; recovery returns retryable/EVIDENCE_CONFLICT, with zero POSTs and no reserved dispatch. |
| TR-03, image/profile mismatch | Env/profile SHA differs from independent mounted seal; operation configures anyway and never reads the seal. A separate seal-only control read the mounted seal once and configured correctly. |

The three relevant repository suites (`canonical-operations`, `canonical-production-boundaries`, `canonical-operations-deployment-binding`) also executed: **26 passed, 0 failed, 0 skipped**, exit 0; TAP duration 9048.1241 ms, process duration 10151.6263 ms. Their existing green coverage does not detect these held-out failures.

All tests reside outside the snapshot under `work/trust_review`; product source is unchanged. No external provider requests, hosted actions, GitHub mutations, product repairs, or unpublished-native tests occurred. Repository tests used a preload denying real fetch, HTTP, HTTPS and socket calls. Held-outs exclusively inject bounded synthetic provider responses and deny global fetch.

Limits: this is local Windows Node 22.23.2 execution, not the prescribed Ubuntu 24.04 supported Docker image or full security/bootstrap/HTTP/customer journey. The image-binding case uses a separate-child filesystem shim only for `/app/.wfm-build-source-sha`, with a seal-only positive control; it does not claim an actual image mount. The staging case invokes the genuine Operations/Bridge/Boundaries with the composed staging callback pattern and a held-out SQLite sink; it does not claim the sealed integration store was exercised. Other findings remain static-review-only. No repaired-source pass is claimed.

Raw TAP, per-case observations, run metadata, source/blob verification and artifact SHA-256 hashes are retained in this directory. `behavioral-verification.json` is the machine-readable evidence index. This follow-up supersedes the initial review's statement that Node was unavailable; that statement described the earlier static-review phase.
