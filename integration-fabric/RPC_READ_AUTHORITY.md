# RPC read authority and cross-call consistency

Some manufacturing/ERP APIs expose reads and mutations through the same HTTP verb and endpoint family. The transport verb is therefore not an authority boundary. Odoo JSON-2 is the reference case: every model method is invoked with HTTP `POST`, API access inherits the bot user's normal Odoo access rights/record rules/field access, and each JSON-2 call runs in its own SQL transaction.

`runtime/rpc-read-authority.mjs` adds a provider-neutral fail-closed boundary for these APIs.

## Rules

- Authorise exact **model + method** pairs, not HTTP verbs, wildcard models, endpoint families or successful authentication.
- Every allowed pair must be explicitly classified as a read operation. High-risk create/update/delete/action/control-plane method families are rejected even if someone attempts to place them in a read allowlist.
- Read-via-POST is valid only where the provider contract proves that the named method is read-only. POST never implies permission to mutate.
- Generic projections reject credential-like fields. Provider-specific sensitive business fields require their own reviewed mapping rather than flowing through generic extensions.
- If a provider commits each API call separately, multiple reads are **not** represented as one atomic snapshot. Preserve the first-start/last-finish observation window, skew, partial-read state and source provenance.
- Prefer provider methods that perform logically coupled reads in one transaction where available. If cross-resource atomicity cannot be obtained, use bounded observation windows plus overlap/reconciliation and expose freshness/consistency to downstream consumers.
- Authentication failure, throttling, schema drift or unavailable methods never expand the allowlist or trigger a fallback to broader credentials.

## Odoo reference case

Odoo 19 introduced External JSON-2 at `/json/2/<model>/<method>`. The provider recommends dedicated bot users; keys are bearer API keys, can be revoked, and are limited to a maximum lifetime of three months. The actual models/fields/methods are database-specific and should be discovered from the authorised database documentation/metadata before exact WFM read pairs are enabled.

Odoo documents that every JSON-2 request has its own SQL transaction. `search_read` is specifically useful because the search and read occur in one transaction; a separate `search` followed by `read` does not share that isolation guarantee. The WFM fabric therefore prefers single-call read methods where practical and records an observation window whenever multiple calls/resources are joined.

Legacy XML-RPC/JSON-RPC remains migration-only. It was deprecated in Odoo 19; provider documentation schedules the common/object services for removal in Odoo 22 and Online 21.1. New integrations must prefer JSON-2 when the customer version supports it.
