# WFM 24h sell-readiness — exact-head dual Railway proof

Recorded: 2026-09-19T04:55Z

## Exact candidate

- Repository: `paulallen123/-manufacturing-wfm`
- Branch: `feature/one-day-enterprise-implementation-v1`
- Exact head: `8ad98fce8cd13b68793136403857b157654dacf7`
- Runtime-changing parent: `ff3f241f1cfc6b48fa220a7aaf0a6cc3e32b4b03`
- Head commit is documentation-only (`UX_SCORECARD_CYCLE12_R5.md`).

## Existing Railway services — exact source fetched and deployed

No new service, environment, database, volume, domain, or other Railway resource was created.

### wfm-one-day-enterprise-v1

- Project: `9cd73309-0ece-4b9a-891f-7daa13d94f0d`
- Environment: `9e7875b6-e214-4c32-9cee-81235e3d49ff`
- Service: `8cadddc3-15e9-4c38-a93f-0af829054f29`
- Deployment: `fe55a405-2c04-4a8a-becb-a54927290ada`
- Railway source metadata commit: `8ad98fce8cd13b68793136403857b157654dacf7`
- Status: `SUCCESS`
- `/api/health`: Railway healthcheck succeeded on first attempt.

### wfm-integration-fabric-v1-proof

- Project: `9a774359-37fa-47e8-bde0-932420c32923`
- Environment: `6a33f2c1-bedd-46dc-85e7-2ef5d3b54de6`
- Service: `2631d462-61bf-4c01-ac4b-e106a562feeb`
- Deployment: `db44d36a-4212-4677-8383-facd0cf4be6e`
- Railway source metadata commit: `8ad98fce8cd13b68793136403857b157654dacf7`
- Status: `SUCCESS`
- `/api/health`: Railway healthcheck succeeded on first attempt.

## Candidate proof carried by this exact runtime lineage

The current governed browser/build gate completed successfully for the feature head. The Docker candidate admitted strict T0–T4 bounded autonomy and passed 66/66 runtime tests. The cloud-scale proof covers 10,000 employees, 50 sites, 100,000 punches and 40,000 timecards. Independent payroll reconciliation produced expected total 15,180,000 and projected total 15,180,000 with zero unexplained variance; a deliberate +20 corruption was detected as a 20-unit variance.

The browser gate exercised the composed Vector role-first UI with real headless Chromium and passed Integrations roundtrip/return focus, Absence, Time Review and Weekly Sign-off destinations, plus mobile zero-horizontal-overflow and return-focus checks.

## Honest evidence boundaries

Both Railway runtimes explicitly log: `Fixture/demo data only. Production approved: false.` This evidence therefore does **not** claim a live provider integration.

The one-day implementation timing model explicitly identifies itself as `SYNTHETIC_THEORY_ONLY`; it is not proof of a real zero-human customer environment provisioning event.

The current browser proof is a real composed-candidate headless-browser test, but it is not yet an authenticated role-by-role browser journey against the deployed Railway origin.

Sell-readiness remains `CONDITIONAL` until those hard evidence boundaries are closed. The frozen customer-proof release was not altered.