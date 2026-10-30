# V054 consumed exact approval retry — independent peer review

Verdict: **PASS for the isolated boundary repair. No blocking findings.** This review changed no candidate files and made no real provider calls. It does not establish hosted behavior, deployment identity, remote branch ancestry, or a full application build.

## Target and baseline

- Reviewed candidate: `/workspace/scratch/2ea1ba0f2164/v054-retry-xhigh/candidate/integrations/staffology/canonical-production-boundaries.cjs`, SHA-256 `6268ae1a5185f7e43b9e2bf84841b2a64c3d0f8303a6859a15963f6b410b6b64`.
- Baseline file: sibling `baseline/integrations/staffology/canonical-production-boundaries.cjs`, SHA-256 `b9a5943345ba084fe56fe51e7980601b3e45f985949b67e407842aa01359c5d9`.
- The local candidate repository baseline is `5a24a084a8c49889d15da361b35a4b6d2321b1e8`, described as an exact local union source baseline with no claimed remote ancestry. Remote source identity is outside this peer review.
- Baseline and candidate adapter files both hash to `53f724ae3e7fa9f6924677136a631ff83208e064335bbadab2f2b852c5362c09`.
- The production diff adds the terminal consumed guard before the prior reuse/revoke/delete/insert branches, inside the existing `BEGIN IMMEDIATE` transaction. The new author test file was read, but peer heldouts were authored separately.

## Findings and compatibility

The baseline has a confirmed approval lifecycle defect: issuing the same exact consumed permit deletes its consumed approval row and creates a fresh unconsumed row. A direct probe observed the original approval disappear, the consumed-row count fall to zero, and `authority.check` return true again. The durable dispatch marker still points to the deleted original approval ID. This establishes authority rearming and evidence loss, not a duplicate provider effect. In both baseline and candidate, the independent dispatch marker rejected a second simulated dispatch with `STAFFOLOGY_OWNERSHIP_LOST` and the dispatch count remained one.

The candidate rejects the exact consumed permit with `STAFFOLOGY_APPROVAL_CONSUMED` and HTTP status 409 before any mutation. It retains the complete original row and keeps `check` false. `consumed_at !== null` correctly treats timestamp zero as consumed, including after independent process reopen. The surrounding catch rolls back the transaction. Existing unconsumed reuse, expiry renewal, revocation renewal, canonical-person replacement, and replacement-failure rollback remain available.

The only production call to `authority.issue` in this isolated source is the authorization callback created by `approvedCoordinator`. Adapter reconciliation starts dispatch only if the persisted delivery has no dispatch marker. Existing dispatch-marked recovery skips that callback, preserving the original approval identity and read-only reconciliation. No schema, adapter, public method signature, or source wiring changes are introduced by the repair.

## Independent requirement-to-evidence matrix

| Requirement or risk | Independent evidence | Result |
| --- | --- | --- |
| Consumed exact permit cannot be reissued or erase original row | Disk SQLite; two child-process restarts; consumed timestamp zero; full serialized row comparison | Candidate pass; baseline fail |
| Expiry cannot reset consumption | Reopen after expiry; exact retry; full row preservation | Candidate pass; baseline fail |
| A revoked consumed historical row remains terminal | Consumed row with revoked timestamp; exact retry after expiry | Candidate pass; baseline fail |
| A successor principal cannot replace consumed approval | New currently authorized person with same tenant/account; row comparison | Candidate pass; baseline fail |
| Valid pre-dispatch retry continues | Active exact reuse across child process; expired and revoked renewal; canonical-person replacement | Both pass |
| Failed replacement leaves existing evidence intact | SQLite insert-abort trigger; transaction rollback; subsequent valid reuse | Both pass |
| No-resend marker survives recovery/reopen | Stored marker retained; begin loses claim; recovered token cannot reserve second dispatch | Both pass |
| Tenant, actor, and digest boundaries remain enforced | Wrong tenant/missing permission issue; live principal mismatch/revocation consume; wrong digest consume and dispatch | Both pass |
| Existing callers remain compatible | Existing production boundary, review regressions, SQLite contract, and adapter suites | Candidate 85/85 pass |

## Executed checks

Peer heldout source: `/workspace/scratch/2ea1ba0f2164/v054-retry-peer/heldout.test.cjs`, SHA-256 `26d630373e8790d5f4b4ddceb5c02ba2357c2bca5116b554405622e048b32a1c`.

Node executable for all TAP checks: `/workspace/scratch/722aeb5410a4/node-v22.23.2-linux-x64/bin/node` (v22.23.2).

1. `BOUNDARY_SOURCE=<baseline-boundary> <node22> --test /workspace/scratch/2ea1ba0f2164/v054-retry-peer/heldout.test.cjs`: exit 1, 9 passed / 4 failed. The failures are exactly the four consumed-reissue invariants above; there are no test setup failures.
2. `BOUNDARY_SOURCE=<candidate-boundary> <node22> --test /workspace/scratch/2ea1ba0f2164/v054-retry-peer/heldout.test.cjs`: exit 0, 13 passed / 0 failed.
3. From the candidate root, `<node22> --test integrations/staffology/canonical-production-boundaries.test.cjs integrations/staffology/review-5921699729-regressions.test.cjs integrations/staffology/sqlite-contract.test.cjs integrations/staffology/staffology-adapter.test.cjs`: exit 0, 85 passed / 0 failed.
4. `git diff --check`: exit 0.
5. Supplemental state probe used the default Node v24.22.1 runtime and synthetic in-memory SQLite to directly compare row retention, authority validity, marker identity, and dispatch refusal.

Raw evidence:

- `evidence/baseline-node22.tap`, SHA-256 `dbbd79c768a4ed1d991c9c202d8d200175b515accb84341c7b7893ed7df60d10`.
- `evidence/candidate-node22.tap`, SHA-256 `f1fa437f966bbaa507bb657d827af0d1e83491d03f121c29ed214611117b9d31`.
- `evidence/compatibility-node22.tap`, SHA-256 `64d809e8b3baf1cef464a9157429a9a33ac7ed45f9c8afe9585b1850e365b5c8`.
- `evidence/state-probe.json`, direct before/after observations, including the independent no-resend result.

The focused checks establish the requested consumed approval lifecycle and preservation behavior with actual SQLite storage and process restarts. They do not establish simultaneous-process race behavior, live Staffology outcomes, or lifecycle repair for approval rows already erased before this change.
