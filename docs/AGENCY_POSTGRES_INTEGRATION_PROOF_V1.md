# Agency PostgreSQL Integration Proof v1

## Purpose

Turn the Agency Labour Exchange PostgreSQL store contracts from mocked-query evidence into an executable, real-database shadow proof without touching Railway, customer databases, payroll, live schedules, invoices, or production supplier messaging.

This is evidence infrastructure for draft PR #82 only. It does not apply migrations to any live environment.

## Scope

The proof imports the same DDL and PostgreSQL store adapters used by the branch and starts an ephemeral PostgreSQL 16.10 container using a pinned image digest. It then exercises those adapters over separate real PostgreSQL connections so uniqueness, row locking, foreign keys, state transitions, and concurrency behavior are proven by PostgreSQL rather than by an in-memory test double.

The integration lane covers:

- portal-token one-time consumption;
- tenant/token composite-key isolation;
- supplier-delivery first-claim idempotency;
- provider-receipt event deduplication;
- monotonic positive receipt reconciliation;
- attempt-number protection against stale negative provider evidence;
- migration/index creation for all three Agency Labour Exchange store contracts.

## Concurrency evidence

The proof creates 32 concurrent PostgreSQL connections for the replay-sensitive paths.

Expected invariants are fail-closed:

- 32 same-token consumption attempts -> exactly 1 consumption and 31 `already_consumed` results;
- the same token ID can be consumed independently by two different tenants because tenant ID is part of the key;
- 32 same-delivery claims -> exactly 1 winning `dispatching` claim and 31 existing-state results;
- 32 copies of one authenticated provider event -> exactly 1 recorded event, 31 duplicates, one receipt row, and final delivery state `sent`;
- stale `definitively_not_sent` evidence for attempt 1 cannot make attempt 2 retryable; the current-attempt receipt is the only one allowed to transition the newer unknown attempt to `not_sent`.

These are database-level proofs only. They do not send a supplier message and do not authorise a live retry.

## Privacy and authority boundary

The test uses synthetic tenant/site/request/agency IDs, a `.example` destination, fingerprints, synthetic provider references, and a synthetic portal token. It does not use customer or worker personal data.

The proof has no authority to:

- write a live schedule;
- write payroll;
- approve or mutate an invoice;
- deploy a migration;
- call a live provider;
- alter eligibility/ranking rules.

Eligibility-before-ranking and supplier-eligibility-before-dispatch remain unchanged.

## CI behavior

The regular deterministic Agency Labour Exchange suites continue to run on the pinned Node 22.23.2 image. A second shadow step runs `test/frontier/agency-postgres-integration.test.mjs` with `AGENCY_POSTGRES_PROOF_REQUIRED=1` so Docker/PostgreSQL unavailability fails the hosted proof rather than silently skipping it.

Outside that explicit integration lane the file skips its database tests by default, preventing ordinary local/unit runs from accidentally starting infrastructure.

## Promotion boundary

This proof is necessary but not sufficient for promotion. The lane remains draft until hosted execution is available and passes. A successful ephemeral PostgreSQL proof must not be represented as Railway/customer-database proof.

After real PostgreSQL execution is green, the next high-value boundary is a real non-production provider adapter and sandbox/test callback proof, followed by browser/UI validation, authorised customer-data replay, production security review, and operational measurements.
