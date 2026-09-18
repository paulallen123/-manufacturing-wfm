# Integration security boundary

The integration fabric is intentionally safer than a generic "connect to anything" proxy.

- **No arbitrary URL probing.** Public probes may only use URLs already committed to the reviewed registry.
- **No credentials in Git.** OAuth secrets, API keys, passwords, client certificates and tenant tokens belong at the executor boundary.
- **Read-only first.** `writeEnabled` is false across the registry. Writes are enabled per connector only after sandbox evidence, idempotency/replay controls and customer authorisation.
- **Plant-network separation.** OPC UA, MQTT, BACnet and Modbus should normally terminate at a customer/site edge gateway. The cloud service should not scan production VLANs.
- **Data minimisation.** Canonical mapping should ingest only fields needed for workforce, production, cost, compliance and decision workflows.
- **Replay/idempotency.** Webhooks, files and event streams require a source event ID or deterministic dedupe key.
- **Rate limits.** Each vendor adapter must honour vendor-specific throttling and Retry-After semantics.
- **Version drift.** API versions and schema fingerprints are evidence inputs; a changed contract degrades the connector until compatibility is re-proven.
- **Tenant isolation.** Connection configuration and tokens are scoped to one customer tenant/site boundary and never reused between customers.
- **Diagnostic redaction.** Logs may include connector ID, status, latency and correlation IDs, but not reusable credentials or raw sensitive payloads.
