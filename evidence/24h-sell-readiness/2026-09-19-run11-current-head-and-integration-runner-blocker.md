# WFM 24-hour sell-readiness evidence — run 11

Recorded against product candidate `31f4203c2cb3a7c3130350c0bc74839e090c39da` on `feature/one-day-enterprise-implementation-v1`.

## Candidate provenance

- GitHub branch head: `31f4203c2cb3a7c3130350c0bc74839e090c39da`.
- GitHub commit verification: cryptographically verified (`verified=true`, reason `valid`).
- The merge commit message states PR #176 is a release-only exact-SHA integration-proof path with no product-runtime/readiness-claim change.
- Feature branch remains unprotected. No control was relaxed in this run.

## Existing Railway service — one-day enterprise candidate

Service: `wfm-one-day-enterprise-v1`

- Existing service only; no new resource created.
- Railway deployment id: `6592cbfd-8563-4af3-97aa-c71fb43d7953`.
- Railway source metadata identifies exact commit `31f4203c2cb3a7c3130350c0bc74839e090c39da` and branch `feature/one-day-enterprise-implementation-v1`, proving private GitHub source access was available for this candidate.
- At the time this evidence note was written the Railway deployment state was still `BUILDING`, so this note does **not** claim successful runtime promotion or healthcheck completion.

Build evidence already completed inside that exact candidate image before final image export:

- `WFM_T0_T4_AUTONOMY_ADMISSION=PASS`.
- `SEALED_RUNTIME_PRESENTATION_REPAIR=PASS` and retired-presentation purge passed.
- Node test suite: `96` tests, `96` pass, `0` fail, `0` skipped.
- `VECTOR_ONLY_PRESENTATION_ADMISSION=PASS`.
- Cloud scale/payroll harness: `PASS`.
- Scale: 10,000 employees, 50 sites, 100,000 punches, 40,000 timecards, 1,750 cohorts.
- Independent clean payroll reconciliation: expected `15,180,000`, projected `15,180,000`, unexplained variance `0`, variance count `0`.
- Deliberate corruption: expected `15,180,000`, projected `15,180,020`; exact +20 variance was detected as one variance rather than accepted.
- Hostile-data gates detected duplicate employee ID, orphan manager, missing structure and malformed punch; structural auto-apply failed closed.
- Lifecycle tests passed for overnight clocking, duplicate/post-leaver clock rejection, absence bounded by employment, approved overtime override, agency assignment windows, starter/transfer/leaver effective dates, retro-change evidence, and integration-outage checkpoint recovery.
- Role learning/mastery tests remained fail-closed: implementation cannot be marked READY until role competence evidence exists; browser self-certification is rejected; coach/trainer roles require teach-back evidence.
- Tenant-isolation, OAuth/PKCE, credential containment, provider substitution/expiry, malicious pagination and integration control-plane RBAC tests passed.

Claim boundary retained by the build itself: the scale/payroll harness proves cloud execution, scale behaviour and fail-closed data handling only. It does not claim a live payroll/HCM/ERP provider connection or customer production implementation.

The one-day timing simulation still self-labels `SYNTHETIC_THEORY_ONLY` and states: architecture timing simulation only, not customer/production/payroll/implementation evidence. This run does not promote that to real zero-human implementation proof.

## Existing Railway service — integration proof

Service: `wfm-integration-fabric-v1-proof`

- Existing security hold `rootDirectory=/__security_hold_7b6f9d22e1__` was preserved.
- Exact-SHA pre-deploy validation was preserved.
- Last known successful runtime remains `2dbe3913e50941f90c8e8d73f8c4ff14517e3d24`.
- A normal source-bound build correctly fails when the checkout does not contain the hold directory; this is expected fail-closed behaviour and was not bypassed.

The exact gated release workflow for `31f4203c…` was re-run. GitHub Actions run id `35461430347`, attempt 3, failed before executing any workflow step. The release job id was `105949831120`, with `steps=[]`, `runner_id=0` and blank runner name; fetching job logs returned no log blob. Therefore the exact integration release remains blocked by GitHub Actions runner allocation, not by application tests or Railway runtime code.

The same `ubuntu-24.04` label has executed successfully on this repository in earlier successful workflow runs, so changing the runner label without evidence would be speculative and was not done.

## Provider proof and readiness boundary

Relevant proof service variables inspected in this run exposed no provider-specific authorised sandbox credential set for Entra, Okta, Google Workspace, HCM, payroll or ERP. No provider is therefore claimed live; fixture/provider-contract tests remain labelled accordingly.

Sell-readiness remains **CONDITIONAL**. Hard outstanding evidence gates are:

1. execute the exact gated integration-proof release on the existing service without weakening its hold;
2. demonstrate an authorised non-fixture external provider sandbox/API receipt;
3. execute a genuine zero-human customer/environment provisioning run rather than the synthetic timing model;
4. if the current one-day Railway deployment does not reach `SUCCESS`, diagnose that exact deployment without changing readiness flags.

No new paid resource, frozen customer-proof release mutation, security-control relaxation, or readiness-flag override was made in this run.
