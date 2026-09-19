# Manufacturing WFM Integration Fabric

This directory is a **separate integration laboratory** for the Manufacturing WFM platform. It intentionally does not alter the sealed customer-proof runtime until an adapter has earned enough evidence to be promoted.

## Goal

Make the product easy to connect to the systems manufacturers already own: ERP, HCM/payroll, MES/MOM, WMS, EAM/CMMS, access control, identity, SCADA/IIoT, energy/BMS, QMS/PLM, logistics and iPaaS/middleware.

The strategy is **protocol-first, vendor-thin**. Instead of maintaining hundreds of fully bespoke stacks, the fabric standardises transport/authentication and keeps vendor adapters focused on authentication, discovery and mapping.

Core families include REST/OpenAPI, OData, SOAP, GraphQL, SCIM, webhooks, SFTP/files, JDBC/ODBC, OPC UA, MQTT/Sparkplug B, BACnet, Modbus, EDI/AS2, Kafka, AMQP 1.0, JMS, Protocol Buffers RPC over HTTP/2 and Schema Registry. Legacy JSON-RPC/XML-RPC is modelled as a migration-only profile rather than a preferred new-build path.

## Catalogue model

`systems.json` remains the stable base seed catalogue. `systems-research.json` is the baseline reviewed research overlay. `research-overlays/*.json` contains deterministic, additive follow-on deltas for subsequent market/evidence reviews. `scripts/load-catalog.mjs` loads the baseline and then the follow-on overlays in lexical order into the effective catalogue used by validation, conformance, planning and public probing.

An overlay may patch an existing effective system, including a system introduced by an earlier overlay, only when current vendor documentation or a directly observed authorised connection materially changes what can be claimed. A new-system entry cannot duplicate an existing ID. No overlay may enable writes or promote evidence beyond what was actually observed.

The effective catalogue now covers 155 systems. The latest research deltas add Cognite Data Fusion as a newly verified industrial-data/IIoT target; upgrade HighByte Intelligence Hub and Tulip to `spec-verified`; and now promote SAP Fieldglass to `spec-verified` based on SAP's current 2026 REST API reference, OAuth 2.0 authentication model, connector resources and Identity (SCIM) integration surface. HighByte explicitly carries Sparkplug B as a reusable MQTT/IIoT route; Tulip's scoped REST APIs and shop-floor machine/station model are captured for worker, production and machine-state mapping; and Fieldglass now reuses the existing REST/SCIM/file profiles for contingent-workforce data instead of remaining a protocol blind spot. Celigo's newly documented hosted MCP capability is recorded as a potentially valuable autonomous-implementation management plane, but it is not treated as permission for unsupervised production mutations and is not yet promoted to a generic MCP transport profile. ADP WorkForce Suite remains discovery-level because product relevance is clear but product-specific public protocol documentation is still insufficient. Market relevance is not API certification.

## Evidence levels

1. `discovery-queued` – product identified; claims are not made.
2. `spec-verified` – current public vendor documentation confirms an integration surface.
3. `public-surface-probed` – an external runner can reach the vendor public surface/auth boundary.
4. `sandbox-authenticated` – vendor sandbox credentials have authenticated.
5. `tenant-authenticated` – an authorised real tenant has authenticated.
6. `read-roundtrip-proven` – representative customer data can be read and normalised.
7. `write-roundtrip-proven` – controlled write + read-back succeeds.
8. `production-certified` – operational/security/reliability gates are complete.

A schema/mock/fixture result must never be reported as a real provider connection. The ambiguous legacy label `external-connected` is rejected by conformance; authenticated connections must use the explicit maturity ladder and carry an `evidenceRef`.

## Data, automation and customer-value review

`opportunity-profiles.json` adds a second dimension to the catalogue. It does **not** upgrade connector evidence. Instead, it forces every catalogued system to be reviewed for the WFM value it could unlock: expected data, canonical WFM objects, least-privilege permissions, candidate automation, savings hypotheses, gaps, risks and the next safe development action.

Category profiles cover ERP/finance, people/WFM/payroll, production, maintenance, supply chain, quality/engineering, physical access, identity, industrial telemetry, energy, middleware/iPaaS and supporting platform systems. A system can inherit more than one profile; for example an ERP/MES product can contribute both finance/cost context and production demand. System-specific vendor-doc overrides are used where current official evidence supports a more precise data/value model.

This makes the coverage report commercially useful without overstating evidence. Category-derived fields are explicitly hypotheses until vendor-specific data objects are verified. Savings are opportunity hypotheses, not guaranteed outcomes. Examples include payroll leakage reduction, overtime/agency reduction, labour-to-order cost attribution, production/downtime recovery, maintenance staffing, warehouse peak planning, engineering-change qualification, access/attendance anomaly evidence and shift-level energy attribution.

`scripts/build-plan.mjs` writes the resulting system-by-system matrix to `integration-fabric/reports/coverage-matrix.json`. Each entry includes protocol route, authentication/evidence state, expected permissions/data, WFM objects, automation candidates, customer value, savings hypotheses, data gaps, risks and the next development action required to increase evidence maturity.

## iPaaS compatibility

`openapi.yaml` is the vendor-neutral northbound contract. It is deliberately OpenAPI 3.0.3 for broad compatibility with integration platforms. The same canonical model can be exposed through webhooks/event streaming and translated by MuleSoft, Boomi, Workato, SAP Integration Suite, Oracle Integration Cloud, Azure Logic Apps/Power Automate, Google Cloud Application Integration, Jitterbit Harmony and similar platforms.

Enterprise messaging is also treated as a first-class reuse path. Kafka, AMQP 1.0 and JMS can carry canonical events, but passive discovery must use non-destructive patterns and must not steal or acknowledge messages from an existing production consumer.

## Tests

`scripts/validate.mjs` validates the effective registry, all research overlays, opportunity coverage and integration contract without external dependencies.

`scripts/conformance.mjs` requires every P0 system to map to at least one reusable protocol/vendor profile, every catalogued system to map to a WFM data/value opportunity profile, forbids write-enabled probes, rejects ambiguous evidence labels and requires evidence references for tenant-authenticated or round-trip claims.

`scripts/probe-public.mjs` performs low-volume, read-only HTTPS reachability checks only against documentation/public URLs already allow-listed in the effective catalogue. It does not send credentials and cannot turn an arbitrary input URL into an SSRF probe. Public reachability never upgrades a system to sandbox, tenant or round-trip evidence.

The GitHub Actions gate runs validation on changes and on a schedule. Public vendor availability is evidence, not a release gate, so remote outages are recorded rather than treated as WFM defects.

## Promotion rule

No adapter is promoted into the sealed WFM runtime simply because it exists here. Promotion requires explicit evidence appropriate to its maturity level, security review, tenant isolation and regression coverage. A strong customer-value hypothesis can raise development priority, but it cannot bypass the evidence or safety ladder.
