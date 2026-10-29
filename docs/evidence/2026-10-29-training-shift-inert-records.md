# V067: prevent active records from relabelling validated training/shift receipts

## Requirement and ownership

The accepted V067 lane integrates training-versus-shift conflict checks. Existing PR #521 owns the bounded pairwise helper; PR #501 remains the sole integration/release path. The getter defect and reproducer were handed off at https://github.com/paulallen123/-manufacturing-wfm/pull/521#issuecomment-6510379564 and registered at https://github.com/paulallen123/-manufacturing-wfm/issues/527#issuecomment-6510386034.

Fresh PR/head/comment and exact-module open-PR checks found only the existing donor. The root reserved this bounded existing-donor write set at issue #527 comment6510477550. The builder and independent verifier changed only isolated local scratch; the integration owner must recheck the branch head before any expected-head publication.

Exact donor parent: `585d36f4181475bab887fcfc11b812458f5f53cd`; tree `fda8864d5293d67f91e8d7daf2a0edade8b8fef9`; ref `feature/training-shift-collision-20261027`. Canonical integration head checked: `61718e1862fa650136e1952f622c9d8dd4c22af8`. This is not a new runtime, route, controller, customer or provider writer.

## Behavior

The helper previously validated values and read them again when returning its receipt. A getter could supply a valid scope, ID or hash during validation and substitute a different value later; freezing a caller object does not make its accessors inert.

The helper now rejects proxy/nonplain records before executing traps, reads own property descriptors without invoking getters, rejects accessor/hidden/symbol fields, and builds null-prototype snapshots. Scope, shift and training are validated and returned from those same owned snapshots. Ordinary JSON data, null-prototype own data and ignored extra plain data keep the existing behavior. Original root-scope and timestamp diagnostic ordering is retained.

The result remains pairwise declared overlap only. Source authentication, roster completeness, scheduling, training, payroll and execution authority remain false. No live caller or cross-tenant customer exploit is established.

## Exact reviewed bytes

- Source `operations/runtime/training-shift-collision.cjs`: Git blob `5b64589a538e3a45029343f85a2cd884ab42955d`; SHA-256 `a7c7282ef0f2a891fc8f4e299d9775d7299cbb16054b7e4d0e55071fd856fe00`.
- Test `operations/runtime/training-shift-collision.test.cjs`: Git blob `41805320b9c4559e62c4de6443a4e9fbc3991992`; SHA-256 `561808ec4fb6e0bb2363faf4310f943fb67d45ddde2e9fa3ec8efe986884d38e`.
- The two-file patch was checked against exact donor bytes with `git apply --check`, then applied in a disposable directory; resulting source/test bytes matched the reviewed candidate.

## Executed builder evidence

Runtime: Node `v22.23.2`.

1. Original source plus six new regression groups: `node --test --test-reporter=tap training-shift-collision.test.cjs` exited1, **5 pass / 5 fail / 0 skip**. The failures establish active root selectors, receipt fields, frozen accessors, proxies and inherited/extra active records were admitted. Ordinary JSON compatibility remained green. RED TAP SHA-256 `9c9bb5a4345dde8740647250d7f425ecec077296bef7e6d4255c7de24e1f65f7`.
2. Candidate source: focused **10/10 pass / 0 skip**, exit0; syntax check exit0.
3. Final source plus exact-current `61718e1` scheduler source/test: `node --test --test-reporter=tap training-shift-collision.test.cjs manufacturing-scheduling-engine.test.cjs` exited0, **37/37 pass / 0 skip**. Scheduler source/test Git blobs `97cbbc3405abfc010a6513aa67ab58d56e1079f8` / `ee1c0b4e12d818b67e03bdf0dd6ae53624cdc2b8` were verified before execution. TAP SHA-256 `af240d963ca7fc208a150de438c1a8fda3c4b79b23e80f834ac03f00c6a0c3f7`.
4. The published four-case owner reproducer against final source: **4/4 pass / 0 skip**, exit0.

Counts overlap and must not be added into a unique total.

## Independent verification

A separate verifier derived its own expected invariants and retained its own heldout/compatibility tests. Same exact donor with those initial heldouts: **11 pass / 9 fail**, exit1. Final candidate source hash was verified unchanged before and after execution.

Pinned Node `v22.23.2`: independently derived final heldout/compatibility suite **27/27 pass / 0 skip**, exit0. It includes 120 plain-JSON differential overlap scenarios, proxy/accessor zero-hook checks, null-prototype and extra `__proto__` JSON compatibility, foreign tenant/site/worker denial, ordinary frozen data, touching windows, all returned identity/hash substitutions, and frozen active hashes. These scenarios are not 120 extra reported tests.

Final independent TAP SHA-256 `adb70b278c2944cf23d1ce4ce8dd1951c8e198b6065727bf9ae17185e759a081`. No remaining Important issue was found within the bounded snapshot-consistency contract. The reviewer did not edit builder source.

## Boundary and next action

This is a reviewed, locally tested donor repair, not canonical integration, final-image admission, deployment, source authentication, hosted role proof, provider proof or customer readiness. No tenant, schedule, payroll, provider, deployment or credential state was changed.

The existing donor owner should publish only these exact source/test/evidence bytes with a fresh expected-head lease on PR #521, preserving any intervening work. The sole canonical owner must then bind trusted roster/LMS inputs and role/site scope, reconcile into the actual current candidate, independently review that union, run exact-image/security/recovery gates, and obtain approved hosted persistence/readback/audit proof before a customer-ready claim.

