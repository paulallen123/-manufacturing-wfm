# Northstar → VECTOR regression matrix

## Purpose

Northstar is now a permanent external test double for VECTOR.

Every major integration or attendance change should be tested in two layers:

1. **Northstar behavioural proof** — provider/device persona behaves deterministically.
2. **VECTOR round-trip proof** — the actual VECTOR runtime authenticates, ingests, reconciles and recovers correctly.

## Current proven baselines

| Test | Northstar | VECTOR target | Status | Claim boundary |
|---|---|---|---|---|
| Workday-shaped provider → people sync | Hosted provider emulator | Existing hosted integration-fabric proof runtime | PROVEN | Fictional tenant; not real Workday/customer; not latest FORGE |
| Wall terminal → IN/OUT/replay/gap/revoke | Hosted device emulator | Sealed 0.6.76 customer-proof runtime | PROVEN | Fictional device/tenant; not physical hardware/customer; not latest FORGE |

## Mandatory FORGE promotion reruns

When the current FORGE container is hostable, rerun:

### Integration
- authenticate fictional manager;
- discover Northstar provider persona;
- confirm source authority;
- create connection;
- attest managed auth reference;
- activate mapping;
- pull provider-shaped records from Northstar;
- reconcile zero loss/duplicates;
- inject schema drift;
- degrade safely;
- produce repair guidance;
- recover to ACTIVE.

### Attendance / clocking
- register fictional device;
- accept IN and OUT;
- prove exact replay idempotency;
- hold sequence gap;
- reject forged tenant selector;
- show last-seen without secret disclosure;
- keep time-review/correction surfaces healthy;
- revoke device;
- reject post-revocation clock.

### Device evidence safety
Also retain Northstar emulator-only regressions for:
- mobile offline replay;
- kiosk session bleed;
- duplicate terminal punch;
- access event direction/identity ambiguity;
- HMI logout not causing automatic OUT;
- Wi-Fi signal loss not causing automatic OUT;
- raw biometric template rejection.

## Promotion rule

A capability is **PROVEN for a release only when the exact hosted release being promoted passes the applicable Northstar round-trip suite**.

Older baseline proof is valuable regression evidence, but never automatically inherits to a newer release.
