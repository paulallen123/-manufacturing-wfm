# Session-scoped read authority

`runtime/session-read-authority.mjs` governs read-only integrations whose login response creates a session cookie and may also provide a load-balancer affinity cookie. It is provider-neutral; SAP Business One is the first documented profile.

## Trust boundary

- Session credentials remain inside the executor secret boundary. Cookie values are never accepted by or emitted from this policy object.
- Session identity is namespaced by WFM tenant, connection, exact HTTPS origin and port, API base/version, source company, principal reference and credential revision.
- Affinity cookies are routing hints only. They never prove identity, permission, source scope, page continuity or completeness.
- Data requests are restricted to exact allowlisted resources using `GET` or `HEAD`. Login/logout bootstrap, mutations, actions and SQL/query administration are outside steady-state authority.

## Continuations and recovery

Provider next links are untrusted input. The guard requires the exact origin, API base/version, entity and approved query contract; only the continuation cursor may change. It rejects fragments, credentials, duplicate cursors, non-positive page sizes, query drift, cursor regression and repeated canonical links. Page, byte and elapsed-time budgets are policy-configurable for both small and large tenants.

A 401 permits one bounded reauthentication attempt for the same scope. The uncommitted page chain is replayed from the last committed checkpoint with overlap reconciliation. A second 401 stops for credential diagnosis; 403 stops for permission diagnosis; 429 and retryable server/network failures back off without changing credentials or versions. Affinity loss replays the uncommitted page and cannot advance a checkpoint. Any session-scope change requires a new checkpoint namespace and reconciliation.

## Composition

This guard complements regional route authority, source-scope checkpoints, API-version routing, schema negotiation, dataset coverage and batch reconciliation. It does not itself store credentials, perform login, persist checkpoints, establish a complete snapshot or grant deletion authority.
