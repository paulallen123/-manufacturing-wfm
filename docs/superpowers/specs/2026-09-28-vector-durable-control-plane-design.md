# VECTOR Durable Control Plane — Design

Date: 2026-09-28
Status: Approved 2026-09-28
Branch: `design/vector-control-plane-20260928`
Scope: Orchestration only. No VECTOR product feature expansion.

## 1. Purpose

Eliminate VECTOR delivery stalls caused by orchestration failures while preserving proof integrity, customer-proof discipline, fail-closed safety, exact-candidate binding, and isolation between VECTOR and Northstar.

The control plane must make it impossible for open release gates to coexist with an empty execution queue unless every remaining gate is a true safety/evidence block with no admissible work available.

Primary invariant:

> OPEN RELEASE GATES + ZERO RUNNING/QUEUED ADMISSIBLE WORK = ORCHESTRATION FAILURE

Scheduled reporting times are observation cadences only. They never delay execution.

## 2. Architecture

Use a separate Vercel-hosted durable orchestration service built with Vercel Workflow for stateful execution and Vercel Queues for event fan-out.

High-level flow:

1. GitHub, Railway, Northstar and VECTOR proof lanes emit events.
2. The Vercel control plane ingests each event and binds it to a candidate identity.
3. Candidate state is updated transactionally.
4. The gate DAG is recalculated immediately.
5. Every newly admissible dependent and independent task is enqueued immediately.
6. Workers execute tasks against VECTOR, Railway, GitHub or Northstar.
7. Results return as signed/hashed proof receipts.
8. The orchestrator accepts only terminal application evidence, never infrastructure status alone.
9. Any failed assertion becomes a permanent regression case before the gate can reopen.

VECTOR itself remains the target product. Northstar remains the independent reliability/proof laboratory. The control plane owns orchestration and release-gate state only.

## 3. Separation of responsibilities

### Vercel Control Plane
Owns:
- Candidate registry.
- Gate DAG and dependencies.
- Task queue and leases.
- Result consumption.
- Retry/reroute classification.
- Provider/failure-domain registry.
- No-idle invariant.
- Proof-target retention.
- Release-gate state.
- Latest-receipt monotonicity.
- Audit log of orchestration decisions.

Must not:
- Infer PASS from provider status.
- Mutate customer production data.
- Override failed safety/evidence gates.
- Treat duplicate services on one provider as independent resilience.

### VECTOR
Owns:
- Product runtime.
- Business logic.
- Implementation engine.
- Security controls.
- Integrations.
- Autopilot.
- Persistence/recovery.
- Runtime self-identity.

VECTOR exposes proofable endpoints and receipts but never self-authorises production release.

### Northstar
Owns:
- Isolated customer simulations.
- Failure injection.
- Browser/device/integration emulation.
- Independent result verification.
- Assault/regression execution.
- Proof-pack generation.

Northstar must:
- Verify target identity before every test.
- Treat VECTOR as a target, never a source of truth.
- Return PASS/FAIL/BLOCKED/UNPROVEN with evidence.
- Convert confirmed failures into reusable regression cases.

Northstar currently runs on Railway, so it is not an independent runtime failure domain. A future Northstar or verifier deployment on another provider may count only when its control/data/runtime failure domain is genuinely separate.

## 4. Candidate identity

Every candidate is identified by:
- repository
- branch/ref
- exact commit SHA
- build/deployment ID
- runtime self-reported SHA
- release identifier
- environment
- provider
- failureDomainId

A candidate is inadmissible if any identity field conflicts.

A proof receipt is rejected if its candidate identity does not match the frozen candidate exactly.

## 5. Gate DAG

Initial production-readiness gates:

1. pre_freeze
2. hosted_runtime
3. exact_source_binding
4. golden_journey
5. autonomous_implementation
6. competency_training
7. integrations
8. security
9. autopilot_execute
10. autopilot_rollback
11. persistence_restart
12. stale_restore_tamper_recovery
13. outcome_learning_runtime
14. northstar_assault
15. failure_domain_independence
16. production_authority

Each gate has:
- state: UNPROVEN | RUNNING | PASS | FAIL | BLOCKED
- candidateSha
- requiredEvidenceTypes
- dependencies
- runnableIndependentOfDependencies
- latestReceiptId
- failureDomainRequirements
- retryPolicy
- retentionRequirements

No gate may become PASS from design intent, infrastructure success, copied evidence, stale evidence, another SHA, another environment or another provider target.

## 6. Task model

Every task includes:

- taskId
- candidateSha
- gateId
- proofType
- targetDeploymentId
- targetRuntimeSha
- failureDomainId
- provider
- idempotencyKey
- leaseId
- attempt
- createdAt
- terminalState
- evidenceDigest
- dependencies
- retentionToken

Tasks use idempotency keys based on candidate + gate + proof type + semantic input version.

Workers use leases. Duplicate delivery is allowed; duplicate execution must be harmless.

## 7. Terminal result model

Only these top-level orchestration outcomes exist:

- PASS
- FAIL
- PROVIDER_DEGRADED
- BLOCKED

Infrastructure status such as Railway SUCCESS or GitHub workflow completed is metadata, not proof.

Rules:
- Railway SUCCESS + application FAIL => FAIL.
- Railway SUCCESS + no proof receipt => BLOCKED/NO_PROOF.
- Railway SKIPPED => inadmissible lane; reroute.
- GitHub failure before any step executes => PROVIDER_DEGRADED.
- Credential/provider/tool unavailable before product execution => PROVIDER_DEGRADED.
- Product assertion reached and failed => FAIL.
- Safety gate intentionally prevents execution => BLOCKED.

## 8. No-idle invariant

After every event, the orchestrator recalculates runnable work.

If any release gate is not PASS:
- If dependent work is runnable, enqueue it.
- Else if independent proof/preflight is runnable, enqueue it.
- Else if a distinct failure-domain lane exists, enqueue it.
- Else if repair/preparation/simulation work is admissible, enqueue it.
- Else mark candidate BLOCKED with explicit reasons and required external action.

An empty queue with open gates and no explicit BLOCKED reason is a fatal orchestration invariant breach.

This check runs:
- after every terminal task result
- after provider degradation
- after candidate deployment
- after gate-state change
- after task cancellation
- after retention/cleanup events

It is event-driven, not timer-driven.

## 9. Readiness semantics

No fixed sleep loops or attempt counters may determine readiness.

A proof target must expose condition-based state:
- 503 while PENDING/RUNNING
- 200 only when terminal PASS
- terminal non-2xx immediately on FAIL/BLOCKED where supported

Diagnostics must include:
- current proof state
- active gate
- candidate SHA
- last event
- blocking reason
- dependency state

Fixed retry windows may exist only at provider transport level and never count as evidence.

## 10. Frozen target retention

A frozen candidate must remain reachable until:
- every declared dependent proof is terminal
- evidence is persisted
- no queued task references the target
- rollback/recovery evidence is preserved

Cleanup before dependents finish is an orchestration failure.

Retention uses a durable token/reference count owned by the control plane.

## 11. Stale evidence rejection

For each candidate + gate, receipts are monotonic.

The control plane accepts only:
- the latest valid terminal receipt
- with exact candidate identity
- from an admitted proof lane

Older checkpoints cannot overwrite newer progress.

If implementation progresses 6/21 -> 14/21 -> 18/21, reporting 6/21 later is rejected as stale.

## 12. Failure domains

A registry explicitly defines failure domains.

Example:
- railway-us-west-runtime
- railway-proof-workers
- vercel-control-plane
- github-actions
- non-railway-verifier

Services sharing a provider/control plane are not automatically independent.

Resilience claims use unique failureDomainId count, never raw service count.

## 13. Provider degradation and rerouting

On PROVIDER_DEGRADED:
1. Record provider incident.
2. Do not count it as product failure.
3. Select another admitted lane/provider if available.
4. Continue all independent tasks.
5. Preserve original failure evidence.
6. Re-enter the degraded provider only when useful; never retry-loop blindly.

## 14. Northstar integration

The control plane sends Northstar:
- exact target URL
- exact SHA
- deployment ID
- tenant/test profile
- assault pack
- allowed mutation scope
- rollback requirements

Northstar returns:
- observed evidence
- verified result
- unproven claims
- risks
- evidence digest
- next assault recommendation

Northstar cannot promote release state directly. Its receipt is evaluated by the control plane against gate policy.

## 15. Security

The control plane must:
- use least-privilege provider credentials
- never store customer production credentials in workflow payloads
- use provider secret stores for tokens
- sign or digest proof receipts
- reject untrusted webhook fields that attempt to alter candidate/gate policy
- require exact source identity from the target itself where available
- record immutable orchestration audit events
- prevent one tenant/candidate from mutating another
- fail closed on missing identity/provenance

## 16. Immediate migration

Migration must not pause VECTOR delivery.

Phase A — shadow mode:
- Control plane observes existing Railway/GitHub/Northstar events.
- It computes what should run next without triggering mutations.
- Compare recommendations with actual execution.

Phase B — proof orchestration:
- Control plane owns non-destructive proof launches first.
- Browser, security, integration, persistence, Autopilot and Northstar proof move under it.

Phase C — release-gate ownership:
- Control plane becomes authoritative for gate state.
- Existing ad-hoc lanes become workers only.
- Platform SUCCESS statuses lose any release authority.

Phase D — multi-domain resilience:
- Add at least one genuinely non-Railway execution/verifier domain.
- Prove provider-loss failover.

## 17. First live workflow

Use the current frozen VECTOR candidate as the first orchestrated case.

Critical path:
1. live-data-import
2. privileged competency
3. frontline readiness
4. exact Golden Journey rerun
5. Autopilot rollback
6. stale-restore/tamper recovery
7. bind outcome-learning to frozen SHA
8. Northstar assault
9. second failure-domain proof
10. production-authority gate

All other proof/preflight work runs in parallel where safe.

## 18. Acceptance criteria

The orchestration problem is considered fixed only when all of the following are proven:

1. Open gates + empty queue immediately raises ORCHESTRATION_INVARIANT_BREACH.
2. Terminal PASS fans out all newly runnable work without scheduled delay.
3. Terminal FAIL immediately launches repair/regression work plus independent work.
4. Provider pre-execution failure becomes PROVIDER_DEGRADED and reroutes.
5. Railway SKIPPED can never satisfy a gate.
6. Railway SUCCESS without application PASS can never satisfy a gate.
7. A proof target cannot be cleaned up while dependents remain.
8. Stale receipts cannot reduce or overwrite monotonic progress.
9. Duplicate queue delivery cannot duplicate consequential actions.
10. Fixed sleep/attempt readiness is rejected by validation.
11. Exact-SHA mismatch fails closed before proof execution.
12. False-green provider statuses are ignored when receipt state differs.
13. Loss of GitHub Actions does not stop independent VECTOR proof work.
14. Loss of Railway proof workers causes reroute to a distinct failure domain when configured.
15. Chaos test: kill orchestrator process mid-run; durable workflow resumes without losing state.
16. Chaos test: duplicate events, reordered events and stale events preserve correct state.
17. Chaos test: target disappears mid-proof; retention violation is detected and candidate is blocked.
18. Chaos test: one provider unavailable; independent tasks continue.
19. Complete VECTOR customer-readiness DAG executes continuously with no unexplained idle interval.
20. Every orchestration defect discovered becomes a permanent regression test.

## 19. Non-goals

This project does not:
- add new VECTOR customer features
- weaken any proof gate
- make Northstar part of VECTOR runtime
- replace Railway immediately
- make Vercel itself a customer runtime dependency
- infer readiness from synthetic tests alone
- claim production readiness before all gates pass

## 20. Recommended technology

Primary:
- Vercel Workflow for durable stateful orchestration
- Vercel Queues for durable event fan-out and consumer isolation
- Vercel deployment as a separate control-plane failure domain
- Existing GitHub and Railway integrations as workers/providers
- Northstar as independent attack/proof engine

Fallback:
- If Vercel Workflow is unavailable or fails acceptance tests, use the same state model behind a provider-neutral durable workflow engine. The contract in this document remains authoritative regardless of implementation technology.
