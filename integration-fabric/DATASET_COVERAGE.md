# Dataset coverage and absence semantics

Manufacturing source APIs frequently expose partial views: incremental windows, sparse alerts, aggregates, webhook signals, paginated snapshots and customer-scoped projections. A missing source row is **not** automatically a deleted business object.

`runtime/dataset-coverage.mjs` provides a provider-neutral coverage contract so ingestion, reconciliation and the semantic layer preserve what a dataset can actually prove.

## Coverage kinds

- `complete-snapshot` — intended to enumerate the complete object universe for a proven source scope. Missing records may become tombstone candidates only after tenant/site scope, all pages and reconciliation are proven complete and the source is authoritative for object existence.
- `incremental-delta` — records changed inside a bounded cursor/time window. Absence means unchanged or outside the window; it never implies deletion. Use overlap replay, stable-ID dedupe and explicit tombstones/soft-delete evidence where the provider supports them.
- `sparse-projection` — only records meeting a condition are returned. Absence means the condition is not currently met; it never implies deletion.
- `aggregate-projection` — grouped/rolled-up measures. It is analytical evidence, not object-existence authority.
- `event-signal` — webhooks/queues/notifications. Missing events are never completeness proof. Event ingestion must reconcile to an authenticated read surface.

## Fail-closed rules

1. Missing-record deletion requires `complete-snapshot`, `authoritativeForExistence:true`, proven source scope, complete pagination and completed reconciliation.
2. A pagination gap, partial regional outage, permission/scope uncertainty or interrupted backfill blocks tombstone inference.
3. Incremental, sparse, aggregate and event datasets cannot delete canonical entities merely because an entity was not observed.
4. Coverage kind, absence meaning, entity universe, source scope and freshness remain in provenance so downstream product logic can distinguish truth from partial evidence.
5. Customer-specific mappings may enrich semantics but cannot widen a dataset's authority.
6. Horizontal scale does not change coverage semantics: one spreadsheet and a multi-region enterprise feed use the same completeness rules.

## Katana reference case

Katana's `/v1/inventory_signals` endpoint is intentionally sparse: it returns only variants with demand in the preceding 30 days and is summed across all locations. A missing `variant_id` means **no recent demand**, not a missing inventory item. It is therefore `sparse-projection` and can enrich replenishment/material-risk decisions but can never remove an inventory entity.

Katana `/v1/inventory` is the candidate full inventory listing, but WFM will not treat it as authoritative for deletions until an authorised tenant proves account/location scope, every `X-Pagination` page, archived/deleted semantics and reconciliation. Manufacturing-order syncs using `updated_at_*` filters are `incremental-delta`; soft-delete evidence must be read explicitly with `include_deleted` where supported.
