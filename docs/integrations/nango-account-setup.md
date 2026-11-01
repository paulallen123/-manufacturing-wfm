# VECTOR Nango setup

## Current status

The existing Nango account is on **Free, $0/month**. The production environment has the four integration definitions below. A fresh dashboard read on 1 November 2026 confirmed **zero authorised provider connections** across all four definitions; no live sync has been verified. On 1 November 2026, the approved restricted key was stored in the existing VECTOR customer service's Railway configuration and its presence was verified. The source proposal remains unmerged, and no deployment was triggered. A definition or stored backend key is not evidence that a customer account is connected or that VECTOR has synchronised records.

| Provider | Production integration ID | Saved definition | Remaining provider setup |
| --- | --- | --- | --- |
| NetSuite OAuth | `netsuite` | Created; `rest_webservices` scope | NetSuite OAuth client credentials, account ID and authorised account consent |
| SAP S/4HANA Cloud | `sap-odata-oauth2-cc` | Created | SAP tenant API configuration and client credentials for the intended service |
| SAP SuccessFactors | `sap-success-factors` | Created | SuccessFactors API server, company identity and the required authorised credentials |
| Gusto | `gusto` | Created | Gusto OAuth application configuration and an authorised payroll company |

Dashboard: <https://app.nango.dev/prod/integrations>

The existing direct Gusto and Staffology implementation remains the payroll integration path. This change does not migrate payroll execution to Nango or introduce a SAP S/4HANA business-data adapter. The new runtime seam supplies credentials to the existing NetSuite and SuccessFactors metadata broker only. Metadata observations do not activate a connection or authorise payroll changes.

## Existing Gusto access observed — 1 November 2026

A read-only check of the already connected Gusto app returned the company **Vector** (`49d3bf95-5b5b-4251-89d8-1b614e47e676`). Gusto reported the company as **Not Approved**, with the next required onboarding question asking who the business will pay. No onboarding answers, plan choices, payroll inputs or payment instructions were submitted.

This confirms access through the ChatGPT Gusto connector only. It does not create a Nango connection, transfer the connector token to VECTOR, verify the existing backend's Gusto credentials, or establish payroll readiness. The Nango Gusto definition still requires its own authorised connection and application configuration if that route is used.

## Cost boundary

Nango's Free plan is hard-capped at **10 connections, 10 compute hours per month and 10 GB of data transfer per month**. Usage observed on 31 October 2026 was 0 connections, 0 compute hours and 0 GB. No plan upgrade, payment method or new hosting service was added during this setup.

These limits cover Nango. They do not supply NetSuite, SAP or payroll-provider accounts, licences or production API approval, and they do not change the cost of VECTOR's existing hosting. Exceeding the useful capacity of the free tier requires an explicit product decision; this implementation does not upgrade the plan.

Pricing reference: <https://nango.dev/pricing>

## Restricted backend permission approved; key stored

The user explicitly approved the restricted credential-reading permission and storage in VECTOR's backend. The key **VECTOR production connector access** was created in `prod`. Read-back verified one stored scope, **Connections → `read:with_credentials`**, with ordinary connection read implied. All other permission groups remained unselected. Its last-used status was **Never** at the creation verification on 1 November 2026, before the backend transfer.

The created key has this single scope for the implemented credential resolver:

```text
environment:connections:read_credentials
```

This scope can retrieve connection credentials for a known connection ID in that environment. It is not a per-customer permission enforced by Nango. VECTOR therefore separately requires an exact trusted tenant/profile binding, response identity, ownership tags and provider configuration before returning an access token. The key is stored as the existing VECTOR backend's server-side `WFM_NANGO_API_KEY` variable. It must not be placed in source control, browser code, screenshots, issue text or chat.

The resolver requests the access token without the refresh token and preserves the existing direct provider transport, DNS/origin checks, collection permits and activation controls. It does not require the default full-access key, connection-list scope, connection-write scope or account-level permissions.

### Backend storage receipt — 1 November 2026

After the user explicitly approved restricted temporary staging for the transfer, the Railway connector saved only `WFM_NANGO_API_KEY` to the existing destination:

| Destination | Verified identity |
| --- | --- |
| Project | `43367a88-2233-4c6b-9018-0ce234dd73ca` |
| Environment | `production` / `eed9f097-610a-416e-83b9-6bc7bdb3eeef` |
| Service | `vector-customer-ready-candidate` / `cded4ff7-24b1-4aaa-a7e2-67f143583bc2` |

The write used `skipDeploys=true` and `staged=false`; the successful receipt listed only that variable. Fresh read-back reported `exists=true`, `valuesRedacted=true`, and `sealed=false`. This confirms stored service configuration, not a sealed variable or use by a running process. `WFM_NANGO_METADATA_BINDINGS_JSON` remains absent.

The main-side temporary file and directory were deleted in the cleanup `finally` block. The synchronised browser-side copy was separately deleted afterwards. Both directories were independently verified absent, and the browser clipboard was verified empty. No secret was displayed, logged or committed to the repository. The [non-secret installation receipt](../../evidence/vector-nango-setup-20261031/backend-installation-receipt.json), recorded at **2026-11-01 00:30:13 UTC**, retains the write, read-back and cleanup facts.

No deployment was triggered. The historical latest recorded customer-service deployment attempt remained `d9112b19-7e46-4eab-8873-9a51826870b6`, **FAILED**, from 23 October 2026; this write did not cause a new failure or change that deployment. The existing proof-service staged patch was unchanged. The Nango source proposal remains unmerged and awaits canonical admission; storing the key has not enabled live connections or sync.

### Resolved transfer history

Automatic approval review initially rejected browser-clipboard transfer into a shared local file because the approval then covered backend storage but not temporary local staging. A direct Railway variable-editor alternative then stopped at browser sign-in: the selected GitHub account did not support password sign-in, and the secure alternative-method prompt was declined. These are historical events, not the current transfer blocker. The user's subsequent explicit approval covered the restricted temporary transfer, which completed through the Railway connector and was verified as recorded above.

Permission references:

- <https://nango.dev/docs/reference/backend/http-api/api-keys>
- <https://nango.dev/docs/reference/backend/http-api/connections/get>

## Activation sequence

1. Review and integrate the bounded code change through the existing canonical VECTOR release path. It stays disabled when `WFM_NANGO_METADATA_BINDINGS_JSON` is absent or empty.
2. Configure and authorise each real provider account through Nango. Use a provider administrator and the required account permissions; the Nango dashboard login alone does not grant them.
3. Add trusted connection tags `vector_tenant_id` and `vector_profile_id`. Prepare exact server-side metadata profile bindings and provider identity configuration. No example or placeholder binding is a live connection.
4. Activate the admitted code and complete bindings through the existing canonical release and deployment controls. Key storage is complete; the metadata bindings are still absent, and this transfer did not deploy the proposal.
5. Verify with a read-only metadata request using the real authorised account. Check the intended tenant, account, expiry and collection permit before making any live-connection claim.
6. Enable downstream business-data or payroll flows only through their existing VECTOR activation and approval controls.

Until those steps are complete, the truthful status is **definitions created; restricted key stored and presence verified; runtime support prepared but unmerged; no live provider connection verified**. Local tests use synthetic tokens and the actual sealed metadata broker; they do not prove production API access.
