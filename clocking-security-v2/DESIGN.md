# Invisible Attendance v1 — zero-hardware clocking

Status: isolated development candidate; not release-approved.

## Product objective

Make attendance effectively invisible to the worker using infrastructure and actions the customer already owns. No new clocks, fobs, badges, beacons or specialist readers are required by the product. A worker should normally arrive, begin work and leave without opening an app, scanning a code or joining a queue.

The engine converts independent site/identity evidence into an auditable attendance decision. It does not use opaque ML to decide pay.

## Evidence inputs

Initial provider-neutral event model:
- existing access-control entry/exit;
- existing T&A clocks where the customer explicitly keeps them authoritative;
- enterprise Wi-Fi/RADIUS authenticated association/disassociation;
- MES/HMI operator login/logout;
- Windows/workstation login/logout;
- site-scoped SSO activity;
- existing scanner activity;
- precise proximity/ranging where already available (BLE Channel Sounding, UWB, Wi-Fi RTT/NAN RTT).

Raw GPS, continuous coordinates, CCTV imagery and biometrics are not required for v1.

## Non-negotiable safety invariants

1. A lost Wi-Fi/Bluetooth/phone/workstation signal never stops pay by itself.
2. Ordinary HMI/workstation logout is corroborating evidence, not a departure anchor by default.
3. Automatic IN/OUT requires independent evidence domains unless an existing T&A source is explicitly configured as direct authority.
4. Tenant, employee and site boundaries fail closed.
5. Evidence event IDs are idempotent; content-changing replay is rejected.
6. Evidence is immutable. Corrections/reviews must be separate records in the production integration.
7. Source timestamp and server receipt timestamp are distinct. Unsupported clock skew/staleness is rejected or held.
8. Ambiguity produces review_required/evidence_only, never a guessed payroll event.
9. Store only metadata required to explain/reconcile the attendance event; raw coordinates/SSID/images are dropped by this model.
10. Pay-policy calculation remains a separate deterministic layer. Presence evidence must not silently redefine contractual paid-time rules.

## Automatic IN

Examples that can form a quorum:
- existing door entry + authenticated enterprise Wi-Fi;
- on-site HMI login + authenticated enterprise Wi-Fi;
- workstation login + independent on-site proximity evidence;
- explicitly-authoritative legacy T&A IN event.

The authoritative timestamp is taken from a trusted start anchor after corroboration, not from the arrival time of the second signal.

## Automatic OUT

OUT is intentionally stricter because false clock-out can underpay a worker.

Default automatic OUT requires a genuine departure anchor (currently existing access exit, or explicit authoritative legacy T&A OUT) plus an independent corroborating absence/end-of-work signal. Wi-Fi disappearance, HMI logout, workstation logout or ranging-away alone cannot stop pay.

Future customer-specific adapters may designate a work-ending source as an OUT anchor only after the source semantics are proven and the configuration is explicitly approved.

## Durable recovery slice

The isolated development branch now includes a synchronous append-only evidence journal used to prove crash/restart and exact-once semantics before database integration.

The journal deliberately persists the event before the attendance engine is allowed to act, fsyncs each frame, records a checksum and stable event digest, and stores the resulting engine outcome separately. On restart the runtime rebuilds state by replaying durable events in order. A crash after the event is persisted but before it is applied therefore replays it once; a crash after application but before the caller receives the response becomes a deterministic replay rather than a second attendance mutation.

Additional safeguards:
- partial trailing frames from interrupted writes are truncated without discarding earlier complete frames;
- checksum corruption fails closed;
- conflicting reuse of a provider event ID fails closed;
- rejected evidence gets a durable rejection outcome so restart does not create an infinite poison-message loop;
- logic-version mismatch fails closed instead of silently reinterpreting historic payroll evidence under changed rules.

This file journal is a development proof harness, not the final production persistence choice. Production integration should use the existing transactional datastore with unique event identity and durable commit settings. If SQLite is used for an embedded/site component, WAL with `synchronous=FULL` is the minimum durability mode under consideration because SQLite documents FULL WAL transactions as ACID across power loss; the final datastore decision remains subject to the product's existing persistence architecture.

## Reliability acceptance target

"100% reliability" is an engineering acceptance target, not a promise that third-party networks and physical infrastructure never fail. Release requires 100% pass on the defined safety/integrity suite and, critically, zero silent wrong payroll mutations in tested failure scenarios.

Before release:
- deterministic unit/state tests: 100% pass, zero skipped;
- randomized replay/reorder/property runs: no duplicate authoritative transition;
- high-volume weak-signal attack: zero negative-only clock-outs;
- persistent-store crash/restart and exact-once recovery;
- concurrent ingestion/idempotency across multiple workers/sites/tenants;
- provider outage, delayed delivery, duplicate delivery and clock-drift tests;
- revoked source/device and credential-rotation tests;
- cross-tenant/cross-site adversarial tests;
- real provider adapter proof for at least two independent evidence domains;
- payroll exclusion proof for evidence_only/review_required states;
- manager correction/review audit proof;
- privacy/DPIA implementation review and worker transparency requirements;
- hosted synthetic factory soak with shift-boundary bursts;
- production rollout behind a feature flag with rollback and observation.

If uncertainty remains, fail safe to review rather than fabricate an attendance time.

## Legacy terminal integration pattern

For existing Suprema/BioStar estates, near-real-time attendance should prefer the platform's WebSocket event stream rather than polling the event-search REST API. Suprema documents that event-search reads from the database after an approximately 3–10 second delay, whereas the WebSocket stream exposes monitoring events in real time. Historical/API retrieval remains valuable for reconciliation and gap filling.

The adapter must preserve both provider event time and our receive time. Suprema documents that `datetime` is the actual device event time while `server_datetime` is the later database synchronisation time. Therefore `datetime` should be treated as source evidence after timezone handling; `server_datetime` must not silently replace the actual event occurrence time.

Recommended pattern: realtime WebSocket ingest -> durable event journal/inbox -> deterministic attendance engine -> historical API/index reconciliation for missed intervals after reconnect. Existing Suprema hardware can remain in place; no replacement clock or new credential is required.

## Research basis (checked 18 Sep 2026)

- Microsoft NPS/RADIUS accounting supports Accounting-Start/Stop/Interim records tied to authenticated user sessions.
- HPE Aruba Central exposes client/location streaming events where the customer already has the required WLAN/location configuration.
- Cisco Meraki exposes wireless client auth/association/disassociation/roam events that can be mapped into the provider-neutral Wi-Fi evidence adapter, subject to identity-binding quality.
- Suprema BioStar 2/X recommends WebSocket for real-time event logs because REST event-search reads from the database after an approximately 3–10 second delay; the device `datetime` and later `server_datetime` are distinct.
- Android 16 Ranging provides a unified API for UWB, Bluetooth Channel Sounding, Wi-Fi NAN RTT and Bluetooth RSSI where compatible hardware already exists.
- Bluetooth Core 6.0 Channel Sounding adds secure fine-ranging mechanisms; it is an optional enhancement, never a hardware dependency.
- SQLite documents `synchronous=FULL` in WAL mode as ACID, including durability across power loss; this informs the persistent-site adapter design but does not force SQLite as the product datastore.
- UK ICO worker-monitoring guidance requires clear purpose, necessity/proportionality and transparency; biometric timekeeping creates additional special-category-data obligations, so biometrics are not the default design.


## Access-control integration autopilot

Physical access is now treated as a first-class zero-hardware attendance evidence domain, but access activity is not blindly equated with work or presence.

New isolated modules:
- \`access-control-evidence.mjs\`: provider-neutral safety boundary for person-bound access decisions;
- \`access-feed-supervisor.mjs\`: connector health, token-expiry, reconnect, deduplication and historical-reconciliation supervision.

Safety rules:
- a generic door-unlock/door-state event is never treated as proof that a person crossed the door;
- only a granted event tied to a mapped personal credential and a known directional reader can become \`access_entry\` or \`access_exit\`;
- shared/weak identity bindings fail to review;
- denied access is operational/security intelligence, not attendance evidence;
- doors can be marked attendance-ineligible so internal movements do not create attendance transitions;
- raw credential numbers, images and biometric templates are not required or stored by the adapter.

Lowest-friction onboarding strategy:
1. Detect or select the customer's access platform.
2. Prefer vendor push/event subscription over high-frequency polling.
3. Prefer a vendor cloud gateway when available to avoid customer firewall changes.
4. Otherwise use the existing site edge-connector pattern with outbound-only connectivity.
5. Auto-discover access points and people where APIs permit.
6. Auto-map people through existing workforce identifiers/credential assignments.
7. Ask the customer only to confirm ambiguous doors, direction and attendance eligibility.
8. Start in evidence-only mode until identity/direction mapping and feed health tests pass.

Continuous operation:
- connector heartbeat proves the integration is alive even when no doors are used;
- auth expiry is detected before failure so credentials can be refreshed proactively;
- duplicate provider events are ignored safely;
- sequence gaps create reconciliation/backfill work rather than silent data loss;
- reconnect automatically schedules historical reconciliation where supported;
- event lag is measured from provider event time to receipt time;
- feed health can be shown as healthy / reconciling / degraded / stale / auth refresh due.

Current local proof: 15/15 new access-control/autopilot tests passed on 18 Sep 2026. These tests are additive to the existing invisible-attendance safety suite and do not make the branch release-approved.

## Access-control research basis (checked 18 Sep 2026)

- Kisi documents real-time webhooks and recommends event push instead of repeated API polling; its authenticated API is rate-limited.
- Gallagher Command Centre's View Events & Alarms REST API supports historical retrieval and monitoring live events. Gallagher's Cloud API Gateway is specifically intended to simplify remote connectivity and reduce firewall/IT configuration by tunnelling to on-prem Command Centre.
- Genetec Security Center Web SDK supports receiving/listening for events and querying access-control events; the integration lane may be cloud-reachable or site-edge depending on deployment.
- HID Origo supports callback/webhook event delivery plus an Event Management API for later retrieval. Its callback lifecycle includes suspension/recovery behavior, reinforcing the need for our independent reconciliation supervisor.
- ONVIF Profile A supports standardized access-control configuration and standardized access-control-related events, giving us a vendor-neutral path for conformant products.
- UK ICO guidance treats access-control/timekeeping monitoring as worker monitoring; biometric identification is special-category data when used to uniquely identify a person. The product should therefore minimize collected data, keep workers informed, and avoid ingesting biometric templates where not required.


## 24/7 100% capture certification protocol

The product must never advertise or display an unqualified 100% attendance claim merely because a connector is installed or because the average capture rate is high. Certification is generated from evidence.

Two metrics are deliberately separate:
- **Automatic Capture Rate** — percentage of scheduled workers with a proven passive automatic IN and OUT route before the shift.
- **Verified Clock Completeness** — percentage of scheduled working shifts that finish with a verified IN and OUT and zero unresolved identity/evidence exceptions.

A site/shift may display **PASSIVE_AND_VERIFIED_100** only when all of the following are true:
1. automatic preflight coverage is 100% for every scheduled worker;
2. every working shift has a verified IN and OUT;
3. no missing IN, missing OUT, partial-evidence, stale-session, unscheduled-presence or unmapped-person exception remains;
4. every evidence source required for the shift is currently healthy;
5. every source proves complete continuity across the certification window;
6. every detected sequence/cursor gap or reconnect interval has been reconciled from a supported authoritative backfill source;
7. a non-backfillable source that suffered a possible loss cannot be used to certify that window;
8. payroll release remains blocked while any of the above is false.

If final verified completeness is 100% but automatic capture coverage was below 100%, the only permitted claim is **VERIFIED_100_ONLY** and the automatic capture rate must be stated separately.

24/7 supervision uses a provider-neutral source watchdog with heartbeat, event lag, sequence-gap detection, duplicate detection, reconnect handling and certification-window reconciliation. A feed that appears healthy now but had an unreconciled gap earlier cannot certify the historical shift.

This supports an evidence-backed statement such as:
> “100% of scheduled working shifts had a verified IN and OUT for the certified period.”

It does not support a blanket statement that passive infrastructure can infallibly observe every human under every physical/network failure. Any marketing claim must remain aligned with the evidence certificate actually generated by the product.
