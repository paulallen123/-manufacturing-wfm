# Manufacturing WFM — Customer Proof Status

**Evidence date:** 17 September 2026  
**Purpose:** customer-facing proof of the existing Manufacturing Workforce Management platform.  
**Claim boundary:** demonstration/customer-proof staging only. This file does not claim production approval, genuine provider certification, external security assurance, or real-customer ROI.

## Frozen customer-proof baseline

- Release candidate: `0.6.76-hosted-staging-rc1`
- Runtime SHA-256: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`
- Runtime artifact: `artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz`
- Runtime artifact size: `562434` bytes
- Runtime manifest SHA-256: `8d8bc31622e7f1c9710a479a9c0f5208297fa2f3b93e8e15e625114c850b28ce`
- Runtime package manifest SHA-256: `b0c435abc6bf1ea6fa38d8fbb8f8eabdfac846dba3380c4b0cd4eab52099213a`
- Runtime source content SHA-256: `456e8f6961525e0dd9d4449db94772c0902a4e6743b312cf09070ce611014781`
- Sealed runtime source commit: `b265ba9c28fef68e1d3556c86a58f9bcdb183bd1`
- Sealed regression / hosted-acceptance result recorded in the manifest: **1878/1878 passed, 0 failed**.
- Docker packaging verifies the frozen artifact hash before extraction, uses pinned base image `node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96`, removes package managers from the final runtime, and starts as non-root `node`.

These facts establish build, packaging and provenance readiness for the frozen candidate. They do **not** by themselves establish that this exact candidate is the artifact currently running on Railway.

## Railway staging-proof lane

Dedicated project: `manufacturing-wfm-staging-proof`

- Project ID: `9a774359-37fa-47e8-bde0-932420c32923`
- Environment ID: `6a33f2c1-bedd-46dc-85e7-2ef5d3b54de6`
- This lane is staging/customer-proof only even though Railway uses its default environment name `production` internally.
- Production systems remain disconnected.

### Exact repo-backed customer-proof service

Service: `wfm-customer-proof-0676`  
Service ID: `ddd54fb9-3564-4251-9959-28cf3308c272`  
Public origin reserved by Railway: `https://wfm-customer-proof-0676-production.up.railway.app`

Verified service configuration at this checkpoint:

- source repository: `paulallen123/-manufacturing-wfm`;
- Dockerfile builder using repository `Dockerfile`;
- watch paths limited to `Dockerfile`, `DEPLOYMENT_MANIFEST.json`, `STAGING_FREEZE.json`, and `artifact/**`;
- health check: `/api/health`;
- target port: `3000`;
- hardened staging variables applied: `NODE_ENV=staging`, `NODE_OPTIONS=--experimental-sqlite`, `WFM_HOSTED_STAGING=true`, `WFM_DB=/tmp/wfm-proof.sqlite`, exact public origin, exact runtime SHA-256, and an isolated strong staging password;
- `WFM_RUNTIME_SHA256` is pinned to `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`;
- no deployment history exists yet;
- no production approval or pilot-ready flag has been enabled.

2FA has been completed and the prior empty placeholder was removed. The dedicated resource slot is no longer blocked by 2FA.

## First-deployment bootstrap evidence

Railway's redeploy API explicitly confirms that a service with zero deployment history cannot receive deployment #1 through redeploy. Railway's supported bootstrap is `railway up` against the existing service.

A fail-closed GitHub Actions bootstrap was therefore added at `.github/workflows/railway-first-deploy.yml` in commit `f076f77a3e46dfd0a9c46c515b515d6803cb9025`.

The workflow:

- checks out the repository with a commit-pinned checkout action;
- refuses to continue if `RAILWAY_TOKEN` is absent;
- re-verifies the frozen runtime SHA-256 and staging-only claim flags before upload;
- downloads Railway CLI `v5.57.8` from Railway's immutable GitHub release;
- verifies the published Linux x86_64 archive SHA-256 `43bc4f0385af68cfecaff09efbf5a933a87df728e01d77cb5613c30b74ac3d9d` before execution;
- disables Railway CLI auto-update;
- targets only project `9a774359-37fa-47e8-bde0-932420c32923`, environment `6a33f2c1-bedd-46dc-85e7-2ef5d3b54de6`, service `ddd54fb9-3564-4251-9959-28cf3308c272`.

GitHub Actions run `35235275548` failed **only** at the explicit `RAILWAY_TOKEN` availability check. Checkout passed; runtime verification, CLI download and Railway deployment were skipped. No credential was exposed and no deployment occurred.

The repository currently has no `RAILWAY_TOKEN` Actions secret available to that workflow. Railway's connected API does not expose project-token creation, and GitHub's connected API does not expose repository-secret creation, so this is now a deliberate human credential boundary rather than an engineering failure.

## Outside-in proof target

`live-host-proof.yml` was retargeted in commit `267d6f486728eff86b632933b1baccafca242f46` to the dedicated customer-proof origin:

`https://wfm-customer-proof-0676-production.up.railway.app`

The workflow remains fail-closed. It must not be treated as passing evidence until deployment #1 exists and the live endpoint returns the expected release/mode/fixture/claim flags.

## Existing runtime service

Service: `wfm-staging-runtime-0670`  
Service ID: `7273a773-d59b-4636-a69b-e357efd92b80`

Latest observed successful Railway deployment: `6f4ac3df-47af-4266-8aa8-6a0e689dd23f`.

That service is **not accepted as proof** of the sealed 0.6.76 Docker build and has not been repurposed or weakened to force success.

## External customer-proof gates still required

The following remain **unverified** until the exact sealed candidate receives deployment #1:

1. Railway build/deployment provenance proving the exact `0.6.76-hosted-staging-rc1` packaging path and artifact hash.
2. Public HTTPS `/api/health` from that exact deployment.
3. Public HTTPS login and authenticated browser customer journey evidence.
4. Hosted tenant-isolation browser/API evidence.
5. Hosted onboarding, kiosk/clocking, attendance correction and payroll/provider-handoff journeys.
6. Restart/recovery and bounded failure-mode evidence for the hosted service.
7. Reproducible hosted traces/screenshots/logs and final deployment identifiers tied to the sealed candidate.

## Immediate next action

Create a Railway **project token** from the Tokens page in the `manufacturing-wfm-staging-proof` project settings, scoped to environment `6a33f2c1-bedd-46dc-85e7-2ef5d3b54de6`, and store it directly in GitHub repository Actions secrets as `RAILWAY_TOKEN`. Do not paste the token into chat or source control.

Once that secret exists, re-run failed GitHub Actions run `35235275548`. The workflow will then re-verify the sealed candidate, install the digest-pinned CLI and execute deployment #1 against the existing service. No second service is required.

As soon as deployment #1 exists, the next proof sequence is: verify build logs show the sealed Docker path and successful `3ca08429...` tarball check → verify Railway deployment ID/status → verify public HTTPS `/api/health` release/mode/fixture/claim flags → verify unauthenticated `/api/bootstrap` fails closed → run authenticated browser customer journeys → tenant isolation → onboarding → kiosk/clocking → attendance correction → payroll/provider handoff → restart/recovery/failure modes → capture reproducible logs/traces/screenshots.

No production execution is connected or authorised by this status.

## Claims that remain deliberately blocked

`pilot_ready` and `production_approved` must remain false until their separate evidence gates are genuinely satisfied.

- Genuine authorised provider proof against customer-grade NetSuite/SAP/Oracle HCM or equivalent endpoints rather than fixtures/harnesses.
- Independent external security assurance / penetration evidence appropriate to the intended release scope.
- Production-scale performance / resilience evidence at agreed reference loads.
- Production acceptance, operational ownership, monitoring/SLOs, backup/recovery and incident controls signed off for a real customer deployment.
- Verified real-customer ROI from customer data.

## Customer-proof message

The correct statement today is: **the frozen 0.6.76 candidate is sealed, hash-pinned, extensively regression-tested and its dedicated Railway service is fully configured. Deployment #1 is now blocked only by the absence of a project-scoped Railway CI token in GitHub Actions. External proof of the exact candidate remains incomplete until that one-time credential boundary is satisfied and the HTTPS/browser proof sequence passes.**
