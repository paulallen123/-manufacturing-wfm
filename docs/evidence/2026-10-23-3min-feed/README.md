# Execution evidence — 23 October 2026

## Current successor: documented webhook envelope

The user's dashboard screenshot exposed a contract gap in the original receiver:
3Min sends a notification containing the original request in `payload`, not the
original request as the top-level body. Verified against the official endpoint
manual, Webhook payload section: https://3minapi.com/guide/endpoint-detail.
The initial wrapper regression fails with REJECTED_VALIDATION where intake was
expected; see webhook-wrapper-red.tap. Earlier passing tests did not cover that
provider wrapper and do not prove compatibility.

The correction validates the notification and extracts the original payload.
Bindings now require endpointSlug, which is part of their immutable fingerprint.
Body/header record IDs and the bound endpoint must match. Only successful create
notifications are ingested. Updates, deletes, failed results and malformed wrappers
receive metadata-only durable rejection receipts; there are no workforce mutations.
Accepted event digests use JSON.stringify(payload), allowing distinct provider
record IDs/processing timestamps for one source event while preserving delivery
alias reservations and detecting conflicting payloads. Raw notifications remain
the digest input for validation rejections. The accepted stored JSON is the original
payload, not provider metadata.

Fresh Node22.23.2 source suite:80/80 PASS, exit0, zero skips; focused11/11.
Actual composed bootstrap/login/HTTP intake/readback/restart:1/1 PASS, exit0,
using the documented wrapper. See webhook-wrapper-green.tap and
webhook-wrapper-composed.tap. Independent review is in webhook-wrapper-review.md.

Base reconciliation: latest frozen PR501 source75310949f6fa965e81f49edbb77837423b7c705e
changes four harness/receipt files plus records since80e324; none overlap the
3Min donor files. This successor incorporates that base in the same PR509 branch,
preserving its repaired harness, receipt and evidence. No PR501/canonical branch
or frozen deployment configuration is changed. Current-base composed/harness/receipt
verification passes10/10, exit0, zero skips, in current-base-composed.tap.

Latest read-only infrastructure reconciliation: isolated deployment48dba1fe reports
SUCCESS at source75310949. It does not include the 3Min receiver and is not proof
of this donor or the customer journey. Customer service's latest deployment remains
d9112b19 FAILED with no WFM_3MIN variables. 3Min production is now enabled by the
user's dashboard action; both webhook URLs remain absent. No credentials or webhook
settings were changed here.

Account readback: Free,1000 calls/month,3 used,7-day retention. The official endpoint
manual additionally says Free endpoints are automatically removed seven days after
creation. Persistent production operation therefore requires the account's endpoint
lifetime to be resolved through the provider's plan settings; no plan change was
made or authorized by this implementation. No live provider data was sent.

## Earlier implementation evidence

User request: add required VECTOR integrations via 3Min API in the existing live
tenant; resumed with "Proceed in getting this done".

Author execution: /root, workspace /workspace/scratch/6b06c133d8ed.
Independent reviewer: /root/review_3min.
Parent snapshot:80e32463a113599a3e29f02fed267fed5ed1b5b7 (existing PR501 lineage).
This is a bounded donor change for the current integrator, not a new release
controller or replacement product. The local checkout is a partial source snapshot;
remote publication preserves the full parent Git tree.

No AGENTS.md appeared in the full parent tree. Open PR search for3Min/3min returned
no focused existing implementation before editing and again before publication.
PR501's existing source/build owner and frozen build target remain unchanged.

## Fresh evidence

- Initial six HTTP tests failed against the unchanged hub: the receiver was absent.
- An added delivery-ID alias regression reproduced202 instead of409, then passed
  after the delivery association table repair.
- First integrated source run:75/75 Node24.19.0 tests, zero failures/skips.
- Independent review found an Important protocol gap: semantic validation failures
  returned permanent400 without durable rejection evidence. Fixed by transactional
  REJECTED_VALIDATION receipts, metadata/digest only,202 acknowledgement.
- Final focused suite:7/7. Final broad source suite is retained in source-tests.tap.
- Independent re-review accepted receiver SHA256
  2bd84c8ae69a8945fe37528e15b9310a0c751a51810217029248a695e6baed8a and
  test SHA25684914cb98b37ae7fbf32e14b549ab778963fe51666289ff217fba0c93acc747e.
  Heldouts verified all11 domains, cross-tenant isolation, wrong credential/scope,
  restart replay, conflicting correction, absent invalid payload retention,
  atomic failure rollback and retry after storage recovery.
- Syntax checks passed. Docker COPY/test additions preserve the original CRLF
  encoding; this restoration is formatting-only relative to the reviewed content.
- Source inspection confirms bootstrap's integration-prefix routing and that its
  identity guard passes sessionless integration traffic to the responsible handler.
  This is static reachability evidence, not installed-runtime execution.
- 3Min resource creation and synthetic write/readback succeeded; see THREE_MIN_FEED.md.

## Continuation: Node 22 and composed runtime

The same 76 integration tests pass on Node22.23.2, zero failures/skips, in
source-tests-node22.tap. This closes the previously unverified supported-Node
source-test gate.

The explicit integration file list in scripts/compose-vector-local-runtime.mjs
omitted three-min-feed.cjs. The modified hub required that file, so the local
assembled application could not load the receiver. A composed regression first
failed its receiver-presence assertion (composed-red-node22.tap). Adding the
receiver to that list fixes the packaging gap. Docker admission now includes the
new composed regression in a separate RUN after dependency installation.

The first post-fix run passed startup, HTTP intake, login, receipt inspection and
restart/replay, then failed the test fixture's tenant change because its target
tenant did not exist. That result is retained in composed-fixture-failure-node22.tap.
The fixture now inserts the synthetic tenant before changing its synthetic user.
The final composed regression passes1/1 on Node22.23.2, exit0, zero skips, in
composed-green-node22.tap. It exercises the actual composed bootstrap and security
middleware, rejected credentials, session-required receipt reads, real fixture
login, payload/secret exclusion, durable replay after process restart, and tenant
change isolation. No canonical employee records are created.

The composed input snapshot copied1233 Git-blob-verified files from the existing
PR501 source cache. Two locally modified harness files were excluded and fetched
from the exact parent commit instead. The original harness/deadlines were used;
this work did not adopt the separate release owner's diagnostic proposal. Cached
security dependencies were copied into the isolated test snapshot. This is local
composed-runtime evidence, not a Docker build, exact installed image, fresh npm
installation or hosted/provider proof.

Read-only release reconciliation found PR501's build failed at its existing
attendance-runtime readiness check. The latest customer build d9112b19 also reports
FAILED; the previous customer deployment057e19a2 remains listed SUCCESS. No deployment
or configuration was changed. 3Min endpoint readback still shows sandbox active,
production inactive and no webhook/auth value. Its connected tool cannot set the
dashboard-only webhook auth header. Provider source authorisation and a source-specific
mapping consumer remain necessary before operational use.

## Honest boundaries and next gates

The receiver has not been merged, built into an admitted image, deployed, or enabled
in the customer tenant. No live webhook delivery or browser/customer journey is
proven. The new receipt API has no added UI rendering. No automatic mapping consumer
or real provider authorisation was implemented. No completion claim for "all
integrations" is made.

Next: current integrator adopts this exact bounded delta after review, runs supported
full-image and hosted admission, binds the authorised actual
tenant/site/source and unique secret in the existing service, configures dashboard
webhook authentication, tests sandbox-to-hosted delivery/readback/restart, implements
the source-specific consumer with reconciliation and customer UI, then promotes
production through the existing release process. Real ERP/HCM/payroll/MES/access
connections additionally need their own authorised provider identities and scopes.

The existing Railway failed-build diagnosis and candidate are owned by the
current integration execution; this session did not replay or bypass that action,
alter Railway configuration, create a new service, or weaken release gates.

