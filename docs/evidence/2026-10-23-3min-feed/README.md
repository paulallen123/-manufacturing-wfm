# Execution evidence — 23 October 2026

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

## Honest boundaries and next gates

The receiver has not been merged, built into an admitted image, deployed, or enabled
in the customer tenant. No live webhook delivery or browser/customer journey is
proven. The new receipt API has no added UI rendering. No automatic mapping consumer
or real provider authorisation was implemented. No completion claim for "all
integrations" is made.

Next: current integrator adopts this exact bounded delta after review, runs supported
Node22/full-image and installed middleware admission, binds the authorised actual
tenant/site/source and unique secret in the existing service, configures dashboard
webhook authentication, tests sandbox-to-hosted delivery/readback/restart, implements
the source-specific consumer with reconciliation and customer UI, then promotes
production through the existing release process. Real ERP/HCM/payroll/MES/access
connections additionally need their own authorised provider identities and scopes.

The existing Railway build cancellation and frozen candidate are owned by the
current integration execution; this session did not replay or bypass that action,
alter Railway configuration, create a new service, or weaken release gates.

