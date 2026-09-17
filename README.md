# Manufacturing WFM — isolated customer-proof staging lane

This branch records **0.6.70-hosted-staging-rc5**, derived from the canonical **0.6.70-provider-native-reconciliation-controls-candidate**. It exists to prove the latest customer journey without weakening the separate containment environment or implying production approval.

The build is **fictional/demo-data staging only** and refuses `NODE_ENV=production`. Hosted mode requires HTTPS origin enforcement, an explicit staging database path and a non-default credential. The old local demo credential is rejected. The customer-facing login and authenticated shell identify themselves as **hosted staging demo**, keep the hosted password field blank, and explicitly state that the environment is not production or pilot approved.

The runtime is SHA-256 pinned to `5fbe9c2923890c410cf6d7184f7678409da92cf3c6b485a217de60d6259a9931`. `DEPLOYMENT_MANIFEST.json` records the canonical parent, hosted derivative identity, runtime manifest and completed customer-focused gates.

Completed evidence before independent Chromium proof: **65/65** security/authentication/tenant/correction tests, **61/61** onboarding/kiosk/manufacturing/payroll tests, **39/39** focused hosted/API/Factory Control Centre/source-watch tests plus **5/5** explicit hosted-entry assertions, exact packaged health/login/bootstrap smoke, and external HTTPS health with HSTS on the RC5 Railway service.

Independent Chromium run `35214869595` is the current browser acceptance gate. Open gates after browser proof remain full-suite regression completion, genuine provider Level A acceptance, external security/performance assurance, production persistence/backup architecture and customer acceptance. This staging lane is suitable only for controlled customer demonstration and evidence gathering until those gates close.
