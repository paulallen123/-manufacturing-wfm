# VECTOR passwordless proof runner

This branch adds a staging-only non-human authentication path for development and customer-proof automation.

- Ed25519 signed assertions only.
- No staging password is required by proof clients.
- Short-lived normal `wfm_session` sessions are minted after verification.
- Actor tenant and role are resolved from the existing user record, never accepted from the caller.
- Assertions are origin-bound, short lived and single use.
- Proof sessions are marked and resource-bound to issuer `wfm-proof-runner`.
- Browser proof receives only the short-lived session cookie; signing material is removed from the browser process environment.
- Activation is refused outside hosted staging.
- Customer passkey/SSO proof remains a separate release gate.

The sealed legacy runtime still checks for its historic staging credential during startup. While proof-runner auth is enabled, the bootstrap shim creates an internal random compatibility value so operators and proof automation never create, retrieve, store or type that credential.
