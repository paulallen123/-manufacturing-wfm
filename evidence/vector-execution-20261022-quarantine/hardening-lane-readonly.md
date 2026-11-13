# Existing hardening lane: read-only assessment, 2026-10-22

No remote mutations, secret values, or credentials accessed by this assessment.

## Candidate proof lane

- Project: vector-hardening-proof / 43367a88-2233-4c6b-9018-0ce234dd73ca.
- Only environment returned: production / eed9f097-610a-416e-83b9-6bc7bdb3eeef.
- Service: vector-hardening-proof / 48ee3ceb-9cfc-4399-b3a1-3628e3603815.
- Configured source: paulallen123/-manufacturing-wfm, branch release/vector-hardening-pre-freeze-20260925, checkSuites false, builder RAILPACK.
- Latest deployment: 36ce7d6b-5801-412e-a924-8dbd7a33dce9, SUCCESS, created 2026-10-17T15:13:09.244Z.
- Deployment metadata: SHA 5ea6d4664e52348557e7e6284fe75a1c98d8a976, branch main. This differs from the current configured source branch; do not attribute serving bytes to configured branch.
- Provider marks this deployment canRollback=true and canRedeploy=true.
- Existing domain: https://vector-hardening-proof-production.up.railway.app, port3000.
- Runtime health path /api/health, timeout180, sfo one replica, no volume or TCP proxy.
- Variable NAMES only observed: NODE_ENV, NODE_OPTIONS, PORT, WFM_DB, WFM_HOSTED_STAGING, WFM_PUBLIC_ORIGIN, WFM_REQUIRE_DURABLE_STATE, WFM_STAGING_PASSWORD. Values and their validity not assessed.
- No per-service staged changes.

## Outside-in observations

GET /api/health returned HTTP success and JSON status ok, mode hosted-staging, fixtureOnly true, hosted true, productionApproved false, pilotReady false, release 0.6.76-hosted-staging-rc1. Curl exit0.

GET /api/runtime-identity returned401 (curl exit22). The public interface does not independently expose the source SHA for this older artifact. Provider deployment metadata is the only fresh SHA evidence obtained for this lane. Authenticated identity readback remains required.

## Ownership assessment

Open PR search for exact phrase vector-hardening-proof returned no matches. Issue search for exact service UUID returned no matches. Issue288 comments contained historical broad redeploy warning https://github.com/paulallen123/-manufacturing-wfm/issues/288#issuecomment-5973660233 requiring bounded recovery-verification authority before proof admission; this does not establish current ownership. Issue265 full-comment retrieval failed twice with Transport closed. Therefore lane ownership is UNKNOWN, not inactive or free. Project service state and age do not prove ownership availability. Parent should use current canonical ownership ledger/handoff before repurposing it.

## Serving candidate must remain untouched

Same environment contains pending STAGED patch b453aa80-4763-4a08-a4f5-d5d27534b2c8, updating customer-ready service cded4ff7-24b1-4aaa-a7e2-67f143583bc2 from90ad90fcf60adaca9abacdd4ad14bf392f95e585 to48dce8f697825c8cd5f99b3e5aeea3953647f8c2. Environment-wide accept-deploy would include that change. Do not use accept-deploy merely to configure this proof lane.

The connector exposes connect_service_source with repo, branch, commitSha, serviceId and staged:false. It pins/rebuilds one service without accepting the global patch, but applies to all environments. Only one environment was observed. This is a technically available operation, not an ownership or release authorization determination. Existing resource reuse avoids adding services/replicas/subscriptions; build/usage charges still exist and must remain inside the established budget.

## Minimum route once prerequisites are met

1. Establish exclusive use of service48ee and preserve its current rollback source/deployment/configuration.
2. Freeze a combined, reviewed inference+Autopilot repair SHA, including explicit proof trigger and cold exact-image CI admission. Passing one repair's CI does not prove combined bytes.
3. Validate hosted-mode, origin, staging credential, DB-path and Node22 contract securely without printing values. Determine Dockerfile build compatibility; current service builder is RAILPACK, not proof that the combined Dockerfile is used.
4. Pin only service48ee to the combined SHA via the permitted service-scoped source operation; preserve the global candidate patch. Verify terminal deployment success and outside-in build-file-bound identity.
5. Run bounded synthetic authenticated HTTP/browser proof with a separate verifier. Existing vector-live-browser-proof f84fe27d-af17-451c-b164-54dfef6b6a4b has Playwright1.63 image and signed-proof credential variable names, but is bound to protected candidate/run variables and has no publicly exposed domain. Do not repoint it or reuse its credentials without owner-approved exact scope; names do not prove valid access.
6. No volume exists on48ee: this lane cannot currently establish deployment-restart durability. Use it only for honest scoped runtime/browser evidence unless a separately authorized durable lane is available. Do not claim full recovery/customer proof.

## Release controls read at canonical48dce8f

- release/proof-lane-policy.json: explicit freeze trigger, pre-freeze simulation, live runtime contract and outside-in reachability; exact source across lanes; skipped is NO_PROOF; two independent providers for production promotion; fixture/staging artifact cannot prove production readiness.
- release/development-proof-control.json: implementation changes require source+exact-image+hosted-runtime+restart recovery; operations changes require source+exact-image+authenticated Golden Journey+fresh-login persistence+restart recovery; quarantine affected capability without halting unrelated work.
- artifact/vector-proof-freeze.trigger previously inspected: promotion needs exact Golden Journey, evidence continuity, independent verification, recovery, cold rerun after fixes.
- .github/workflows/canonical-staging-release.yml targets a different old one-day service8cadddc3 in test project; integration-proof-exact-gated-release.yml targets2631d462 in staging-proof project. Neither directly provides this combined canonical repair lane. Do not dispatch those workflows as if they deploy service48ee.

Assessment: closest existing resource is48ee, but it is NOT yet an admitted, unowned proof lane. Immediate remaining gates are exclusive ownership, combined exact artifact admission, protected configuration validation, build/identity binding and scoped verifier authority. No new spending approval is inherently required merely to inspect or prepare; do not assert zero deployment cost.
