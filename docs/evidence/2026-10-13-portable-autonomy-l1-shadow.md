# F6.4 portable autonomy evidence: bounded L1 shadow verifier

Status: **TESTED in isolation.** This is an adoption package, not an integrated or enabled capability.

## Requirement and source

F6.4 in the authoritative VECTOR Friday release backlog (version 7) and issue #62 call for portable autonomy evidence: signed permits and receipts, bounded authority, nonce and revocation checks, shadow mode, and explicit trust levels. This package addresses only L1 software signature verification. It does not assert hardware attestation, TRACE conformance, safe execution, or a customer outcome.

## Ownership and base

The package remains on the existing draft PR #437 and its existing three-file fence. Its predecessor is exact head `27d8a6c21eac063dd7fd09a65b3b92af490670ba`, based on canonical release SHA `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. No Trust Spine, execution gateway, deployment controller, canonical ref, Railway service, tenant, provider, runner, controller, or customer state was changed by this isolated repair.

## Result and changed files

- `trust/runtime/portable-autonomy-evidence.cjs`: fixed-schema Ed25519 permit and receipt signatures, domain-separated digests, and fail-closed verification for scope, event, policy, build, authority, bounded lifetime, nonce, key revocation, trusted key role, executor identity, tenant/site, call budget, and paired receipt. The caller context is now an exact ordinary record whose security fields are copied once before callbacks. Revocation identifiers are copied through captured Set intrinsics into verifier-owned data, key bindings must be ordinary data records, and the success result uses a captured freeze intrinsic. The result remains non-executable `L1_SOFTWARE` evidence.
- `trust/runtime/portable-autonomy-evidence.test.cjs`: the original synthetic cases plus regressions for accessor-backed context fields, lying Set subclasses, callback mutation after snapshot, intrinsic tampering, and accessor-backed key bindings.
- This evidence record preserves the disproved predecessor and the bounded repair result.

## Negative result and repair verification

The 16 October exact-head review (review 5553313554) disproved the predecessor's earlier “no remaining critical or important false acceptance” claim. The committed predecessor suite passed 27/27, but independent held-outs passed 35 and failed 9. Stateful context accessors could bypass trusted key, replay, expiry, TTL, and call-cap decisions; a Set subclass could lie about both revoked signer keys. The review also identified unresolved policy choices for dual-role key material and an operational time floor.

On the unchanged predecessor source with the nine new regressions, `node --test tdd-red/trust/runtime/portable-autonomy-evidence.test.cjs` reproduced **27 pass / 9 fail**, exit 1. The first repaired candidate passed 36/36, but independent review then reproduced one additional Important expired-permit false acceptance through live date/number primitives after the registry callback; publication was blocked. After adding that held-out and capturing the remaining post-callback date, number, buffer, regexp, Set-iterator, and hash primitives, Node `v24.19.0` `node --check` on both source and test followed by `node --test trust/runtime/portable-autonomy-evidence.test.cjs` produced **37/37 pass**, 0 fail/skip/todo. The candidate source blob is `4cdecdebbd384e387ba974e7652903379d757f0f` (SHA-256 `89d7eba47eb3ed4d81cbf8f41084cd30c1bd030c70219c96e94dca102692ab5e`); the test blob is `35e40bec7a6990da17635140321211e3660c6359` (SHA-256 `ab409b341b87ab616e56d103fcdd61607a1d2a415e29bab4cffc2e1f87330602`). Fresh independent exact-bytes re-review is required before adoption.

## Integration and proof boundaries

No merge, canonical integration, Node 22.23.2/final-image admission, release approval, deployment, enablement, hosted proof, or customer proof has occurred. The signer remains a synthetic software key in tests. Verification does not grant execution authority. Dual-role key-material prohibition and an operational time floor remain owner policy decisions and are not silently imposed here.

## Remaining work

The canonical owner must decide authoritative key-registry, role separation, revocation and nonce-store semantics; reconcile only the independently accepted exact successor onto current contracts; run supported Node 22/final-image admission and applicable security/privacy/tenant gates; and only then perform controlled deployment and authenticated intended-role durable-state/fresh-login/audit proof. Issue #62's broader benchmark, privacy/custody, multi-process replay, compensation semantics, L2/L3 hardware claims, and real customer proof remain open.
