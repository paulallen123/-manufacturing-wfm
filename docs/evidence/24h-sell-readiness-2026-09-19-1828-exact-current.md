# Manufacturing WFM 24-hour sell-readiness — exact-current cloud evidence

Recorded: 2026-09-19 18:28 UTC
Candidate branch: `feature/one-day-enterprise-implementation-v1`
Candidate SHA: `18be0c40d47b58bef7b472cfce28946f30228b55`
Evidence branch: `evidence/24h-sell-readiness-20260919-1828-exact-current`

## Provenance and release controls

- GitHub reports candidate SHA `18be0c40d47b58bef7b472cfce28946f30228b55` as cryptographically verified (`reason=valid`).
- The feature branch remains unprotected and the repository currently has no server-side rulesets. The existing integration-proof security hold was therefore not bypassed.
- No new Railway service/resource was created. No paid infrastructure was added. No readiness/security flag was weakened.
- The frozen customer-proof release was not changed or redeployed.

## Exact-current one-day Railway candidate

Existing Railway service: `wfm-one-day-enterprise-v1`
Deployment: `d5a80c72-1199-4438-9d4a-b52f589552cb`
Source SHA: `18be0c40d47b58bef7b472cfce28946f30228b55`
Result: `SUCCESS`

Build/admission receipts:

- `96` tests, `96` pass, `0` fail, `0` skipped.
- `WFM_T0_T4_AUTONOMY_ADMISSION=PASS`.
- `VECTOR_ONLY_PRESENTATION_ADMISSION=PASS`.
- Hosted runtime listens on `0.0.0.0:3000` and reports: `Fixture/demo data only. Production approved: false.`

Exact-candidate cloud scale and payroll proof:

- Employees: `10,000`.
- Sites: `50`.
- Punches/clockings: `100,000`.
- Timecards: `40,000`.
- Independent clean payroll: expected `15,180,000`; projected `15,180,000`; unexplained variance `0`; variance count `0`.
- Deliberate corruption: projected `15,180,020`; unexplained variance `20`; variance count `1`; the corruption was detected rather than accepted.
- Hostile-data checks detected duplicate employee IDs, an orphan manager, missing workforce structure and a malformed punch, and blocked unsafe auto-apply.
- Configuration-engine identity check was exact.
- `productionMutation=false`; `customerMutation=false`.
- Claim boundary remains explicit: this proves cloud execution, scale behaviour and fail-closed data handling; it does not claim a live payroll/HCM/ERP provider connection or customer production implementation.

The one-day implementation timing model still reports `SYNTHETIC_THEORY_ONLY`; it is architecture timing simulation and is not customer, production, payroll or implementation evidence. It therefore does not close the zero-human customer-provisioning gate.

## Exact-current hosted role-first browser matrix

Existing Railway audit service: `wfm-built-ui-audit`
Post-target-success audit deployment: `6cf94da0-5900-418b-90e5-216c8f95d05c`
Audited candidate SHA: `18be0c40d47b58bef7b472cfce28946f30228b55`
Result: `SUCCESS`

The audit was rerun after the exact-current one-day service had successfully deployed. Real headless Chromium produced these receipts:

- `CURRENT_TIME_REVIEW_EMPTY_STATE=PASS|active=0|invented=0`.
- Manager: `PASS`, role `manager`, tenant `northstar-demo`, navigation `Time & Attendance`, screenshot SHA-256 prefix `61aef660fa0b0f78`.
- Employee: `PASS`, role `employee`, tenant `northstar-demo`, screenshot SHA-256 prefix `67c97b844708b5d1`.
- Payroll: `PASS`, role `payroll_admin`, tenant `northstar-demo`, navigation `Reports`, screenshot SHA-256 prefix `2337ab912dbadf7a`.
- Company admin: `PASS`, role `director`, tenant `northstar-demo`, navigation `Integrations`, screenshot SHA-256 prefix `7c5d184c3135ffd9`.
- Isolation manager: `PASS`, role `manager`, tenant `isolation-test`, navigation `Time & Attendance`, screenshot SHA-256 prefix `61aef660fa0b0f78`.
- Final receipt: `CURRENT_CANDIDATE_ROLE_BROWSER_MATRIX=PASS|roles=5|navClicks=4|activeActionJourneys=0|emptyStateJourneys=1|sha=18be0c40d47b58bef7b472cfce28946f30228b55`.
- `BROWSER_PROOF_SERVER=PASS`.

The exact-current manager fixture had zero active authoritative Time Review actions. The browser proof therefore did not manufacture an action merely to exercise a click. It proved that the authoritative action-evidence bridge was available and returned a valid zero-active state, and that the Vector UI rendered zero Time Review action buttons. The active-source action/open/return-context path is retained and remains fail-closed for fixtures that contain active authoritative evidence, but that path was not exercised by this exact-current fixture.

## Defects found and repaired safely

Two proof/runtime defects were addressed without weakening the product claim boundary:

1. Hosted browser-proof liveness: the proof service previously waited until the complete browser matrix before opening its health listener, allowing Railway liveness to terminate a valid long-running proof. PR #172 changed the proof harness to listen in `RUNNING` state first and emit `PASS` only after proof completion; failures still terminate the service.
2. Hosted Time Review action-evidence source: the authoritative loopback replay lost hosted reverse-proxy protocol context and returned `502` while authenticated `/api/time-review` itself was healthy. The candidate now preserves a sanitised `x-forwarded-proto` value (`http`/`https` only) on the existing loopback source request, with regression coverage.
3. Browser source-state completeness: PR #175 keeps the role proof fail-closed for both legitimate authoritative states — exercise a bound action when active evidence exists, or prove that the UI invents no action when the authoritative source is empty.

A more invasive public-origin hairpin proposal was closed without merge after the narrower reverse-proxy-context repair became available.

## Integration-proof service blocker

Existing Railway service: `wfm-integration-fabric-v1-proof`
Exact-current attempt: `6bc7f2a5-e919-43d6-a5dc-a24ca2a89694`
Requested source SHA: `18be0c40d47b58bef7b472cfce28946f30228b55`
Result: `FAILED` before product build.

The failure is the deliberate root-directory security hold: `__security_hold_7b6f9d22e1__` does not exist in the source snapshot. The hold was intentionally left intact because the feature branch is still unprotected and repository rulesets remain absent. This is a release-governance blocker, not a product-test failure, and the combined two-service candidate is not green.

## Still unproven / claim boundary

- No authorised real external-provider sandbox/API receipt was produced in this run. Provider connectivity must remain classified as fixture/contract evidence unless a genuinely authorised provider call is evidenced.
- A genuinely zero-human customer/environment provisioning run is not yet proven. The timing model remains explicitly `SYNTHETIC_THEORY_ONLY`.
- The integration-proof service is not on the exact-current SHA because its security hold remains active.
- Consequently sell-readiness remains `CONDITIONAL`; no readiness flag was changed to manufacture a pass.
