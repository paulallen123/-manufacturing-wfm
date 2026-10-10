# Gusto webhook receiver

The existing candidate previously loaded a receiver from a data URL in `NODE_OPTIONS`, outside the source image. It saved an unauthenticated verification token before checking it with Gusto, and then used the newest token to validate events regardless of whether verification succeeded. An isolated HTTP/SQLite regression reproduced acceptance of a forged event after the simulated provider rejected its token. No adversarial request was sent to the hosted service.

The versioned receiver replaces that preload at the same `/api/integrations/gusto/webhooks` route. Configure the existing service with:

```text
NODE_OPTIONS=--import=/app/integration-runtime/gusto-webhook-preload.mjs
```

The Docker image and canonical local composer both package the receiver and preload. Docker admission executes the receiver regression suite, including an actual child process with the Node preload.

Verification uses the already registered subscription from the existing database and the configured provider environment. Caller-supplied subscription identifiers cannot replace that binding. The candidate token becomes durable and usable only after Gusto accepts it for that subscription; a failed verification leaves the established token and subscription unchanged. The transaction rechecks the binding after the provider round trip. Existing unverified token rows remain preserved but cannot authenticate events.

Events require a verified subscription and its verified token. HMAC covers the exact received bytes; duplicate events retain one receipt, and conflicting payloads under the same event identifier are rejected. Public health exposes only a readiness response, not subscription identifiers, token state, provider errors or event counts. JSON sizes and provider response sizes are bounded; provider calls reject redirects and share a seven-second deadline. Errors exclude provider bodies and credentials.

Startup does not provision or verify a subscription, acquire a provider token, or process any workforce/payroll operation. It uses the existing subscription and database. A provider callback can verify the existing subscription; a signed event records its metadata receipt only. This change does not prove provider delivery, customer training, workforce reconciliation, payroll submission or production readiness.

The legacy callback format and table schema are preserved. Existing verified tokens are still retained in the original database token column; this repair does not migrate historical storage or claim encryption at rest for that column. A subscription must be established through the existing provider administration workflow before verification callbacks can be admitted.

Official contracts: [Gusto webhook verification](https://docs.gusto.com/embedded-payroll/reference/put-v1-verify-webhook-subscription-uuid), [Gusto webhook signatures](https://docs.gusto.com/embedded-payroll/v2026-02-01/docs/webhooks), and [App Integrations event payload and retries](https://docs.gusto.com/app-integrations/docs/webhooks).

Run `node --test integration/runtime/gusto-webhook-receiver.test.mjs` with the pinned Node 22.23.2 runtime. Tests use isolated SQLite files, real local HTTP requests and a simulated provider; no live Gusto credentials or writes are used.
