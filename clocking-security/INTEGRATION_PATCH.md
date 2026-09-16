# WFM 0.6.29 Clocking Security Integration Patch

Status: **IMPLEMENTATION-READY DESIGN / ISOLATED MODEL VERIFIED / NOT YET MERGED INTO THE VERIFIED WFM BUNDLE**

## Baseline actually inspected

The current Railway browser-test runner extracted package version `0.6.29-proof-factory-zero-touch-foundation-candidate`. Its shared kiosk path is implemented in `server.cjs`, `public/kiosk-client.js`, `public/kiosk-sw.js`, `public/kiosk.html`, and the existing `lib/personal-store.cjs` / `public/personal-core.js` clock state machine.

Fresh hosted browser baseline before this patch: **144/144 checks passed** across Chromium, Firefox and WebKit for manager, employee, supervisor, payroll and super-user desktop/mobile journeys. The frozen source bundle has not been modified by this experiment.

## Concrete defect being fixed

The current `/api/kiosk/sync` authenticates the registered tablet and checks tenant/site/readiness/idempotency/sequence, but passes `Date.parse(capturedAt)` from the kiosk browser into `personal.command()` as the effective clock time. A manipulated tablet wall clock can therefore influence authoritative attendance time within the supported offline window. `serverAt` is recorded, but is not the personal event time.

The shared kiosk also identifies a worker from a scanned/typed employee ID. Device authentication does **not** prove which person is standing at the tablet. That is a separate buddy-punching/identity risk and remains an open next slice.

## Smallest safe server patch

### 1. Add one-time kiosk challenge storage

Add a transactional table such as:

```sql
CREATE TABLE IF NOT EXISTS kiosk_challenges(
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES kiosk_devices(id),
  tenant TEXT NOT NULL,
  site TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS kiosk_challenges_expiry ON kiosk_challenges(expires_at);
```

Do not accept tenant/site from the client. Resolve them from the registered device.

### 2. Add `GET /api/kiosk/challenge`

Place this before cookie-authenticated application routing, because it uses the existing `kioskDevice(req)` credential instead of a user session.

Behaviour:
- authenticate active registered device;
- generate cryptographically random challenge ID;
- bind to device + tenant + site;
- 60-second expiry;
- return `{challengeId, serverTime, expiresAt}`;
- opportunistically prune old used/expired challenges;
- `Cache-Control: no-store`.

### 3. Bind challenge into kiosk event digest

Current digest fields remain and add `challengeId || null`. Reusing an event ID with altered challenge/time/employee/type must continue to fail.

### 4. Change `/api/kiosk/sync` time-authority decision

Keep all existing checks for:
- device credential and revocation;
- tenant/site from registered device;
- employee readiness and authorised site access;
- event type;
- bounded offline evidence timestamp;
- event ID idempotency/content collision;
- strict per-device sequence.

Then:

**Valid unused challenge for same active device/tenant/site**
- authoritative time = server receipt time;
- client `capturedAt` survives only as evidence;
- mark challenge used in the same transaction as clock application;
- call existing `personal.command()` with the server time;
- return `status: accepted`, `timeTrust: server`, `authoritativeAt`, `clientCapturedAt`, `receivedAt`.

**Missing / expired / reused / unknown / wrong-device challenge**
- do **not** mutate `personal_clock`, `personal_event` or `personal_session`;
- durably store kiosk evidence as `status: held`, stable reason `OFFLINE_OR_UNVERIFIED_TIME` and detailed reason code;
- store device/site/employee/kind/client captured time/server received time;
- advance the device sequence because the server safely received the evidence;
- return `status: held`, never “accepted” or “payroll approved”.

**Prior unresolved held evidence for the employee**
- any later otherwise-valid kiosk event is also held as `PRIOR_HELD_EVENT`;
- this prevents an offline OUT followed by an online IN from corrupting the authoritative state machine.
- implement this with an indexed DB lookup, not a history scan.

### 5. Add a tenant-scoped review read model

`GET /api/kiosk/review`, authenticated by normal application session and `company.configure` (or a narrower future attendance-review permission).

Return a bounded latest page of held kiosk evidence for the actor's tenant only. Fields: device, site, employee, event type, sequence, client captured time, server received time, hold detail, resolution state. Never return device secret hashes.

### 6. Add explicit review resolution only after the read model passes

Use a separate immutable resolution record/table rather than rewriting original kiosk evidence. Required fields:
- tenant, device, event ID;
- approve/reject;
- independently verified authoritative time for approval;
- reviewer identity and server review time;
- reason;
- idempotency key/digest;
- resulting personal event ID when applied.

Rules verified by the isolated model:
- tenant scoped;
- reason mandatory;
- approval requires verified time;
- resolve an employee's held evidence in durable order;
- a held event applies at most once;
- rejection never mutates personal state;
- authoritative clock cannot move backwards;
- original `clientCapturedAt` and `receivedAt` remain immutable;
- once the chain is reconciled, normal online server-time clocking can resume.

## Client patch

### `public/kiosk-client.js`

- while online and registered, prefetch one `/api/kiosk/challenge` using existing device credentials;
- consume one challenge per deliberate employee clock action;
- attach `challengeId` to the queued event;
- if no challenge exists, queue immediately anyway as evidence for review—do not strand the worker at the tablet;
- after sync, remove both `accepted` and `held` events from IndexedDB once the server durably acknowledges them;
- keep rejected/transport-failed events queued;
- display separate counts for accepted vs held-for-review;
- never call a local save or held result payroll-approved;
- do not silently retry a held event with a new challenge, because that would alter the evidence semantics.

### `public/kiosk.html`

Keep the warm flow to one deliberate tap after employee identification.

Copy states:
- online/verified: “Server time verified. Attendance still follows normal review.”
- offline/no challenge: “Recorded on this device. It will be sent for attendance review.”
- server-held: “Received safely. A manager needs to verify the time before it can affect attendance.”

No coordinates should be shown. No geolocation, face recognition or biometric database is required for this slice.

## Feature flag / rollback

Integrate behind a server-side feature flag, suggested name:

`WFM_KIOSK_VERIFIED_TIME_V1=true`

Default **false** until migration + regression + hosted browser tests pass. Flag-off behaviour must not delete challenge/held/review evidence. If the new path is disabled after use, stop new verified-time writes but preserve read/reconciliation access.

Database migration must be additive and rollback-compatible. Never run an older binary that cannot safely read/write the new evidence state without an explicit migration/rollback plan.

## Acceptance gates before release

1. Existing full Node suite on the exact source passes with zero skipped tests.
2. Focused challenge/held/review tests pass over actual SQLite + HTTP, including transaction rollback and process restart.
3. Existing hosted browser baseline remains green across Chromium/Firefox/WebKit.
4. Kiosk browser tests cover online challenge, offline queue, reconnect, held acknowledgement, IndexedDB persistence, refresh/restart and double-tap suppression.
5. Device revocation invalidates challenge issuance and sync immediately.
6. Tenant isolation is tested with separate authenticated accounts and separate kiosk devices.
7. Concurrent sync/retry tests show no duplicate personal event or duplicate resolution.
8. Payroll path proves held evidence is excluded until independently resolved and reviewed through existing time-review/payroll controls.
9. Accessibility: keyboard/touch target/status announcement tests; no colour-only status.
10. Physical iOS/iPadOS/Android tests remain open until run on real devices.

## Identity next slice (separate from time authority)

A registered shared tablet proves the **device**, not the **employee**. Do not call the kiosk buddy-punch resistant until worker identity is improved. Evaluate in this order:

1. authenticated employee-owned phone / PWA using passkey or device-bound credential as the strongest no-terminal mode;
2. shared tablet with a short-lived employee-present proof generated from the worker's authenticated phone (e.g. rotating QR/deep link), with the tablet only consuming a single-use server token;
3. badge/employee ID as a low-assurance fallback requiring stronger review/exception analytics;
4. Apple/Google Wallet barcode only as a convenience carrier for a rotating/single-use server token, not as identity by itself;
5. NFC Wallet tap only if the customer already has compatible readers; do not introduce reader hardware merely to satisfy a “no hardware” product goal.

Do not build a central facial-recognition or fingerprint database for this objective.
