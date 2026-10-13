# Agents bootstrap exact-run binding: isolated correction

## Requirement, source, ownership

Issue #288 requires one read-only Agents API session and its status tools to remain bound to the existing implementation run, tenant, candidate SHA and deployment. The existing route verified that `runId` existed for the tenant but fetched `statusForTenant(tenant)`, which reports the tenant's *current* run. A historical same-tenant run could therefore create a session while receiving another run's readiness.

Before selection and before coding, searches of open PR titles/bodies and branch names for Agents API bootstrap, run binding, `statusForTenant` and historical runs found no focused owner or branch. The merged candidate already contained the Agents adapter and route; this corrects those files in place. Issue #60 hybrid workforce and issue #65 workforce provenance remain outside this package. Canonical implementation and release ownership stays with the existing release line.

Exact base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` on `release/vector-customer-ready-candidate-20260925`. Changed files:

- `implementation/runtime/agents-api-bootstrap-route.cjs`
- `implementation/runtime/agents-api-bootstrap-route.test.cjs`
- `implementation/runtime/agents-api-adapter.cjs`
- `.github/workflows/agents-bootstrap-run-binding-gate.yml`
- `docs/evidence/2026-10-13-agents-bootstrap-run-binding.md`

## Implementation and tests

The route now compares the current status's exact `runId` and tenant with the requested binding before session creation, after session creation, during each tool call and before logging/returning analysis. The existing adapter accepts a server-side current-identity guard and invokes it immediately before either outbound `/events` submission and before persisting a report. Mismatch returns 409 and cannot turn an old run's status into current-run proof. No new controller, job, runner, tenant, source of release authority or live OpenAI call was added.

TDD regression 1: the historical-run test failed because the old route attempted OpenAI session creation (`VECTOR_AGENTS_SESSION_CREATE_AMBIGUOUS`); it passed after the route check. Regression 2: the async-session-GET rotation test failed because the old adapter reached `/events`; it passed after the adapter guard. Final local `node --test implementation/runtime/agents-api-bootstrap-route.test.cjs implementation/runtime/agents-api-adapter.test.cjs`: 16/16 pass. Same suite in pinned Node 22.23.2 Docker image `sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96`: 16/16 pass. `node --test implementation/runtime/one-day-enterprise-engine.test.cjs`: 89/89 pass locally. `git diff --check` passed before review; rerun before commit. Independent review found the async GET race, which was fixed; re-review found no remaining concrete defect in this diff. GitHub exact-head workflow result is pending until the PR exists.

## State and next gate

**TESTED in an isolated worktree.** No canonical adoption, exact-image build, deployment, hosted authenticated tenant proof or customer proof. The Railway candidate service's last SUCCESS deployment `faca24a2-10b9-4289-bc49-3406e44f7272` serves `90ad90fcf60adaca9abacdd4ad14bf392f95e585`; the change to `48dce8f` remains staged as patch `b453aa80-4763-4a08-a4f5-d5d27534b2c8`. This fix is newer than both and is not in either serving or staged source. A guard before a network call is not a durable exclusive run lease; the canonical controller must retain its fencing and reconcile a turn whose network outcome is ambiguous.

Next: canonical owner reviews this package, adopts it on the single candidate with any other approved changes, runs exact-image and security gates, uses the approved Railway release process, then proves wrong-run and run-rotation denial on the exact serving SHA with authorised synthetic tenant/run data. No production promotion or customer-ready claim follows from local tests alone.
