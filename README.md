# Manufacturing WFM — isolated customer-proof deployment wrapper

This private repository is the deployment transport for **0.6.70-hosted-staging-rc1**, derived from the canonical **0.6.70-provider-native-reconciliation-controls-candidate**.

The hosted build is **fictional/demo-data staging only**. It deliberately refuses `NODE_ENV=production`. Hosted mode requires an explicit HTTPS `WFM_PUBLIC_ORIGIN`, an explicit staging database path and a non-default 20+ character `WFM_STAGING_PASSWORD`; the local development credential is rejected in hosted mode.

The container fetches the frozen runtime only during image build, verifies SHA-256 `f9704a40a78bbfd9961184250fe1a6143ba68f7cab23f40b30935c99afee6d6a`, extracts it into the image and then removes the transfer file. `DEPLOYMENT_MANIFEST.json` records canonical source identity, hosted derivative identity, runtime manifest identity and completed customer-focused gates.

Completed pre-cloud proof: security/authentication/tenant/correction gate **65/65**, onboarding/kiosk/manufacturing/payroll gate **61/61**, and dedicated hosted-mode acceptance passed.

Open gates remain external HTTPS/browser acceptance on the exact cloud image, full-suite regression completion, genuine provider Level A evidence, external security/performance assurance, production persistence/backup architecture and customer acceptance. No production or pilot approval is implied by this staging deployment.
