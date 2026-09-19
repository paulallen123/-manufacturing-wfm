# 24-hour sell-readiness evidence — exact-current role browser matrix

Captured against feature candidate `4962412edf56bed407fd8ab368bd56e26f96f6cc`.

## Proven current-candidate Railway provenance

- Existing service only: `wfm-one-day-enterprise-v1`.
- Railway deployment: `d5eb8771-0868-484b-adce-592f70ea773e`.
- Source commit: `4962412edf56bed407fd8ab368bd56e26f96f6cc` from `paulallen123/-manufacturing-wfm`, branch `feature/one-day-enterprise-implementation-v1`.
- Deployment status: `SUCCESS`; `/api/health` succeeded on the first attempt.
- Runtime claim boundary remains authoritative: fixture/demo data only; `productionApproved=false`.
- Exact Railway build passed 87/87 tests, Vector-only presentation admission, and the cloud scale/payroll proof already emitted by that deployment.
- Scale/payroll figures from the exact build: 10,000 employees, 50 sites, 100,000 clockings, 40,000 timecards; expected payroll 15,180,000 = projected 15,180,000; unexplained variance 0. A deliberate +20 corruption was detected exactly.
- The one-day timing model remains `SYNTHETIC_THEORY_ONLY`; this evidence does not relabel it as a real customer implementation.

## Hosted authenticated role-browser matrix

Existing proof service only: `wfm-vector-mobile-proof`; no new Railway resource was created.

Proof deployment: `859d0c91-643a-45ef-b2b6-994e6f1b2c50`, status `SUCCESS`.

Target origin: `https://wfm-one-day-enterprise-v1-production.up.railway.app`.

Expected candidate SHA pinned by the harness: `4962412edf56bed407fd8ab368bd56e26f96f6cc`.

The harness used real headless Chromium/Playwright against the hosted Railway origin. For every role context it required:

- fresh unauthenticated `/api/bootstrap` => HTTP 401;
- real hosted `/api/login` => HTTP 200;
- authoritative role and tenant from authenticated `/api/bootstrap`;
- required role surface => HTTP 200;
- payroll RBAC boundary as expected;
- `/vector-shell.js` => HTTP 200 and marker `VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1`;
- Vector shell loaded by the page and Vector DOM nodes present;
- retired presentation markers absent from the served Vector asset;
- non-trivial authenticated rendered DOM;
- no horizontal overflow at desktop 1440x1000 or mobile 390x844;
- keyboard focus leaves the body after Tab;
- no uncaught page errors;
- a real full-page screenshot generated and SHA-256 hashed without persisting credentials.

Observed passes:

| Context | Authoritative role | Tenant | Payroll | Required surface | Role-first navigation | Screenshot SHA-256 prefix |
|---|---|---|---:|---|---|---|
| manager | manager | northstar-demo | 403 | `/api/time-review` 200 | Time & Attendance clicked | `61aef660fa0b0f78` |
| employee | employee | northstar-demo | 403 | `/api/personal` 200 | not applicable in this gate | `772c0a3e4753f609` |
| payroll | payroll_admin | northstar-demo | 200 | `/api/payroll-run` 200 | Reports clicked | `2337ab912dbadf7a` |
| company-admin capability account | director | northstar-demo | 200 | `/api/onboarding` 200 | Integrations clicked | `7c5d184c3135ffd9` |
| isolation-manager | manager | isolation-test | 403 | `/api/bootstrap` 200 | Time & Attendance clicked | `61aef660fa0b0f78` |

Final proof line:

`CURRENT_CANDIDATE_ROLE_BROWSER_MATRIX=PASS|roles=5|navClicks=4|sha=4962412edf56bed407fd8ab368bd56e26f96f6cc`

This materially clears the prior gap that the current deployed candidate lacked an authenticated hosted role-by-role browser proof. It does not prove every possible task click path, production readiness, real employee data, or an authorised external provider integration.

## Gates deliberately not bypassed

`wfm-integration-fabric-v1-proof` remains on its last known-good held runtime. Its source root is deliberately set to `__security_hold_7b6f9d22e1__`; the hold was not removed because the feature branch remains unprotected and the repository has no server-side rulesets. Alignment of the second service was therefore not manufactured by weakening release controls.

The current feature commit is unsigned/unverified. This is a release-authority blocker, not a runtime test failure.

GitHub Actions `Vector-only UI guard` was rerun. Attempt 2 again completed `failure` without a runner: job `105924544597` has `steps=[]`, `runner_id=0`, and label `ubuntu-24.04`. There are no job logs because no runner executed steps. This remains a CI infrastructure/admission failure; it is not used to override the successful in-Railway Vector admission or the hosted browser proof.

## Remaining hard evidence gaps

1. Protected/verified release authority sufficient to lift the integration-service security hold without weakening controls, followed by exact-SHA alignment of both existing services.
2. A genuinely authorised external-provider sandbox/test API proof where access already exists. Fixture/provider simulators must remain labelled fixture-only.
3. A real zero-human customer/environment provisioning run. The timing simulation is explicitly not that proof.
4. End-to-end coverage can continue to be strengthened beyond the five-role browser matrix; this file only records what was actually executed.

No frozen customer-proof release was changed, no paid infrastructure was added, no readiness flag was changed, and no secret value is recorded in this evidence.