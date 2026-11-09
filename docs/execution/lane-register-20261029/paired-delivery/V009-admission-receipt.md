# V009 recovery-help admission supplement — 30 October 2026

The reviewed V009 recovery-help patch remains absent from canonical PR #501. This handoff removes a distinct preparation gap: its new help regression was missing from the explicit Dockerfile admission commands. The complete patch now includes source and installed-module admission. It is a text artifact for the existing canonical owner, not adopted product source.

## Source, custody and authority

- Fresh canonical head: PR #501 `61718e1862fa650136e1952f622c9d8dd4c22af8`; freshly inspected owner comments show the prior handoff `6510558143` and fail-closed correction `6510617892`, with no later recovery adoption/acceptance in that inspected conversation.
- The existing V009 patch in PR #528 at `d7cb3eb771dcf9d6dee6d0b4c35e5bc7cedd4f74` is byte-identical to the prior reviewed local patch, SHA-256 `49d887e9e60185891e35e93ca36c70ee77115d64bb475e741a2899b656a517ac`.
- Every scoped current GitHub file was fetched at exact canonical head and its Git blob recomputed before use; see JSON baseline manifest. Applicable `AGENTS.md`, `security/AGENTS.md` and `security/runtime/AGENTS.md` each returned 404 at that source.
- The published complete patch changes only `Dockerfile`, `security/runtime/owner-access-recovery.cjs` and `security/runtime/owner-access-recovery-help.test.cjs`. The product module is byte-identical to the previously reviewed candidate, SHA-256 `a7211fe3f6ad85f94be2d469eccd0adc6d2e5613c17fe2439d16bc697fa4463e`.
- Implementer: `/root/recovery_unblock`. Independent reviewer: `/root`; separately reviewed the supplement and reran installed-layout checks, Node 22 **4/4, zero skips**. Model identity is not exposed in these execution receipts; no provider model switch is asserted.
- Existing PR #501 owner retains canonical source, actual image/release and protected access proof. Only unique documentation artifacts are published to the existing PR #528 branch under the coordinator's explicit writer lease.

## Bounded delta

The supplement adds one source `RUN node --test` admission for the existing recovery suite plus help tests. It copies the help test to `/tmp/wfm-recovery-help/`, selects the exact `/app/security-runtime/owner-access-recovery.cjs` module and sibling identity guard, runs the same real-loopback HTTP checks, and removes that temporary fixture after success. A test-only `WFM_RECOVERY_MODULE` selector makes this installed target explicit; the default still tests the source sibling. No test assertion or product module is weakened. Existing test commands, pinned base image, failure exits, passkey default, grant validation, password-reset API and WebAuthn authority remain unchanged by this supplement.

The source admission lies in `autonomy-proof`, whose receipt is consumed by `hardened-runtime`. The installed admission lies in `hardened-runtime`, inherited by the final runtime and installed-archive proof. This was checked from the exact Dockerfile; no image build was executed here.

## Fresh executed evidence

Actual runtime for each retained run: Node `v22.23.2` at `/workspace/scratch/722aeb5410a4/node-v22.23.2-linux-x64/bin/node`. JSON receipts give full working directories, command argv, exits and TAP digests. All tests use synthetic grant metadata and disposable local paths.

| Target | Command after `node --test --test-reporter=tap` | Exit | Result |
| --- | --- | --- | --- |
| Exact unchanged source baseline | `security/runtime/owner-access-recovery-help.test.cjs` | 1 | 1 pass, 3 expected failures, 0 skips |
| Reviewed candidate source with portable test loader | `security/runtime/owner-access-recovery.test.cjs security/runtime/owner-access-recovery-help.test.cjs` | 0 | 15 pass, 0 fail/skip |
| Exact unchanged module in copied installed layout | `tmp/wfm-recovery-help/owner-access-recovery-help.test.cjs`, explicit baseline `WFM_RECOVERY_MODULE` | 1 | 1 pass, 3 expected failures, 0 skips |
| Candidate in copied installed layout | Same help test, explicit candidate `WFM_RECOVERY_MODULE` | 0 | 4 pass, 0 fail/skip |
| Previously independently authored HTTP harness, rerun by implementer against installed module | `v009-verifier/authority-http.test.cjs`, explicit candidate `V009_MODULE` | 0 | 10 pass, 0 fail/skip |

Baseline failures are the intended 404-versus-help/host-boundary differences, not test-loader failures. Both baselines retain a passing configured first-passkey page control. Copied installed modules and template were hash-compared to their source counterparts before testing. The independent review's separate 4/4 rerun is corroboration, not additional unique coverage.

Clean exact-baseline `git apply --check` and application of the complete patch passed. The resulting three files were byte-compared with the frozen candidate. `git diff --check` passed. The Dockerfile originally had no reference to `owner-access-recovery-help.test.cjs`; the supplement adds both required invocations without deleting existing commands.

## Adoption

Choose exactly one route on a clean current owner candidate after verifying preimages:

1. Apply `V009-complete-owner-ready.patch` directly to exact `61718`; or
2. Apply the original `V009-reviewed.patch`, then `V009-admission-supplement.patch`.

Do not apply the original runtime patch a second time after the complete patch. Any newer owner head requires renewed reconciliation and exact-byte review. The complete patch SHA-256 is `8d3fbc19b54738a78261aa05d4226b510c98b054ffd0089ff40d2572b6376537`; supplement SHA-256 is `8c47f676d5085ea3ad99eaa4e4323a2692f79d92f7c2cccb7f185839bd0b0ca4`. Final help-test SHA-256 is `a47246407c0761df1d6c75684d74c685fb4facdcd2f5766502aa7f3f3e70ad3b`; Dockerfile SHA-256 `26ff94210927db6c0e27229d004871585b48164b3b5b9ce5e0727415fdde01e5`.

## Remaining gates and claim boundary

V009 remains **CUSTOMER_PROOF / OWNER_READY_ADMISSION_SUPPLEMENT**. Canonical adoption, full pinned image/security admission and same-serving-SHA browser proof remain open. The executor has no Docker binary; installed-layout tests copy only the relevant declared runtime files and do not prove an image build. No new hosted request or genuine credential ceremony was performed in this supplement session.

The original anonymous 404 is intentional fail-closed behavior; the copy correction gives useful public guidance without enabling unconfigured recovery. Actual invitation expiry, revocation, authorised first registration, lost-all-passkey recovery, refresh/fresh-login persistence and audit require their legitimate protected actor/device/grant and exact hosted proof. Static help is not account recovery. No credential, token, customer account, tenant, provider, operational, cloud configuration or deployment state was changed.
