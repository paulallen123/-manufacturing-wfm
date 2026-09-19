# 24h sell-readiness release-path evidence — 2026-09-19 23:56 BST

## Exact candidate
- Feature branch head: `c0750bbdd165ec21d3197f2ecc39cc4a8ce8d06f`
- GitHub commit verification: cryptographically verified.
- Origin: merge of PR #181, a release-only change to `.github/workflows/integration-proof-exact-gated-release.yml`.
- Product runtime / Vector role-first UX change relative to the previously proven candidate: none.

## One-day enterprise Railway service
- Existing service: `wfm-one-day-enterprise-v1`
- Project: `9cd73309-0ece-4b9a-891f-7daa13d94f0d`
- Environment: `9e7875b6-e214-4c32-9cee-81235e3d49ff`
- Service: `8cadddc3-15e9-4c38-a93f-0af829054f29`
- Exact-current deployment attempt: `bf118f0a-b8e0-4890-9d5a-d5c2af65a29e`
- Commit resolved by Railway: `c0750bbdd165ec21d3197f2ecc39cc4a8ce8d06f`
- Result: `FAILED` before build; build/deploy logs empty.
- Fail-closed source configuration remains unchanged: root directory `/__security_hold_one_day_enterprise__`.
- Last successful runtime deployment: `b2ae8d64-3a2a-498e-9e95-86fb54c53276` at `c9878364b02dffb77c21702d58af35c344e5ff68`.
- No security hold, readiness flag, root directory, or customer-proof release was weakened or changed to obtain a pass.

## Integration proof Railway service
- Existing service: `wfm-integration-fabric-v1-proof`
- Project: `9a774359-37fa-47e8-bde0-932420c32923`
- Environment: `6a33f2c1-bedd-46dc-85e7-2ef5d3b54de6`
- Service: `2631d462-61bf-4c01-ac4b-e106a562feeb`
- Exact-gated GitHub Actions run: `35474819920`
- Rerun job: `105982197343`
- Result: `completed/failure` before any workflow step; `steps=null`, so checkout, exact-SHA verification, secret access, Railway CLI upload and application code were not reached.
- Existing integration security hold remains intact.
- Last successful integration runtime: deployment `6a625a13-ba37-4203-8f84-a816a6fc4081` at `2dbe3913e50941f90c8e8d73f8c4ff14517e3d24`.

## Interpretation
This run proves Railway private-GitHub source resolution reaches the exact current candidate, but the normal one-day source path remains intentionally fail-closed behind its hold and the approved exact-upload path for the integration service remains blocked before runner allocation. These are release-path / execution-infrastructure failures, not evidence of an application-runtime regression. The combined exact-current candidate must not be called green until both existing services run the same admitted candidate through their security controls.

## Readiness claims deliberately not promoted
- `production_approved`: remains false.
- Authorised non-fixture external-provider proof: not established in this run.
- Genuine zero-human customer/environment provisioning proof: not established in this run.
- Frozen customer-proof release: untouched.
- New paid infrastructure/resources: none.
