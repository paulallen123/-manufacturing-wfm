# Manufacturing WFM — isolated customer-proof deployment wrapper

This private repository is the deployment transport for **0.6.70-hosted-staging-rc2**, derived from the canonical **0.6.70-provider-native-reconciliation-controls-candidate**.

The hosted build is **fictional/demo-data staging only**. It deliberately refuses `NODE_ENV=production`. Hosted mode requires an explicit HTTPS `WFM_PUBLIC_ORIGIN`, an explicit staging database path and a non-default 20+ character `WFM_STAGING_PASSWORD`; the local development credential is rejected in hosted mode.

The RC2 runtime includes the canonical `BUILD_INFO.json` and `PACKAGE_MANIFEST_SHA256.json` required by the independent verification-worker identity gate. The deployment wrapper fetches the frozen runtime, verifies SHA-256 `ecb59f71218b0be62d815471259b916cfe595a97ebbc166a554e167d176cf37c`, and refuses to continue on any mismatch. `DEPLOYMENT_MANIFEST.json` records canonical source identity, hosted derivative identity, runtime manifest identity and completed customer-focused gates.

Completed pre-cloud proof: security/authentication/tenant/correction gate **65/65**, onboarding/kiosk/manufacturing/payroll gate **61/61**, dedicated hosted-mode acceptance passed, and public cloud health passed.

Open gates remain completion of independent browser acceptance, full-suite regression completion, genuine provider Level A evidence, external security/performance assurance, production persistence/backup architecture and customer acceptance. No production or pilot approval is implied by this staging deployment.
