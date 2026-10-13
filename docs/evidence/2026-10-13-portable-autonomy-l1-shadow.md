# F6.4 portable autonomy evidence: bounded L1 shadow verifier

Status: **TESTED locally and independently reviewed.** This is an adoption package, not an integrated or enabled capability.

## Requirement and source

F6.4 in the authoritative VECTOR Friday release backlog (`VECTOR-Friday-release-backlog-2026-10-11.md`, version 7) and [issue #62](https://github.com/paulallen123/-manufacturing-wfm/issues/62) call for portable autonomy evidence: signed permits and receipts, bounded authority, nonce and revocation checks, shadow mode, and explicit trust levels. The full issue also requires a broader synthetic benchmark and later customer proof. This package addresses only L1 software signature verification. It does not assert hardware attestation, TRACE conformance, safe execution, or a customer outcome.

## Ownership and base

Checked issue #62, open PRs and branch searches for portable autonomy, permit/receipt and F6.4 before editing on 2026-10-13. Issue #62 was open without an assignee or active implementation comment; no active permit/receipt PR or branch was found. The broad older discovery PRs #86 and #234 are historical context, not competing writers. The canonical release branch `release/vector-customer-ready-candidate-20260925` was at `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`; Railway's latest successful deployment was still old serving SHA `90ad90fcf60adaca9abacdd4ad14bf392f95e585`, with the canonical SHA only staged. This package starts from that exact canonical SHA and adds files without modifying the existing Trust Spine, execution gateway, deployment controller, or release workflow. The canonical owner must adopt and verify it on the exact release candidate.

## Result and changed files

- `trust/runtime/portable-autonomy-evidence.cjs`: fixed-schema Ed25519 permit and receipt signatures, domain-separated canonical digests, fail-closed verifier for scope, event, policy, build, authority, bounded lifetime, nonce, key revocation, trusted key role, executor identity and tenant/site, call budget and paired receipt. Returns a non-executable `L1_SOFTWARE` verification result. The caller supplies a trusted role/identity/tenant/site-bound key registry, revoked key IDs, the observed nonce decision, maximum TTL and call cap, and context; this package neither persists a nonce nor executes an action.
- `trust/runtime/portable-autonomy-evidence.test.cjs`: synthetic positive and negative cases, including 1,000 deterministic adversarial verifications.
- `docs/evidence/2026-10-13-portable-autonomy-l1-shadow.md`: this evidence record.

## Tests and review

Node `v24.19.0`: `node trust/runtime/portable-autonomy-evidence.test.cjs` initially passed 20/20 cases. After binding `eventDigest` to caller context, `node --test trust/runtime/portable-autonomy-evidence.test.cjs` passed its file-level test. The independent reviewer found that an executor signature could claim another executor ID and an authority signer could also sign a receipt if the resolver did not enforce roles; the reviewer also identified an uncapped permit lifetime and missing tenant/site key scope. We added trusted role/identity/tenant/site binding and policy maximum TTL/call cap, with reproducer negatives. The final `node trust/runtime/portable-autonomy-evidence.test.cjs` passed 27/27 cases, including 1,000 synthetic adversarial verifications. Independent re-review found no remaining critical or important false acceptance within the isolated L1 contract. These intermediate defects were caught before publication; no final test failure remains. No hosted or exact-candidate test has been run.

## Integration and proof

No merge, canonical integration, release approval, deployment, enablement, hosted proof, or customer proof. Current status cannot exceed **TESTED** after the final test and review pass. The signer is a synthetic software key in tests. The result is evidence validation only and does not grant execution authority.

## Remaining work

The canonical owner must decide the actual trusted key registry, revocation and nonce store semantics, authorize approved shadow integration points, and verify the exact candidate with the Trust Spine and synthetic tenant isolation. Issue #62's full 1,000-case mix and ≤25 ms median target require an agreed benchmark environment and wider scenarios. Privacy minimization and downstream receipt custody, replay behavior across processes, failure and compensation semantics, L2/L3 hardware claims, hosted/customer proof, and production release approvals remain open. No real personnel or payroll action is exercised.
