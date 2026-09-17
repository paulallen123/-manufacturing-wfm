# Manufacturing WFM — isolated customer-proof staging lane

This branch records **0.6.70-hosted-staging-rc4**, derived from the canonical **0.6.70-provider-native-reconciliation-controls-candidate**. It exists to prove the latest customer journey without weakening the separate containment environment or implying production approval.

The build is **fictional/demo-data staging only** and refuses `NODE_ENV=production`. Hosted mode requires HTTPS origin enforcement, an explicit staging database path and a non-default credential. The old local demo credential is rejected. The customer-facing UI identifies itself as **Hosted staging demo** and explicitly states that it is not production or pilot approved.

The runtime is SHA-256 pinned to `c99f0ffb724978cb758eb16237b293791fe1e9aeca9d395d8c4238283789f380`. `DEPLOYMENT_MANIFEST.json` records the canonical parent, hosted derivative identity, runtime manifest and completed customer-focused gates.

Completed evidence before independent Chromium proof: **65/65** security/authentication/tenant/correction tests, **61/61** onboarding/kiosk/manufacturing/payroll tests, **39/39** hosted-presentation/API/Factory Control Centre/source-watch tests plus **5/5** explicit hosted-presentation assertions, and external HTTPS health with HSTS on the RC4 Railway service.

Open gates remain final independent browser evidence, full-suite regression completion, genuine provider Level A acceptance, external security/performance assurance, production persistence/backup architecture and customer acceptance. This staging lane is suitable only for controlled customer demonstration and evidence gathering until those gates close.
