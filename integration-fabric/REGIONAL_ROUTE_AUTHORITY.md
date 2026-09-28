# Regional route authority

This control preserves provider region, customer data location and transfer authority from ingestion through lineage and checkpoints. It is a routing guard, not a general legal-compliance claim.

## Invariants

- Runtime endpoints must match an exact approved HTTPS host.
- Route identity includes provider, route id, region and data location.
- Moving data to another region requires an allowlisted destination and explicit customer approval.
- Regional failover is never silent. A route change starts a new checkpoint namespace and requires overlap replay and reconciliation.
- Customer-selected data location is recorded only when supported by tenant, contract or provider evidence.
- Regional routing cannot expand API permissions, write authority, private-network reachability, payroll authority or industrial-control authority.

`runtime/regional-route-authority.mjs` implements the fail-closed route policy. Provider profiles can describe regional requirements before tenant setup, but executable routes are populated only from verified customer/provider configuration. A regional outage therefore reduces freshness or availability instead of silently moving data across a regional boundary.
