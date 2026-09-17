# Manufacturing WFM — Customer Proof Status

**Evidence date:** 17 September 2026  
**Purpose:** customer-facing proof of the existing Manufacturing Workforce Management platform.  
**Claim boundary:** demonstration/customer-proof staging only. This file does not claim production approval, genuine provider certification, external security assurance, or real-customer ROI.

## Frozen customer-proof baseline

- Release candidate: `0.6.76-hosted-staging-rc1`
- Runtime SHA-256: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`
- Runtime manifest SHA-256: `c125518bb8d8db747e1586e11af9a46755cc2e50473518a5beb3bda6bb286f4d`
- Sealed runtime source commit: `b265ba9c28fef68e1d3556c86a58f9bcdb183bd1`
- Deployment/proof plumbing head verified during this checkpoint: `80c942c074c7ca57e73c8cbaeeb87b658b295961`
- Sealed regression / hosted-acceptance result recorded in the manifest: **1878/1878 passed, 0 failed**.
- GitHub `Customer Proof Gate` run `35230273480` completed successfully against the hardened packaging/proof path.
- Docker packaging verifies the frozen artifact hash before extraction, uses a pinned Node base digest, removes package managers from the final runtime, and starts as non-root `node`.

These facts establish build, packaging and provenance readiness for the frozen candidate. They do **not** by themselves establish that this exact candidate is the artifact currently running on Railway.

## Railway staging-proof lane

Dedicated project: `manufacturing-wfm-staging-proof`

- Project ID: `9a774359-37fa-47e8-bde0-932420c32923`
- Environment ID: `6a33f2c1-bedd-46dc-85e7-2ef5d3b54de6`
- This lane is staging/customer-proof only even though Railway may use its default environment naming internally.

### Exact customer-proof placeholder

Service: `wfm-staging-0670-customer-proof`  
Service ID: `e6cd8d95-e726-4062-a30b-feaf247378fa`

Verified state at this checkpoint:

- no deployment history;
- no public domain;
- deletion of this empty placeholder is staged so its resource slot can be reused for the exact repo-backed 0.6.76 proof service;
- applying that deletion is blocked by Railway's normal two-factor-authentication requirement and has **not** been bypassed.

### Existing runtime service

Service: `wfm-staging-runtime-0670`  
Service ID: `7273a773-d59b-4636-a69b-e357efd92b80`

Latest observed successful Railway deployment during this checkpoint: `6f4ac3df-47af-4266-8aa8-6a0e689dd23f`.

The observed deployment metadata reports an image-based `node:22.16.0-bookworm-slim` runtime. It is therefore **not accepted as proof that the sealed `0.6.76-hosted-staging-rc1` Docker build is the externally running artifact**, because the sealed Docker path has separate pinned-image and artifact-integrity requirements.

The Railway domain and `/api/health` configuration show that an HTTPS service surface exists, but **external HTTPS health/login for the exact sealed candidate remains unverified** until the repo-backed candidate has been deployed and tested.

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

## Hosting attempt and current blocker

- A new repo-backed customer-proof deployment from `paulallen123/-manufacturing-wfm`, branch `main`, was attempted in the dedicated staging-proof project.
- Railway rejected new resource provisioning because the current workspace/free-plan resource limit is reached. No existing running service was mutated by the failed attempt.
- Applying the already-staged deletion of the empty, undeployed placeholder would free the required slot, but Railway requires account 2FA for that change.
- A fresh isolated project was also tested as a non-destructive alternative and hit the same resource-provision limit.
- Existing test/runtime services were not repurposed merely to force success, preserving the customer-proof isolation and containment boundary.

## External customer-proof gates still required

The following remain **unverified** until the exact sealed candidate is externally deployed:

1. Railway build/deployment provenance proving the exact `0.6.76-hosted-staging-rc1` packaging path and artifact hash.
2. Public HTTPS `/api/health` from that exact deployment.
3. Public HTTPS login and authenticated browser customer journey evidence.
4. Hosted tenant-isolation browser/API evidence.
5. Hosted onboarding, kiosk/clocking, attendance correction and payroll/provider-handoff journeys.
6. Restart/recovery and bounded failure-mode evidence for the hosted service.
7. Reproducible hosted traces/screenshots/logs and final deployment identifiers tied to the sealed candidate.

## Immediate next action

Complete Railway's required 2FA for the already-staged deletion of the **empty, undeployed** customer-proof placeholder. Once the resource slot exists, the next safe operation is to create the repo-backed service in this same dedicated staging-proof project, deploy the exact frozen candidate, verify deployment provenance/hash and HTTPS health, and then execute the authenticated browser proof suite.

No production execution is connected or authorised by this status.

## Claims that remain deliberately blocked

`pilot_ready` and `production_approved` must remain false until their separate evidence gates are genuinely satisfied. Do not change these flags merely to improve a demonstration.

- Genuine authorised provider proof against customer-grade NetSuite/SAP/Oracle HCM or equivalent endpoints rather than fixtures/harnesses.
- Independent external security assurance / penetration evidence appropriate to the intended release scope.
- Production-scale performance / resilience evidence at agreed reference loads.
- Production acceptance, operational ownership, monitoring/SLOs, backup/recovery and incident controls signed off for a real customer deployment.
- Verified real-customer ROI from customer data.

## Customer-proof message

The correct statement today is: **the frozen 0.6.76 candidate has sealed build/provenance and extensive automated regression evidence, but external Railway proof of that exact candidate is not complete yet. Do not represent the current Railway runtime service as the sealed 0.6.76 customer-proof deployment until the repo-backed deployment, HTTPS checks and browser evidence have passed.**
