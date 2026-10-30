# V123 signed-zero receipt correction — 2026-10-30

This isolated source repair targets #551 exact head `bf96891fa3ffe87d164be9e222a25d9fc4697d94`, tree `b80456a7f617dde6a65801ac8f00908cafae6f59`. Existing #551/#354 owners retain adapter/engine ownership. It changes two source/test paths and this bounded receipt; it does not adopt into #552/#501 or select a production consumer/store/path.

## Defect and correction

The adapter accepts finite baseline/result values, including negative zero. The original engine receipt retains `-0`, while JSON serializes that value as `0`. Consequently the returned receipt differs from the immediate committed snapshot and subsequent replay. Three independent fail-first cases cover baseline `-0`, result `-0`, and both. All fail against exact #551.

Normalize both numeric zeros to positive zero before engine ingestion and storage. This matches the existing persisted JSON representation and needs no schema migration. The same three assertions are appended to the existing `durable-outcome-ledger.test.mjs`: returned receipt equals the immediate snapshot, both zero-valued numeric fields are canonical, reopen preserves the snapshot, and replay returns the same receipt without inserting another row. All inherited source/tests are retained.

| Path | Repaired Git blob | SHA-256 |
| --- | --- | --- |
| `adaptive-intelligence/durable-outcome-ledger.mjs` | `b66e574e4a028cbabda53bb47ab6e05ab4f4d347` | `3afa7e0d088c142379e4d2350d68aeabfc30bcc313e5926fae8675ef79fafcca` |
| `adaptive-intelligence/durable-outcome-ledger.test.mjs` | `d3ecf3db34137f65d0f209f0ec042446f55f8ade` | `533f8040d2376ad0a9c0a17f294de55ade1cb792b383812d6fc7fff78e17d8b6` |

## Verification

Fresh Node 22.23.2 local checks, zero skips:

- Independent signed-zero cases: exact donor 0/3 pass, exit 1; repair 3/3 pass, exit 0.
- Repaired inherited engine and all three ledger suites: 284/284 pass, exit 0.
- Those suites plus eight independently authored identity/persistence heldouts: 292/292 pass, exit 0. The peer heldouts cover canonical whitespace identities, tenant/source evidence keys, rollback after reopen, refusal to elevate unverified proof, concurrent process deduplication and committed distinct wins, defensive copies, literal SQL syntax, and hidden/symbol field refusal.
- Independent coordinator `/root` reviewed the exact two-file diff and reran both 284/284 and combined 292/292 before authorizing this isolated draft publication. This is scoped source review, not formal GitHub approval or integration acceptance.

Repository-reproducible command:

```sh
node --test adaptive-intelligence/engine.test.mjs adaptive-intelligence/durable-outcome-ledger.test.mjs adaptive-intelligence/durable-outcome-ledger-heldouts.test.mjs adaptive-intelligence/durable-outcome-ledger-inert-input.test.mjs
```

Independent local evidence SHA-256: signed-zero red TAP `b5c8c627340e3a2b84be4e0014d34e817a0bfe923b58a085cf73d5306d8cf361`; signed-zero green TAP `969f9ec022a5f3d436f5e38b1e821df555c65c66aa5f63dee92198709440bfb6`; combined green TAP `eb940757af327ac6e4902ec9df901d9c13edac926b71e68ccb830d245e878c00`; independent peer source `a20b0d4f6890541a027f4de7232ff44e623db2210e6b60cf7da7396c5623861f`; independent signed-zero source `def619c61178f4311c52799bf7be534888a66a0e9965fd9eb09e2783ac5edbbb`.

## Boundaries and next owner

V123 remains DEVELOPMENT, customer-complete no. SQLite is experimental in this runtime. Approved supported store/path, durable volume/backup custody, authenticated tenant/source/evidence binding, current consumer adoption, combined image/security/recovery and hosted restart/audit/readback remain separate owner gates. Local concurrency and killed manual-writer tests do not establish cross-host consensus or crash injection inside the adapter. Learning remains advisory (`authority:'none'`). No live storage/tenant/provider/deployment mutation, financial validity, measured saving, readiness or DONE claim is made.

Canonical adoption must include the complete inherited guarded engine and its test file, plus the repaired ledger and three existing ledger suites. Admission selectors and runtime packaging need a separate exact-source integration review. This draft adds no default consumer or authority.
