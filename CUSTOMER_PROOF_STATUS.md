# Manufacturing WFM — Customer Proof Status

**Evidence date:** 17 September 2026  
**Purpose:** customer-facing proof of the existing Manufacturing Workforce Management platform.  
**Claim boundary:** demonstration/customer-proof staging only. This file does not claim production approval, genuine provider certification, independent external security assurance, or verified real-customer ROI.

## Frozen customer-proof baseline

- Release candidate: `0.6.76-hosted-staging-rc1`
- Runtime SHA-256: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`
- Runtime artifact: `artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz`
- Runtime artifact size: `562434` bytes
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
Deployment ID: `49a53c09-9e4b-41a3-a8dd-0133c97f2792`

### Deployment provenance

The one-time GitHub Actions bootstrap was successfully re-run after the project-scoped Railway token was added as the repository secret `RAILWAY_TOKEN`.

- GitHub Actions workflow: `Railway first deploy - customer proof 0.6.76`
- Run ID: `35236184751`
- Successful rerun job ID: `105264296024`
- Frozen runtime SHA check passed before upload.
- Pinned Railway CLI `v5.57.8` archive digest verification passed.
- The exact existing Railway service was targeted; no replacement service was created.

Railway build evidence for deployment `49a53c09-9e4b-41a3-a8dd-0133c97f2792` confirms:

- repository `Dockerfile` was used;
- base image resolved to the exact pinned Node `22.23.2` digest;
- `artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz` was copied into the build;
- in-build SHA-256 check returned `/tmp/runtime.tgz: OK` for `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`;
- package managers were removed from the final runtime image;
- Railway produced image digest `sha256:b67e05912c6d7014774faca4a543e09354ff5a0033c18cd28188b98d30b22ce6`;
- Railway `/api/health` deployment health check succeeded on the first attempt.

Runtime logs confirm:

- `Fixture/demo data only. Production approved: false.`
- server listening on `0.0.0.0:3000`;
- public origin is the dedicated customer-proof Railway HTTPS domain.

## Independent outside-in live-host proof — PASSED

A GitHub-hosted runner independently tested the public Railway domain after deployment.

- Workflow: `Live Host Proof`
- Run ID: `35239783975`
- Job ID: `105264944927`
- Target: `https://wfm-customer-proof-0676-production.up.railway.app`

Passed evidence:

1. Public `GET /api/health` returned HTTP 2xx and reported:
   - `status: ok`
   - `mode: hosted-staging`
   - `fixtureOnly: true`
   - `hosted: true`
   - `productionApproved: false`
   - `pilotReady: false`
   - `release: 0.6.76-hosted-staging-rc1`
2. Public application root returned a non-empty HTTP 2xx response.
3. Public `/kiosk.html` returned a non-empty HTTP 2xx response.
4. Unauthenticated `GET /api/bootstrap` returned **HTTP 401** with `{"error":"Sign in is required."}`.

This is independent outside-in evidence that the exact customer-proof host is reachable and that protected application data fails closed without authentication.

## Security gate on the proof commit — PASSED

The owner-originated main-branch proof commit also passed the repository-wide security gate.

- Workflow run ID: `35239783955`
- Job ID: `105264942369`
- Workflow-security regression checks: PASS
- Deployment/resilience metadata validation: PASS
- Exact staging candidate Docker build: PASS
- Runtime identity/reduced attack-surface proof: PASS
- Staging candidate refuses production mode: PASS

## What is now genuinely demonstrated

The platform can now be described as a **live, isolated customer-proof staging deployment of the exact sealed 0.6.76 candidate**, backed by reproducible build/provenance evidence and independent public availability/authentication-boundary proof.

The demo uses fictional/fixture data. The application and customer-facing surfaces are real hosted application behaviour, not screenshots or a mock landing page.

## Remaining customer-proof gates

These remain open and must not be implied as complete:

1. Authenticated browser sign-in on the live host using the staging credential.
2. Authenticated end-to-end customer journey evidence across readiness/operations, onboarding, workforce data, skills, availability, production demand, labour planning, scheduling, kiosk/clocking, disruption/recovery, time review, payroll handoff, cost/ROI and audit/support surfaces.
3. Hosted tenant-isolation browser/API evidence.
4. Interactive kiosk/clocking behaviour beyond public page availability.
5. Hosted attendance correction and payroll/provider-handoff journey evidence.
6. Restart/recovery and bounded failure-mode evidence on the live service.
7. Reproducible screenshots/traces/video tied to this deployment ID and frozen runtime hash.

## Production/pilot gates remain deliberately blocked

`pilot_ready` and `production_approved` remain false.

Separate evidence is still required for:

- genuine authorised provider proof against customer-grade NetSuite/SAP/Oracle HCM/payroll or equivalent endpoints rather than fixtures/harnesses;
- independent external security assurance / penetration testing appropriate to release scope;
- production-scale performance and resilience at agreed reference loads;
- production operational ownership, monitoring/SLOs, backup/recovery and incident controls;
- verified real-customer ROI from customer data.

## Current customer-proof wording

**Supported statement:** “This is a live, isolated instance of the actual Manufacturing WFM application running the exact sealed 0.6.76 customer-proof build. Its build provenance, public HTTPS health, application/kiosk availability and unauthenticated protection boundary have been independently re-proven. The demonstration uses fictional data and remains staging-only; production and genuine external-provider acceptance are separate gates.”
