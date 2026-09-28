# Source Scope and Checkpoint Partitioning

Manufacturing integrations must not assume a provider object ID, incremental checkpoint or deduplication key is globally unique. A source can contain multiple tenants, environments, server instances, companies, legal entities, plants, regions and datasets, and those boundaries can change after acquisitions, sandbox-to-production moves or regional restructuring.

The fabric therefore creates a deterministic `scope:v1:<sha256>` namespace from approved source dimensions before any reusable checkpoint is accepted. `providerId`, `connectionId` and `resource` are always required. Connectors can additionally require tenant/environment/company, serverInstance/company, site, region, API version or dataset according to the provider/deployment variant. Missing provider-required dimensions fail closed.

Scope values are Unicode NFC-normalised and secrets/arbitrary connector fields are never copied into the namespace or semantic lineage. Source IDs are treated as unique only inside the proven source scope. Changing company, environment, region, API version or dataset creates a different checkpoint namespace; the fabric must start a new checkpoint and recover with bounded overlap replay/reconciliation rather than continuing the old cursor.

For small tenants, irrelevant dimensions remain absent so one spreadsheet/API/account does not require enterprise configuration. For global tenants, provider metadata or customer configuration supplies the additional dimensions and the same runtime partitions ingestion, reconciliation and lineage without forking the connector architecture.

## Deployment variants

A connector may expose machine-readable deployment variants. Cloud and on-premises variants can differ in host, authentication and customer-edge requirements while sharing the same canonical mapping and protocol adapters. A cloud-safe host never authorises direct access to a customer-managed on-premises network. Private/on-premises variants must use the approved customer edge or other bounded customer-controlled route.

## Recovery rule

A checkpoint may be resumed only when its recorded scope namespace exactly matches the current source scope. A mismatch is a recovery event, not an invitation to guess identity. The connector creates a new namespace, replays an overlap window or bounded snapshot, deduplicates by source ID inside the new scope and reconciles before advancing freshness/evidence.

This policy supports multi-region and multi-entity scale while preserving source authority, lineage and data-sovereignty boundaries. Country/region fields are provenance inputs; they are not by themselves proof of contractual data residency or permission to transfer data across borders.
