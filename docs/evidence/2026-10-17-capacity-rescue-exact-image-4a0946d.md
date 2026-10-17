# Capacity Rescue exact-target source/image admission

## Binding and scope

Proof-only branch: `proof/capacity-rescue-image-4a0946d-20261017`, created from canonical base `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` on `release/vector-customer-ready-candidate-20260925`. Target is PR #333 immutable head `4a0946de945490f8b927c08863d2e2cf2a17efd0`, not a merge or reconciled candidate. Before creation, the GitHub connector rechecked those bindings and searched capacity branches and exact-head/proof PRs; no competing exact-head proof owner was found.

Only this evidence file and `.github/workflows/capacity-rescue-image-4a0946d.yml` are added. Product source, tests, Dockerfile, release state, runtime/deployment, tenant/provider data, controllers and shared runner configuration are untouched. The proof uses an ephemeral GitHub-hosted Ubuntu runner; it does not deploy, push an image, connect to a tenant or start the application server.

Exact reviewed blobs:

- `operations/runtime/capacity-rescue-shadow.cjs`: `0bd582d1b41e203fb623112f2f4453fd67daaad7`
- `operations/runtime/capacity-rescue-shadow.current-base.test.cjs`: `50d1b1010ac8e2f42b2c75ac9790c8b094bea206`
- Target `Dockerfile`: `a31e87448e6950906691c13d56ed6c9cc986bb55` (unchanged)

## Commands and fail-closed gates

The workflow triggers only for pushes to this proof branch that change its own workflow path. It has read-only contents permission, owner/actor/repository/ref/event assertions, SHA-pinned checkout v4.2.2 and setup-node v4.4.0, no persisted checkout credentials and Node `22.23.2`. It checks out and verifies the target HEAD, both reviewed blob IDs and Dockerfile blob before execution.

```sh
node --test operations/runtime/capacity-rescue-shadow.current-base.test.cjs operations/runtime/decision-episode.test.cjs operations/runtime/demand-decision-service.test.cjs
git diff --exit-code HEAD
docker build --progress=plain --build-arg RAILWAY_GIT_COMMIT_SHA=4a0946de945490f8b927c08863d2e2cf2a17efd0 --tag capacity-rescue-proof:4a0946d --file Dockerfile .
docker image inspect capacity-rescue-proof:4a0946d --format 'FINAL_IMAGE_ID={{.Id}}'
```

The final inspection overrides the image entrypoint with Node, disables network, uses the unprivileged node user, drops capabilities, denies privilege escalation and makes the filesystem read-only. It asserts Node `v22.23.2` and `/app/.wfm-build-source-sha` equal the target. At `/app/operations-runtime/capacity-rescue-shadow.cjs`, existence requires a SHA-256 byte match to reviewed source; absence is explicitly logged as installation not proven. The unchanged Dockerfile does not explicitly copy this module into its final operations runtime. A sealed SHA alone is not proof of module installation or enabled behavior.

The `always()` verdict requires both authority and admission jobs to succeed; failed, skipped or cancelled prerequisites cannot yield green. No unchanged failed workflow is rerun. Any build/test failure is a blocker to image admission, not permission to alter product/build gates or release state.

## Proof ladder and limits

1. Existing PR #333 review reported committed tests 48/48 and independent adversarial held-outs 6/6 (54/54 aggregate) on Node 24.19.0. This workflow does not rerun the out-of-tree held-outs or relabel them as Node 22 evidence.
2. Successful focused source suites under exact Node 22.23.2 establish isolated target source admission only.
3. A successful unchanged Docker build plus final sealed-SHA inspection establishes an isolated exact-target image build. Installed module identity is separately reported only if the inspected final path exists byte-for-byte.
4. Canonical-owner reconciliation/integration, exact integrated-candidate image/security gates, deployment, authenticated tenant execution, durable-state proof and customer outcome evidence remain separate, pending gates.

The accepted product delta only rejects negative economic components. It does not bind the full constraint/economic graph into the episode identity or prove semantic non-overlap/source authority of submitted benefits. Savings remain hypotheses, not measured customer value. PR #333 is based on historical `90ad90fc...`; this package does not integrate it with the current base. Only the canonical owner may reconcile, integrate, deploy or admit customer proof.

## Execution record

This file specifies admission, not a preclaimed green result. Exact proof PR/head/run identities and observed status are recorded in the draft PR and external completion report after submission. A green result never means integration, deployment, enabled Capacity Rescue behavior, durable state, customer proof, measured savings or production authority.
