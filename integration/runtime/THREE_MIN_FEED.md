# 3Min API feed receiver — bounded implementation

The existing autonomous integration hub now accepts authenticated JSON feeds at
`POST /api/integrations/autonomous/feeds/3min/<binding-id>` and exposes tenant-scoped
receipt metadata at `GET /api/integrations/autonomous/feeds/3min` through the existing
manager session check. Both the Dockerfile and local runtime assembler copy the
receiver. Docker admission includes its HTTP tests and a composed bootstrap,
authentication, receipt-readback and restart regression.

This is transport intake, not a completed provider connector or operational
import. Data remains RECEIVED_UNVALIDATED until a source-specific consumer proves
authorisation, mapping, completeness and reconciliation. Invalid authenticated
payloads receive REJECTED_VALIDATION receipts with a digest but no retained bad
payload. Neither path grants source readiness, payroll authority or savings.

## Configuration

On the existing VECTOR service, configure `WFM_3MIN_FEEDS_JSON` as a JSON array.
Each binding must contain exactly these fields:

```json
[{
  "id": "customer-workforce",
  "tenant": "<actual-authorised-tenant>",
  "site": "<actual-authorised-site>",
  "source": "<actual-authorised-source>",
  "domain": "people",
  "environment": "sandbox",
  "endpointSlug": "iy9xlv2w0i5ml2m88pmag",
  "secretEnv": "WFM_3MIN_WORKFORCE_TOKEN"
}]
```

Set the named secret separately to a unique cryptographically random value
(e.g. 32 random bytes encoded as base64url, 43 characters). Never use an existing
internal worker token. An absent, malformed or weak configuration disables intake.
Changing a binding's scope or endpoint slug requires a new binding ID; existing delivery identities
cannot be reinterpreted as another tenant or source.

Supported intake domains: people, organisation, skills, absence, time, production,
quality, maintenance, finance, payroll and access-control. This list describes
allowed envelope categories, not certified vendor integrations.

Configure the 3Min endpoint's webhook to the exact HTTPS VECTOR receiver route
only after the receiver's release and authorised tenant/site/source configuration.
Set the webhook auth header name to `x-vector-feed-token` and its value to the
matching receiver secret using the 3Min API dashboard. The connected 3Min tools
cannot set that header or retrieve the full API key. Do not paste secrets into
GitHub, chat, URLs or endpoint descriptions. Use separate endpoint/binding secrets
for different source authorities and sandbox/production.

3Min's signing headers are not verified by this implementation: authentication
uses its documented custom auth-header mechanism over HTTPS. Adding Standard
Webhooks signatures should use the official library, never hand-rolled crypto.

## Envelope and delivery semantics

3Min sends a notification wrapper, not the original request as the top-level body.
The documented wrapper has `id`, `operation`, `status`, `endpoint_slug`, `payload`,
and `processed_at`, with `target_record_id` on updates/deletes. The wrapper's `id`
must equal `X-3minapi-Record-Id`; `endpoint_slug` must equal the configured
`endpointSlug`. These mismatches fail403 without storing a source payload.

This append-only inbox accepts only `operation: "create"`, `status: "success"`
and an absent/null `target_record_id`. Other operations, failed results or malformed
notifications receive durable REJECTED_VALIDATION receipts and2xx; they never
update/delete workforce records. The VECTOR envelope below is inside `payload`.
Reference: https://3minapi.com/guide/endpoint-detail#webhook-payload

The endpoint requires exactly `schemaVersion, tenant, site, source, domain,
environment, eventId, occurredAt, records`. Version is `vector-feed-v1`.
Tenant/site/source/domain/environment must exactly match the server binding.
Events need a stable nonempty source identifier and canonical ISO UTC timestamp.
Each request holds 1–500 object records, with a 256 KiB raw-body ceiling and bounded
JSON nesting. Credentials and payloads are never included in receipt readback.

3Min delivers `X-3minapi-Record-Id`. Durable SQLite transactions atomically bind
every delivery ID (including aliases for the same source event) to one receipt,
store the serialized original payload and its digest, and append audit metadata.
Accepted event checksums use `JSON.stringify(payload)` so wrapper IDs and processing
timestamps can vary for duplicate source events. JSON whitespace is normalized;
payload key order remains significant. Validation-rejection checksums use the raw
notification bytes and retain no payload. Matching retries return the same receipt;
changed payloads or conflicting reused IDs return409. Storage failures roll back and
return503 so the provider can retry. Authenticated validation failures are stored
and acknowledged202; transport/auth/scope failures remain4xx. The provider contract
requires response within15 seconds; committed2xx is receipt acknowledgement, not
processing success.

There is deliberately no automatic deletion, outbound provider write, employee
creation, connection-state promotion, UI readiness claim or background consumer.
The existing durable database retains accepted payloads; production retention and
capacity must be included in release operations.

## Provisioned provider resource

- Endpoint: `01a16a4d-c707-7e24-8a5c-3f0e1fc4d59c`, VECTOR workforce intake v1.
- API URL: https://api.3minapi.com/api/v1/data/iy9xlv2w0i5ml2m88pmag
- Dashboard: https://3minapi.com/dashboard/api/01a16a4d-c707-7e24-8a5c-3f0e1fc4d59c
- At creation: sandbox active, production inactive, neither webhook configured.
- Latest readback after the user's dashboard action: production is also active;
  neither webhook is configured and the VECTOR receiver remains undeployed.
- Synthetic record `01a16a4e-af16-74a3-9399-86e3f1b84c7b` accepted202 and subsequently
  read back200 with its exact nine-field envelope.
- Creation also queued the provider's automatic sample record. That sample does
  not satisfy VECTOR's semantic envelope validation.
- Free subscription observed:1,000 calls/month,7-day provider retention. No upgrade.

No employee, customer or provider production data was sent in these checks.

