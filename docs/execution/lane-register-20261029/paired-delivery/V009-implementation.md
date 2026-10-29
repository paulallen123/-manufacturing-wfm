# V009: bounded public recovery-help repair

This patch corrects the advertised `/access-recovery` navigation when no usable first-passkey grant exists. It does not implement general lost-passkey recovery, create an invitation, issue credentials, change roles, or establish customer readiness.

## Source and ownership

- Repository: `paulallen123/-manufacturing-wfm`; PR501 head freshly checked as `61718e1862fa650136e1952f622c9d8dd4c22af8` before work.
- Existing canonical integration/onboarding owner retained; only disposable local files were changed.
- Latest handoff inspected: PR501 comment `6510326598`. No competing recovery repair was identified in the latest inspected discussion.
- Exact original Git blobs for five dependency/template/source files were verified; see `baseline-blobs.json`.
- There was no AGENTS.md in the recursive exact-head tree.

## Observable behavior

- A correctly addressed HTTPS `GET /access-recovery` returns useful static sign-in help when its setup grant is absent, malformed, expired, legacy password-only or unavailable outside staging.
- The static help contains no form, code/password input, script, account identifier, grant details or dynamic account lookup. It sets no cookies and opens no database. It offers existing-device/invitation guidance and a return to secure sign-in.
- Only a configured current `first-passkey` grant retains the existing passkey setup page. The actual code, identity, prior-credential, epoch, policy and WebAuthn checks remain in their existing paths.
- Query strings, wrong host/proxy transport, unsupported methods and injected identity headers remain denied. An invalid configured public origin fails unavailable rather than introducing an unbound page.
- The owner recovery API implementation is unchanged. The old public password-reset form is no longer displayed by this page.

## Verification

Author runtime: Node `v24.22.1`.

1. `node --test baseline/security/runtime/owner-access-recovery-help.test.cjs`: **1 pass, 3 expected failures, 0 skips**, exit1. This exercises the exact original source and detects the advertised404/unsafe legacy public-page behavior.
2. `node --test candidate/security/runtime/owner-access-recovery-help.test.cjs candidate/security/runtime/owner-access-recovery.test.cjs`: **15 pass, 0 failures/skips**, exit0. Includes real local HTTP plus the existing synthetic grant/atomicity/session-isolation suite.
3. `node --check candidate/security/runtime/owner-access-recovery.cjs`: exit0.

Independent verifier is `/root/support_security_extensions_audit`; its separate HTTP harness and receipts are under `../v009-verifier`. Treat those reports as independent local proof only and retain their exact candidate hash.

## Patch custody

- Patch: `v009-access-help.patch`, SHA256 `49d887e9e60185891e35e93ca36c70ee77115d64bb475e741a2899b656a517ac`.
- Candidate source SHA256: `a7211fe3f6ad85f94be2d469eccd0adc6d2e5613c17fe2439d16bc697fa4463e`.
- New authored HTTP test SHA256: `b667599c7c306716b82e9724e437738982e0ff1c7ab562572d1afad8339d275a`.
- Current baseline failure TAP SHA256: `d8b1a24024a2973e96a3be7867846f561f91b92c15b7aaf2fb9185ed447bc708`.
- Current author green TAP SHA256: `c5d555da3d1db6a53854097c02b0c54e22d512ecf1243ad6e3be91e5d26dd5be`.

## Adoption and remaining work

The existing integration owner must recheck head/ownership, apply the two-file patch in the current candidate, register/run the new test in the required security/image admission, obtain formal review and verify the actual hosted navigation before release. No product branch, deployment, cloud configuration, customer/provider state or secret was changed here. Supported Node22/exact combined image and hosted/browser acceptance remain unrun for this patch.

Full V009 remains open: genuine authorised invitation and passkey registration, expiry/revocation, account recovery, fresh-login persistence and customer proof are separate acceptance outcomes. Static help never substitutes for those requirements.
