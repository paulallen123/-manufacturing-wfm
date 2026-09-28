# Schema negotiation and custom-field drift

Manufacturing integrations frequently change without a connector release: administrators add custom fields, local apps extend schemas, acquisitions create regional variants, and vendors evolve API versions. The integration fabric must preserve useful new fields without silently changing the meaning of existing mappings.

`runtime/schema-negotiation.mjs` provides a provider-neutral schema observation and drift boundary.

## Rules

- Build a deterministic fingerprint from provider/object type plus stable field identifiers and field contracts. Field order must not change the fingerprint.
- Preserve provider-native stable field identifiers and source names separately where the provider supplies both.
- Treat optional additive fields as additive schema growth. They may be preserved in the semantic envelope's `extensions` area without being promoted automatically into canonical meaning.
- Treat removed fields, required-field additions, type/cardinality/reference/unit/currency changes, renames and fields that become sensitive as review-required drift.
- Never silently reinterpret a field after review-required drift. Continue the last proven mapping where safe, quarantine affected fields/records where not safe, and raise connector diagnostics.
- Do not copy credential-like or explicitly sensitive fields into generic extensions/evidence.
- Keep custom/local fields attributable to their source schema fingerprint and provider record identity.
- Tenant size does not change the contract. A spreadsheet-sized tenant and a global multi-instance tenant use the same schema-fingerprint and drift semantics; batching/indexing handle scale.

## Metadata-driven providers

Providers with metadata APIs (for example Frappe/ERPNext v15+ DocType metadata, OData `$metadata`, GraphQL introspection where permitted, schema registries and OpenAPI) should populate the same schema observation model rather than create provider-specific drift logic.

Providers without metadata endpoints may build observations from provider-owned specifications, customer-approved sample exports or bounded read-only schema discovery. The evidence source must remain recorded separately from the runtime mapping.

## Recovery

After a breaking schema change, a successful remap produces a new accepted fingerprint and mapping version. Historical records retain their original fingerprint so replay/backfill can be interpreted against the schema that actually produced them rather than the newest tenant schema.
