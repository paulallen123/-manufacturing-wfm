# Current independent PR364 compatibility and security review

Reviewer: `/root/review_six_file`; 2026-10-23. Separate bounded review of the existing proof-runner authentication donor. No remote writes, source edits, new worker/lane, new tests, build execution, CI trigger, credentials, or customer/provider interaction. This is an independent agent technical recommendation, not a human or formal GitHub approval.

## Verdict

**ADOPT as the bounded normalized-email ambiguity rejection repair. Not release approval and not a claim that all concurrent identity-selection hazards are resolved.** No new adoption-blocking defect or authentication weakening was found in the exact two-file delta. The existing concurrent-identity limitation remains Important and must not be represented as closed.

## Exact current composition

Current PR501 candidate inspected at commit `1e8330c6d0c67811d47b5c17b44daf75649f9099`, tree `bd9c85018ce11096f4c90b6bb1aa1acb5480810f`. Donor PR364 head `91da2d752f599f4c2d357ba6cedfea2ddf4d6f2f`.

| Path | Current PR501 baseline | Donor/adoption blob |
| --- | --- | --- |
| security/runtime/proof-runner-auth.cjs | 0165b9a5207eeb870e2690c4da6456ec8457db7e | fbc0b6b974bb98821294de3ff456376c4385d73e |
| security/runtime/proof-runner-auth.test.cjs | 429954089f3ca7bdc47aed41058859a594f964d7 | 98f3e63ff4745c279867225df2b68155f19088eb |

Fetched source/test at both exact refs directly through GitHub. PR364 files endpoint contains exactly these two modified paths. Source delta is only the query's deterministic ordering, `.get` to `.all`, zero-match check, multiple-match refusal, and unique-result selection. Removing the single added ambiguity test from the donor test reproduces the current baseline test exactly; no prior assertions are changed or removed.

Independently fetched complete recursive trees for proposed auth tree `b32071f3fe800e1d71243007810a67e705c4f679` and current baseline tree: 1,456 entries each, neither truncated. Exactly the two expected leaf blobs differ; no added/deleted paths or leaf mode/type changes. Thus the earlier six-file repair and retained evidence are unchanged. Later documentation/ref publication remains the integration owner's responsibility and must preserve these source identities.

## Current source assessment

- Signature/allowlist/origin/transport/time/nonce validation still precedes principal lookup. Multiple database rows matching the existing normalized-email comparison now return HTTP409 with audit event `ambiguous-normalized-email`, rather than choosing the first row. This rejects both cross-tenant and same-tenant ambiguity. Missing identity still returns403. The response remains generic and does not expose candidate tenant identities; the secondary audit records only the match count and normalized supplied email.
- The ambiguity branch precedes token generation and all nonce/session insertion. Secondary rejection-audit failure is swallowed but does not fall through into issuance. Refusal does not consume the nonce, allowing a correctly signed assertion to be retried after an explicitly corrected identity mapping while its existing short lifetime remains valid.
- Unique matches preserve the exact stored email, tenant and role. There is no synthesized principal, new role grant, tenant fallback, or user-controlled tenant selection. `ORDER BY email` is not used to select among ambiguous rows: all rows are counted and ambiguity is refused.
- Existing Ed25519 verification, fixed assertion issuer/audience framing, email allowlist, staging-only enablement, HTTPS-origin requirement, maximum assertion lifetime, nonce uniqueness, secure cookie attributes and session TTL are unchanged. Session, proof-session, nonce and issuance-audit writes remain one transaction, with rollback before refusal on failure. This narrow change does not alter surrounding identity-survival enforcement or schemas.

## Reused evidence, no reruns

Read original `pr364-review/REVIEW.md` and actual retained TAP outputs, inspected the two extra held-out cases, and independently rehashed source, tests, dependencies and evidence. The `base` test fixture intentionally uses the donor regression test against the old engine to produce RED; it is not the old baseline test blob.

- Node22.23.2 RED: 8 pass / 1 fail; exact failure is `ambiguous normalized proof identity fails closed before session issuance`, actual HTTP200 versus expected409. SHA256 `7e386bab842ebcce395ae880e8e7eadd06a511b733e91c2347d7552c17b0638b`.
- GREEN donor suite: 9/9, zero fail/skip/cancel/todo. SHA256 `a4e7ad15dc6f102f8f31f47e686c4175c3d2f56d486c315bf2da634706592c7d`.
- Existing edge harness: 11/11, comprising the overlapping nine tests plus two same-tenant ambiguity cases with normal and deliberately failed rejection auditing. Not 11 additional independent cases. SHA256 `f5867f44552153d7127c25d46abde23a57f9119fb26e810d8da85a21028d327a`; harness SHA256 `5ba0659098b28badf9a015a24e666bc27caba31016e94fc0e41f4750ea4f745d`.
- Original review SHA256 `1e8b1039de99a6542879e6fe18643fbe60891e84712fd14f8135860f288dd681`.
- Current exact dependencies still match tested bytes: identity-survival-guard `929297a2fc698d6aa1ba2714ded5db79ee9bb3d4`; passkey-schema `f6d37edc3c7135b3feeb210605cf9c3619c31307`.

The original RED is retained, not relabelled as a setup error. Earlier dependency-load failures remain setup limitations, not product defect evidence. No unchanged suite was rerun and no new test was required for this unchanged bounded donor.

## Findings and retained limitations

### Critical

No new Critical finding in this two-file delta. No whole-product security certification is implied.

### Important

**Retained identity-selection race, not repaired here:** `userStmt.all(email)` executes before `BEGIN IMMEDIATE`. Another connection may change the user population or principal binding between that query and issuance. The fix rejects ambiguity observed at lookup; it does not establish atomic uniqueness/binding through mint time. This was explicitly recorded in the prior review and remains open. A stronger guarantee needs a separately reviewed transaction/identity-invariant design and concurrency acceptance. Do not describe this donor as eliminating every cross-tenant principal race.

Existing normalization uses JavaScript lowercasing for assertion email and SQLite `lower(email)` for lookup; this is not a new comprehensive Unicode normalization/casefold contract. No schema uniqueness migration is introduced. Hosted trusted-proxy handling, key custody/rotation, assertion authority, allowlist administration, role revocation and active identity-change semantics are unchanged and not established by these synthetic tests.

### Minor

No new Minor adoption-blocking finding. Ambiguity now deliberately changes previously successful but unsafe ambiguous requests to409. Clients and operators must correct the ambiguous identity mapping instead of retrying until an arbitrary row wins. All matching rows are materialized by `.all`; no arbitrary cap or alternative identity-selection policy was introduced.

## Declined to judge and disposition

Declined: full hosted authentication admission, trusted proxy deployment correctness, key/private credential availability, genuine isolated hosted identity, production session durability, final installed image/build/CI execution, comprehensive tenant-isolation or Unicode guarantees, post-lookup concurrency safety, authenticated customer journeys and release readiness. No live configuration or identity should be created or enabled merely because this source donor is accepted.

Final disposition: **exact two-file source adoption acceptable with preserved limits; release and broader authentication assurance remain unproven.** The prior six-file review is untouched. Existing failures, programme requirements and deadline remain preserved.
