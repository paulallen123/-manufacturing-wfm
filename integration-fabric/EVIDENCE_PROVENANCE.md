# Integration evidence provenance

The Manufacturing WFM integration fabric separates **product discovery** from **integration-interface verification**.

A vendor product page, analyst page, marketplace listing, search result, generated SDK, inferred OpenAPI description or third-party API directory can identify a useful manufacturing system or capability. None of those sources alone is enough to promote a connector to `spec-verified` unless the technical integration surface is confirmed by a provider-owned specification/documentation source or by an authorised sandbox/tenant observation.

## Promotion rule

`spec-verified` and every higher evidence level require at least one source that both:

1. is provider-owned/provider-published or comes from an authorised observation; and
2. confirms the actual technical integration surface being claimed (for example protocol/API family, supported endpoint contract, authentication boundary or equivalent integration mechanism).

Marketing statements such as “integrates with ERP/HRIS/IoT” can support customer-value discovery and prioritisation, but they do not establish REST, GraphQL, webhook, file, database, iPaaS or other protocol support.

Third-party generated or inferred specifications are discovery leads only. If their own metadata says that an OpenAPI file was generated from documentation, inferred, reconstructed or otherwise not published by the provider, the fabric must keep the system at `discovery-queued` until authoritative technical evidence is obtained.

## Safe fallback

When a system is commercially relevant but the public technical contract is unresolved:

- catalogue the system and its customer-value hypotheses;
- leave `protocols` empty rather than guessing an adapter;
- keep `writeEnabled:false`;
- record the missing technical/authentication/tenant/version evidence explicitly;
- set the next action to obtain provider technical documentation or an authorised sandbox/tenant integration pack;
- reuse an existing protocol profile only after the evidence actually matches it.

The reusable `runtime/evidence-provenance.mjs` guard provides a machine-testable boundary for new evidence reviews. It supplements, and never weakens, the existing maturity, security and release gates.
