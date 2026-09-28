# Genuine provider sandbox certification through VECTOR

This proof lane closes the gap between the Integration Fabric's adapter contract and a real external provider.

It deliberately runs through:
1. the Integration Fabric connector registry;
2. the existing fail-closed `buildSafeConnectionTest` contract;
3. an exact allowlisted provider sandbox/demo host;
4. a managed secret reference resolved only at the executor boundary;
5. a bounded GET/HEAD request;
6. provider-specific assertions;
7. the existing `validateConnectionEvidence` gate;
8. evidence bound to an exact VECTOR candidate SHA.

## First executable provider paths

### SAP S/4HANA profile
Uses SAP Business Accelerator Hub's official sandbox host and a personalised SAP API key. The first probe is deliberately read-only. Passing it earns at most `sandbox-authenticated` evidence.

### Xero profile
Uses the Xero Accounting API against a connected organisation and refuses to proceed unless the Organisation response independently states `IsDemoCompany=true`. This prevents a real organisation from being used accidentally.

## What this does not prove

- customer production;
- production certification;
- a write round-trip;
- provider failure/recovery;
- a complete workforce semantic mapping;
- release authority.

Those remain separate gates. A platform/deployment success never upgrades this evidence.

## Required secrets

Do not put credentials in source, evidence or chat.

- SAP: `SAP_API_KEY`
- Xero demo: `XERO_ACCESS_TOKEN`, `XERO_TENANT_ID`
- Exact VECTOR candidate: `VECTOR_CANDIDATE_SHA`

Run:

```bash
node integration-fabric/scripts/certify-provider-sandbox.mjs sap-s4hana
node integration-fabric/scripts/certify-provider-sandbox.mjs xero
```

Evidence is written under `integration-fabric/evidence/provider/`.

## Next gates

After sandbox authentication, add provider-specific canonical WFM mapping and independent reconciliation. Stateful write/read-back is a separate sandbox-only contract and must never weaken the read-only connection proof.
