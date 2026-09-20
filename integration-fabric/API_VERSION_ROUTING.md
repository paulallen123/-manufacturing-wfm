# API version routing

The integration fabric must negotiate API versions per resource instead of assigning one version to an entire provider. This is required when providers run overlapping API generations, regional variants, staggered migrations or incomplete replacements.

## Fail-closed rules

- Prefer the provider-recommended current route for the specific resource/capability.
- A fallback must be explicitly documented or tenant-proven by the provider; existence of an older endpoint is not sufficient.
- 401/403/407 never trigger version downgrade. Diagnose credentials, tenant scope and permissions.
- 429 and retryable 5xx errors retry the current version under bounded backoff; they never trigger downgrade.
- Capability-probe 404/405/410/501 may use a provider-declared fallback only when the fallback has the same canonical contract or an explicit compatibility mapper.
- Write/mutation routes never enter a read plan. Read-over-POST is accepted only when the RPC method's read semantics are separately proven.
- API version and pagination style are part of checkpoint identity. Switching version or paging contract invalidates the old checkpoint and requires overlap replay/reconciliation.
- Schema fingerprint, version and source route remain in provenance so historical replay is interpreted against the contract that produced the data.

## Small-to-enterprise behaviour

A small tenant can use one sequential route and one checkpoint without additional infrastructure. Large tenants may partition safe reads by object, site/entity and bounded time window, but provider concurrency/rate limits remain authoritative. Horizontal worker count must never increase request concurrency blindly.

## MRPeasy reference case

MRPeasy documents REST API v2 as an expanding API and recommends v2 for functionality that exists there while retaining v1 for missing functionality. v1 list endpoints commonly use `Range` plus `206 Partial Content`; v2 list endpoints use `limit`/`offset` with endpoint bounds. The fabric therefore selects version by resource, does not downgrade on authentication/rate-limit/outage errors, and uses version-specific checkpoint namespaces with reconciliation when switching versions.
