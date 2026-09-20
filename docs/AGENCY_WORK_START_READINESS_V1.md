# Agency Labour Work-Start Readiness v1

## Purpose

This is a bounded, shadow-only work-start decision layer for agency labour. It answers one narrow question at the start of an assignment or shift: **is the worker's accepted agency response still bound to the current authoritative Right to Work assurance, and has authenticated role/site-specific identity-continuity evidence passed for that same assurance and assignment?**

It does not rank workers, write a schedule, clock anyone in, alter payroll, create an invoice, or update worker master data.

## Why this is separate from advance scheduling

The existing schedule preflight / authority guard / transaction-scoped shadow permit can legitimately run before the shift. Identity-continuity evidence, by design, is collected only inside a bounded window around shift start. Requiring a continuity fingerprint when an advance schedule command is prepared would therefore reject otherwise valid assignments simply because the worker has not yet arrived.

This boundary keeps the agency experience low-friction: eligibility and accepted-worker evidence can support advance planning, while identity continuity is checked at the point it becomes available. A future real work-start or clocking-admission command must consume a separate work-start authority derived from this boundary; it must not reinterpret continuity as a ranking signal.

## Decision contract

A pass requires:

- exact tenant, site, request, supplying agency and worker scope;
- the current non-conflicted authoritative Right to Work assurance for that worker;
- exact assignment fingerprint and assurance coverage through the assignment;
- an already accepted preferred-worker or partial-fill agency response whose stored assurance binding matches the current assurance version;
- fresh authenticated identity-continuity evidence for that exact worker, assignment and assurance version;
- the continuity policy fingerprint and continuity evidence fingerprint;
- no ranking, schedule, payroll or clocking authority in the continuity result itself.

The current Right to Work / accepted-response authority is read **before and after** identity-continuity evaluation. The two privacy-minimised authority fingerprints must be identical. If authoritative assurance or accepted-response evidence changes while continuity is being evaluated, readiness fails closed rather than combining evidence from different states.

## PostgreSQL boundary

`createPostgresAgencyWorkStartAuthorityStore` is SELECT-only. It reads the current Right to Work assurance and the latest accepted matching preferred-worker/partial-fill response for the exact tenant/site/request/agency/worker and current assurance version. It does not update the assurance ledger, portal response, continuity ledger, schedule, clocking, payroll, invoice or worker record.

The output deliberately contains only fingerprints and scoped identifiers needed for auditability. It excludes raw access/badge data, source subject identifiers, signatures, photographs, biometric payloads/templates, date of birth, document numbers, share codes, portal tokens and raw Right to Work evidence.

## Fail-closed rules

Readiness fails closed for missing/unavailable authority storage, missing current assurance, conflicted assurance, wrong tenant/site/request/agency/worker/assignment, insufficient assurance coverage, no accepted response bound to the current assurance, invalid/failing continuity evidence, continuity scope/version mismatch, any unexpected authority in the continuity result, or any change to the authoritative state during continuity evaluation.

Every output retains `rankingImpact: 'none'` and explicitly reports `scheduleWriteAuthorized: false`, `payrollWriteAuthorized: false`, `clockingWriteAuthorized: false` and `workStartWriteAuthorized: false`.

## UK policy context

The Home Office draft employer Right to Work guide updated on 11 September 2026, due to take effect on 1 October 2026, continues to require prescribed checks before work and proportionate measures to be satisfied that the person checked is the person carrying out the work. The Digital Right to Work supplementary code 1.1, published 1 September 2026, supports holder services used to help confirm the person carrying out work or services is the worker whose Right to Work was checked.

This layer does not turn those controls into worker scoring and does not make biometrics mandatory. Site/role continuity policy remains explicit and can use less intrusive trusted operational evidence where appropriate.

## Proof scope

Deterministic proof covers valid exact authority + continuity composition, stale/conflicted/expired/unaccepted authority, continuity scope/version/authority tampering, dependency failure, a read-only privacy-minimised PostgreSQL contract, authoritative state changing during continuity evaluation, 5,000 forged/stale continuity decisions producing zero ready outcomes, and deterministic evidence.

Real PostgreSQL proof uses the existing branch DDLs together and proves an exact accepted/current assurance plus authenticated continuity evidence can produce a read-only readiness result; a newer authoritative assurance without a matching accepted response fails closed; and identity observations/provenance bound to an older assurance cannot satisfy readiness after authoritative state changes.

This remains development/shadow evidence only and has not been applied to Railway or any customer environment.
