# Manufacturing WFM — hosted staging proof

This repository contains the immutable deployment wrapper for **0.6.31-hosted-staging-rc1**, derived from the verified 0.6.31 Provider Run Recovery Candidate.

The application remains a **fictional-data staging candidate**. It deliberately refuses `NODE_ENV=production`. Hosted mode is opt-in and requires an explicit HTTPS `WFM_PUBLIC_ORIGIN` and a non-default 20+ character `WFM_DEMO_PASSWORD`. The old local demo credential is rejected in hosted mode.

The runtime is stored as checksummed base64 chunks so the exact verified artifact can be reconstructed by the Docker build without mutating application business logic during deployment. `DEPLOYMENT_MANIFEST.json` records provenance and hashes.

Open proof gates after deployment: external HTTPS acceptance, hosted Playwright journey/evidence, full-suite regression completion, and production-grade persistence/auth architecture. No production approval is implied by this staging deployment.
