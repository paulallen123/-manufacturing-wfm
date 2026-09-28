# Manufacturing WFM — Customer Proof Status

**Evidence date:** 17 September 2026  
**Purpose:** customer-facing proof of the existing Manufacturing Workforce Management platform.  
**Claim boundary:** demonstration/customer-proof staging only. This file does not claim production approval, genuine provider certification, independent external security assurance, or verified real-customer ROI.

## Frozen customer-proof baseline

- Release candidate: `0.6.76-hosted-staging-rc1`
- Runtime SHA-256: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`
- Runtime artifact: `artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz`
- Runtime artifact size: `562434` bytes
- Runtime source content SHA-256: `456e8f6961525e0dd9d4449db94772c0902a4e6743b312cf09070ce611014781`
- Runtime manifest SHA-256: `8d8bc31622e7f1c9710a479a9c0f5208297fa2f3b93e8e15e625114c850b28ce`
- Runtime package manifest SHA-256: `b0c435abc6bf1ea6fa38d8fbb8f8eabdfac846dba3380c4b0cd4eab52099213a`
- Pinned base image: `node:22.23.2-bookworm-slim@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96`
- Full split regression recorded in the deployment manifest: **1878/1878 passed, 0 failed**.
- Runtime remains fixture-only/staging-only with `pilot_ready=false` and `production_approved=false`.

## Exact live Railway customer-proof deployment — PROVEN

Railway project: `manufacturing-wfm-staging-proof`  
Project ID: `9a774359-37fa-47e8-bde0-932420c32923`  
Environment ID: `6a33f2c1-bedd-46dc-85e7-2ef5d3b54de6`  
Service: `wfm-customer-proof-0676`  
Service ID: `ddd54fb9-3564-4251-9959-28cf3308c272`  
Public origin: `https://wfm-customer-proof-0676-production.up.railway.app`  
Latest verified successful deployment ID: `2d399257-e7ea-43e8-a728-d563e8cb366b`

Railway's internal environment name is `production`, but this project is deliberately an isolated customer-proof staging lane. Product production approval remains false and production execution remains disconnected.

### Deployment provenance

Latest Railway build evidence for deployment `2d399257-e7ea-43e8-a728-d563e8cb366b` confirms the sealed deployment path remains intact:

- repository `Dockerfile` was used;
- base image resolved through the exact digest-pinned Node 22.23.2 image;
- `artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz` was copied into the image;
- the in-build SHA-256 check returned `/tmp/runtime.tgz: OK` for `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`;
- the sealed runtime was extracted only after that integrity check;
- package managers were removed from the final runtime image;
- the application runs as the non-root `node` user;
- Railway health checks complete successfully.

Runtime logs confirm the staged server is listening on `0.0.0.0:3000` and serving the dedicated HTTPS customer-proof origin.

## Independent live-host proof — PASSED

The latest main-branch outside-in proof has passed against the public customer-proof host.

- Main source checkpoint: `b20147641ba3e1f93f3189a28ded706f9d535166`
- Workflow: `Live Host Proof`
- Run ID: `35278351691`
- Result: **SUCCESS**

Passed evidence includes:

1. Public `GET /api/health` returns HTTP 2xx and reports the exact `0.6.76-hosted-staging-rc1` hosted-staging identity.
2. The health boundary continues to report fixture/demo mode and keeps `productionApproved=false` and `pilotReady=false`.
3. Public application root returns HTTP 2xx.
4. Public `/kiosk.html` returns HTTP 2xx.
5. Unauthenticated protected bootstrap access fails closed with HTTP 401.

## Authenticated hosted journey — MATERIAL PROGRESS PROVEN

The live deployment has now progressed beyond public-health-only proof. Railway HTTP/runtime evidence records successful authentication and authenticated application traffic against the dedicated proof host:

- `POST /api/login` → HTTP 200;
- authenticated `/api/bootstrap` → HTTP 200;
- `/api/readiness` → HTTP 200;
- `/api/availability` → HTTP 200;
- `/api/schedule` → HTTP 200;
- `/api/scheduling-summary` → HTTP 200;
- `/api/schedule-publication` → HTTP 200;
- `/api/payroll-control` → HTTP 200;
- `/api/providers/NetSuite` → HTTP 200;
- `/api/workflows` → HTTP 200;
- `/api/cost/realization` → HTTP 200;
- `/api/proof` → HTTP 200;
- kiosk/device token, revoke and clocking calls were exercised successfully;
- attendance-correction calls were exercised successfully.

Hosted request evidence also includes a Playwright/Headless Chrome browser session against the proof host. This materially demonstrates authenticated hosted application behaviour across readiness, planning/scheduling, kiosk/clocking, attendance and payroll/provider-control surfaces. It is not yet treated as a complete final visual evidence pack until the trace/screenshot/video artefacts are preserved and tied to the same deployment identity.

## Probe cleanup — NOT CURRENTLY CLASSIFIED AS PRODUCT DEFECTS

Two diagnostic requests returned HTTP 404:

- `/api/demand`
- `/api/cost`

Repository search finds no current application routes with those exact paths. The working canonical planning/demand surfaces include `/api/scheduling-summary`, `/api/schedule` and `/api/readiness`, while the working cost surface includes `/api/cost/realization`.

The two 404 responses are therefore currently classified as obsolete/guessed diagnostic probe paths rather than evidence that the corresponding product capability is broken. Proof tooling should use canonical routes and remove these stale probes; no frozen runtime mutation is justified solely to make invented endpoints return 200.

## Current security/integrity gates — GREEN

Latest relevant main-branch checks include:

- `Live Host Proof` run `35278351691` — **SUCCESS**;
- `WFM every-push security gate` run `35278351695` — **SUCCESS**;
- `WFM runtime integrity and resilience gate` run `35278351709` — **SUCCESS**.

Recent identity-survival/security work also reached a successful reviewed runtime-guard gate before the current main checkpoint. Failed/cancelled intermediate experiments are not treated as release proof; the latest applicable successful gates are the evidence baseline.

## What is now genuinely demonstrated

The platform can now be described as a **live, isolated customer-proof staging deployment of the exact sealed 0.6.76 candidate** with:

- reproducible sealed build and artifact-integrity evidence;
- live public HTTPS health and application/kiosk availability;
- unauthenticated protected-data rejection;
- successful hosted sign-in and authenticated bootstrap;
- successful hosted functional traffic across core manufacturing-WFM customer journeys;
- browser-driven hosted activity;
- current green public-host, security and runtime-integrity gates.

The demo uses fictional/fixture data. The application and customer-facing surfaces are real hosted application behaviour, not screenshots or a mock landing page.

## Remaining customer-proof gates

These remain open and must not be implied as complete:

1. Explicit hosted tenant-isolation negative proof across at least two isolated customer identities/contexts.
2. Controlled hosted restart/recovery and bounded failure-mode proof tied to the exact customer-proof deployment.
3. Preserve and index the final browser screenshot/trace/video evidence package against the exact deployment ID and frozen runtime hash.
4. Clean obsolete `/api/demand` and `/api/cost` probe assumptions from proof tooling and re-run against canonical routes where applicable.
5. Final evidence reconciliation so every claimed customer journey points to a reproducible hosted log, test, trace or artefact rather than only aggregate traffic observation.

## Production/pilot gates remain deliberately blocked

`pilot_ready` and `production_approved` remain false.

Separate evidence is still required for:

- genuine authorised provider proof against customer-grade NetSuite/SAP/Oracle HCM/payroll or equivalent endpoints rather than fixtures/harnesses;
- independent external security assurance / penetration testing appropriate to release scope;
- production-scale performance and resilience at agreed reference loads;
- production operational ownership, monitoring/SLOs, backup/recovery and incident controls;
- verified real-customer ROI from customer data.

## Current customer-proof wording

**Supported statement:** “This is a live, isolated instance of the actual Manufacturing WFM application running the exact sealed 0.6.76 customer-proof build. Its artifact hash, deployment path, public HTTPS health, authentication boundary and a substantial authenticated hosted customer journey have been re-proven. The demonstration uses fictional data and remains staging-only; tenant-isolation/recovery evidence, production acceptance and genuine external-provider acceptance remain separate gates.”
