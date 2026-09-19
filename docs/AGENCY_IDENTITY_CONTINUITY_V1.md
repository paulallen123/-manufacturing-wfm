# Agency Labour Identity Continuity v1

## Purpose

This is a bounded, shadow-only evidence layer for agency-worker identity continuity at the start of an assignment or shift. It answers one narrow question: **does fresh, trusted, assignment-specific evidence support that the worker presenting for work is the same pseudonymous subject bound to the authoritative Right to Work assurance already accepted for that assignment?**

It does not rank workers, grant schedule authority, clock a worker in, alter payroll, create an invoice, or update worker master data.

## UK policy context

The Home Office draft employer's guide published on 11 September 2026, due to take effect on 1 October 2026, says employers must be satisfied that the person whose Right to Work was checked is the person carrying out the work. It describes proportionate ongoing measures including workplace passes, attendance/biometric systems, checks at the start of a period or shift, and other equivalent controls. It recommends re-verification at least once in any 24-hour period or shift where proportionate to the operating model and substitution/impersonation risk.

The digital Right to Work supplementary code 1.1, published 1 September 2026 and in force from 2 September 2026, also supports holder services used to confirm that a person carrying out work or services is the worker whose Right to Work was checked.

This implementation deliberately does **not** convert those examples into a universal biometric requirement or worker-ranking signal. Site/role policy is explicit, versionable and supplied by the surrounding policy/onboarding layer. The implementation can use low-intrusion operational signals such as an existing access pass or attendance event. A direct-identity signal is required only when the explicit policy says so.

ICO worker-monitoring guidance remains relevant to any upstream adapter that processes biometric data. Biometric data used to uniquely identify a worker is special-category data; the ICO says organisations should assess necessity/proportionality, identify a lawful basis and special-category condition, complete a DPIA for biometric identification, and consider less intrusive alternatives. This WFM slice therefore stores and evaluates **fingerprinted adapter evidence only** and does not ingest or retain raw images, biometric templates, badge numbers or source payloads.

## Evidence contract

Every decision is bound to:

- tenant, site, request and supplying agency;
- worker ID and the exact authoritative `assuranceVersionId`;
- the role/location/start/end assignment fingerprint;
- an explicit site + role continuity policy;
- a bounded shift-start evidence window;
- trusted source-system IDs and allowed signal types;
- independent-source requirements;
- subject-fingerprint consistency across accepted observations.

Supported signal classes in v1 are:

- `access_pass` — operational credential evidence;
- `attendance_clock_in` — operational credential evidence;
- `supervised_identity_check` — direct identity evidence;
- `rtw_dvsp_holder_check` — direct identity evidence.

Operational credentials are **not** treated as direct proof of identity. A site/role policy can require two or more independent sources and can separately require a direct-identity observation.

## Fail-closed rules

The evaluator fails closed for invalid/missing policy, unavailable evidence storage, wrong tenant/site/request/agency/worker/assignment/assurance scope, untrusted source or signal, duplicate evidence, stale/future evidence, subject mismatch, insufficient independent sources, or a missing required direct-identity signal.

The PostgreSQL reader is exact-scope and `SELECT`-only. The deployment-contract ledger is append-only and deduplicates source events by `(tenant_id, source_system_id, source_event_fingerprint)`.

## Privacy and authority boundary

Decision output contains only source-system IDs, event fingerprints, signal class/type and timestamps. The internal pseudonymous subject fingerprint is used for consistency checking but is not emitted in the decision output.

The boundary explicitly excludes raw badge identifiers, photographs, biometric data/templates, date of birth, document numbers, share codes and raw provider payloads. The result always reports:

- `rankingImpact: 'none'`;
- `scheduleWriteAuthorized: false`;
- `payrollWriteAuthorized: false`;
- `clockingWriteAuthorized: false`.

A failed continuity check is an escalation/revalidation signal. It must not silently reduce a worker's ranking score, alter pay, or create a disciplinary outcome.

## Proof scope

Deterministic tests cover standard and elevated role/site policies, independent/direct evidence requirements, subject disagreement, untrusted/stale/future/duplicate evidence, exact assurance/assignment scoping, unavailable storage, read-only privacy-minimised SQL, deterministic evidence, and a 5,000-evaluation replay attack that cannot manufacture a second independent source.

Real PostgreSQL tests cover exact two-source evaluation, append-only evidence and 32-way duplicate-event convergence, plus cross-tenant isolation of direct-identity evidence.

The DDL is a development deployment contract only. It has not been applied to Railway or any customer database, and this slice performs no live schedule, payroll, invoice, clocking or worker-master mutation.
