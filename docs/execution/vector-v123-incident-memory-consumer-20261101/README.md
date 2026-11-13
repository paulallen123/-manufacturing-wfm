# V123 signed incident-memory consumer — bounded source slice

V123 remains **DEVELOPMENT; customer-complete no**. This adds an opt-in read consumer for incident/engineering measurements to the existing durable outcome ledger. It selects no application consumer, producer, tenant, signer, state path, volume, backup, provider, or deployment.

## Acceptance and exact base

[The exact V123 acceptance record](https://github.com/paulallen123/-manufacturing-wfm/blob/6059e40a58d1f47c4a5a0ac23b793ab19888b40b/docs/execution/lane-register-20261029/lanes/V123.json) calls for deduplication surviving restart and recurrence/non-recurrence paths, with authenticated measurement provenance. Full completion separately requires the current integrated version, intended-role workflow, authoritative backend, durable state, fresh login/readback, audit and independent security/recovery proof. [The current #527 row](https://github.com/paulallen123/-manufacturing-wfm/issues/527#issuecomment-6550876973) remains the coordination record.

The isolated source baseline is #501 commit `b26bb6f0fc30e33b6f4c31e05608368a45fd00a4`. A fresh GitHub recursive tree read was compared against all 1,748 local blobs; every blob, including the freeze marker, matched before editing. The reconstructed baseline Git tree is `a32ad01908703aa92f77a7fd5cf91e09b24396cd`. This package adds only this receipt and the consumer module/test. It preserves the six inherited V123 engine/ledger source/test paths from #557 and does not change #501/#573 refs, their marker, Docker, CI selectors, schema or locks.

## Producer and consumer contract

`createDurableIncidentMemoryConsumer` requires an explicit absolute `path`, `mode` (`create` or `open`), canonical `tenantScope`, canonical `source`, pinned Ed25519 `publicKey`, and trusted server-side `readAttestation` function. `minRepeatedWins` is 2–1,000, default 3. Construction creates no files or network requests. Importing it has no state-path or environment-variable selection.

- `consume({evidenceRef})` asks the configured producer for `{tenantScope,source,evidenceRef}`. The producer must use the same stable evidence reference for one incident/engineering observation on every retry; a new incident uses a new reference. The caller cannot submit measurement values or assert verification. A committed receipt is returned only after source verification, current-memory revalidation, durable append and store-identity checks.
- `recurrence({fingerprint})` authenticates **all** retained rows before matching the requested incident family. It exposes only the configured tenant/source, retained evidence references, and derived evaluations/skill candidates. Multiple distinct retained references yield `recurrence-observed`; one yields `observed`; zero yields `no-known-match`. These describe retained observations, never prove absence of incidents. Every output has `authority:'none'`; candidates retain `authority:'none'`. Recurrence suggests a prevention review and cannot execute or authorize repairs.
- `close()` is idempotent. Pending asynchronous producer reads check closure again before any subsequent store operation.

The producer returns an inert exact-key envelope `{payload,signature}`. `signature` is unpadded base64url Ed25519. Signing bytes are UTF-8 `VECTOR_INCIDENT_MEASUREMENT_V1\n` followed by `JSON.stringify` of the values in this exact order:

```js
['schemaVersion','tenantScope','source','category','fingerprint',
 'baseline','result','verified','evidenceRef','createdAt']
```

`schemaVersion` is 1; `category` is `support-incidents`; `verified` is a literal boolean. Baseline/result are finite numbers with a finite difference. Positive differences must be at most `Number.MAX_VALUE/(minRepeatedWins+1)` so concurrent independent appends cannot overflow the inherited threshold aggregate. Numeric zero is canonicalized consistently with JSON and the inherited ledger. `createdAt` is a valid canonical UTC ISO timestamp with millisecond precision. Tenant IDs are at most 100 characters; source/fingerprint/evidence references are at most 120; surrounding whitespace and control characters are rejected. No value is truncated. Unknown, hidden, symbol, accessor, Proxy, array or non-record payload fields are refused without executing them. The signature binds every measurement field, including the stable evidence reference and verification flag.

Source authentication happens before first file creation. `create` uses exclusive `wx` creation and refuses an existing path. `open` requires an existing, nonempty, bound regular file and fails closed for missing/unbound/corrupt state. The existing `outcome_replay_config` table retains a binding to tenant, source, signer fingerprint and threshold; this introduces no schema migration. Reopening under a different binding is refused. One consumer store supports one tenant/source. Foreign rows are rejected and cannot blend into derived advice.

The inherited ledger stores normalized outcomes rather than signatures. Therefore every read and append re-fetches each retained observation through the trusted read adapter, verifies its signature, and compares its complete normalized content with the retained row. Source unavailability, changed proof or tampered retained content fails closed, including when the requested fingerprint has no match. The injected producer must itself enforce authenticated server-side access, consent, evidence accuracy and immutable observation keys. A signature proves the pinned signer attested the measurement; it does not independently prove the measurement is accurate.

## Verification

Fresh supported Node **22.23.2**: 300/300 pass, exit 0, zero skips — 16 new consumer checks and the unchanged inherited 284 checks. The first 13 consumer checks fail against a bounded absent-consumer stub (13 failures, exit 1); the module was then implemented. A peer reproduced a concurrent finite-number overflow in the initial implementation. The dedicated regression fails 0/1 on the prior source with the numeric guard removed and passes 1/1 on this source. The additional same-handle and separate-handle concurrent aggregate checks pass.

```sh
node --test adaptive-intelligence/durable-incident-memory.test.mjs \
  adaptive-intelligence/engine.test.mjs \
  adaptive-intelligence/durable-outcome-ledger.test.mjs \
  adaptive-intelligence/durable-outcome-ledger-heldouts.test.mjs \
  adaptive-intelligence/durable-outcome-ledger-inert-input.test.mjs
```

Coverage includes signature/signed-field tampering; tenant/source/reference mismatch before file creation; inert query refusal; signed unverified outcomes receiving no learned authority; exact replay after reopen; distinct recurrence and no-known-match; conflict and failed-write rollback; retry after write outage; whole-store provenance validation before filtering; signer/source/threshold binding; and foreign-source refusal.

Independent peer `/root/v123_consumer_peer` reviewed the exact module/test bytes and this bounded contract, then ran 14 separate heldouts. Both the peer and implementation worker ran the combined set fresh on Node 22.23.2: **314/314 pass, exit 0, zero skips**. Heldouts cover pending-read closure, inert producer records, source/authority boundaries, first-write deduplication, existing-path refusal, missing/replaced stores, canonical zero/calendar values, changed signed provenance, threshold rebinding, concurrent numeric aggregation and fresh-process reopen. The peer accepted this source slice with the documented custody/runtime limits; this is not formal GitHub approval or customer acceptance. Independent heldout source SHA-256: `b303cfd8efe860dd4f866440ab4811a2873b0dfdc4f837080736fbcd0740caac`; implementation-worker combined TAP SHA-256: `c36775fe9d77f2ce6f551bb5387b7d8bf108df5f2b702b8755db8b2d4448bd56`.

## Remaining owner gates and limits

This is an isolated source consumer, not adoption by a live customer workflow. A real authenticated measurement producer, approved trusted signer, approved supported storage/path, volume/backup custody, consumer integration, intended-role audit/readback, combined image admission, independent security/recovery proof and hosted restart/fresh-login proof remain open. SQLite remains experimental in Node 22.

Local file custody is a trust boundary. The consumer checks file identity on each operation and before acknowledgement and refuses deleted/replaced state. It does not prove completeness after deletion of individual rows, restoration of an older valid database, or adversarial filesystem replacement inside a synchronous open/commit interval; independent backup/restore custody is required. `open` does not silently accept a recreated empty database, but the inherited path-based SQLite constructor can create an empty file in a destructive external unlink race before the post-open binding check rejects it. No cross-host consensus, anti-rollback witness, key rotation, historical-signature archive, live source accuracy or production durability claim is made.

Revalidation is a bounded source slice that reads retained observations again; it is not an optimized large-history query service. Producer failure prevents advisory reads rather than returning a false clean history. No live tenant/provider/storage mutation, paid resource, deployment, readiness, measured saving, financial validity or DONE claim is part of this package.
