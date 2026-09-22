# Northstar Provider Test-Double Contract

Hosted lab: `https://vector-proof-plane-9bosun.v2.appdeploy.ai/`

Northstar exposes provider-shaped synthetic endpoints so VECTOR connectors can be configured against a deterministic test double.

## Synthetic authentication

These token endpoints return a short-lived **synthetic test token**. It is not a provider credential and has no customer/production authority.

- NetSuite: `POST /provider/netsuite/oauth2/v1/token`
- SAP: `POST /provider/sap/oauth/token`
- Workday: `POST /provider/workday/oauth2/token`
- ADP: `POST /provider/adp/auth/oauth/v2/token`
- MuleSoft: `POST /provider/mulesoft/oauth/token`

Returned bearer token is intentionally test-only.

## Provider-shaped data endpoints

### Oracle NetSuite
`POST /provider/netsuite/services/rest/query/v1/suiteql`

Models:
- SuiteQL POST request shape;
- `Prefer: transient`;
- limit/offset continuation;
- stable ordering expectation;
- token expiry;
- throttling/concurrency pressure;
- query/schema drift.

### SAP S/4HANA
`GET /provider/sap/Workforce`

Models:
- OData collection;
- `@odata.nextLink`;
- `$skiptoken`;
- `$top`;
- authentication failure;
- gateway pressure;
- entity metadata/schema drift.

### Workday
`GET /provider/workday/workers`

Models:
- `data[]` + `total`;
- limit/offset paging;
- WID-like identifiers;
- Reference_ID-like identifiers;
- malformed continuation request;
- auth/schema errors.

### ADP Workforce Now
`GET /provider/adp/hr/v2/workers`

Models:
- `$top` / `$skip`;
- documented page-size ceiling;
- 204 terminal page;
- `Prefer: respond-async`;
- 202 + Link + Retry-After;
- worker-status / primary-assignment style payload.

### MuleSoft Anypoint Gateway
`POST /provider/mulesoft/northstar/workers`

Models:
- gateway/proxy behaviour;
- request transformation;
- source-digest preservation;
- throttling;
- transformation failure;
- upstream VECTOR failure.

### Legacy SFTP Payroll
`GET /provider/sftp/inbox`

HTTP is used only as a control/test facade for the hosted Lab. The payload models:
- file names;
- manifest/checksum;
- sequence;
- atomic rename;
- partial upload;
- duplicate batch;
- schema drift.

A future dedicated SFTP listener may replace the facade if needed for transport-level client testing.

## Fault injection

Where supported, add `?fault=<fault-id>`.

Examples:
- `token-expiry`
- `rate-limit`
- `schema-drift`
- `bad-next-page`
- `async`
- `transform-failure`
- `upstream-failure`
- `partial-batch`
- `duplicate`

## Evidence ladder

1. **PROTOCOL_EMULATED**
   Northstar's deterministic provider profile passes.

2. **HOSTED_TEST_DOUBLE_PROVEN**
   The deployed Northstar host proves its callable provider-shaped HTTP routes.

3. **VECTOR_TEST_TENANT_ROUNDTRIP**
   VECTOR authenticates to Northstar, ingests provider-shaped data, persists/reconciles it, and returns expected evidence in the dedicated fictional tenant.

4. **PROVIDER_SANDBOX_PROVEN**
   A genuine provider sandbox/non-production tenant is used successfully.

5. **CUSTOMER_TENANT_PROVEN**
   A customer-controlled non-production/production integration is independently accepted.

6. **PRODUCTION_CERTIFIED**
   Only after provider/customer/security/operational release criteria are actually satisfied.

No lower level may be described using a higher-level claim.

## Separation

Northstar remains a separate testing solution.

VECTOR does not depend on Northstar for production operation.

Northstar cannot:
- access customer tenants;
- hold real provider/customer credentials;
- publish customer schedules;
- release payroll;
- override VECTOR policy;
- promote itself as a certified provider implementation.
