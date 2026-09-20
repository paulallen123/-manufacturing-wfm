# Owner-authorized staging access recovery

This additive recovery mechanism is **disabled by default**. It changes only the password for the existing synthetic account `superuser@northstar.example` in `northstar-demo`, with existing person `d1` and role `director`. It neither creates users nor grants roles/permissions, and does not issue a session. Subsequent sign-in uses the existing `/api/login` route and its protections.

The retired `/api/staging-access` grants and expiry remain unchanged. Their hashes are explicitly forbidden for recovery. Never reuse either old token.

## Deployment prerequisites

An authorized environment owner must:

1. Confirm the actual deployed candidate contains `owner-access-recovery.cjs` alongside `bootstrap.cjs`, and that `bootstrap.cjs` loads and routes it. Existing container builds must copy the entire security runtime directory or explicitly include the new file.
2. Preserve the existing durable SQLite database/volume. Confirm a single persistent writable database is shared by every service instance; independent ephemeral databases cannot enforce global one-time use. SQLite file locking enforces concurrent redemption on the same database.
3. Obtain the current `session_epoch` and `policy_version` for `northstar-demo` from the authorized security control plane or read-only database access. The existing identity guard creates this row on authenticated activity; recovery refuses when it is absent. Do not invent these values or create/change the row to force recovery. Recovery refuses a privileged freeze and does not clear any holds.
4. Generate a **fresh cryptographically random 32-byte token**, encoded as canonical base64url (43 characters), and a fresh random grant ID (16–80 URL-safe characters). Keep the plaintext token out of source, environment variables, logs, request URLs, PR descriptions, and tool transcripts. Deliver it through an approved secret-delivery channel. Do not ask an agent to type or read it through ordinary browser tools.
5. Set `WFM_OWNER_RECOVERY_JSON` through the authorized environment editor using this exact object shape, containing only the SHA-256 hex digest of the token:

```json
{"id":"NEW_RANDOM_GRANT_ID","tokenHash":"64_LOWERCASE_HEX_SHA256_DIGEST","issuedAt":0,"expiresAt":0,"sessionEpoch":1,"policyVersion":1}
```

Replace all placeholders and example numbers with actual values. Times are Unix milliseconds. `issuedAt` must not be in the future; `expiresAt` must be after issuance and no more than 30 minutes later. Epoch and policy must match the verified tenant control row. Keep `NODE_ENV=staging`, `WFM_HOSTED_STAGING=true`, `WFM_IDENTITY_SURVIVAL_GUARD` enabled, the existing `WFM_DB`, and the exact bare HTTPS `WFM_PUBLIC_ORIGIN`.

No plaintext token or password is configured in the application. Changing `WFM_STAGING_PASSWORD` does not reset existing accounts; this recovery intentionally updates the actual persisted password hash.

## User flow

Open `https://<verified-existing-host>/access-recovery`. The user privately enters the recovery code, new password (20–256 characters), and confirmation. Password changes require a manual user handoff under the browser skill: the user must complete the recovery form directly in their own browser. browserAuth does not support password changes and must not be used for this step. Ordinary agent secret input or inspection is forbidden. The subsequent normal login may use the approved browserAuth secure-entry workflow. The page sends a same-origin JSON POST; codes never appear in URLs or browser storage. On success, return to `/` and sign in as `superuser@northstar.example` with the newly chosen password.

The transaction durably consumes the grant, changes the password, revokes only this account's existing sessions/bindings, and appends an audit event. Any transaction/audit failure rolls everything back. Existing role, tenant, permissions, personnel links, business data, freezes, epochs, policy versions, protection records, and other accounts are unchanged. The browser's old session and retired restore cookies are cleared. A lost success response cannot reactivate the grant: try normal sign-in with the new password before requesting another code.

The endpoint requires the exact configured Host, `X-Forwarded-Proto: https`, and exact Origin for POST. It rejects query strings, cross-site fetch metadata, client identity-authority headers, malformed input, unsupported content types, expired or used grants, changed account identity, and changed/frozen tenant security context. It fails closed when configuration or database controls are unavailable.

## Revocation and limits

Remove `WFM_OWNER_RECOVERY_JSON` and restart/redeploy the service to disable unused grants, including the page. Replacing the config stops accepting the previous grant; an already consumed hash or grant ID remains unusable even if restored in configuration. An authorized database administrator can durably revoke an already provisioned unused grant by inserting its exact hash and ID into `owner_recovery_ledger` with `event='revoked'` and an ISO timestamp, once that additive table exists. No public HTTP revocation/admin route is exposed. Never delete the ledger or roll back the database to undo consumption.

No password, token, session, or external setting was created by this patch. Deployment, verified epoch/policy retrieval, secure token delivery, and user secure-entry still require actual authorized access. Existing redacted provider settings cannot be used to reconstruct credentials. This patch cannot by itself restore access when those channels are unavailable.

Deployment restarts the application. The existing login source-quarantine implementation stores live counters in process memory; its existing restart behavior is unchanged by this patch. Do not claim this patch makes those counters durable. Account recovery itself never calls a quarantine reset, bypasses login, removes protection records, or clears privileged freezes.

Run verification with `node --test security/runtime/*.test.cjs`. The recovery suite tests one-time/restart replay, independent-worker concurrency, targeted revocation and authority preservation, expiry, host/origin/transport and input rejection, durable grant revocation, and rollback on audit failure.
