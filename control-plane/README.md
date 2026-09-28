# VECTOR Durable Control Plane

This directory is an isolated, Vercel-targeted control-plane application. It does not alter the sealed VECTOR runtime or the frozen customer-proof candidate.

Current mode: **Phase A / SHADOW**.

Implemented in this slice:

- Vercel Workflow candidate controller with durable per-candidate state.
- Vercel Queues fan-in for provider/proof events and fan-out for control-plane tasks.
- Exact candidate identity binding across repository/ref/SHA/deployment/runtime/release/environment/provider/failure domain.
- Terminal application PASS required before any proof gate can pass.
- Provider SUCCESS treated as metadata only.
- Monotonic receipt sequencing with stale receipt rejection.
- Event deduplication and deterministic task idempotency keys.
- Provider degradation rerouting to another admitted healthy lane where one exists.
- Frozen-target retention protection.
- `OPEN GATES + EMPTY QUEUE = ORCHESTRATION_INVARIANT_BREACH` unless every remaining gate has an explicit block.
- Shadow-only task consumer: no external product/provider mutations yet.

## Security boundary

`POST /api/candidates/start` requires `VECTOR_CONTROL_PLANE_ADMIN_TOKEN` as a bearer token.

`POST /api/ingest` requires HMAC-SHA256 over `<timestamp>.<raw-body>` using `VECTOR_CONTROL_PLANE_INGEST_SECRET`, sent in `x-vector-signature`, with the ISO timestamp in `x-vector-timestamp`.

Queue callback routes are private Vercel queue consumers configured in `vercel.json`.

## Local deterministic tests

```bash
npm test
```

These tests do not claim hosted durability. Hosted Workflow/Queue execution must be proven separately on the Vercel preview deployment before Phase B can dispatch real proof work.

## Customer-proof freeze and deferred activation lane

The live customer-proof baseline is pinned to commit `3030541675e41157405b933c30d82c8fd4b12927` and Railway deployment `e6399d9c-63ca-4272-ab0d-6d1010e444bd`.

While any customer-proof gate remains open:

- only work that directly closes, unblocks, repairs or accelerates a mandatory proof gate may enter the proof lane;
- all other product development stays draft/isolated and must not mutate the frozen candidate;
- deferred work is tracked in `candidates/post-proof-deferred-queue-2026-09-28.json`;
- the post-proof activation base is `queue/post-proof-activation-303054`, created from the exact frozen SHA;
- a deferred change cannot become promotion-eligible until every customer-proof gate except `production_authority` is PASS;
- promotion readiness additionally requires exact frozen-SHA compatibility, isolated tests, verified rollback, a prepared deployment recipe, and a hard activation budget of 60 minutes or less.

This allows development to continue without invalidating proof, while preparing bounded post-proof changes for rapid activation once the live customer environment is genuinely proven.

