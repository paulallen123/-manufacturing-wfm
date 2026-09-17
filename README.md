# Manufacturing WFM — isolated customer-proof staging lane

This branch records **0.6.70-hosted-staging-rc6**, derived from the canonical **0.6.70-provider-native-reconciliation-controls-candidate**. It exists to prove the latest customer journey without weakening the separate containment environment or implying production approval.

The build is **fictional/demo-data staging only** and refuses `NODE_ENV=production`. Hosted mode requires HTTPS origin enforcement, an explicit staging database path and a non-default credential. The old local demo credential is rejected. The customer-facing login and authenticated shell identify themselves as **hosted staging demo**, the operating context says **Hosted staging evidence**, the hosted password field is blank, and the kiosk uses neutral fictional-demonstration wording rather than a development-build label.

The runtime is SHA-256 pinned to `89666f0b3118fa262fda5764f07915fde07492f816fa9ac8140b560089f6f3e0`. `DEPLOYMENT_MANIFEST.json` records the canonical parent, hosted derivative identity, runtime manifest and completed customer-focused gates.

Completed evidence before final RC6 Chromium proof: **65/65** security/authentication/tenant/correction tests, **61/61** onboarding/kiosk/manufacturing/payroll tests, **39/39** focused hosted/API/Factory Control Centre/source-watch tests plus **7/7** explicit customer-presentation assertions, exact packaged health/login/bootstrap smoke, and external HTTPS health with HSTS on the RC6 Railway service. RC5 independently passed the full Chromium journey before these two label-only RC6 changes.

Independent Chromium run `35215470091` is the final RC6 browser acceptance gate. Open gates after browser proof remain full-suite regression completion, genuine provider Level A acceptance, external security/performance assurance, production persistence/backup architecture and customer acceptance. This staging lane is suitable only for controlled customer demonstration and evidence gathering until those gates close.
