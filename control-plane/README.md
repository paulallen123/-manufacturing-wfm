# VECTOR Durable Control Plane

This directory is an isolated, Vercel-targeted control-plane application. It does not alter the sealed VECTOR runtime or the frozen customer-proof candidate.

Current mode: **Phase A / SHADOW**.

Implemented in this slice:

- Vercel Workflow candidate controller with durable per-candidate state.
- Vercel Queues fan-in for provider/proof events and fan-out for control-plane tasks.
- Exact candidate identity binding across repository/ref/SHA/deployment/runtime/release/environment/provider/failure domain/claim boundary.
- Terminal application PASS required before any proof gate can pass.
- Exact receipt-to-task binding: task ID, idempotency key, admitted lane, failure domain, deployment and runtime identity must match.
- Derived `customer_proof_authority` only after every required evidence gate passes.
- Production authority is structurally outside this staging control plane; customer-proof evidence cannot be relabelled as production approval.
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

Current deterministic state-machine verification: **31/31 affected control-plane tests passing** in an isolated execution harness while GitHub Actions is degraded. This is logic verification only, not hosted/release proof.

These tests do not claim hosted durability. Hosted Workflow/Queue execution must be proven separately on the Vercel preview deployment before Phase B can dispatch real proof work.
