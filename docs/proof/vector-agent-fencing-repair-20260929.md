# VECTOR agent fencing repair evidence — 2026-09-29

This document records the controller ownership repair evidence prepared for the canonical VECTOR customer-proof lane.

## Canonical identity

- Branch: `release/vector-customer-ready-candidate-20260925`
- Source SHA: `13b61efa27759502f393af71ab7655a134676b5f`
- Railway application deployment: `e356b308-b5ee-4824-b4ba-889fcd90beff`
- Tenant: `northstar-demo`
- Implementation run: `09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e`

## What was repaired locally

A local controller repair was prepared for `implementation/runtime/implementation-work-controller.cjs` to add:

- per-attempt owner identity;
- monotonically increasing claim fence;
- private lease token hashed at rest;
- build/deployment binding digest;
- transactional receipt/state updates;
- stale owner, stale fence, expired lease, wrong token and wrong deployment rejection;
- policy/dependency blockers taking priority over lease expiry.

The repair also added a focused regression file: `implementation/runtime/implementation-work-fencing.test.cjs`.

## Local verification evidence

- Original controller/test blob hashes matched:
  - `implementation-work-controller.cjs`: `fababacb895f5edb717c4d247eef94fe15f20707`
  - `implementation-work-controller.test.cjs`: `8f43dd0309ac0504aaafccd94a3a712d95a575fc`
- Original four controller tests: `4 pass / 0 fail`.
- Expanded 42-test fencing suite against the original controller: `11 pass / 31 fail`.
- Repaired controller with the same 42-test suite: `42 pass / 0 fail / 0 skipped`.
- Node: `v22.16.0`.
- `node:sqlite` emitted its expected experimental warning.
- Patch package SHA256: `c3dd9956100195f2d6d9ffd722acd3a16574263857af7324facb17575453ee12`.

These were local controller tests only. They are not full VECTOR suite evidence, hosted proof, customer proof, or evidence that the Agent can execute writes.

## Important integration warning

Do not merge the controller patch alone.

`one-day-enterprise-engine-core.cjs` currently calls `tenantEnvironmentProvisioner.provision()` before `workController.claim()` inside `executeTenantEnvironmentEffect`. That means result fencing alone does not protect the effect boundary. The runtime caller must claim ownership before the effect and pass the owner, fence and lease token into the result call.

## Live executor rebinding

The existing executor service `vector-customer-gate-executor-0928` was redeployed on the same service, not replaced. The latest successful executor deployment was:

- Executor deployment: `ed420ff1-eca0-4a75-9edf-b88c2530a67d`
- Status: `SUCCESS`

Its fresh read-only receipt is bound to:

- `candidateSha`: `13b61efa27759502f393af71ab7655a134676b5f`
- `targetDeploymentId`: `e356b308-b5ee-4824-b4ba-889fcd90beff`
- `runId`: `09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e`
- `tenant`: `northstar-demo`
- `operationalReady`: `false`
- `completedRequirements`: `5`
- `totalRequirements`: `21`
- runnable: `time-policies`, `absence-policies`

This rebinding removes the old stale executor receipt as the current read-only target, but it does not activate Agent writes or prove customer readiness.

## Current status

- Agent session exists and remains read-only.
- Agent write capability is not active.
- Time and absence policies remain pending because authoritative customer policy decisions are still required.
- Customer-proof status remains not ready.
