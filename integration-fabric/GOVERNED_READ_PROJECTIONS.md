# Governed Read Projections

Use provider-defined read projections such as BAQs, saved searches, reports, OData query views or customer-owned read views when they reduce authority and data volume versus a full transactional service.

A projection is not trusted merely because it is called a report or query. The fabric requires an exact immutable projection identifier, provider/customer evidence that execution is read-only, reviewed parameters and fields, source-scope dimensions, stable identifiers, schema fingerprinting, pagination/reconciliation semantics and explicit dataset-coverage semantics.

## Safety invariants

- Arbitrary query text, wildcard projection IDs and direct SQL are not runtime authority.
- Projection parameters and projected fields are allowlisted; unknown parameters or fields fail closed.
- Credential-like fields are excluded from generic projections.
- A projection cannot confer mutation, function/action or control-plane authority.
- Pagination gaps, duplicate pages and partial runs do not advance a completeness checkpoint.
- Missing rows never imply deletion unless the projection is explicitly an authoritative complete snapshot with proven scope, complete paging and completed reconciliation.
- Provider custom fields remain source-attributed extensions and pass through normal schema-drift controls.
- Checkpoints remain partitioned by provider, connection, projection/dataset and required tenant/company/site/version dimensions.

## Why this matters

For small manufacturers, one reviewed projection can provide a near-zero-configuration bootstrap without granting a broad ERP service identity. For large enterprises, separate projections can be delegated by company/site/domain, independently versioned, scaled and reconciled without forking the integration platform.

Epicor Kinetic BAQs are the first provider profile to exercise this capability. The same control is intentionally reusable for provider saved searches/custom reports, customer-managed database read views and other governed query surfaces once their read-only semantics are proven.