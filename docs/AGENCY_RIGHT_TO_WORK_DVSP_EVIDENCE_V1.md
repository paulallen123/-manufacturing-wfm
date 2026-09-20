# Agency Right to Work DVS provider evidence v1

## Purpose

This bounded development slice makes the trust evidence behind a digital Right to Work check durable, versioned and auditable instead of relying only on mutable supplier policy configuration.

It does not deploy a database migration, call a live DVS, modify a worker record, schedule, payroll or invoice, or change worker/supplier ranking weights.

## Why this exists

For post-1 October 2026 agency-labour Right to Work assurance, a digital verification route needs evidence that the DVS used for the check was appropriately registered and certified for Right to Work at the relevant time. The public DVS register and supplementary-code lifecycle can change over time, so a later mutable configuration value is not enough to explain which provider evidence supported a historic worker check.

Current official sources used for this design:
- GOV.UK, Supplementary code for digital right to work checks (1.1), published 1 September 2026;
- GOV.UK, Supplementary codes for digital verification services, updated 1 September 2026;
- GOV.UK, Find registered digital verification services;
- OfDIA update of 3 September 2026 confirming version 1.1 came into force on 2 September 2026 and explaining the transition from earlier code versions.

The existing eligibility engine remains responsible for the substantive Right to Work rules. This slice supplies auditable provider evidence to that gate and adds no ranking benefit or penalty.

## Evidence ledger

`wfm_agency_rtw_dvsp_provider_evidence` is append-only by evidence version. Each record is scoped to:
- tenant;
- supplying agency;
- DVS provider;
- deterministic evidence version ID.

It records:
- register status;
- trust-framework certification state;
- Right to Work supplementary-code certification state and version;
- whether the provider is treated as exclusive to the agency's Right to Work route;
- evidence effective time and optional expiry;
- when the register/certificate evidence was verified;
- a short one-way fingerprint of the underlying register evidence;
- a bounded source descriptor and record time.

The raw register evidence reference is never persisted in this ledger.

## Check-time resolution

Provider evidence is resolved against the worker check timestamp, not merely against today's configuration. A candidate evidence version must:
- match tenant, agency and provider;
- already be effective at the worker check;
- have registry evidence observed no later than the worker check;
- not have expired at the worker check.

The resolver selects the most recent qualifying evidence. If two conflicting versions have the same effective and registry-verification time, resolution fails closed as ambiguous rather than selecting arbitrarily.

A strict evaluator wrapper refuses a DVSP worker check when durable provider evidence is unavailable, mismatched, ambiguous, not yet effective, expired, or only observed after the worker check. When evidence is resolved, the wrapper feeds only a derived fingerprint into the existing Right to Work evaluator and adds the exact provider-evidence version to the audit result.

## Privacy and authority boundary

The ledger stores provider/compliance metadata, not worker immigration documents. Raw register evidence, share codes, dates of birth, passport/document numbers and raw worker Right to Work evidence are outside this table and its audit result.

This boundary can establish or reject provider evidence for a Right to Work eligibility assessment only. It cannot:
- make an ineligible worker rankable;
- add ranking weight;
- write a schedule;
- alter payroll;
- approve or alter an invoice;
- send an agency request;
- deploy a migration.

## Proof

Deterministic tests cover version determinism, privacy, tenant/agency/provider scope, effective/expiry timing, append-only idempotency, ambiguity failure, durable-store failure, strict evaluator fail-closed behaviour and a 10,000-iteration privacy/determinism stress test.

A separate required PostgreSQL shadow proof applies the exact DDL to an ephemeral pinned PostgreSQL 16.10 container, attacks one evidence version with 32 concurrent append attempts, and verifies exact historical check-time resolution across changing provider status. This remains synthetic engineering evidence and is not customer or Railway database proof.
