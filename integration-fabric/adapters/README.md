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

## Shared high-variance patterns

Vendor adapters should reuse these behaviours instead of implementing one-off versions:

- **Regional endpoint binding:** resolve the customer-approved region/environment once during connection setup and persist that choice with the tenant configuration. Never silently fail over between regional endpoints or data-residency boundaries.
- **Credential lifecycle:** cache short-lived access tokens within their safe lifetime, rotate API credentials before expiry, support overlap during rotation where the vendor permits it, and expose health warnings without logging reusable secrets.
- **Asynchronous export jobs:** model request -> job/run ID -> status polling -> paged retrieval as a resumable state machine. Persist the vendor job ID, use bounded polling/backoff, honour vendor idempotency/reuse windows, and resume safely after intermittent connectivity.
- **Pagination:** treat continuation links/tokens and vendor-specific page/size rules as opaque transport state. Bound page sizes/concurrency and preserve a deterministic checkpoint so partial runs can restart without duplicating canonical records.
- **Customer-configured schemas:** fingerprint report/custom-field schemas and mapping revisions. A renamed/removed field is schema drift and must not silently remap payroll, worker, qualification, cost or site semantics.
- **Webhook/event ingestion:** authenticate/signature-check where supported, persist source event IDs or deterministic dedupe keys, tolerate retries/out-of-order delivery, and use bounded replay windows.
- **Files/SFTP:** validate checksum/size/schema before canonical ingestion, quarantine partial or malformed deliveries, and make reprocessing idempotent.
- **Multi-site and multi-entity identity:** never rely on display names alone. Preserve source system ID + tenant/programme + legal entity/site context when forming canonical identity keys.
- **Write-capable vendor APIs:** a read connector must be protected by actual operation-level permission or a read facade when the credential can also mutate business or management-plane resources. Intent to issue only GET requests is not a security boundary.
