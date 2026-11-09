# V009 independent authority and HTTP review

Date: 29 October 2026. Reviewer: `/root/support_security_extensions_audit`.

Decision: **ACCEPT bounded public sign-in-help repair for canonical-owner adoption and normal admission.** No material introduced defect found in the reviewed delta. This is not approval of general lost-passkey recovery, a new authentication path, a live deployment, or customer-ready access.

## Exact source and ownership

- Current inspected integration source: PR501 `61718e1862fa650136e1952f622c9d8dd4c22af8`.
- Existing onboarding/auth owner and sole canonical integrator retain ownership. No source branch, cloud state, customer, provider, credential or account was modified by this verifier.
- Frozen local candidate: `v009-builder/candidate/security/runtime/owner-access-recovery.cjs`, SHA-256 `a7211fe3f6ad85f94be2d469eccd0adc6d2e5613c17fe2439d16bc697fa4463e`.
- Authored test: `owner-access-recovery-help.test.cjs`, SHA-256 `b667599c7c306716b82e9724e437738982e0ff1c7ab562572d1afad8339d275a`.
- Independent verifier: `authority-http.test.cjs`, SHA-256 `b59e48e6593c51f43bdedb8b040e3c3fb04dd11ab821cd2596119eb1df9efb34`.
- Full source/log hashes: `review-manifest.json`. Baseline exact GitHub blobs: `baseline/source-manifest.json` and builder `baseline-blobs.json`.

## Mechanism and legitimate authority

The advertised `/access-recovery` route already exists. Its404 with absent/expired recovery configuration is an intentional default-deny mechanism, not an absent route. The observed customer defect is the unconditional public sign-in link terminating in raw404. The repair returns static guidance under an independently validated HTTPS public origin; it does not make unconfigured recovery available.

Current invitation registration requires a pending, unexpired invitation token hash and exactly one same-tenant user matching the normalized recipient-email hash. Existing/revoked historical credentials and revoked initial authority deny first enrolment. Current scope/freeze and the authorization are rechecked at cryptographically verified WebAuthn registration.

The separate owner grant supports initial passkey enrolment only for the existing synthetic owner account and current tenant epoch/policy/freeze. It cannot replace a lost credential, create accounts, change roles, clear holds or authorize another tenant. A legacy password-reset grant is not hosted passkey authentication. The repair removes that misleading public password form while leaving the existing API contract unchanged.

The generic help text is identical across absent, malformed, expired, non-staging and legacy grants. It contains no account identity, token, configuration, form, input, script or session cookie. Valid first-passkey grants preserve the existing page and WebAuthn assets. Wrong host, insecure forwarded transport, query credentials and injected identity are denied; non-GET requests are rejected. Missing/malformed public origin remains503.

## Executed verification

Actual runtime: Node `v24.22.1`.

1. Independent real HTTP baseline:
   `node --test --test-reporter=tap authority-http.test.cjs > baseline-http.tap`
   Result: **6 passed,4 expected failures,0 skipped, exit1**. Failures demonstrate raw404 help, unconfigured page boundary, exposed legacy password form, and missing-origin response mismatch. Existing first-passkey and API denials pass.
2. Frozen candidate independent real HTTP:
   `V009_MODULE=/workspace/scratch/2ea1ba0f2164/v009-builder/candidate/security/runtime/owner-access-recovery.cjs node --test --test-reporter=tap authority-http.test.cjs > candidate-http.tap`
   Result: **10 passed,0 failed,0 skipped, exit0**.
3. Existing owner recovery plus authored help regressions, independently rerun:
   `node --test --test-reporter=tap security/runtime/owner-access-recovery.test.cjs security/runtime/owner-access-recovery-help.test.cjs > candidate-affected.tap`
   Result: **15 passed,0 failed,0 skipped, exit0**.
4. Independently verified byte-identical configuration, owner authorization/consume functions, body/reset logic, first-passkey renderer and API implementation suffix. Only the public help renderer and page routing change.

The HTTP harness uses actual loopback `http.request` with explicit Host/proxy headers, not a mocked request handler. Database paths deliberately do not exist; help and denied requests are checked to create no database. The baseline was initially exercised with `fetch`, which did not preserve the requested Host in this runtime; the harness was corrected to `http.request` before the retained baseline/candidate results. Those initial harness failures are not product findings.

## Remaining gates

- Canonical-owner reconciliation and exact combined-source review.
- Prescribed Node22 and full installed-image admission.
- Hosted deployment and repeat read-only UI/API proof on exact serving source.
- Genuine invitation/first-passkey ceremony, authorised user/device participation, refresh/fresh-login and audit readback.
- General lost-all-passkey recovery remains a separate unimplemented/unproven workflow here.
- No access grant, recovery code, token, session or customer-state mutation was created.
