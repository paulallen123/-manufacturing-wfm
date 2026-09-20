# Agency Right to Work Refresh v1

## Purpose

Provide a low-friction, auditable way for a supplying employment business to submit refreshed Right to Work assurance for a specific worker and assignment without giving the agency broad WFM access and without allowing the refresh path to mutate schedules, payroll or invoices.

## Boundary

The refresh token is HMAC-signed, expiring and bound to tenant, site, request, agency, worker and a fingerprint of the authoritative assignment role/location/time window. A token becomes invalid if the assignment changes.

The agency submits only refresh evidence. WFM derives the checker agency and assignment scope from the signed token and authoritative request rather than trusting agency-supplied scope fields. The refreshed evidence must pass the existing `evaluateAgencyRightToWork` gate before it can be recorded.

Evidence older than or equal to the currently held assurance is rejected as stale. Invalid evidence does not consume the token, so an agency can correct an ordinary form error without requesting another link.

## Idempotency and audit

Accepted refreshes are recorded through a durable `recordOnce` contract. The PostgreSQL adapter uses `(tenant_id, token_id)` as the primary key and `INSERT ... ON CONFLICT DO NOTHING`, so application instances share one replay decision.

The ledger stores identifiers, assignment/token/evidence fingerprints, check method, check time, coverage time and receipt time. It deliberately does not store share codes, date of birth, document numbers, raw evidence references or Positive Verification Notice references.

## Right to Work policy relationship

This module does not create a new legal rule. It feeds refreshed evidence back through the existing effective-dated Right to Work assurance engine, preserving eligibility-before-ranking and method neutrality.

The Home Office draft employer guide updated 11 September 2026 comes into force on 1 October 2026. It requires prescribed checks and repeat checks for time-limited permission, and describes Employer Checking Service / Positive Verification Notice handling. The same guidance also describes a limited 28-calendar-day continuation in specified circumstances while fresh Home Office evidence is obtained. This refresh slice does not infer that exception from an agency assertion; it continues to require the existing assurance engine to accept the evidence.

## Authority and privacy

This path is evidence capture and revalidation only. It has no authority to write a worker master record, alter eligibility policy, rank workers, change a live schedule, create or alter payroll, or approve/change an invoice.

A future promotion/storage layer must preserve the same privacy boundary and must re-run eligibility before refreshed evidence can influence selection.
