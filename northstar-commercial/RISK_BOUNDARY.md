# Northstar risk boundary

Northstar is developed as a separate commercial product lane. It must not create a write path into VECTOR production, customer production, or real third-party systems during the simulation-first phase.

## Objective

Minimise founder, customer and platform risk by making the default product useful without requiring production credentials or real personal data.

## Technical ring-fence

- Synthetic data by default.
- Ephemeral tenant-scoped environments.
- Deny outbound network access unless explicitly allowlisted.
- No production credentials in development, test or demo environments.
- No destructive public MCP tools.
- Strict per-tenant authorization on every request.
- Cryptographic/immutable run receipts for proof.
- Automatic environment expiry and cleanup.
- Hard compute, storage and spend ceilings.
- Rate limiting, abuse detection and circuit breakers.
- Fail closed on auth, isolation, policy or uncertainty.
- Rollback before autonomous promotion.
- Security and regression suites are release gates, not advisory checks.

## Commercial ring-fence

Before taking paid customers or processing live customer data:
- Trade through an appropriate limited-liability entity rather than personally.
- Keep company finances, contracts, infrastructure and credentials separate from personal ones.
- Avoid personal guarantees where commercially possible.
- Use written customer terms, acceptable-use terms, privacy notice and a DPA when required.
- Contractually define supported use, customer responsibilities, liability allocation, exclusions and reasonable liability caps with qualified legal review.
- Maintain appropriate technology/cyber/professional-indemnity insurance.
- Verify rights to all provider names, logos, schemas, samples and other IP used in commercial materials.
- Do not imply vendor partnership, certification or endorsement unless it exists.

## Status language

Only use:
- PROVEN — repeatably working with evidence.
- BUILT — implemented, proof incomplete.
- DESIGNED — agreed design, incomplete implementation.
- RESEARCHED — evidence/research only.
- BLOCKED — no safe route currently exists; an alternate route is being explored.

A generated file, design, mock, or successful happy-path response is never enough to claim PROVEN.
