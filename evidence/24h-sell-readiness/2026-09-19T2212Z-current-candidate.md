# WFM 24-hour sell-readiness evidence — 2026-09-19 22:12Z

## Candidate identity

- Candidate branch: `feature/one-day-enterprise-implementation-v1`
- Exact candidate SHA: `c9878364b02dffb77c21702d58af35c344e5ff68`
- Candidate is a GitHub cryptographically verified merge commit.
- Delta from the previously browser-proven `fce08f3018c73037ffff46b2d4e7c6c3d7d23085` is release-workflow-only: the exact integration release runner label changed from `ubuntu-24.04` to `ubuntu-22.04`; no product-runtime or Vector UX file changed.

## Railway GitHub source proof

Existing service only: `wfm-one-day-enterprise-v1` (`8cadddc3-15e9-4c38-a93f-0af829054f29`).

Fresh GitHub-source deployment:
- Deployment: `b2ae8d64-3a2a-498e-9e95-86fb54c53276`
- Exact Git SHA: `c9878364b02dffb77c21702d58af35c344e5ff68`
- Status: `SUCCESS`
- Runtime remained fail-closed/truthful: `Fixture/demo data only. Production approved: false.`
- Exact-image gates observed in the build include resilience policy, T0-T4 autonomy admission, sealed role-first presentation repair and retired-presentation purge.
- No new Railway resource was created.

## Exact-current hosted browser matrix

Existing browser audit service only: `wfm-built-ui-audit` (`59d09928-f233-47f4-9a5d-b890a65be08b`).

Deployment: `8f80eaee-7543-4bda-8d71-7598b7871227`

Receipts:
- `CURRENT_TIME_REVIEW_EMPTY_STATE=PASS|active=0|invented=0`
- `CURRENT_ROLE_BROWSER_PASS=manager|role=manager|tenant=northstar-demo|nav=Time & Attendance|shot=61aef660fa0b0f78`
- `CURRENT_ROLE_BROWSER_PASS=employee|role=employee|tenant=northstar-demo|nav=not-applicable|shot=67c97b844708b5d1`
- `CURRENT_ROLE_BROWSER_PASS=payroll|role=payroll_admin|tenant=northstar-demo|nav=Reports|shot=2337ab912dbadf7a`
- `CURRENT_ROLE_BROWSER_PASS=company-admin|role=director|tenant=northstar-demo|nav=Integrations|shot=7c5d184c3135ffd9`
- `CURRENT_ROLE_BROWSER_PASS=isolation-manager|role=manager|tenant=isolation-test|nav=Time & Attendance|shot=61aef660fa0b0f78`
- `CURRENT_CANDIDATE_ROLE_BROWSER_MATRIX=PASS|roles=5|navClicks=4|activeActionJourneys=0|emptyStateJourneys=1|sha=c9878364b02dffb77c21702d58af35c344e5ff68`
- `BROWSER_PROOF_SERVER=PASS`

The HTTP evidence showed real HeadlessChrome requests against the hosted origin, including pre-authentication 401s, successful logins, entitled role endpoints, expected payroll denial for a non-entitled role, and Vector asset retrieval.

## Exact integration release blocker

The integration release security model remains intact on existing service `wfm-integration-fabric-v1-proof` (`2631d462-61bf-4c01-ac4b-e106a562feeb`):
- `rootDirectory=/__security_hold_7b6f9d22e1__`
- watch pattern remains `security/manual-release-gate/**`
- exact-SHA pre-deploy validation remains enabled
- `/api/health` remains the health check
- no bypass, no new resource and no readiness weakening

PR #180 changed only the GitHub-hosted runner label from `ubuntu-24.04` to `ubuntu-22.04` to test whether the repeated pre-execution failure was image-specific. The resulting exact integration workflow run `35472206478`, job `105975083190`, again failed before a runner was allocated: `steps=[]`, `runner_id=0`, `runner_group_id=0`, labels `ubuntu-22.04`.

Conclusion: the blocker is not specific to the Ubuntu 24.04 image. The failure occurs before checkout, secrets, Railway CLI, source archive/upload or application code. The security hold was therefore retained.

Latest successful integration runtime remains deployment `6a625a13-ba37-4203-8f84-a816a6fc4081` on SHA `2dbe3913e50941f90c8e8d73f8c4ff14517e3d24`.

## Evidence interpretation / remaining gates

Sell-readiness remains **CONDITIONAL**. Do not promote it merely from fixture or synthetic evidence.

Still outstanding:
1. Execute the exact gated integration deployment for the current candidate after a GitHub-hosted runner is actually allocated, or via an equally strong immutable-commit mechanism that does not weaken the hold.
2. Produce authorised non-fixture external-provider sandbox/API evidence. No provider should be described as live until that exists.
3. Produce a genuine zero-human customer/environment provisioning run. The current one-day timing model remains `SYNTHETIC_THEORY_ONLY`.
4. Treat synthetic Tier-1 recovery proof as synthetic; do not represent it as frozen customer-runtime evidence.

The frozen customer-proof service was not changed in this run. No paid resources were created and no production/readiness flag was changed to manufacture a pass.
