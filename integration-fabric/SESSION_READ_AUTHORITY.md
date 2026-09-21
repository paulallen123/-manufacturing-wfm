# Session-scoped read authority

`runtime/session-read-authority.mjs` governs read-only integrations whose login response creates a session cookie and may also provide a load-balancer affinity cookie. It is provider-neutral; SAP Business One is the first documented profile.

`runtime/session-broker.mjs` supplies the in-memory execution boundary for those policies. Trusted scope, request, login and read executors are fixed when the broker is created; public callers cannot inject credential-receiving callbacks. Concurrent expiry shares one generation-fenced refresh, stale failures cannot replace a newer session, and each read gets at most one recovery attempt. Permission, throttle and server failures never trigger login. Failed refreshes remain closed for their generation until an explicit rotation, preventing a waiter cohort from causing sequential login storms.

## Trust boundary

- Session credentials remain inside the executor secret boundary. Cookie values are never accepted by or emitted from this policy object.
- Session identity is namespaced by WFM tenant, connection, exact HTTPS origin and port, API base/version, source company, principal reference and credential revision.
- Affinity cookies are routing hints only. They never prove identity, permission, source scope, page continuity or completeness.
- Data requests are restricted to exact allowlisted resources using `GET` or `HEAD`. Login/logout bootstrap, mutations, actions and SQL/query administration are outside steady-state authority.

## Continuations and recovery

Provider next links are untrusted input. The guard requires the exact origin, API base/version, entity and approved query contract; only the continuation cursor may change. It rejects fragments, credentials, duplicate cursors, non-positive page sizes, query drift, cursor regression and repeated canonical links. Page, byte and elapsed-time budgets are policy-configurable for both small and large tenants.

A 401 permits one bounded reauthentication attempt for the same scope. The uncommitted page chain is replayed from the last committed checkpoint with overlap reconciliation. A second 401 stops for credential diagnosis; 403 stops for permission diagnosis; 429 and retryable server/network failures back off without changing credentials or versions. Affinity loss replays the uncommitted page and cannot advance a checkpoint. Any session-scope change requires a new checkpoint namespace and reconciliation.

The broker also fences late login completion after a scope closes, rechecks scope/request authority before login and recovery, bounds active requests and stored scopes, refuses to evict active leases, redacts echoed session values from errors, and blocks session values from returned data and diagnostics.

## Composition

These guards complement regional route authority, source-scope checkpoints, API-version routing, schema negotiation, dataset coverage and batch reconciliation. The broker stores sessions only in process memory and invokes a trusted login executor; it does not persist credentials/checkpoints, coordinate generations between processes, establish a complete snapshot or grant deletion authority. Multi-process deployments may deliberately use independent provider sessions per worker, or require a separately proven distributed coordinator where the provider forbids that topology.
