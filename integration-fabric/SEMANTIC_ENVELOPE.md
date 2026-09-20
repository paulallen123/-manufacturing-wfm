# Cross-domain semantic envelope

`runtime/semantic-envelope.mjs` is the reusable metadata boundary for joining workforce, production, maintenance, quality, energy, inventory and finance data without losing source meaning.

The envelope is intentionally transport- and provider-neutral. Vendor adapters keep their native payloads and mappings, while cross-domain records preserve the metadata needed to decide whether two values are actually comparable.

## Required principles

- Preserve provider/source system and source record identity.
- Preserve the original source timestamp string and declared source timezone instead of rewriting local time semantics.
- Record ingestion time separately so delayed, recovered or stale data can be diagnosed.
- Preserve effective-from/effective-to intervals independently of observation/ingestion time.
- Preserve source authority and confidence. Operational evidence must not silently become payroll, finance or legal authority.
- Preserve schema version/fingerprint and lineage so custom-field/schema changes can be traced.
- Keep local extensions instead of forcing every regional/customer field into a global enum.
- Never silently convert incompatible units or currencies.

## Units and currencies

When source and canonical units differ, the envelope requires an explicit reviewed conversion method and factor. When source and canonical currencies differ, it requires a positive FX rate, rate date/time, conversion method and rate source. This keeps finance attribution auditable and prevents stale or implicit conversions.

## Time, regions and recovery

The envelope stores the source-observed timestamp exactly as supplied, its timezone/locale context, ingestion time and optional stale threshold. Late recovery can therefore repair historical state without masquerading as a live event. This is important for plant/network outages, delayed SaaS processing, offline/mobile sync and cross-region reconciliation.

## Causal/outcome readiness

Where a record relates to a WFM recommendation or action, the envelope can preserve recommendation/action IDs and timestamps, baseline and outcome windows, and competing changes. This supports later outcome analysis without asserting that correlation proves causation.

## Scale

The envelope is per-record metadata with no tenant-size assumption. A one-source micro manufacturer and a multi-region enterprise use the same semantic contract; scale is handled by ingestion/batching/indexing rather than a different schema fork.
