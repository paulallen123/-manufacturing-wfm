# Adapter contract

Each vendor adapter should stay thin. Shared protocol/authentication code belongs in the fabric, not duplicated per vendor.

An adapter is responsible for:
- endpoint discovery and API version;
- authentication metadata (never stored in source);
- vendor pagination/rate-limit handling;
- vendor object -> canonical WFM mapping;
- canonical WFM -> vendor mapping only where a write use case is explicitly enabled;
- idempotency keys and replay safety;
- health/readiness checks;
- redaction-safe diagnostics;
- evidence metadata identifying sandbox/tenant/proof level.

Default behavior is read-only. Write operations require an explicit capability and test fixture/tenant authorization.
