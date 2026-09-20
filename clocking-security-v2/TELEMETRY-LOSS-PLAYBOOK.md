# Telemetry-loss playbook

Status: defensive development control for the existing Manufacturing WFM attendance/security candidate. This file does not authorise production mutation.

## Trigger

Treat required hosted telemetry as unavailable when a required stream heartbeat is missing/stale, a heartbeat sequence has an unresolved gap/rollback, an expected canary is not observed inside its bounded lag window, or the latest successful canary is too old to prove current continuity.

Quiet traffic is never proof that telemetry is working. A known independently expected canary, or equivalent independently expected signal, must be observed.

Treat unsigned, invalidly signed, wrong-stream or wrong-trust-domain observation evidence as untrusted. A monitored workload must not be able to mark its own telemetry healthy. Release-grade heartbeat, backfill and canary observations therefore require an allow-listed independent observer signature bound to the exact customer/site trust domain and telemetry stream.

## Automatic response budget

Only these narrow, reversible actions are permitted automatically from this control:

1. block security-sensitive promotion/release decisions;
2. pause automated security mutations that depend on the missing telemetry;
3. preserve and label the last known-good evidence snapshot.

The control must not disable users, rotate production-wide credentials, shut down broad services, restore backups, delete resources, or change payroll/workforce data.

## Recovery

Recovery requires fresh continuity evidence rather than a manual override alone. Required stream heartbeat(s) must be current, every missing heartbeat sequence in an unresolved gap must be observed through the explicit backfill path, and a fresh canary must be observed within the configured lag and freshness limits. A replayed, late, previously consumed, unsigned, wrong-domain or wrong-stream canary cannot clear the incident.

## Evidence boundary — 19 September 2026

The earlier telemetry-security branch established that an empty log window cannot safely distinguish quiet traffic from telemetry loss. A later read-only outside-in health request was observed in Railway telemetry, proving continuity for that specific service/path/time only. It did not prove every telemetry stream, the attendance provider feeds, or end-to-end release readiness. Those remain separate evidence gates.

The next hardening step closes a separate poisoned-telemetry assumption: observation records are not trusted merely because the expected canary ID or sequence is present. They must carry independent signed provenance scoped to one trust domain and allowed stream. This prevents an application process or another customer/site cell from fabricating healthy continuity evidence.
