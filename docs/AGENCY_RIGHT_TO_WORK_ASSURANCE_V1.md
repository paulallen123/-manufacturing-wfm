# Agency Labour Right to Work Assurance v1

Status: development/shadow only  
Policy snapshot: 18 September 2026  
Operational cutover: 1 October 2026, with worker-contract scope determined by the worker's employment commencement date rather than assignment date alone

## Purpose

This bounded control keeps Right to Work assurance inside the Agency Labour Exchange's existing **eligibility-before-ranking** architecture. It is not a worker-ranking signal and cannot be offset by cost, attendance, productivity, quality, supplier performance or other commercial evidence.

The WFM platform does not claim to perform the statutory Right to Work check itself. For the ordinary manufacturing agency-worker arrangement modelled here, it verifies that the supplying employment business has provided sufficient, assignment-specific assurance before the worker may enter ranking or dispatch consideration.

## Current UK basis

The Home Office's draft employer guide updated on 11 September 2026 states that its updated Right to Work Scheme guidance comes into force on 1 October 2026. It expands the Scheme beyond traditional contracts of employment to worker contracts, individual subcontractors and online matching services, with separate extended-liability rules for relevant contractual chains.

Critically, the guide says that for employment under a **worker's contract**, civil-penalty liability under the new scope applies where that employment commenced on or after 1 October 2026. The implementation therefore does not infer the new worker-contract scope merely because an assignment happens after 1 October: it requires the engagement type and employment commencement date.

The same guide contains a manufacturing-specific example: a manufacturer obtains temporary production workers from an employment business for use in its own factory operations. In that example the extended-liability provisions do not apply to the manufacturer or employment business merely because of that labour-supply arrangement; responsibility for preventing illegal working and civil-penalty liability remains with the employment business as employer of the workers on assignment.

Official source: https://www.gov.uk/government/publications/right-to-work-checks-employers-guide/draft-employers-guide-to-right-to-work-checks-16-july-2026-accessible

The Home Office's October 2026 anti-discrimination code says checks must be applied consistently, workers must not be screened on perceived nationality or other racial characteristics, and an applicant must not be treated less favourably because of the permissible check route they use. The supported assurance contract therefore accepts prescribed manual, Home Office online, RtW DVSP and applicable Employer Checking Service routes without ranking one method above another.

Official source: https://www.gov.uk/government/publications/right-to-work-checks-code-of-practice-on-avoiding-discrimination/code-of-practice-for-employers-avoiding-unlawful-discrimination-while-preventing-illegal-working-in-force-from-6-april-2022-accessible-version

## Effective-dated behavior

For assignments beginning before 1 October 2026, the existing branch behavior is preserved: the worker must have verified Right to Work evidence and any time-limited permission must cover the assignment end.

For assignments beginning on or after 1 October 2026, the engine first requires the agency assurance to classify the worker's engagement. It supports the ordinary agency-labour paths `contract_of_employment` and `workers_contract`; other engagement models fail closed for policy review rather than being guessed from a label.

For a `workers_contract` engagement, the new 2026 worker-contract scope is applied only where `employmentCommencedAt` is on or after 1 October 2026. If that worker-contract engagement began before the cutover, the existing verified-and-valid-through-assignment gate is retained and the engine records that the new scope was not inferred from the later assignment date.

Where the enhanced assurance path applies, the supported ordinary manufacturing agency-labour path additionally requires:

- an explicit contractual-arrangement classification;
- the supplying employment business to be recorded as the responsible Right to Work party for the supported manufacturing labour-supply arrangement;
- check provenance tied to that supplying agency;
- a recognised check method;
- a dated evidence reference;
- evidence obtained before assignment start and not future-dated;
- role, site/location and assignment-window scope sufficient for the proposed work; and
- affirmative confirmation that any work restrictions have been checked against the proposed assignment.

A conflicting, missing or non-standard arrangement fails closed for policy review. The engine deliberately does **not** infer legal responsibility for managed-service chains, substitution models, individual subcontractor arrangements, online matching services or other contractual structures from a generic label.

## Privacy boundary

The eligibility engine does not need to retain or expose a share code, date of birth, passport/document number, raw immigration document or raw Right to Work record. It emits a short evidence fingerprint plus minimum audit metadata. The supplying employment business remains responsible for retaining the statutory evidence required for the check it owns.

The output is designed to answer only the WFM assurance questions needed for an assignment: what type of engagement applies, when a worker-contract engagement commenced, who owned the check, which prescribed route was used, when it was checked, whether the assignment was within the authorised work scope and whether the evidence reference can be reconciled later.

## Fairness boundary

Right to Work remains a binary eligibility prerequisite, never a ranking advantage. The ranking engine does not receive nationality, immigration category, document type, share code, date of birth or other protected/sensitive-like attributes. A worker with time-limited permission is not penalised in ranking merely for having time-limited permission when the permission covers the assignment and required checks/restrictions are satisfied.

## Authority boundary

This control has no authority to:

- write or change a live schedule;
- add a worker to payroll;
- calculate or withhold wages;
- approve an agency invoice;
- send an agency request on its own;
- weaken supplier eligibility; or
- bypass manager approval where another gate requires it.

It only decides whether the Right to Work assurance evidence is sufficient for a worker to continue through Agency Labour eligibility.

## Deterministic proof

The new unit and integration suites cover:

- pre-1-October compatibility;
- preserved legacy failure names;
- worker-contract scope tied to employment commencement rather than assignment date alone;
- fail-closed missing/unsupported engagement classification;
- responsibility and arrangement classification;
- neutral acceptance of prescribed check routes;
- supplier/checker provenance;
- future-dated and post-start check rejection;
- mandatory auditable evidence reference without exposing the raw reference;
- role, location and assignment-window binding;
- work-restriction confirmation;
- refusal to shift the supported manufacturing arrangement's statutory check ownership to the hirer; and
- an adversarial eligibility-before-ranking scenario where a cheaper, perfect-performance worker with incomplete assurance is excluded before scoring while a compliant lower-scoring worker remains selectable.

A deterministic 5,000-candidate post-effective-date stress test further requires that no candidate with missing new assurance can be selected even when those candidates are deliberately given stronger performance and cheaper rates.

## Known boundary / next compliance gap

This v1 slice validates evidence presented for the assignment. It does not yet own an agency evidence-ingestion or renewal workflow for time-limited permissions, ECS Positive Verification Notice expiries, or repeat checks. Those should be added as a separate effective-dated evidence lifecycle with reminders/escalation and fail-closed refresh before future assignments, rather than widening this bounded eligibility change.
