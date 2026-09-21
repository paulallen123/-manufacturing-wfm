# VECTOR authentication repair — 21 September 2026

Status: **BUILT — not deployed or production approved.**

Authentication source baseline: `ab93677008026540208d82c8f449b03f190c9faa`. Publication preserves the newer parent `d0c843092a8a4c462ffbd109e78fbf997e372933`, whose four intervening commits change only proof-result scripts and their evidence. Continue the existing repair branch and draft PR #220. Preserve the release branch, approved five-section Vector application, database preservation requirements, existing admission gates and all security holds.

## Changes

The identity guard previously rejected an expired or unknown cookie before a fresh POST `/api/login` or POST `/api/logout` could reach the existing sealed handler. The repair permits only those exact authentication requests through, after rejecting injected identity headers. It does not create a session, skip credential validation, exempt lookalike routes or allow protected API access.

The existing packaged `owner-access-recovery.cjs` now also provides an opt-in email sign-in path, without changing the original owner-recovery grant policy. No new authentication service, dashboard or architecture was created. The existing bootstrap already mounts this component before the identity guard, and the Dockerfile already includes it.

An explicitly enrolled mailbox can request an eight-digit code or a 256-bit link token. Both expire after ten minutes, require the requesting browser's pre-authentication cookie, and are single-use alternatives. Opening a link does not consume it; the page requires explicit confirmation. A forwarded link alone cannot log another browser in. A user reading email on another device can type the code in the original browser.

Verification rechecks the existing user record, tenant, role, person, permissions, password state, session epoch, policy version and security freeze. Consumption, the existing session/binding and the audit event are committed atomically. A private-device option lasts twelve hours, rather than indefinitely; the default lasts four hours. Existing password sign-in remains available.

Queued email payloads are encrypted with AES-256-GCM. Retries use the same Resend idempotency key. Raw provider errors, codes and tokens are not logged. Request counters persist across restart and are bounded by global/network limits before creating per-address counters. A rate-limited resend does not overwrite the browser's existing challenge cookie. The worker sets SQLite's lock wait before schema reads to prevent a cold concurrent start from failing immediately.

## Verification actually performed

On Node **v22.16.0**, all **55 authentication tests passed three consecutive runs**, with zero failures or skips in those final runs. The run includes the two new test files and the exact, unchanged existing identity-guard and owner-recovery tests, including independent-worker single-consumption checks. Initial failing tests reproduced the expired-cookie problem, missing email implementation, database-context drift and resend/counter issues before their repairs. A transient concurrent-start failure was also reproduced and repaired before the three final runs.

Reproduce this bounded suite from a full checkout:

```sh
node --test security/runtime/identity-survival-guard.test.cjs security/runtime/owner-access-recovery.test.cjs security/runtime/identity-login-reentry.test.cjs security/runtime/email-signin.test.cjs
```

The existing `scripts/run-local-vector-proof.mjs` discovers all `security/runtime/*.test.cjs`, so it will include the new tests without changing its gates. It requires the pinned **Node v22.23.2** and full composed runtime. That command, the complete repository suite, Docker admission and hosted browser tests have **not** been run for this change. Node v22.16.0 emitted its normal experimental SQLite warning; that is not a claim of exact-runtime admission.

A local Chromium check was attempted but the execution environment's managed URL policy prohibited navigation. No policy was changed. No successful browser journey, screenshot, video or real email delivery is claimed. Use the already-existing authorised hosted proof runner as the next browser route; do not create another competing runner.

## Activation requirements — leave disabled until satisfied

The connected Resend account returned no domains. The inspected candidate service also had no email sign-in configuration. No sender domain, API key, real mailbox enrollment, live credentials or Railway variables were created or changed.

1. Verify a sending domain controlled by the owner, configure a sending-only provider credential, and disable tracking for authentication emails.
2. Explicitly approve the real mailbox-to-existing-account mapping. Do not infer privileged enrollment from Git commit authorship, an arbitrary email address or test fixture identities. The target user and tenant security-control row must already exist.
3. Set `WFM_EMAIL_SIGNIN_KEY` to a securely generated 32-byte secret encoded as 64 lowercase hex characters, `RESEND_API_KEY`, and `WFM_EMAIL_SIGNIN_CONFIG_JSON` through the protected environment settings, never the repository or chat. The JSON shape is `{ "sender": "verified-sender@owned-domain", "accounts": [{ "recipient": "approved-mailbox", "email": "existing-database-email", "tenant": "existing-tenant", "personId": "existing-person", "role": "existing-role" }] }`. Use the actual HTTPS `WFM_PUBLIC_ORIGIN` and preserved `WFM_DB`.
4. Complete pinned-runtime, Docker, real delivery, browser, logout/revocation and post-restart checks on the existing isolated candidate. Preserve/restore-verify any existing database before a restart or promotion. Bind the actual served release identity to the tested source.
5. Only then enable `WFM_EMAIL_SIGNIN_ENABLED=true` for the enrolled pilot. The rate budget is deliberately conservative (200/minute global, 50/minute per socket peer, 5/15 minutes per mailbox), not demonstrated enterprise-scale capacity. A shared reverse proxy may share the peer budget; do not trust arbitrary client-supplied forwarding headers to increase it.

Leave the flag absent/false to retain the original login surface. Invalid enabled configuration fails closed and must be corrected or disabled through the authorised control plane. Email sign-in is not phishing-resistant MFA and must not silently replace an enterprise SSO/MFA requirement. Enterprise SSO, passkeys, automatic machine identity/session provisioning, full customer-journey proof and the narrated product videos remain separate unfinished requirements.
