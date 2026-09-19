# 24h sell-readiness — exact-head Railway dual-service proof

Recorded: 2026-09-19 UTC

## Candidate

- Repository: `paulallen123/-manufacturing-wfm`
- Branch: `feature/one-day-enterprise-implementation-v1`
- Exact source commit: `16128cdcd80e6ee893352c83b7ac8d384d387dbb`
- Commit message: `docs(vector): record green neutral-planning proof`

## Existing Railway services only

No new service, database, volume, environment, or other Railway resource was created for this proof.

### `wfm-one-day-enterprise-v1`

- Railway deployment: `84083913-1a7e-4885-973a-bdf5b3250b6c`
- Source branch: `feature/one-day-enterprise-implementation-v1`
- Source commit: `16128cdcd80e6ee893352c83b7ac8d384d387dbb`
- Result: `SUCCESS`
- Runtime startup explicitly states: `Fixture/demo data only. Production approved: false.`

### `wfm-integration-fabric-v1-proof`

- Railway deployment: `72f50465-a29e-47f8-85c9-5985021454d0`
- Source branch: `feature/one-day-enterprise-implementation-v1`
- Source commit: `16128cdcd80e6ee893352c83b7ac8d384d387dbb`
- Result: `SUCCESS`
- Runtime startup explicitly states: `Fixture/demo data only. Production approved: false.`

## Build-time admission evidence from the exact source image

The Railway build for the exact source commit completed the embedded admission suite with:

- `tests 66`
- `pass 66`
- `fail 0`
- `VECTOR_ONLY_PRESENTATION_ADMISSION=PASS`
- `RETIRED_PRESENTATION_PURGE=PASS`

The same build executed the cloud scale/payroll proof with status `PASS`:

- employees: `10,000`
- sites: `50`
- punches: `100,000`
- timecards: `40,000`
- independent clean payroll expected total: `15,180,000`
- independently projected total: `15,180,000`
- unexplained variance: `0`
- deliberate corruption projected total: `15,180,020`
- deliberate corruption unexplained variance: `20`
- deliberate corruption variance count: `1`

The build also passed lifecycle/control tests covering clocking, absence, overtime approval protection, agency assignment windows, effective-dated starter/transfer/leaver handling, retro changes, integration outage recovery, tenant isolation, role learning/mastery, source-system discovery controls, OAuth/PKCE, credential handling, and fail-closed readiness behaviour.

## Claim boundary

This evidence proves that the exact current candidate was fetched from the private GitHub branch, built and admitted in Railway, and successfully deployed to both pre-existing proof services. It does **not** prove a live ERP/HCM/payroll provider connection or a real customer production implementation.

The implementation timing model in the build remains explicitly labelled `SYNTHETIC_THEORY_ONLY` and states that it is architecture timing simulation only, not customer, production, payroll, or implementation evidence.

Provider connectivity remains fixture/test-harness evidence unless separately backed by an authorised provider sandbox/test API receipt. The runtime remains `Production approved: false`.

## Release safety

This evidence operation did not modify or redeploy the frozen customer-proof release. The evidence is stored on this isolated branch only.