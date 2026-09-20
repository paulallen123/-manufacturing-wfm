# Agency Identity Observation Ingress v1

## Purpose

Provide a bounded authenticated ingestion boundary for shift/start identity-continuity observations before they enter the existing Agency Labour evidence ledger. This slice proves provenance, replay resistance, exact assignment/Right-to-Work binding and privacy minimisation. It does not rank workers or suppliers and it has no authority to mutate schedules, payroll, invoices, clocking or worker master data.

## Boundary

The route supplies only server-controlled tenant, site, request and configured source-system scope. A source-specific adapter authenticates the original raw request bytes before JSON parsing. The included HMAC reference adapter is for sources that support an equivalent signed-webhook scheme; other access-control, attendance or identity providers should supply an adapter using their documented authentication mechanism rather than reusing HMAC where it does not apply.

After authentication, a trusted binding resolver converts the transient source subject reference into the exact agency worker, assignment fingerprint, authoritative Right-to-Work assurance version and pseudonymous subject fingerprint. The source payload cannot choose those values.

The authoritative PostgreSQL resolver now makes that trust boundary concrete. It HMAC-fingerprints the provider subject before database lookup, requires exactly one active append-only source-subject mapping, joins that mapping to the same current non-conflicted Right-to-Work assurance, and requires an already accepted preferred-worker agency response whose stored assurance binding matches that current version. The lookup is read-only and fails closed on missing, ambiguous, stale, future-dated, conflicted or expired evidence.

## Fail-closed controls

- original string/byte body required for signature verification;
- bounded signature timestamp tolerance and event-age/future-skew policy;
- source must exist in the server-side registry and the signal must be allowed for that source;
- binding must match the route tenant, site, request and source exactly;
- assignment, Right-to-Work assurance and pseudonymous subject fingerprints must be correctly formed;
- authoritative binding requires one active pseudonymous provider-subject mapping, one matching current non-conflicted Right-to-Work assurance and a matching accepted preferred-worker response before the observation time;
- source event identity is server-derived from configured source + provider event ID;
- exact replays are idempotent while a changed payload reusing the same event identity is rejected;
- authenticated provenance is persisted before the observation, so a partial failure can leave only an inert audit receipt, never an evaluator-visible observation without earlier provenance;
- PostgreSQL conflict losers use a fresh statement read rather than trusting a same-statement conflict snapshot;
- ingress, provenance and provider-subject mapping ledgers are append-only.

## Privacy and auditability

The durable observation contains only the existing privacy-minimised continuity fields. A separate append-only ingress receipt records event/authentication/binding fingerprints, ingress version and receipt time. Raw badge/card identifiers, source subject references, photographs, biometric payloads, webhook bodies, signatures and secrets are neither returned nor stored by this layer.

The authoritative resolver receives the transient provider subject reference only long enough to compute a keyed tenant/source-scoped fingerprint. PostgreSQL therefore receives only that fingerprint, not the raw provider identifier. The continuity subject fingerprint is independently keyed to tenant + agency + worker so two trusted systems can support the same worker continuity decision without exposing their provider-specific identifiers.

An authenticated rejected attempt may leave a provenance receipt but cannot create or alter a continuity observation. This preserves an audit trail without granting eligibility or scheduling authority.

## Evidence

Deterministic tests cover authentication/tamper detection, parsed-body substitution, stale signatures, unknown/spoofed sources, source-signal policy, cross-scope binding rejection, exact replay idempotency, changed replay rejection, event-time bounds, privacy minimisation and 5,000 forged attempts with zero additional durable identities.

The authoritative-binding deterministic proof additionally covers read-only SQL, raw provider-subject exclusion from PostgreSQL parameters, exact current-assurance/accepted-response requirements, ambiguous/malformed/future/expired evidence rejection, cross-system pseudonym separation, end-to-end ingress integration and 5,000 unrecognised provider identities producing zero authoritative bindings.

The real PostgreSQL proof covers 32 concurrent authenticated replays converging to one observation, concurrent conflicting payloads converging to one durable observation while the loser fails closed, append-only privacy-minimised provenance receipts, authoritative provider-subject resolution, invalidation when the current Right-to-Work assurance changes, fail-closed overlapping mappings and append-only provider-subject mappings.

## Promotion boundary

This is development/shadow evidence only. It does not deploy database DDL, call a real access-control/attendance/DVSP provider, modify Railway/customer environments or authorize a live workforce action. Provider-specific sandbox proof, production DB privileges and operational privacy review remain required before promotion.
