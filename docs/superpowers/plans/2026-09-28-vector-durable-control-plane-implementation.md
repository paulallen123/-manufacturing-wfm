# VECTOR Durable Control Plane — Implementation Plan

Date: 2026-09-28
Branch: `design/vector-control-plane-20260928`
Design authority: `docs/superpowers/specs/2026-09-28-vector-durable-control-plane-design.md`

## Non-negotiable boundary

The existing frozen VECTOR customer-proof candidate remains untouched. This control plane is a separate service and begins in non-mutating shadow mode.

## Phase A — executable shadow control plane

1. Implement the gate DAG as deterministic code.
2. Bind every event/receipt to the exact frozen candidate identity.
3. Reject provider-success false greens, stale receipts, missing provenance and candidate mismatches.
4. Track provider health and reroute only to admitted healthy lanes.
5. Enforce frozen-target retention.
6. Enforce the no-idle invariant after every accepted event.
7. Use Vercel Workflow as the durable per-candidate state owner.
8. Use Vercel Queues for event fan-in and task fan-out.
9. Keep task execution shadow-only until hosted durability and queue semantics are proven.
10. Convert every orchestration defect into a regression test.

## Phase A acceptance

- Unit tests pass for bootstrap fan-out, PASS fan-out, false-green rejection, stale receipt rejection, exact-SHA mismatch, duplicate events, provider reroute, FAIL->repair/regression and retention violation.
- A Vercel preview builds successfully from this branch.
- Starting a candidate creates a durable Workflow run.
- Signed ingest publishes to `vector-control-events`.
- Queue consumer resumes the correct candidate Workflow hook.
- Workflow immediately publishes newly runnable tasks to `vector-control-tasks`.
- Shadow task consumer records exact candidate/gate/lane/idempotency metadata.
- Killing/redeploying the control-plane preview does not lose a waiting candidate workflow.

## Phase B — non-destructive proof dispatch

Only after Phase A hosted evidence passes:

- Replace shadow task logging with bounded adapters for browser proof, exact-source verification, security checks, persistence/restart checks and Northstar assault initiation.
- Every adapter must be idempotent and return a signed/digested terminal receipt.
- Provider failures before product execution return `PROVIDER_DEGRADED`, never product `FAIL`.
- No adapter may mutate the frozen VECTOR runtime.

## Phase C — release-gate authority

Only after Phase B proves exact-candidate durable orchestration under duplicate/reordered events, provider degradation, restart and target-retention attack tests:

- Make the control plane authoritative for release-gate state.
- Remove release authority from Railway/GitHub platform success states.
- Preserve terminal application proof as the only PASS authority.

## Phase D — independent failure domain

- Configure and prove a genuinely non-Railway verifier/runtime lane.
- Do not count Northstar-on-Railway as independent until its runtime/control/data failure domain is truly separate.
- Prove provider-loss failover before the `failure_domain_independence` gate can pass.
