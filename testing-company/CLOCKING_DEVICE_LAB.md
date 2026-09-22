# Northstar Devices & Clocking Lab

Northstar's device lab is a separate synthetic test system for VECTOR attendance/clocking development.

## Device personas

### Personal mobile self-clocking
Models:
- signed-in employee session;
- CLOCK IN / OUT / breaks;
- offline queue and replay;
- rapid double tap;
- device/source clock skew;
- revoked session;
- stale app version.

Safety:
- replay keeps original event time separate from receipt time;
- device state never directly mutates payroll;
- raw continuous GPS is not required.

### Shared tablet / kiosk
Models:
- employee PIN / QR / badge identity;
- worker-to-worker session handoff;
- offline queue;
- kiosk reset;
- duplicate taps;
- wrong-worker binding.

Safety:
- shared device identity alone is never sufficient;
- previous worker sessions may not bleed into the next user's event.

### Wall clocking terminal
Models:
- badge / NFC / PIN;
- IN / OUT;
- sequence numbers;
- buffered offline replay;
- duplicate punch;
- clock skew;
- revoked credential.

Safety:
- direct T&A authority exists only when explicitly configured;
- sequence gaps require reconciliation before completeness certification.

### Access-control reader
Models:
- personal credential entry / exit;
- denied access;
- duplicate provider events;
- sequence gaps;
- unknown direction;
- shared credential;
- door-state-only activity.

Safety:
- door unlock/state is not proof of person passage;
- direction and personal identity are mandatory for automatic attendance evidence.

### Workstation / HMI
Models:
- enterprise LOGIN / LOGOUT.

Safety:
- logout alone is corroborating evidence and never an automatic payroll OUT by default.

### Enterprise Wi-Fi / RADIUS
Models:
- accounting start/stop;
- association/disassociation;
- roaming;
- stale stop;
- signal disappearance.

Safety:
- loss of Wi-Fi evidence alone never stops pay.

### Biometric terminal safety test
This persona exists to test the privacy boundary, not to make biometrics a product requirement.

Raw biometric templates/images are rejected from the default attendance-evidence path.

## Hosted callable device doubles

Hosted lab:
`https://vector-proof-plane-9bosun.v2.appdeploy.ai/`

Synthetic bearer token:
`northstar-device-test`

Routes:
- `POST /device/mobile/clock`
- `POST /device/kiosk/clock`
- `POST /device/terminal/punch`
- `POST /device/access/event`
- `POST /device/hmi/event`
- `POST /device/wifi/event`
- `POST /device/biometric/event`

Query parameters:
- `action=<supported-action>`
- `fault=<supported-fault>`

These are test doubles, not real hardware transports.

## Evidence progression

1. DEVICE_BEHAVIOUR_EMULATED
2. HOSTED_DEVICE_DOUBLE_PROVEN
3. VECTOR_TEST_TENANT_ATTENDANCE_ROUNDTRIP
4. REAL_HARDWARE_OR_PROVIDER_SANDBOX_PROVEN
5. CUSTOMER_SITE_PROVEN
6. PRODUCTION_CERTIFIED

No lower level may inherit a higher-level claim.

## VECTOR invariants Northstar tests

- tenant/site/employee boundaries fail closed;
- event IDs are idempotent;
- occurrence time and receipt time remain distinct;
- unsupported skew/staleness is held or rejected;
- ambiguity becomes review/evidence-only, not a guessed clock;
- negative-only presence evidence never becomes automatic OUT;
- access door state alone is not presence evidence;
- raw biometrics are not required/stored by default;
- device/evidence path cannot directly release payroll;
- sequence gaps and reconnect windows must reconcile before 100% completeness can be certified.
