# VECTOR Durable Control Plane

This directory is an isolated, Vercel-targeted control-plane application. It does not alter the sealed VECTOR runtime or the frozen customer-proof candidate.

Current mode: **Phase B-capable / fail-closed dispatch**.

Implemented:

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
- Signed, allow-listed proof dispatch for admitted lanes.
- Exact candidate, provider, failure-domain, deployment and runtime binding revalidated immediately before every outbound dispatch.
- No task may supply its own callback URL; endpoints come only from server-side lane configuration.
- HTTPS-only outbound proof dispatch with HMAC-SHA256 provenance and idempotency headers.
- Fail-closed shadow behaviour unless `VECTOR_CONTROL_PLANE_DISPATCH_MODE=LIVE_PROOF` is explicitly configured.

## Security boundary

`POST /api/candidates/start` requires `VECTOR_CONTROL_PLANE_ADMIN_TOKEN` as a bearer token.

`POST /api/ingest` requires HMAC-SHA256 over `<timestamp>.<raw-body>` using `VECTOR_CONTROL_PLANE_INGEST_SECRET`, sent in `x-vector-signature`, with the ISO timestamp in `x-vector-timestamp`.

Queue callback routes are private Vercel queue consumers configured in `vercel.json`.

Outbound proof lanes require server-side endpoint + signing secret pairs:

- Railway proof workers: `VECTOR_DISPATCH_RAILWAY_URL` + `VECTOR_DISPATCH_RAILWAY_SECRET`
- GitHub proof lane: `VECTOR_DISPATCH_GITHUB_URL` + `VECTOR_DISPATCH_GITHUB_SECRET`
- Northstar lane: `VECTOR_DISPATCH_NORTHSTAR_URL` + `VECTOR_DISPATCH_NORTHSTAR_SECRET`
- Independent verifier lane: `VECTOR_DISPATCH_EXTERNAL_URL` + `VECTOR_DISPATCH_EXTERNAL_SECRET`

No outbound dispatch occurs unless `VECTOR_CONTROL_PLANE_DISPATCH_MODE=LIVE_PROOF`.

## Deterministic tests

```bash
npm test
```

The dispatcher test suite verifies shadow fail-closed behaviour, exact-candidate drift rejection, admitted lane/provider/failure-domain binding, HTTPS-only endpoints, HMAC provenance, idempotency, task-supplied URL rejection and provider-rejection handling.

Hosted Workflow/Queue durability still requires a Vercel preview deployment and interruption/recovery proof before this control plane can be called hosted-proven or authoritative for customer-proof execution.
