# VECTOR Nango setup

## Current status

The existing Nango account is on **Free, $0/month**. The production environment has the four integration definitions below. The dashboard showed **zero authorised connections** when verified on 31 October 2026. A definition makes the provider available for setup; it is not evidence that a customer account is connected or that VECTOR has synchronised any records.

| Provider | Production integration ID | Saved definition | Remaining provider setup |
| --- | --- | --- | --- |
| NetSuite OAuth | `netsuite` | Created; `rest_webservices` scope | NetSuite OAuth client credentials, account ID and authorised account consent |
| SAP S/4HANA Cloud | `sap-odata-oauth2-cc` | Created | SAP tenant API configuration and client credentials for the intended service |
| SAP SuccessFactors | `sap-success-factors` | Created | SuccessFactors API server, company identity and the required authorised credentials |
| Gusto | `gusto` | Created | Gusto OAuth application configuration and an authorised payroll company |

Dashboard: <https://app.nango.dev/prod/integrations>

The existing direct Gusto and Staffology implementation remains the payroll integration path. This change does not migrate payroll execution to Nango or introduce a SAP S/4HANA business-data adapter. The new runtime seam supplies credentials to the existing NetSuite and SuccessFactors metadata broker only. Metadata observations do not activate a connection or authorise payroll changes.

## Cost boundary

Nango's Free plan is hard-capped at **10 connections, 10 compute hours per month and 10 GB of data transfer per month**. Observed usage was 0 connections, 0 compute hours and 0 GB. No plan upgrade, payment method or new hosting service was added during this setup.

These limits cover Nango. They do not supply NetSuite, SAP or payroll-provider accounts, licences or production API approval, and they do not change the cost of VECTOR's existing hosting. Exceeding the useful capacity of the free tier requires an explicit product decision; this implementation does not upgrade the plan.

Pricing reference: <https://nango.dev/pricing>

## Restricted backend permission approved; key created

The user explicitly approved the restricted credential-reading permission and storage in VECTOR's backend. The key **VECTOR production connector access** has now been created in `prod`. Read-back verified one stored scope, **Connections → `read:with_credentials`**, with ordinary connection read implied. All other permission groups remain unselected. The key's last-used status was **Never** when verified on 1 November 2026.

The created key has this single scope for the implemented credential resolver:

```text
environment:connections:read_credentials
```

This scope can retrieve connection credentials for a known connection ID in that environment. It is not a per-customer permission enforced by Nango. VECTOR therefore separately requires an exact trusted tenant/profile binding, response identity, ownership tags and provider configuration before returning an access token. The key should be stored only as the existing VECTOR backend's protected `WFM_NANGO_API_KEY` environment variable. It must not be placed in source control, browser code, screenshots, issue text or chat.

The resolver requests the access token without the refresh token and preserves the existing direct provider transport, DNS/origin checks, collection permits and activation controls. It does not require the default full-access key, connection-list scope, connection-write scope or account-level permissions.

**Backend installation remains incomplete.** Automatic approval review rejected reading the key from the browser clipboard into a shared local transfer file. The reason was that approval covered protected backend storage, not local staging of the secret. That rejected path was not retried. A direct transfer into Railway's protected variable editor was attempted instead, but the browser required sign-in: GitHub reported that the selected account does not support password sign-in, and the subsequent secure alternative-method prompt was declined. No key was installed and no Railway deployment was triggered. The original scope/storage approval remains valid; another approval for the same permission is not required.

Permission references:

- <https://nango.dev/docs/reference/backend/http-api/api-keys>
- <https://nango.dev/docs/reference/backend/http-api/connections/get>

## Activation sequence

1. Review and integrate the bounded code change through the existing canonical VECTOR release path. It stays disabled when `WFM_NANGO_METADATA_BINDINGS_JSON` is absent or empty.
2. Complete the approved key's direct transfer into `WFM_NANGO_API_KEY` on the existing VECTOR customer service, using the protected Railway variable editor or another approved secret-entry mechanism. Do not stage the secret in a shared local file. The user has already approved the scope and destination; key creation is complete.
3. Configure and authorise each real provider account through Nango. Use a provider administrator and the required account permissions; the Nango dashboard login alone does not grant them.
4. Add trusted connection tags `vector_tenant_id` and `vector_profile_id`. Populate exact server-side metadata profile bindings and provider identity configuration. No example or placeholder binding is a live connection.
5. Verify with a read-only metadata request using the real authorised account. Check the intended tenant, account, expiry and collection permit before making any live-connection claim.
6. Enable downstream business-data or payroll flows only through their existing VECTOR activation and approval controls.

Until those steps are complete, the truthful status is **definitions created; runtime support prepared; no live provider connection verified**. Local tests use synthetic tokens and the actual sealed metadata broker; they do not prove production API access.
