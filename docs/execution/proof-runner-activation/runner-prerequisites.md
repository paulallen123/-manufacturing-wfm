# Existing signed browser runner — concrete prerequisites

Reviewer `/root/build_route_review`; source `4ed5eb3668452a0229469b8e1d426e84eea18187`. Read-only review: no secret values read, identity created, configuration changed, build started or provider called. Existing runner: project43367a88-2233-4c6b-9018-0ce234dd73ca / environment eed9f097-610a-416e-83b9-6bc7bdb3eeef / service f84fe27d-af17-451c-b164-54dfef6b6a4b.

The current runner is not compatible with the canonical signed client by adding variables alone. It runs inline BROWSER_PROOF_SCRIPT, recognizes VECTOR_SIGNED_READONLY_MATRIX, requires status PROVEN and exact source/deployment before launching BROWSER_ROLE_PROOF_SCRIPT. The canonical client deliberately emits CURRENT_SIGNED_AUTH_NAVIGATION=PARTIAL. Existing VECTOR_SCOPE_JSON and WRAPPED_PASSKEY_CREDENTIALS are not inputs to this canonical authentication path.

## Minimum target-side setup

1. Actual admitted candidate application bootstrap must serve a verified HTTPS origin; the receipt-only build server is insufficient. Its /api/runtime-identity and response headers must independently report the exact SHA, build-file-matched, fixtureOnly:true and productionApproved:false. WFM_CANDIDATE_SHA must match /app/.wfm-build-source-sha. Preserve hosted non-root and durable-volume controls.
2. Enable only the existing staging signed-auth boundary: NODE_ENV=staging, WFM_HOSTED_STAGING=true, WFM_PROOF_RUNNER_AUTH=enabled, WFM_PUBLIC_ORIGIN equal to that origin, WFM_DB on the approved isolated volume, WFM_PROOF_RUNNER_PUBLIC_KEY_B64 matching the existing protected Ed25519 signer, and WFM_PROOF_RUNNER_ALLOWED_EMAILS limited to the five chosen synthetic actors. Optional session TTL is 1–30 minutes; default15 minutes. No passkey or Google/Apple provisioning is required for this separate proof-only session route. Do not expose or copy the private signer into source/evidence; verify key matching inside an authorized secret-aware runtime, revealing at most a public-key fingerprint.
3. Reuse the existing artifact's fictional fixtures after observing them through the actual app. The inspected sealed/composed bootstrap creates14 fixture accounts on an empty database; five already cover this proof matrix. No manual database grants or new customer identities are needed. Explicit scope can use the table below only if live persisted identities agree. The server refuses missing or normalized-email-ambiguous users and derives role/tenant from stored user records, not actor JSON.

| Slug | Synthetic email | Tenant | Required stored role |
|---|---|---|---|
| manager | manager@northstar.example | northstar-demo | manager |
| employee | maya@northstar.example | northstar-demo | employee |
| payroll | payroll@northstar.example | northstar-demo | payroll_admin |
| company-admin | superuser@northstar.example | northstar-demo | director |
| isolation-manager | other@isolation.example | isolation-test | manager |

4. An actual implementation run and applied tenant configuration must exist for the primary tenant. A fresh database returns NOT_STARTED; expected values cannot create this state. The client requires status.runId, tenantEnvironment.runId, isolation.tenant and configurationDigest, plus nonempty current requirement evidenceBinding.expected entries matching exact SHA/deployment/tenant/run. Obtain these from authoritative current status after setup, never invent them. Existing /contract-activated accepts a separately authorized internal credential and synthetic scope, creates a run/environment before notification; /contract-signed is fail-closed without a verified signing-provider adapter. For a synthetic run, preserve an explicit synthetic contract/source designation and prevent real notification delivery. Do not fabricate a completed real contract or provider receipt. Existing managed workspace or preexisting run association constraints must be respected; reuse/reconcile rather than reset.

## Minimum existing-runner configuration

Set VECTOR_PROOF_AUTH_PROFILE=signed and VECTOR_PROOF_ACTORS_JSON to the five verified mappings. Supply VECTOR_PROOF_URL as the exact HTTPS origin with trailing slash; WFM_EXPECTED_CANDIDATE_SHA, EXPECTED_DEPLOYMENT_ID, EXPECTED_IMPLEMENTATION_TENANT, EXPECTED_IMPLEMENTATION_RUN_ID and EXPECTED_CONFIGURATION_DIGEST from the actual target. Reuse PROOF_PRIVATE_KEY_B64 only after secure format/matching validation: canonical base64 PKCS8 PEM Ed25519. Variable presence does not prove validity. Existing legacy aliases EXPECTED_CANDIDATE_SHA/EXPECTED_CANDIDATE_DEPLOYMENT are not canonical substitutions.

For exact asset proof, set WFM_REQUIRE_VECTOR_ASSET_DIGESTS=true with independently derived VECTOR_CANONICAL_JS_SHA256, VECTOR_CANONICAL_CSS_SHA256 and VECTOR_WORKFLOW_JS_SHA256 from the candidate artifact, then compare served bytes. Do not obtain expected digests solely from the same hosted response being checked. WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE=true requires an authoritative Needs my action row and an Awaiting source confirmation row; absence remains a failed/unexercised gate, not permission to synthesize success.

## Compatible replacement on the same service

Keep the current Playwright1.63.0 image/service and replace its incompatible inline orchestration with a reviewed, hash-checking materializer plus the canonical server. Materialize exactly these files under /tmp/vector-browser-proof preserving their relative layout:

- scripts/current-candidate-role-browser-proof.mjs — blob b736e153d621daeec4915fbe8627885b6496ff00
- scripts/current-candidate-role-browser-proof-server.mjs — blob17304e46922293a92394938de25972a2148bfc8c
- scripts/vector-proof-result.mjs — blob68d4fb92d52b3a06f273a22044b3f9e16a8857a0
- security/runtime/proof-runner-auth.cjs — blob805cb35ce2f750c663be41e8ef6bc780c738a621

Place playwright@1.63.0 in /tmp/vector-browser-proof/node_modules (ESM imports require actual ancestor package resolution; NODE_PATH alone is insufficient), verify the runner Node supports node:sqlite, and launch node /tmp/vector-browser-proof/scripts/current-candidate-role-browser-proof-server.mjs. Reuse existing runtime install mechanism only with checked exit status; source byte materialization itself still needs preparation/review before a startCommand change. No new runner/service/lane is needed. Do not run both old and canonical children or carry the old PROVEN gate forward. Existing /health can remain a liveness path because the canonical wrapper serves its body there; /ready deliberately returns503 while productReady is false. Preserve canonical failure behavior and restart policy.

The canonical signed branch performs authenticated role navigation/source presentation only, then stops before fixture-password leave/attendance/payroll mutations. Successful outcome stays PARTIAL, business-journey fields false/null, endToEndVerified:false, productReady:false. It does not submit payroll. Existing logs alone cannot be labelled whole customer proof. Signed mode computes role screenshot hashes but does not persist screenshot/trace files; actual reviewable screenshot/trace capture remains a separate evidence gap, not something to claim from these hashes.

## Verified evidence and outstanding facts

Six principal files were independently fetched at exact4ed5 and Git-blob matched against materialized sources; result helper independently fetched as seventh. Existing runner config read showed no staged changes, image mcr.microsoft.com/playwright:v1.63.0-noble, /health, restart NEVER, and missing VECTOR_PROOF_AUTH_PROFILE/VECTOR_PROOF_ACTORS_JSON by name. No variable values were accessed. Local Node22 auth-client/preflight suite passed35/35, zero skips; synthetic transport fixtures are not live browser proof.

Unresolved: actual target origin/deployment/serving source after build; existing signer/public-key match; target auth activation and current allowed users; target run/applied configuration; strict asset digests and required action-state rows; safe source materialization into the existing image. These are precise setup/verification prerequisites. No extra product, controller or release lane is proposed.
