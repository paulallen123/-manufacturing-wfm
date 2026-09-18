# Manufacturing WFM Integration Fabric

This directory is a **separate integration laboratory** for the Manufacturing WFM platform. It intentionally does not alter the sealed customer-proof runtime until an adapter has earned enough evidence to be promoted.

## Goal

Make the product easy to connect to the systems manufacturers already own: ERP, HCM/payroll, MES/MOM, WMS, EAM/CMMS, access control, identity, SCADA/IIoT, energy/BMS, QMS/PLM, logistics and iPaaS/middleware.

The strategy is **protocol-first, vendor-thin**. Instead of maintaining hundreds of fully bespoke stacks, the fabric standardises transport/authentication and keeps vendor adapters focused on authentication, discovery and mapping.

Core families: REST/OpenAPI, OData, SOAP, GraphQL, SCIM, webhooks, SFTP/files, JDBC/ODBC, OPC UA, MQTT, BACnet, Modbus, EDI/AS2 and Kafka.

## Evidence levels

1. `discovery-queued` – product identified; claims are not made.
2. `spec-verified` – current public vendor documentation confirms an integration surface.
3. `public-surface-probed` – an external runner can reach the vendor public surface/auth boundary.
4. `sandbox-authenticated` – vendor sandbox credentials have authenticated.
5. `tenant-authenticated` – an authorised real tenant has authenticated.
6. `read-roundtrip-proven` – representative customer data can be read and normalised.
7. `write-roundtrip-proven` – controlled write + read-back succeeds.
8. `production-certified` – operational/security/reliability gates are complete.

A schema/mock/fixture result must never be reported as a real provider connection.

## iPaaS compatibility

`openapi.yaml` is the vendor-neutral northbound contract. It is deliberately OpenAPI 3.0.3 for broad compatibility with integration platforms. The same canonical model can be exposed through webhooks/event streaming and translated by MuleSoft, Boomi, Workato, SAP Integration Suite, Oracle Integration Cloud, Azure Logic Apps/Power Automate and similar platforms.

## Tests

`scripts/validate.mjs` validates the registry and integration contract without external dependencies.

`scripts/probe-public.mjs` performs low-volume, read-only HTTPS reachability checks only against URLs already allow-listed in `systems.json`. It does not send credentials and cannot turn an arbitrary input URL into an SSRF probe.

The GitHub Actions gate runs validation on changes and on a schedule. Public vendor availability is evidence, not a release gate, so remote outages are recorded rather than treated as WFM defects.

## Promotion rule

No adapter is promoted into the sealed WFM runtime simply because it exists here. Promotion requires explicit evidence appropriate to its maturity level, security review, tenant isolation and regression coverage.
