# Genuine provider sandbox certification through VECTOR

This isolated proof lane closes the gap between the Integration Fabric's adapter contract and genuine external provider environments. It does not modify release authority.

Every run passes through the connector registry, the existing fail-closed `buildSafeConnectionTest` contract, an exact allowlisted sandbox/demo host, managed-secret resolution at the executor boundary, a bounded GET/HEAD request, provider assertions, `validateConnectionEvidence`, and an exact VECTOR candidate SHA.

## Executable customer-free paths

- **SAP S/4HANA** — SAP Business Accelerator Hub sandbox; read-only OData service document; maximum claim `sandbox-authenticated`.
- **Xero** — Xero Accounting API; refuses to run unless the Organisation response says `IsDemoCompany=true`; maximum claim `sandbox-authenticated`.
- **Gusto Embedded Payroll** — dedicated `api.gusto-demo.com` environment and demo company; read-only company proof first; maximum claim `sandbox-authenticated`.

## Required secret inputs

Credentials must live in the execution environment secret store, never source/evidence/chat:

- `SAP_API_KEY`
- `XERO_ACCESS_TOKEN`, `XERO_TENANT_ID`
- `GUSTO_ACCESS_TOKEN`, `GUSTO_COMPANY_ID`
- `VECTOR_CANDIDATE_SHA`

Run:

```bash
node integration-fabric/scripts/certify-provider-sandbox.mjs sap-s4hana
node integration-fabric/scripts/certify-provider-sandbox.mjs xero
node integration-fabric/scripts/certify-provider-sandbox.mjs gusto-embedded-payroll
```

Passing this gate proves genuine vendor sandbox/demo authentication and bounded read through the VECTOR Integration Fabric only. It does **not** prove customer production, production certification, write round-trip, provider recovery, full semantic mapping, or release authority.

## Next evidence gates

1. Map representative source data into canonical WFM objects and reconcile it independently.
2. Add a separate sandbox-only synthetic write/read-back contract where the business case requires writes.
3. Inject safe credential expiry, timeout/retry, duplicate/idempotency and schema-drift scenarios without abusing provider services.
4. Only customer-authorised production evidence can later support a production/customer claim.
