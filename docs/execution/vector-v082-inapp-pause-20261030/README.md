# V082 in-app pause publication guard

A confirmed schedule pause could complete while a scheduler awaited current identity. The in-app path then inserted a READY reference without observing that pause. A final SELECT alone also races with a pause committed by another process before the receipt INSERT.

This donor is direct on canonical #501 `61718e1862fa650136e1952f622c9d8dd4c22af8`. Only the reporting service and its existing admitted test file change outside this evidence directory. The same original runtime blobs exist in frozen #552 `7ced0fe91742928235fe3be042766eec2911ed90`; no canonical/frozen branch is changed by this donor. `inventory.json` binds the seven original reporting files, original and candidate source/test blobs, and both parent trees. Both exact root AGENTS.md requests returned404; no instructions were inferred from missing files.

## Changed behavior

Only an in-app candidate whose proposed status is READY takes a short `BEGIN IMMEDIATE` SQLite transaction. Inside that write boundary it reads current schedule state and atomically inserts either BLOCKED_SCHEDULE_PAUSED or READY, then commits. An error rolls back. No await, identity reader, adapter authorization, dispatch or readback runs in the transaction. A competing pause either commits first and blocks READY, or receives the existing locked/busy refusal while READY commits first; retrying after commit can pause future slots. A blocked receipt continues to consume only its exact schedule/slot key. Explicit resume can produce the next slot, and an unrelated schedule remains eligible. Existing receipt immutability, deduplication and final inFlight cleanup remain in force.

The external delivery path and bootstrap adapter configuration are unchanged. Exact frozen bootstrap blob `e823e61bf0c07f6b10e6effdd353746c068695c8` constructs this service with only dbPath. It does not configure a delivery adapter. Synthetic adapter calls in existing tests do not contact a provider.

## Fresh local evidence

Node v22.23.2 was used throughout. Counts overlap and must not be added.

| Check | Result | Scope |
| --- | --- | --- |
| Final admitted test file with unchanged canonical service | 42/44, exit1 | Two intended pause failures; rollback control and original41 pass |
| Final canonical reporting UI/runtime suites | 104/104, exit0 | Three regressions appended to existing selected service test; no new CI selector |
| Copied runtime layout with only service + admitted service test | 44/44, exit0 | Same two installed-file paths used by current Docker copy/test commands |
| Frozen #552 reporting compatibility | 123/123, exit0 | Same final source/test with the four existing V080 test entries; no adoption |
| Independent process/rollback boundary fixtures | 2/2, exit0 | Actual clean child process pause cannot acknowledge during the write lock; later retry succeeds; inserted-receipt failure releases lock and inFlight |
| Independent non-atomic control | 0/1, exit1 | Separate process acknowledged pause200 after final SELECT; old control still persisted READY |
| Independent pause comparison | baseline0/1; candidate1/1 | Exact original source and atomic source, real SQLite/reopen evidence |
| Independent wider authority/containment fixtures | 9/11, exit1 | Two stale async-reader authority counterexamples remain deliberately RED |

Primary `/root/v082_reporting_delivery`; independent challenger `/root/v082_peer`; coordinator `/root` reviewed the narrow transaction design. Actual runtime model identity is unexposed. The independent review accepts only the atomic pause boundary. It is not formal GitHub approval or integration/release authorization.

The original first three-case baseline RED and an intermediate harness failure are retained separately. The intermediate harness incorrectly expected an employee delivery-list200 with an empty result; the actual route correctly refused403. The first six-line source attempt re-read asynchronous identity and pause state without a transaction; independent review rejected its stale-reader and check/write assumptions. It is retained solely as the non-atomic historical control, not shipped as runtime source.

A final validation attempt found four #552 V080 test files restored into the local canonical fixture, while its UI main correctly remained the older #501 blob. That mixed fixture ran123 with104 passing and19 V080 failures. This is retained as a fixture composition failure. A fresh directory was then reconstructed using only the seven remote-verified canonical paths plus the two reviewed overrides; its explicit complete canonical suite passed104/104, and the copied runtime layout passed44/44. No V080 code or tests are included in this donor.

Commands from the local review root:

```sh
V082_NODE=/workspace/scratch/722aeb5410a4/node-v22.23.2-linux-x64/bin/node
"$V082_NODE" --test canonical-check-final-61718/reporting/ui/vector-reporting-ui.test.cjs canonical-check-final-61718/reporting/runtime/vector-reporting-service.test.cjs canonical-check-final-61718/reporting/runtime/vector-report-interchange.test.cjs
"$V082_NODE" --test red-replay/vector-reporting-service.test.cjs
"$V082_NODE" --test copied-layout/vector-reporting-service.test.cjs
"$V082_NODE" --check candidate/reporting/runtime/vector-reporting-service.cjs
"$V082_NODE" --check candidate/reporting/runtime/vector-reporting-service.test.cjs
git apply --check ../atomic-pause-candidate.patch # from the unchanged baseline directory
```

`receipts.json` preserves raw TAP and independently authored fixtures losslessly. Each entry has original byte count, SHA-256 and gzipBase64. Decode into a disposable scratch directory, verify length/digest, and use REPORTING_SERVICE to bind the independent harness to the exact candidate source; EXPECT_SERIALIZED=1 selects the transaction expectation. The wider heldout uses HOLD_FINAL_READER=3 on this atomic source. It intentionally exits1 for stale-role and stale-tenant cases.

## Remaining gates

V082 remains BLOCKED under the accepted #527 acknowledgement-contract handoff `6519282188` and latest hourly row `6528501514`. Repeated asynchronous identity reads cannot establish a fresh authoritative role/tenant snapshot. The independent stale-reader tests still persist READY after a role revocation or tenant move while the reader's old snapshot is pending. This donor does not repair or mask those cases.

Recipient acknowledgement versus provider acceptance, exact delivery identity, current actor authority, append-only acknowledgement audit, replay/idempotency and independent provider readback still require the reporting owner's accepted contract. A report view and READY reference are not acknowledgement. Existing UNKNOWN intent quarantine has no automatic reconciliation release. #481 retains its exact-head independent NO-GO; this donor does not approve it.

Sole canonical owner adoption, exact combined review/image/archive/security/recovery admission, authenticated intended-role and fresh-session proof, authorized provider acceptance/readback and customer acceptance remain open. No adapter enablement, provider action, customer communication, live tenant or deployment mutation, merge, DONE or readiness claim is made.
