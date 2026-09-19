# Agency Identity Observation Ingress v1

## Purpose

Provide a bounded authenticated ingestion boundary for shift/start identity-continuity observations before they enter the existing Agency Labour evidence ledger. This slice proves provenance, replay resistance, exact assignment/Right-to-Work binding and privacy minimisation. It does not rank workers or suppliers and it has no authority to mutate schedules, payroll, invoices, clocking or worker master data.

## Boundary

The route supplies only server-controlled tenant, site, request and configured source-system scope. A source-specific adapter authenticates the original raw request bytes before JSON parsing. The included HMAC reference adapter is for sources that support an equivalent signed-webhook scheme; other access-control, attendance or identity providers should supply an adapter using their documented authentication mechanism rather than reusing HMAC where it does not apply.

After authentication, a trusted binding resolver converts the transient source subject reference into the exact agency worker, assignment fingerprint, authoritative Right-to-Work assurance version and pseudonymous subject fingerprint. The source payload cannot choose those values.

## Fail-closed controls

- original string/byte body required for signature verification;
- bounded signature timestamp tolerance and event-age/future-skew policy;
- source must exist in the server-side registry and the signal must be allowed for that source;
- binding must match the route tenant, site, request and source exactly;
- assignment, Right-to-Work assurance and pseudonymous subject fingerprints must be correctly formed;
- source event identity is server-derived from configured source + provider event ID;
- exact replays are idempotent while a changed payload reusing the same event identity is rejected;
- authenticated provenance is persisted before the observation, so a partial failure can leave only an inert audit receipt, never an evaluator-visible observation without earlier provenance;
- PostgreSQL conflict losers use a fresh statement read rather than trusting a same-statement conflict snapshot;
- ingress and provenance ledgers are append-only.

## Privacy and auditability

The durable observation contains only the existing privacy-minimised continuity fields. A separate append-only ingress receipt records event/authentication/binding fingerprints, ingress version and receipt time. Raw badge/card identifiers, source subject references, photographs, biometric payloads, webhook bodies, signatures and secrets are neither returned nor stored by this layer.

An authenticated rejected attempt may leave a provenance receipt but cannot create or alter a continuity observation. This preserves an audit trail without granting eligibility or scheduling authority.

## Evidence

Deterministic tests cover authentication/tamper detection, parsed-body substitution, stale signatures, unknown/spoofed sources, source-signal policy, cross-scope binding rejection, exact replay idempotency, changed replay rejection, event-time bounds, privacy minimisation and 5,000 forged attempts with zero additional durable identities.

The real PostgreSQL proof covers 32 concurrent authenticated replays converging to one observation, concurrent conflicting payloads converging to one durable observation while the loser fails closed, and append-only privacy-minimised provenance receipts.

## Promotion boundary

This is development/shadow evidence only. It does not deploy database DDL, call a real access-control/attendance/DVSP provider, modify Railway/customer environments or authorize a live workforce action. Provider-specific sandbox proof, production DB privileges and operational privacy review remain required before promotion.
