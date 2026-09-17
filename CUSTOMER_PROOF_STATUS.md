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
- Latest deployment-signal commit verified during this checkpoint: `5c00946a5f3a8a0f9c32d4434ab631b884dbc16e`
- Sealed regression / hosted-acceptance result recorded in the manifest: **1878/1878 passed, 0 failed**.
- GitHub `Customer Proof Gate` run `35230273480` completed successfully against the hardened packaging/proof path.
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
- health check: `/api/health`, timeout 45 seconds;
- target port: `3000`;
- hardened staging variables applied: `NODE_ENV=staging`, `NODE_OPTIONS=--experimental-sqlite`, `WFM_HOSTED_STAGING=true`, isolated staging SQLite path, exact public origin, exact runtime SHA-256, and an isolated strong staging password;
- `WFM_RUNTIME_SHA256` is pinned to `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`;
- no deployment history exists yet;
- no production approval or pilot-ready flag has been enabled.

2FA has been completed and the prior empty placeholder was removed. The dedicated resource slot is therefore no longer blocked by 2FA.

### Bootstrap attempt

- A deployment-signal-only commit `5c00946a5f3a8a0f9c32d4434ab631b884dbc16e` updated `artifact/customer-proof-0676-railway.trigger` after repo attachment and hardened variable configuration.
- The trigger changed no runtime tarball, Dockerfile, deployment manifest or product code.
- Railway still reports **zero deployments** for `wfm-customer-proof-0676`; the GitHub push did not bootstrap deployment #1.
- Railway's redeploy API explicitly reports that it cannot redeploy a service that has never had a first deployment.
- Railway's own next-step instruction is the one-time bootstrap command:
  `railway up --project 9a774359-37fa-47e8-bde0-932420c32923 --environment 6a33f2c1-bedd-46dc-85e7-2ef5d3b54de6 --service ddd54fb9-3564-4251-9959-28cf3308c272`
- Creating a separate GitHub-backed service is not acceptable as a workaround because Railway's free-plan resource provision limit is reached and the existing isolated slot is already correctly configured.
- The Railway infrastructure agent cannot currently perform the deletion/recreation workaround because its agent usage limit is reached.
- The existing runtime service has not been repurposed or weakened to force success.

### Existing runtime service

Service: `wfm-staging-runtime-0670`  
Service ID: `7273a773-d59b-4636-a69b-e357efd92b80`

Latest observed successful Railway deployment: `6f4ac3df-47af-4266-8aa8-6a0e689dd23f`.

The observed deployment metadata reports an image-based `node:22.16.0-bookworm-slim` runtime. It is therefore **not accepted as proof that the sealed `0.6.76-hosted-staging-rc1` Docker build is the externally running artifact**, because the sealed Docker path has separate pinned-image and artifact-integrity requirements.

## Sealed regression evidence

The deployment manifest records:

- Full split regression: **1878/1878 passing**
- Identity/source rerun: **68/68**
- Provider live acceptance harness: **19/19**
- UI evolution: **3/3**
- Security / attendance: **65/65**
- Onboarding / kiosk / manufacturing: **28/28**
- Payroll / provider: **53/53**
- Hosted acceptance harness: **PASS**

Harness/fixture results are automated proof evidence. They are not equivalent to genuine authorised Level-A acceptance by NetSuite, SAP, Oracle HCM, payroll or other production providers.

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

Bootstrap deployment #1 on the **existing** repo-backed service `ddd54fb9-3564-4251-9959-28cf3308c272` using Railway's authenticated dashboard deploy control or the Railway CLI command above. Do not create another service and do not repurpose `wfm-staging-runtime-0670`.

As soon as deployment #1 exists, the next proof sequence is: verify build logs show the sealed Docker path and successful `3ca08429...` tarball check → verify Railway deployment ID/status → verify public HTTPS `/api/health` release/mode/fixture/claim flags → verify unauthenticated `/api/bootstrap` fails closed → run authenticated browser customer journeys → tenant isolation → onboarding → kiosk/clocking → attendance correction → payroll/provider handoff → restart/recovery/failure modes → capture reproducible logs/traces/screenshots.

No production execution is connected or authorised by this status.

## Claims that remain deliberately blocked

`pilot_ready` and `production_approved` must remain false until their separate evidence gates are genuinely satisfied. Do not change these flags merely to improve a demonstration.

- Genuine authorised provider proof against customer-grade NetSuite/SAP/Oracle HCM or equivalent endpoints rather than fixtures/harnesses.
- Independent external security assurance / penetration evidence appropriate to the intended release scope.
- Production-scale performance / resilience evidence at agreed reference loads.
- Production acceptance, operational ownership, monitoring/SLOs, backup/recovery and incident controls signed off for a real customer deployment.
- Verified real-customer ROI from customer data.

## Customer-proof message

The correct statement today is: **the frozen 0.6.76 candidate is sealed, hash-pinned, extensively regression-tested and its dedicated Railway service is fully configured, but deployment #1 has not yet been bootstrapped. External proof of the exact candidate therefore remains incomplete. Do not represent the existing Railway runtime service as the sealed 0.6.76 customer-proof deployment until the dedicated repo-backed service has deployed and the HTTPS/browser proof sequence has passed.**
