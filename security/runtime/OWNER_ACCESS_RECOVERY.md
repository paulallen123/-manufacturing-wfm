# Owner-authorized access setup and recovery

The existing recovery mechanism remains **disabled by default**. The passkey setup mode applies only to the existing synthetic owner account `superuser@northstar.example`, tenant `northstar-demo`, person `d1`, role `director`. It does not create an account, change roles/permissions, clear security holds or grant access to another tenant.

## First passkey in the hosted application

The hosted application rejects password sign-in. A password reset does not fix first-time passkey enrolment. Issue a recovery grant explicitly containing `"purpose":"first-passkey"` for this operation. Legacy six-field password-reset grants cannot authorize passkey enrolment, and a first-passkey grant cannot reset a password.

Use this exact seven-field shape, replacing every placeholder/example with verified values:

```json
{"id":"NEW_RANDOM_GRANT_ID","tokenHash":"64_LOWERCASE_HEX_SHA256_DIGEST","issuedAt":0,"expiresAt":0,"sessionEpoch":1,"policyVersion":1,"purpose":"first-passkey"}
```

Before enabling `WFM_OWNER_RECOVERY_JSON`, the authorised release/environment owner must:

1. Bind the reviewed login repair to the exact existing release, configuration, SQLite database/volume, tenant and proof run. Preserve a consistent recovery backup and the pre-change release/configuration identity. Coordinate the deployment with the existing integration/release owner; do not race another deployment or change its source ref.
2. Verify the account already has the exact tenant, person and role, and has never registered a passkey (including revoked credentials). This mode does not replace or recover a lost credential.
3. Read the actual tenant `session_epoch`, `policy_version` and privileged-freeze state. Do not invent, reset or create these controls. A missing, changed or frozen context refuses enrolment.
4. Obtain approval for this exact account, scope and setup window. Generate a fresh random 32-byte canonical base64url code (43 characters) and random 16–80-character grant ID. Configure only the SHA-256 digest, not the plaintext code. Keep the code out of source, environment variables, logs, request URLs, screenshots, PRs and tool transcripts. Use an approved private owner-to-user handoff; no email service or paid infrastructure is required by this repair.
5. Use Unix millisecond times with issuance not in the future, expiry strictly later, and a lifetime of at most 30 minutes. Issue the grant only when the tested candidate is deployed and the user is ready. Preserve `NODE_ENV=staging`, `WFM_HOSTED_STAGING=true`, the enabled identity guard, exact durable `WFM_DB` and canonical bare HTTPS `WFM_PUBLIC_ORIGIN`.

The user opens `https://<verified-existing-host>/access-recovery`, privately enters the one-time code and clicks **Create my passkey**. The browser/device performs the WebAuthn ceremony with user presence and verification. The agent must hand off credential entry and submission to the user. The page reuses VECTOR's approved blue-and-white sign-in template and existing WebAuthn client. It never places the code in a URL or browser storage.

Successful, cryptographically verified registration atomically persists the passkey, consumes the existing append-only recovery ledger grant, appends audit evidence and issues the ordinary identity-bound passkey session. Existing account attributes, password hash, permissions, business data and other users' sessions remain unchanged. The user can subsequently sign in from the ordinary entry page with the new passkey, without the code.

Cancellation, invalid attestation or failed audit does not consume the grant. Retry within its validity. Lost success response: try ordinary passkey sign-in before requesting another grant. Concurrent registration, replay and restart cannot create a second credential from the same code. Revocation/rotation, expiry, reassignment, changed policy/epoch or freeze between options and final verification fails closed. Origin, RP ID, browser-bound challenge and user verification remain mandatory.

## Revocation, cleanup and rollback

Remove `WFM_OWNER_RECOVERY_JSON` through the existing authorised release procedure after setup or expiry; do not restart independently of the release owner. Configuration removal/rotation disables unused authority. A consumed hash or grant ID remains unusable even if configuration is restored. The existing `owner_recovery_ledger` remains append-only; never delete its rows or restore a database merely to reactivate a code.

An authorised administrator can record revocation of an unused grant in the existing ledger with event `revoked`. Do not delete passkeys or weaken login controls as cleanup. Roll back code/configuration through the recorded release procedure while preserving durable credentials, ledger and audit evidence. No grant, credential or hosted configuration is issued by publishing this source repair.

## Historical password recovery

A six-field grant without a purpose retains the earlier bounded password-reset implementation. It is not the hosted passkey customer-login flow and must not be used to claim access proof. Retired staging-access token hashes remain forbidden. A first-passkey grant returns HTTP 410 from the password-reset endpoint instead of misleading the user into changing an unusable password.

## Verification

Run `node --experimental-sqlite --test security/runtime/*.test.cjs` on the prescribed runtime. The suites include real signed WebAuthn registration and fresh authentication, authority preservation, cancellation/retry, wrong tenant/person/role, expired/revoked/rotated grants, policy/freeze changes, concurrent challenges, restart/replay, audit rollback, secret handling and shared UI behaviour. Local tests are not hosted proof. Retest the exact combined release and complete private browser/device enrolment before marking customer authentication proven.
