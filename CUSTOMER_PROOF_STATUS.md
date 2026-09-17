# Manufacturing WFM — Customer Proof Status

**Evidence date:** 17 September 2026  
**Purpose:** customer-facing live proof of the existing Manufacturing Workforce Management platform.  
**Claim boundary:** demonstration/customer-proof staging only. This file does not claim production approval or genuine provider certification.

## Live proof lane

- Railway project: `manufacturing-wfm-staging-proof`
- Service: `wfm-staging-runtime-0670`
- Public origin: `https://wfm-staging-runtime-0670-production.up.railway.app`
- Health endpoint: `/api/health`
- Latest sealed customer-proof candidate in the repository: `0.6.76-hosted-staging-rc1`
- Repository runtime SHA-256: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`
- Repository Docker runtime base is pinned to Node 22.23.2 by digest and runs as non-root `node` user.
- Latest Railway deployment observed: `6f4ac3df-47af-4266-8aa8-6a0e689dd23f` — SUCCESS for service availability.
- **Exact live-candidate provenance is temporarily held:** Railway service/deployment metadata currently reports `node:22.16.0-bookworm-slim`, the latest deployment is recorded as a `redeploy`, and the environment has one unresolved staged change. Until a fresh Railway source build proves the repository Dockerfile/base and runtime identity, do not claim that the live Railway container is the exact sealed repository candidate.
- Live service has an HTTPS Railway domain and is configured with `/api/health` health checking.

## Sealed regression evidence

The deployment manifest records:

- Full split regression: **1878/1878 passing**
- Identity/source rerun: **68/68**
- Provider live acceptance harness: **19/19**
- UI evolution: **3/3**
- Security / attendance: **65/65**
- Onboarding / kiosk / manufacturing: **28/28**
- Payroll / provider: **53/53**
- Hosted acceptance: **PASS**

The repository artifact and deployment manifest contain provenance hashes linking the hosted candidate to the canonical 0.6.76 source lineage. Those hashes prove the sealed repository candidate; they do not by themselves prove that the currently running Railway redeploy was freshly rebuilt from that exact candidate.

## What can be demonstrated today

1. Hosted HTTPS application availability and login boundary, within the current staging claim boundary.
2. Workforce/company configuration and onboarding flows using fictional demonstration data.
3. Skills, availability and manufacturing demand context.
4. Labour planning and schedule publication.
5. Kiosk / clocking experience and attendance flows.
6. Operational/readiness views and exception handling.
7. Time review and payroll-control workflow.
8. Cost / economic decision views and workforce recommendations.
9. Audit/evidence-oriented workflow behaviour.
10. Support UI and guided operational surfaces included in the hosted artifact.

## Claims that remain deliberately blocked

`pilot_ready` remains `false` and `production_approved` remains `false` until the separate gates below are evidenced. Do not change these flags simply to improve a demonstration.

- Exact Railway deployment provenance must be reconciled to the sealed repository candidate after the current metadata mismatch and staged configuration change are resolved.
- Genuine authorised provider proof against customer-grade NetSuite/SAP/Oracle HCM or equivalent endpoints rather than fixtures/harnesses.
- Independent external security assurance / penetration evidence appropriate to the intended release scope.
- Production-scale performance / resilience evidence at agreed reference loads.
- Production acceptance, operational ownership, monitoring/SLOs, backup/recovery and incident controls signed off for a real customer deployment.

## Customer-proof message

The correct statement today is: **the repository contains a sealed, reproducible 0.6.76 customer-proof candidate with extensive automated regression evidence, and the Railway staging service is available. Exact live-deployment provenance is currently under a fail-closed hold until a fresh source build proves the running deployment matches that sealed candidate. It is not production-approved.**
