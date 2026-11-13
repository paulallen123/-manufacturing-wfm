# Independent current six-file security and composition review

Reviewer: `/root/review_six_file`, independent review subagent; 2026-10-23. The reviewer is not the integration owner, donor author, a separate human approver, or a formal GitHub approval identity. Read-only remote inspection and local hashing/source review only. No product source edits, remote mutations, provider dispatch, build execution, CI retrigger, deployment, or customer data use.

## Verdict

**Accept the exact six-file composition for bounded source adoption by the existing integration owner. No new Critical, Important, or Minor adoption-blocking defect was identified in this composition. Release admission is NOT established.** This is a technical review recommendation, not formal self-approval or authority to bypass branch protection, required reviews, image admission, or customer evidence.

Reviewed source tree `5dc68b8eb2f1645442de45494860aed8b411c0fe` is exactly the requested six-file replay on base tree `4c3c7a025d64e9d0d667ff797a91c7acae868d38`, associated with PR501 base commit `4b79aeec360d64a54b732ac38dc38763163b7e0a`. Both trees were independently fetched through GitHub's read-only Git-tree endpoint with `recursive=1`, neither truncated, each containing 1,445 entries. Exactly six leaf blobs differ; there are no added/deleted paths or type/mode changes. Ancestor tree-object changes are expected. Every other leaf is preserved. A later documentation/evidence commit or branch update is outside this exact-tree verification and must preserve these source identities.

## Exact inputs

| Path | Reviewed blob |
| --- | --- |
| implementation/runtime/configuration-inference-engine.cjs | baa120a0c16872c9b08c3b621a63e5efcd56c4c9 |
| implementation/runtime/configuration-inference-engine.test.cjs | f4fdb8c188f052c84a1a1904c9d3c14e17092cf3 |
| operations/runtime/autopilot-execution-engine.cjs | 8f011b0fe0d1780c76b2b3c25d7f89c15f74c1e9 |
| operations/runtime/autopilot-execution-engine.test.cjs | 0801ea360bf86f53115c290980492f6fdec26ec6 |
| Dockerfile | a2daf4e6a681a87f18d2165b9653a55cff11fcdb |
| implementation/proof/cloud-scale-proof-runner.cjs | 74c4cfa22ba7275fadcc2d2aac18f2d1a5fbc453 |

Donors: inference `42d757a5a2bab7af2684fbdd55b5f02c48c645cb`; Autopilot `2bd1a0addc88ed61e6fcd06c4b3c1369425c11bc`. Fetched both donor source files and commit diffs directly from GitHub. Independently Git-hashed all six locally retained replay files and matched them to the candidate tree and required identities.

Independently verified original binding-input blobs: Dockerfile `afb49eacbbcb8c1f0f9eba5daf276194badb400a`, proof runner `f4c6b2e54d1aa2da3ad5a57914cb3223ccb2115a`. Each candidate is byte-for-byte equal to its original with exactly one literal `b47687d87b56a41240e731cf4e2046edf5acfa68` replaced by `baa120a0c16872c9b08c3b621a63e5efcd56c4c9`. No other bytes changed; Dockerfile retains its 370 CRLF sequences. The mismatch exception, Git-blob computation, require-after-check ordering, assertions, build recipe, and freeze marker remain unchanged.

## Reused execution evidence, not a new test run

Read current GitHub receipt [6367751855](https://github.com/paulallen123/-manufacturing-wfm/pull/501#issuecomment-6367751855), inspected the original independent review, verified all 15 stored original source blobs, and reconciled the donor/dependency identities against the candidate tree. The historical baseline engine is intentionally not a candidate source; the original proof runner differs only by the verified binding substitution. Existing unchanged dependency/test identities match the candidate, including Decision Episode `a8a118ed8fc90a80272077213e1e6ad3956ac4c4` and workforce lifecycle guard `69582fb6e1f945063828b30d9c429579cbc5140a`.

Rehashed retained evidence and inspected TAP totals:

- Node22.23.2 existing affected suite: 131/131 pass, zero fail/skip/cancel/todo. TAP SHA256 `5bd2572ea408460ecf3cb88b24f4ce3f4b74db03c5b35ac598c9f45b5f019a94`.
- Prior independent reviewer `/root/review_combined`: 10/10 held-outs, zero fail/skip/cancel/todo. Harness SHA256 `6a565c38708d688932b1a5b9286fcb5131baea4630d26c9f24fbb1d1870946a9`; exact TAP `5bbb1f97e7b11186014b1467bf1386b581bf85aeb27d2971be870ab08e1909bb`.
- Prior independent review SHA256 `295061c6b867436eab4310ae37b92ed92b1d6926c26eca63a298ae06d184c4a8`.
- Rebound default scale receipt SHA256 `86b0505d1d8c2258b5976dc7227abc454c402aa5d7c4a724476e6d86468a03aa`; prior source receipt reports 14/14 scale assertions, correct-pin positives and stale-pin refusal. These overlapping proof runs are not additive coverage.

No unchanged suites or held-outs were rerun. No new held-out was warranted by a new bounded defect hypothesis. Earlier materialization-newline diagnostics and the corrected do-nothing fixture failure remain historical diagnostics, not hidden or counted as exact acceptance.

## Security and integration strengths

1. Workforce inertness is implemented before semantic inference. `isProxy` rejects live and revoked proxies before prototype/descriptor inspection. Plain/null-prototype own-data rows are copied into null-prototype snapshots; array holes, index accessors, custom array properties/traversal, inherited row evidence, and object/function-valued decision fields invalidate the whole snapshot. Neither accessors nor coercion callbacks become workforce evidence. One invalid decision field discards every row, so valid preceding rows cannot become partial mass assignments. Missing identity/structure still blocks workforce autoApply; intentionally excluded active diagnostic email/firstName fields do not become identity evidence. Frozen and ordinary numeric primitive behavior is retained.
2. One snapshot feeds organisation and workforce within a proposal, avoiding inconsistent repeated reads. Snapshots detach decision fields from caller mutation. The repair does not introduce an arbitrary population cap or alter unrelated shift/payroll inference thresholds.
3. Autopilot now reads execution history and appends retry reconciliation inside the same SQLite `BEGIN IMMEDIATE` transaction. A terminal receipt that already committed is returned without an append; a competing writer cannot commit a terminal receipt between the protected read and retry append. A terminal receipt committed after that transaction remains later in the append-only ledger. No retry dispatches an adapter or compensating mutation. Append/commit errors roll back before publishing and propagate rather than manufacturing successful evidence.
4. Tenant-scoped permit lookup precedes execution-history access; execution identity includes tenant, permit, and context. HTTP authentication, role allowlist, origin/JSON checks, body limit, contextual/expiry validation, unknown-outcome containment, scoped unresolved-execution blocking, immutable plan evidence and event readback binding are not weakened by the delta. SQL values remain parameterized. This is preservation of inspected local controls, not a full application tenant-isolation certification.
5. Fingerprint changes point to the actual reviewed engine rather than suppressing identity checking. All unrelated source and build assertions are preserved by the exact tree comparison.

## Findings and retained limitations

### Critical

No new Critical finding in the bounded six-file delta. This does not assert that the full product has no Critical defects.

### Important

No new Important adoption blocker identified. The following existing limits remain material and are NOT repaired or waived:

- `executePermit` validates permit expiry/context before inspecting historical execution. An expired permit cannot use this route to reconcile an interrupted execution. Historical VERIFIED receipts are returned without fresh authoritative readback. These are explicit unresolved recovery/revalidation contracts, not proved current success.
- Inert admission covers workforce fields, not all exported helpers or punch/timecard record internals. `inferShiftTemplates`, `inferBreakPolicy`, `inferOvertimePolicy`, and direct `roleFromPerson` retain their earlier trust requirements. This review does not authorize arbitrary in-process executable objects for those paths or treat inferred roles as independently authorized access-control grants.
- Source identity is not source authenticity, immutability of a running filesystem, full image provenance, provider authorization, or customer proof. The proof harness is deterministic synthetic evidence; its positive result must not be promoted to operational payroll/provider assurance.
- Existing npm/build and installed-layout failures, provider async/compensation semantics, and historical H01 lifecycle/provider defects remain open in their established tracks. Exact source adoption does not satisfy their acceptance criteria.

### Minor

No new Minor adoption blocker identified. A post-commit retry response/notification can truthfully describe the committed RECONCILIATION_REQUIRED observation even if a terminal event commits immediately afterward. Consumers must refetch the authoritative ledger rather than use notification arrival order as execution state or mutation authority. This is a retained notification-contract limitation, not a terminal-ledger downgrade in the reviewed fix.

## Explicitly declined to judge

- Full installed application security, whole-repository dependency vulnerabilities, site-level authorization, all downstream consumers of inference flags, and authenticated tenant/customer journeys.
- Runtime/image construction, immutable final image digest, container installation, production filesystem durability, hosted isolation, and whether CI1050/1051 actually executed validation bodies. Read [6370021320](https://github.com/paulallen123/-manufacturing-wfm/pull/501#issuecomment-6370021320): the bounded build check is BLOCKED on read entitlement and missing Docker; body execution remains UNKNOWN despite green metadata. No retry or substitute inference was made.
- Root cause of earlier npm failure; TLS/proxy observations are not substituted as diagnosis. No bypass, trust expansion, reduced assertions, or recipe changes are approved.
- Historical VERIFIED revalidation, expired-permit recovery, independently authorized compensation, provider asynchronous side effects, business-effective lifecycle semantics, independently measured outcomes, source provenance, or customer payroll correctness.
- Whether a later branch publication satisfies expected-head protection, current ownership/lease records, required human/formal review, or merge/release policy. The integration owner must reconcile those separately.

Final disposition: **bounded source adoption acceptable; release/customer completion not admitted.** All original programme requirements, deadline, retained failures and truth boundaries remain unchanged.
