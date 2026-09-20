# Agency Labour Right to Work Evidence Lifecycle v1

Status: development/shadow only  
Policy snapshot: 18 September 2026

## Purpose

This bounded slice extends the existing Agency Labour Right to Work assurance with an evidence-lifecycle control. It does not rank workers, contact workers, perform a statutory Right to Work check, mutate schedules/payroll/invoices, or change supplier-selection authority.

The goal is to stop a time-limited permission or Employer Checking Service (ECS) result from becoming stale silently while keeping the agency experience low-friction: evidence that still covers the proposed assignment remains eligible, but a refresh action is surfaced before expiry; evidence that does not cover the assignment fails closed before ranking.

## Current UK basis

The Home Office draft employer guide updated on 11 September 2026 and due to take effect on 1 October 2026 states that follow-up checks are required for people with time-limited permission where employment is to continue beyond the current permission. The follow-up check must be completed on or before the permission ends.

The same guidance states that a Positive Verification Notice (PVN) obtained from the Employer Checking Service provides a time-limited statutory excuse for the period stated in the notice, commonly six months, and a further follow-up check is required before that excuse expires.

Official source: https://www.gov.uk/government/publications/right-to-work-checks-employers-guide/draft-employers-guide-to-right-to-work-checks-16-july-2026-accessible

The October 2026 anti-discrimination code says a person with time-limited permission must not be treated less favourably merely because their permission is time limited and that repeat checks should be carried out consistently. This lifecycle therefore produces no ranking penalty for a compliant time-limited worker.

Official source: https://www.gov.uk/government/publications/right-to-work-checks-code-of-practice-on-avoiding-discrimination/code-of-practice-for-employers-avoiding-unlawful-discrimination-while-preventing-illegal-working-in-force-from-6-april-2022-accessible-version

## Implemented lifecycle

- continuous/indefinite evidence records no scheduled follow-up;
- time-limited evidence must cover the proposed assignment end;
- an operational refresh window defaults to 14 days and is explicitly labelled as an operational workflow setting, not a statutory deadline;
- evidence inside that refresh window remains eligible for a covered assignment but surfaces a `request_updated_right_to_work_assurance_from_supplying_agency` action;
- the refresh action is evidence-only and has no authority to contact the worker, write a schedule, mutate payroll or approve invoices;
- ECS evidence requires an explicit Positive Verification Notice with issue time, expiry and auditable evidence reference;
- ECS coverage is determined from the PVN rather than trusting an older underlying permission-expiry field;
- negative, malformed, expired, future-dated or evidence-free PVNs fail closed;
- raw PVN references are fingerprinted and are not emitted in engine evidence;
- the existing role/site/assignment-window assurance remains mandatory after lifecycle validation.

## Conservative 28-day boundary

Home Office guidance describes a limited continuation of the statutory excuse for up to 28 calendar days in specific circumstances where the employer is reasonably satisfied that an in-time application/appeal exists and must obtain prescribed fresh verification during that period.

This first lifecycle slice deliberately does **not** infer that continuation from boolean flags or an agency assertion. If the current evidence no longer covers the assignment and there is no fresh prescribed evidence, WFM fails closed. A future bounded change may model that path only with explicit evidence, dates, responsibility and audit semantics.

## Privacy and fairness

The lifecycle output does not need or expose a share code, date of birth, passport/document number, raw immigration record or raw PVN reference. The output contains only minimum evidence metadata and a short fingerprint.

A worker is not ranked lower because their permission is time limited or because an ECS check was used. The lifecycle is binary eligibility plus an operational refresh warning; commercial performance and price can never override expired or incomplete evidence.

## Proof

Local deterministic proof on Node 22.16.0 passed 21/21 tests across the lifecycle and existing Right to Work assurance suites.

The lifecycle suite includes a 10,000-evaluation stress test proving that evidence expiring before the assignment end is never treated as eligible, while valid evidence inside the operational refresh window remains eligible and generates only a refresh warning/action.

The Agency Labour integration suite also contains a regression where a cheaper, perfect-performance worker with an ECS PVN that expires before the shift end must be rejected with `score: null` before ranking, leaving the compliant worker selectable.

Hosted CI and real PostgreSQL proof remain separate promotion gates; this document does not claim those gates have passed until GitHub executes them successfully.
