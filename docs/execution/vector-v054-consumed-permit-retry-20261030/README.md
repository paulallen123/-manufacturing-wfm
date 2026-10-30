# V054 — preserve consumed exact Staffology approvals on retry

An exact consumed Staffology permit could be issued again: `createAuthority.issue()` deleted its consumed approval row and inserted a fresh unconsumed approval. That erased the original approval referenced by the durable dispatch marker and made `authority.check()` true again. This donor refuses reissue with `STAFFOLOGY_APPROVAL_CONSUMED` / 409 before any mutation, preserving the complete original approval. Active unconsumed reuse, expired/revoked unconsumed renewal and authorized person replacement remain available.

The independent dispatch marker already prevents a second dispatch in both versions. **No duplicate provider effect is alleged or demonstrated.** This repair concerns one-shot approval state and retained evidence, and cannot recover approval rows already erased before adoption.

## Ownership and exact lineage

The proposed sole parent is current canonical integration owner PR #501 `61718e1862fa650136e1952f622c9d8dd4c22af8`, tree `3b7c62f3903f6b778afaa89fef8ccd568051733d`. Its boundary was freshly fetched and is byte-identical to frozen reviewed union PR #552 `7ced0fe91742928235fe3be042766eec2911ed90`: Git blob `fa24af60d4e1c0eafb29249688f5f1b1c1a9f8b2`, SHA-256 `b9a5943345ba084fe56fe51e7980601b3e45f985949b67e407842aa01359c5d9`. Corrected boundary SHA-256 is `6268ae1a5185f7e43b9e2bf84841b2a64c3d0f8303a6859a15963f6b410b6b64`.

Historical/domain owner PR #292 remains `9e6565decaf439fc44f72719c1b473a206684d2d`; its older boundary blob `eb641eaece4ba0ae737600222463e613cbc78197` lacks this retry-renewal branch. The defect is in the current #501 integration boundary, so this narrow donor is based on #501 rather than replacing #292 with unrelated later source. PR #528 `1f59b3e32cc6c41dd4a19d562cd7c478442fbd96` retains the register; issue #527 and sole #501 integrator retain lane/adoption/release authority. No #501/#552/#292/#528 ref is advanced.

The only production change is a consumed-state guard inside the existing `BEGIN IMMEDIATE`, before reuse/revoke/delete/insert. No schema, adapter, public signature, runtime wiring, provider protocol or shared selector changes. Existing Docker Staffology `*.test.cjs` selection includes the new regression file; no Docker build is claimed. PR #548 lifecycle files are unchanged. This is a separate review donor, not a second connector, runtime or release path.

## Fresh verification

All TAP suites below used Node **22.23.2**, with zero skips. Counts overlap.

| Check | Before | Candidate | Scope |
| --- | --- | --- | --- |
| Four new author regressions, exact #501 imports | 1 pass / 3 expected failures, exit 1 | 4/4, exit 0 | Consumed refusal and complete original row; reopen/expiry/replacement; unconsumed controls; synthetic lost-ack read-only recovery |
| Exact #501 existing production-boundary tests plus new tests | — | 23/23, exit 0 | Owner import compatibility; #501 adapter blob `ec05deedeb5581a4b2f109eb108c796b0e62e59c` and test blob `537fdaeb8787794447855c204808b67ef0ea8064` |
| Separately authored peer heldouts | 9 pass / 4 expected failures, exit 1 | 13/13, exit 0 | Child-process SQLite reopen; consumed timestamp zero; expired/revoked consumed rows; successor actor; renewal; failed-insert rollback; no-resend marker; negative boundaries |
| Peer existing compatibility selection | — | 85/85, exit 0 | Production boundaries, adapter, prior review and SQLite contract |
| Isolated #552-derived source/runtime compatibility | — | 340/340 across 29 files, exit 0 | Full affected Staffology selection with locally composed runtime; synthetic HTTP/process/SQLite fixtures and replaced provider responses |

The coordinator independently read the narrow code/test diff and reran the author 23 and peer 13 checks before publication. The peer changed no candidate files and found no blocking issue. Peer review covers the isolated code/caller behavior; the primary/coordinator separately verified remote source identity. This is bounded technical review, not formal release approval.

The unchanged composer generated a separate runtime. Tested source and runtime boundary bytes equal the corrected hash above. Composition provenance records `sourceCommit:null`, with explicit all-`a` synthetic fixture build binding. Cached lock-matched dependencies were reused; no package installation occurred. `TAR_OPTIONS=--no-same-owner` was local extraction configuration only. Neither composition nor these tests establishes container admission, a deployed build identity, real provider acceptance or customer proof.

Exact commands, source identities, raw compressed TAP and comparison observations are retained in `evidence/`. Two command-setup errors occurred before tests: an execution request named a not-yet-created working directory, and one owner-slice command used a wrong relative log directory. Corrected commands above ran successfully; those setup errors are not product assertions. A tool orchestration JavaScript syntax error occurred before any call and was corrected. Raw red assertion logs are retained separately from green results.

## Reproduce the focused owner check

From the intended checkout with Node 22.23.2:

```sh
node --test integrations/staffology/canonical-production-boundaries.test.cjs integrations/staffology/consumed-permit-retry.test.cjs
BOUNDARY_SOURCE="$PWD/integrations/staffology/canonical-production-boundaries.cjs" node --test docs/execution/vector-v054-consumed-permit-retry-20261030/evidence/peer-heldout.test.cjs
```

The tests create only temporary SQLite state, fictional identities and injected transport responses. No actual Staffology request, live payroll/personnel/tenant mutation, protected grant, deployment, restart, secret/configuration change or provider action was performed.

## V054 remains blocked

The checked-in register's original V054 stage is TEST; the current issue #527 reports BLOCKED / OWNER_PROTOCOL_AND_PROVIDER_AUTHORITY_REQUIRED. Prior owner deltas `6513231465` and `6518385903` retain the generic metadata lost-ACK, expired-lease and status interpretation REDs and the separate queue-order characterization. Those tests were not rerun or silently converted to green here. The generic outbound path still needs owner-defined provider-specific idempotency/status/readback and authorized uncertainty resolution.

Research remains NO / SKIP_REPEAT_RESEARCH. Assigned lane `/root/v054_retry_xhigh` implemented and executed the isolated donor; `/root/v054_retry_peer` authored independent heldouts and reviewed callers; coordinator `/root` independently reviewed and reran the bounded checks. The coordinator requested a Sol xhigh lane; worker runtime model metadata is not independently exposed by the tools. No exclusive external lease is claimed.

Next: the existing #501 integrator reviews/adopts this exact narrow donor once, preserving current integration repairs, then runs exact integrated source/image/security/recovery/freeze gates. Provider authority, genuine acceptance/readback, hosted intended-role/fresh-login evidence and customer readiness remain separate unproven gates. V054 is not DONE.
