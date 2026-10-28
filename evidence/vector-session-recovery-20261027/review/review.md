# Independent session recovery review

Reviewer: /root/session_recovery_review. Verdict: ACCEPT for the bounded source repair, not release or customer proof.

Reviewed changes: identity-survival-guard.cjs adds deletion of the host-scoped Path=/ wfm_session cookie only on its 401 responses. It preserves status, refusal, server-side containment and audit. Federated start continues refusing a presented cookie until the browser applies the logout rejection's explicit expiration; valid-session identity switching remains 409. No stale cookie becomes authority. SameSite does not define cookie identity, so Strict deletion also expires earlier Lax cookies of the same host/name/path. No new authentication method or permission is granted.

Actual independent Node22.23.2 run:52 tests,52 pass,0 fail,0 skipped. Includes original guard/auth/boundary tests and four independent heldouts. Heldouts exercise proof-session scope mismatch and revoked/missing passkey credential, verify 401 cookie deletion plus targeted DB revocation and other-tenant preservation; frozen403 and injected400 retain valid sessions and do not clear cookies; no-session public request remains untouched. Existing five stale federated logout regressions and active-session negative pass. Counts overlap the author's48 and must not be added as distinct total coverage.

Source SHA256:2e07ac5b5f2046a8ef4a5ca0a698f9940800a24e224a5119445bffa75db939d4.
Test SHA256:b817d57041b2e12aab94b1194fa6726ef4f1f78816e4a96545071cbad90b1d09.

Limitations: tests model browser cookie expiration from the actual Set-Cookie receipt; no hosted browser logout or real Google/Apple exchange was performed. Explicit logout recovery is repaired; direct federated start with stale cookie still deliberately returns409 until logout. No production/service/provider mutations by reviewer. Existing hosting/identity proof for7fa8 cannot be transferred to this unbuilt successor. Raw TAP and heldout source alongside this file.
