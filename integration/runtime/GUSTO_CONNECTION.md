# Gusto company connection

Gusto connects through the existing autonomous integration hub and the existing VECTOR Integrations page. The hosted application completes a registered Gusto App Integrations OAuth flow, verifies the company token subject and company response, and retains encrypted credentials in the existing durable SQLite database.

Company authorization is recorded separately from workforce import and payroll validation. A successful company check leaves a new connection in `VALIDATING`; it does not create employees, import payroll, run payroll, or satisfy customer readiness evidence.

## Deployment configuration

Set these values on the existing VECTOR service through its secret configuration. Do not commit credentials or place them in browser code.

| Variable | Value |
| --- | --- |
| `WFM_GUSTO_CLIENT_ID` | Registered Gusto application client ID for the selected environment. |
| `WFM_GUSTO_CLIENT_SECRET` | Corresponding confidential client secret. |
| `WFM_GUSTO_TOKEN_ENCRYPTION_KEY_B64` | Exactly 32 cryptographically random bytes encoded as canonical Base64. Keep this key across deploys and restarts; replacing it prevents existing encrypted credentials from being opened. |
| `WFM_PUBLIC_ORIGIN` | The existing public HTTPS origin, without credentials, a path, query, or fragment. |
| `WFM_GUSTO_ENVIRONMENT` | `sandbox` or `production`. Defaults to `sandbox`; other values disable the connector. Use the environment matching the registered application and intended Gusto company. |
| `WFM_GUSTO_TENANT_COMPANIES_JSON` | Optional JSON object mapping VECTOR tenant IDs to expected Gusto company UUIDs. Only the signed-in tenant's UUID is returned to its administrator. Invalid mappings disable authorization. |

Register this exact callback URI in the corresponding Gusto application:

```text
<WFM_PUBLIC_ORIGIN>/api/integrations/autonomous/oauth/callback/gusto
```

Use the existing service, branch, database volume, tenant, and implementation run. A redeploy must identify the new source commit; prior build or payroll evidence does not become evidence for the new deployment.

Gusto App Integrations scopes are assigned through Gusto's application configuration. This connector requires `companies:read` for company verification. It reports `people.read`, `payroll.read`, and `time.read` only when Gusto actually reports `employees:read`, `payrolls:read`, and `time_sheet:read`, respectively. It does not request payroll write or payroll run operations. Connecting the Gusto ChatGPT app does not provide this hosted application's client credentials or complete its callback flow.

Official contracts: [OAuth](https://docs.gusto.com/app-integrations/docs/oauth2), [scopes](https://docs.gusto.com/app-integrations/docs/scopes), [token information](https://docs.gusto.com/app-integrations/reference/get-v1-token-info), [company information](https://docs.gusto.com/app-integrations/reference/get-v1-companies). API requests use the documented `2026-06-15` version.

## Administrator flow

1. Open **Settings & more → Integrations** in VECTOR and find Gusto.
2. If service configuration is incomplete, the card shows **Gusto setup required** and disables authorization.
3. Connect using the tenant's configured company selection, or enter the expected company UUID when no selection is configured. Approve the company in Gusto using the same browser session that started setup.
4. The callback verifies Gusto's actual company token and company response, then returns to VECTOR's Integrations page. The card displays the verified company, environment, and last check. **Check connection** performs another provider check and refreshes expiring credentials when needed.

Authorization state expires after ten minutes, is single use, and is bound to the tenant, connection, browser session, expected company, and environment. A mismatched session cannot consume the original session's state. Start and verification requests require the exact VECTOR origin and an administrator role. The callback also obeys the existing privileged-access freeze.

The public callback serves a minimal document that clears the authorization query from browser history and completes authorization with an authenticated same-origin POST. It does not persist credentials during the cross-site GET. This preserves VECTOR's existing `SameSite=Strict` session cookies. The landing page uses a fresh CSP nonce, permits only its own completion request, and disables caching and referrers.

Credentials are encrypted with AES-256-GCM. Authenticated encryption binds each token bundle to its tenant, connection, company, and environment. External requests use fixed Gusto hosts, reject redirects, enforce a ten-second deadline, and cap response size. A database refresh lease and credential version prevent concurrent refresh rotation from overwriting a newer token. Provider error bodies, authorization codes, and tokens are excluded from public responses and audit events.

An established connection cannot silently switch to another company or environment. Missing setup, provider rejection, token decryption failure, transient provider failure, and required reauthorization remain explicit states. Generic integration worker attestations cannot substitute for this Gusto verification flow.

## Verification

Run the focused behavior tests with Node 24:

```sh
node --test integration/runtime/autonomous-integration-hub.test.cjs integration/runtime/gusto-company-connector.test.cjs integration/runtime/gusto-integration-hub.test.cjs integration/runtime/gusto-oauth-landing.test.cjs integration/runtime/directory-oauth-broker.test.cjs security/runtime/identity-survival-guard.test.cjs ux-overlay/vector-gusto.test.cjs
node --check ux-overlay/vector-shell.js
```

These tests use real SQLite persistence and an HTTP fake at the external Gusto boundary. They verify local authorization, isolation, recovery, and response handling; they do not certify a live Gusto connection. The connector and its tests are included in the existing Docker runtime and build admission tests.
