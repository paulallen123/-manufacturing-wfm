# Manufacturing WFM — Customer Proof Status

**Evidence date:** 17 September 2026  
**Purpose:** customer-facing live proof of the existing Manufacturing Workforce Management platform.  
**Claim boundary:** demonstration/customer-proof staging only. This file does not claim production approval or genuine provider certification.

## Live proof lane

- Railway project: `manufacturing-wfm-staging-proof`
- Service: `wfm-staging-runtime-0670`
- Public origin: `https://wfm-staging-runtime-0670-production.up.railway.app`
- Health endpoint: `/api/health`
- Latest sealed customer-proof candidate: `0.6.76-hosted-staging-rc1`
- Runtime SHA-256: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`
- Docker runtime base is pinned by digest and runs as non-root `node` user.
- Latest Railway deployment observed during proof work: `cee5ddc4-08d2-4abe-bdbe-ff7167764ea1` — SUCCESS.
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

The artifact and deployment manifest contain provenance hashes linking the hosted candidate to the canonical 0.6.76 source lineage.

## What can be demonstrated today

1. Hosted HTTPS application availability and login boundary.
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

- Genuine authorised provider proof against customer-grade NetSuite/SAP/Oracle HCM or equivalent endpoints rather than fixtures/harnesses.
- Independent external security assurance / penetration evidence appropriate to the intended release scope.
- Production-scale performance / resilience evidence at agreed reference loads.
- Production acceptance, operational ownership, monitoring/SLOs, backup/recovery and incident controls signed off for a real customer deployment.

## Customer-proof message

The correct statement today is: **the product has a live, isolated, reproducible customer-proof environment backed by a sealed build and extensive automated regression evidence. It is ready to be demonstrated. It is not yet being represented as production-approved.**
