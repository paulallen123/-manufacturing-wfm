# Batch reconciliation and watermark safety

File, SOAP, export-job and scheduled-download integrations may expose a source watermark even when the delivered batch is incomplete. A watermark is therefore commit evidence only after the entire transfer, schema, checksum and expected row count have been verified.

## Fail-closed rules

- `complete:false` always quarantines the batch, even when every received row parses and its checksum is valid.
- Quarantined batches cannot commit records, advance watermarks or infer deletions.
- Delta batches never gain deletion authority from absence.
- A complete transfer never grants direct deletion authority. When the dataset-coverage guard separately proves an authoritative complete snapshot, exact scope, every page and completed reconciliation, the result is only `tombstoneCandidateAuthority`; a later governed workflow must decide what happens to that candidate.
- Provider, connection and resource are mandatory source-scope dimensions. Tenant/site/entity dimensions can be required per provider, and a checkpoint from another scope is rejected.
- Watermark ordering is declared per connector: `iso8601`, `unsigned-integer`, `lexical` or `opaque`.
- Cursor type and value are validated on the first batch as well as later batches, and the predecessor must carry the same cursor type.
- ISO timestamps compare their actual instants, including offsets and DST; integer sequences use arbitrary-precision comparison.
- Integer cursors must arrive as canonical decimal strings, preventing precision loss before arbitrary-precision comparison.
- Opaque cursors are deliberately not ordered. A changed opaque cursor may advance only after a complete verified batch; overlap replay and reconciliation remain responsible for gap detection.
- Every accepted candidate carries a scope namespace and expected predecessor for a durable compare-and-swap checkpoint write; the helper does not claim that persistence has occurred.
- Dataset-coverage evidence must name the same dataset and carry the exact same source-scope namespace as the checkpoint, preventing deletion evidence from one feed, tenant or site being borrowed by another.
- The unsafe legacy `previousWatermark` argument is rejected; prior state must be supplied as a scope- and cursor-type-bound checkpoint.
- Invalid declared formats fail closed instead of silently falling back to string comparison.
- Completeness, checksum, schema and delta declarations must be real booleans; string values such as `"false"` are rejected instead of being treated as truthy evidence.

This control is reusable from a one-file micro-manufacturer import through multi-region enterprise feeds. Provider, connector, source scope and cursor kind remain part of the evidence used by the checkpoint owner.
