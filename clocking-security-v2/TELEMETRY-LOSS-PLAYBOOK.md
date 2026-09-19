# Telemetry-loss playbook

Status: defensive development control for the existing Manufacturing WFM security loop. This file does not authorise production mutation.

## Trigger

Treat telemetry as unavailable when a required stream heartbeat is missing/stale, a heartbeat sequence has a gap/rollback, or an emitted synthetic canary is not observed inside its allowed window.

Do not treat a quiet customer traffic period as proof that telemetry is working. A known synthetic canary or equivalent independently expected signal must be observed.

## Automatic response budget

Only these narrow, reversible actions are permitted automatically from this control:

1. block security-sensitive promotion/release decisions;
2. pause automated security mutations that depend on the missing telemetry;
3. preserve and label the last known-good evidence snapshot.

The control must not disable users, rotate production-wide credentials, shut down broad services, restore backups, delete resources, or change payroll/workforce data.

## Recovery

Recovery requires fresh continuity evidence, not a manual override alone: required stream heartbeat(s) must be current, no unresolved sequence gap may remain, and a newly emitted synthetic canary must be observed within the allowed window. Previously observed canaries cannot be replayed to clear the incident.

## Current evidence boundary — 19 September 2026

Railway reported the reviewed hosted services as successfully deployed, but the customer-proof deployment returned no HTTP or deploy log entries in the reviewed 01:09Z–02:09Z window. That absence does not prove compromise and may represent quiet traffic or logging unavailability. Until an independently expected canary is emitted and observed, request-level telemetry continuity remains unproven.
