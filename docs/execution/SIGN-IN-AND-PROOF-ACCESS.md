# Google, Apple and scoped proof access

This increment adds provider authorization-code sign-in to the existing VECTOR session and tenant controls. It is disabled without approved provider configuration and explicit subject bindings. Local synthetic tests are not provider or customer acceptance. The previously admitted 5d8b3f11 image does not contain these changes.

## Human sign-in

Preserve passkeys. Provider buttons appear only when the server reports that provider configured. Provider email/name claims cannot create, link or promote a local user. Each approved provider subject maps to exactly one existing local user and tenant. Local role, freeze, session epoch and policy version remain authoritative. A provider change or mapping removal invalidates its sessions after configuration rollout. Existing authentication is required to establish a new identity binding through the administrative secret/configuration process; no unauthenticated self-linking endpoint is exposed.

Configure through approved Railway secret storage, never chat or Git:

- Google: `WFM_GOOGLE_CLIENT_ID`, `WFM_GOOGLE_CLIENT_SECRET` from an approved Web application registration and consent screen.
- Apple: `WFM_APPLE_CLIENT_ID` (Services ID), `WFM_APPLE_CLIENT_SECRET` (unexpired ES256 developer JWT). The signing private key stays in the approved developer/secret facility. Track expiry and rotate the JWT through that facility. Do not buy or enroll in a new developer subscription without the owner's spending approval.
- Both: canonical HTTPS `WFM_PUBLIC_ORIGIN`, existing `WFM_DB`, and `WFM_FEDERATED_IDENTITIES_JSON`: an array of `{provider,subject,email,tenant}`. Subject is the provider's verified stable identifier, not a guessed email. The existing local user and tenant control row must already exist. This does not provision a new user or tenant.

Register exact callback URLs (proposed configuration, not verified live routes):

`https://vector-customer-ready-candidate-production.up.railway.app/api/auth/federated/google/callback`

`https://vector-customer-ready-candidate-production.up.railway.app/api/auth/federated/apple/callback`

Apple uses form_post, so its short-lived browser-state cookie is Secure/HttpOnly/SameSite=None. State, nonce, browser binding and one-use database state protect callback issuance. Google uses code + PKCE. Fixed provider endpoints, bounded network reads and signature/issuer/audience/expiry checks precede an atomic local-session commit. Authorization code, access token, ID token and provider secret must never be logged. No provider refresh token is retained.

Official configuration references: https://developers.google.com/identity/openid-connect/openid-connect and https://developer.apple.com/help/account/identifiers/register-a-services-id .

## Assistant verification access

Reuse existing `vector-live-browser-proof` service `f84fe27d-af17-451c-b164-54dfef6b6a4b`; do not create a second controller. Its approved Ed25519 signer stays on that service. Human Apple/Google credentials are not shared with agents. The existing signed proof client issues single-use 45-second assertions and requires explicit actors, server allowlist, exact built source, deployment, tenant, implementation run and configuration digest. It emits PARTIAL auth/navigation proof and does not claim the business journey passed.

Run `node scripts/proof-access-preflight.cjs` inside the existing protected runner to validate configuration without printing values or issuing sessions. It reports missing or invalid variable names only. Required bindings:

`VECTOR_PROOF_AUTH_PROFILE=signed`, `VECTOR_PROOF_URL`, `WFM_EXPECTED_CANDIDATE_SHA`, `EXPECTED_DEPLOYMENT_ID`, `EXPECTED_IMPLEMENTATION_TENANT`, `EXPECTED_IMPLEMENTATION_RUN_ID`, `EXPECTED_CONFIGURATION_DIGEST`, `VECTOR_PROOF_ACTORS_JSON`, `PROOF_PRIVATE_KEY_B64`.

The actor map requires manager, employee, payroll, company-admin and a separate-tenant isolation-manager. Use only already approved identities and server allowlist entries. Do not infer those identities from example fixtures or widen permissions merely to make proof pass. Preflight success does not establish server authorization or the correctness of the configured values. The existing client performs that readback before navigation.

Revocation: disable proof auth or remove the relevant allowlist identity through existing controls, revoke sessions/advance tenant session epoch as appropriate, and verify denial. The signer is not unrestricted production access. Provider/customer mutations still require specific action authority and independent readback.

## Admission and rollback

Before activation require independent review, focused protocol/session/tenant negatives, existing passkey regressions, composition and immutable-image build, then real Google/Apple callback and phone browser proof. Keep provider buttons disabled until registrations and account bindings are approved. Rollback disables provider configuration and revokes resulting sessions; additive audit/state tables remain. Application rollback alone does not revoke sessions or undo external actions. No customer deployment or recovery-code creation is authorized merely by this document.
