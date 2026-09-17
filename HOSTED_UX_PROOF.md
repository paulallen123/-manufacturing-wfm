# Hosted UX proof — PR #37

## Status

PASS for isolated hosted staging validation.

- Railway service: `wfm-ux-pr37`
- Railway deployment: `b4425c26-cb54-436c-a78d-10d33b8e05df`
- Public origin: `https://wfm-ux-pr37-production.up.railway.app`
- UX branch proof commit: `63423c20e6640e7411ef803020a237afcb2f2b1e`
- Sealed runtime: `0.6.76-hosted-staging-rc1`
- Sealed runtime SHA-256: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`
- Fixture-only: true
- Production approved: false
- Pilot ready: false

## Live hosted proof

GitHub Actions run `35282255557` completed successfully.

The live service proved:

- exact release health and staging claim boundary;
- unauthenticated `/api/bootstrap` rejected with 401;
- manager login succeeded;
- manager bootstrap, weekly review, time review, operations and recommendations returned 200;
- manager payroll access was denied with 403;
- employee login succeeded;
- employee bootstrap, Personal, time review and attendance-corrections returned 200;
- superuser login succeeded;
- superuser bootstrap, readiness, schedule publication and payroll returned 200;
- the served JS contains the role-first manager navigation, leave decision evidence, condensed sign-off, manager Time Review, employee My Time and Cycle 9 specialist-workspace invariants;
- the served CSS contains the page-overflow containment, More drawer, condensed sign-off, manager Time Review and employee My Time presentation contracts;
- no standalone UX overlay route was introduced outside the sealed static allow-list.

Markers:

- `UX_MANAGER_ROLE_BOUNDARY=PASS`
- `UX_EMPLOYEE_SELF_SERVICE_APIS=PASS`
- `UX_SUPERUSER_SPECIALIST_APIS=PASS`
- `HOSTED_UX_ROLE_FIRST_BUNDLE=PASS`
- `HOSTED_UX_MANAGER_EMPLOYEE_CONTRACT=PASS`
- `LIVE_UX_PR37_BOOTSTRAP=PASS`

## Browser / responsive proof

On the exact hosted-proof head, the role-first gate and UX Cycles 2, 3, 4, 6, 7, 8 and 9 plus runtime-structure inspection all completed successfully. Those gates build the exact composed image and exercise the UX transforms in headless-browser harnesses, including desktop/mobile containment and preservation of authoritative controls.

## Promotion boundary

This evidence validates the new UX in isolated hosted staging. It does not change the production/pilot claim boundary. External provider evidence, independent security assurance, production-scale resilience/performance and production operational acceptance remain separate gates.
