# Integration source reconnect proof package — 2026-10-13

## Requirement and ownership

Source: issue #265, integration/implementation gate: exact-SHA source binding, reconnect, and outage reconciliation. This slice verifies one recoverable `SOURCE` outage with one new canonical import and an idempotent replay. It does not cover authorization failure, rate limiting, provider acceptance, or the whole Golden Journey.

The canonical release/integration owner remains the only integration and deployment owner. Before work, current open PR/title and remote branch searches found no focused source-outage/reconnect verifier. The historical `feature/vector-implementation-source-handoff-20260927` branch and `scripts/implementation-source-handoff-proof.cjs` already exercise initial import, tenant denial, authorization revocation, and restart readback; this package leaves them intact. It adds no runner, worker, runtime route, database writer, or deployment.

## Exact base, result, and capture contract

Base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` (`release/vector-customer-ready-candidate-20260925`). Changed files: `scripts/integration-reconnect-proof-oracle.mjs`, `tests/integration-reconnect-proof-oracle.test.mjs`, this evidence file.

The pure verifier compares five sequential snapshots from the **same serving SHA, deployment, tenant, connection, source instance, and mapping version**. Each snapshot must carry the actual `publicConnection` shape returned by the authenticated `/api/integrations/autonomous/status` route, plus a separately captured read-only count/latest-batch ID and checksum from `integration_canonical_batches`, scoped to that tenant, connection, and mapping version. The outage and reconnect snapshots also need independently captured, time-ordered source probes tied to that same source instance. Post-reconnect/replay snapshots need the actual `/sync-validate` response. A new import requires a different batch ID and checksum; replay must leave both and the batch count unchanged. Missing or inconsistent inputs are BLOCKED.

The external capture process must bind the tenant and serving SHA using independent authenticated/provider evidence. This oracle only checks consistency of supplied captures; it cannot attest their origin or turn synthetic fixtures into customer proof. Direct production database access or deliberate source outage is **not** authorized by this package. The canonical owner must choose an approved synthetic hosted lane and evidence custody before execution.

## Tests and review

- Local `node --test tests/integration-reconnect-proof-oracle.test.mjs`: 20/20 passed, 0 failed before final capture-order correction.
- Local `node --test integration/runtime/autonomous-integration-hub.test.cjs`: 19/19 passed, 0 failed (before final oracle-only revision; runtime unchanged).
- Pinned Node `22.23.2` Docker image ran the final revision: 21/21 passed, 0 failed.
- Independent review of first revision found invented receipt fields, unchanged-checksum false PASS, and rate-limit false BLOCK. First revision was discarded. Second review found unscoped probes and batch witnesses; the revision bound those to source, tenant, connection and mapping. Final review found a recovery probe could predate the observed degraded state; this was fixed with a focused negative case. Reviewer verified the final correction and reported no remaining blocking findings in this bounded review.

## Lifecycle and next action

Status: **TESTED locally** on the pinned image and independently reviewed. No canonical integration, exact-candidate deployment, hosted source capture, or customer proof. The candidate Railway service's staged SHA is not its serving SHA, so no old receipt is attributed to this package.

Canonical owner: review and adopt only after the remaining review/test gates, capture independently witnessed snapshots on one approved serving candidate, run the verifier, and keep the integration gate open until real provider and outside-in evidence is admitted.
