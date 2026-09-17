# Manufacturing WFM — isolated customer-proof staging lane

This branch is the deployment wrapper for **0.6.70-hosted-staging-rc1**, derived from the canonical **0.6.70-provider-native-reconciliation-controls-candidate**.

The customer-proof build remains **fictional/demo-data staging only**. It deliberately refuses `NODE_ENV=production`. Hosted mode is opt-in and requires an explicit HTTPS `WFM_PUBLIC_ORIGIN`, an explicit staging database path, and a non-default 20+ character `WFM_STAGING_PASSWORD`. The local development credential is rejected in hosted mode.

The runtime is fetched only during the container build, verified against SHA-256 `3b39402fcabcbe5267915561474684b010427110b0b5f38562af4d4624b6a181`, then baked into the isolated image. `DEPLOYMENT_MANIFEST.json` records canonical source identity, hosted derivative identity, runtime manifest identity and completed customer-focused test gates.

Completed pre-cloud proof: security/authentication/tenant/correction gate **65/65**, onboarding/kiosk/manufacturing/payroll gate **61/61**, and dedicated hosted-mode acceptance passed.

Open gates remain external HTTPS/browser acceptance on the exact cloud image, full-suite regression completion, genuine provider Level A evidence, external security/performance assurance, production persistence/backup architecture and customer acceptance. No production or pilot approval is implied by this staging deployment.
