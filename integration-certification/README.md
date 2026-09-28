# Integration Certification

This directory contains the executable customer-free provider-proof lane.

## Run

Bind the exact VECTOR candidate under test:

```bash
export VECTOR_CANDIDATE_SHA=<exact-sha>
```

Then provide only the sandbox/dev credentials required by the selected plan and run:

```bash
node integration-certification/run-plan.mjs integration-certification/plans/<plan>.json
```

Evidence is written to `integration-certification/evidence/`. Do not commit credentials or raw sensitive provider payloads.

## Current runnable plans

- `sap-s4-business-partner-read.json` — official SAP sandbox L1 contract proof; requires `SAP_API_KEY`.
- `gusto-demo-company-read.json` — genuine Gusto demo environment L1 read proof; requires `GUSTO_ACCESS_TOKEN` and `GUSTO_COMPANY_ID`.

The runner rejects non-allowlisted hosts and production-looking endpoints. L2/L3 requires explicit write/read-back/recovery plans in a provider-owned demo/development tenant.

## Account gates

Account/login/verification steps are intentionally not automated through source control. Complete vendor identity/terms/verification in the vendor portal, then place credentials only in the isolated execution environment secret store.

- SAP: create/log in to SAP ID, obtain the API key from the Business Accelerator Hub.
- Workday: join the Workday Developer Program and provision a personal development tenant/API client.
- Gusto: create a developer organisation/application and demo company.
- Xero: create a free account, enable demo company, register OAuth2 app.
- NetSuite: obtain an SDN development/testing account; Oracle documents this as the route for ISVs.

No paid product subscription is required by this framework itself, and it must not auto-enrol in paid services.
