# Railway pre-BuildKit hosted-proof evidence — 2026-09-22

## Purpose

Preserve evidence that the current FORGE hosted-proof failure is occurring before application build execution.

This document does not mark the current FORGE candidate green. It records why the failure cannot presently be attributed to product tests.

## Primary FORGE service

Project: `manufacturing-wfm-test`

Service: `vector-forge-candidate`

Observed repeated failures on correct feature-branch commits including:
- `351533f5adbcc25aa1455cb3d8574437a1349632`
- `8efd91ec6d576b64fd3af3217f5932f52e1c6e8f`
- `e1b9f386fd671d1dc055bac345b284b806fc517c`

Representative deployment:
- `7c66def4-9452-497d-a710-2791ac7be8ca`

Only build output:
`scheduling build on Metal builder "builder-kpmtmq"`

No Docker/BuildKit step, source validator, unit test, provenance test, application startup or healthcheck executed.

## Independent Railway project reproduction

Project: `manufacturing-wfm-staging-proof`

Service: `vector-forge-current-proof`

Correct branch snapshot forced with:
- `e6e0dae9ce3af89893eee494875db4023cd52847`

Deployment:
- `d40a822e-2ea7-4981-8459-2478700328dd`

Builder:
- `builder-ehawrf`

Only build output:
`scheduling build on Metal builder "builder-ehawrf"`

Again, no Docker/BuildKit or application output occurred.

This reproduces the same failure across:
- two Railway projects;
- two Railway services;
- different Metal builders;
- the same GitHub repository;
- correct branch source selection.

## Control evidence

The same FORGE Docker architecture successfully built earlier on 2026-09-22.

Successful service deployment:
- service: `vector-forge-candidate`
- deployment: `5a18e772-5caa-49e0-beb7-5b1f5f513c32`
- source: `de3db18bf240b287a78663d581786222933cc643`

That build entered BuildKit, executed Docker stages, completed 10,000-employee / 50-site proof, completed payroll corruption detection, built source-bound Vector UI assets and passed healthcheck.

## External corroboration

Railway community reports document the same failure signature: deployments ending after only `scheduling build on Metal builder`, before normal application build output. In at least one recent incident Railway removed an affected builder from rotation and retries then succeeded.

This corroboration is supporting evidence only; it is not a substitute for Railway account-specific diagnostics.

## Current safe route

1. Preserve the last healthy hosted deployment.
2. Do not weaken Docker/provenance/security gates.
3. Do not rewrite product code to chase a pre-BuildKit provider failure.
4. Keep the exact current FORGE SHA available for retry.
5. Maintain provider-neutral full-runtime proof configuration in `.circleci/config.yml`.
6. Maintain the independent hosted bounded verifier for demand/decision algorithms.
7. When a full-runtime builder is available, require the current SHA to execute:
   - Docker admission;
   - security/provenance tests;
   - cloud-scale/payroll proof;
   - healthcheck;
   - authenticated role proof;
   - tenant isolation;
   - Decision Intelligence;
   - persistence and fresh-login proof.
8. Only then promote the latest integrated candidate from BUILT to PROVEN.

## Claim boundary

Current latest FORGE source remains **BUILT**, not hosted-PROVEN.

The pre-BuildKit failure provides no evidence that current product tests would pass or fail.
