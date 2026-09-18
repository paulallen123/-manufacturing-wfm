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
