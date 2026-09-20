# Agency Labour Exchange v1

## Purpose

Turn an identified manufacturing labour shortage into a fast, auditable agency fulfilment workflow while reducing manager and agency administration.

This is a bounded development slice on the Manufacturing Event / Cost lane. It does **not** change the frozen customer-proof runtime and it does not deploy to Railway.

## Operational loop

1. A shortage is identified after internal staffing and approved overtime options.
2. WFM builds a structured agency request pack containing the assignment facts needed by the supplier.
3. Supplier eligibility is evaluated before supplier performance or worker performance can influence ranking.
4. Candidate eligibility is evaluated before any worker performance ranking.
5. Eligible candidates are ranked using job-relevant, explainable evidence.
6. Preferred workers are sent only to eligible suppliers in configurable parallel cascade phases.
7. An agency can respond through an account-free, scoped link or a future API adapter.
8. Agencies can confirm a preferred worker, propose an alternative, partially fill, or decline.
9. Alternatives are revalidated before acceptance, including supplier compliance where the assignment requires it.
10. Clocked hours can be reconciled against agency claims and invoice lines.
11. Supplier outcomes feed role/site-specific agency performance evidence for the next request.
12. Any mismatch is routed for manufacturer invoice review rather than affecting worker pay.

## Request pack

The request model includes:
- hirer and business nature;
- role, duties and location;
- shift start/end, expected duration, days/hours and worker count;
- required skills and qualifications;
- health and safety risks and control measures;
- expenses and pay/condition metadata;
- an explicit industrial-action replacement flag;
- an explicit Fair Work Agency gangmaster-licensing applicability flag where the customer/policy layer has determined that the assignment is in scope.

Requests with incomplete core evidence or an industrial-action replacement purpose fail closed.

The engine deliberately does not infer gangmaster-licensing scope from a generic industry label. Current FWA guidance says licensing is generally relevant to agriculture, horticulture, shellfish gathering, and food processing/packaging, but exemptions exist, including some food-packaging activities. The policy/onboarding layer must therefore resolve applicability from auditable customer facts before setting the flag.

## Supplier eligibility before ranking

An approved supplier is not automatically rankable. When the request is marked as requiring an FWA gangmaster licence, the supplier must have auditable evidence that:
- the supplier is approved and active;
- the FWA licence status is `licensed`;
- a dated evidence reference from the public register/Active Check process is retained;
- the licence check has been performed within the previous three calendar months;
- any supplied licence-expiry evidence covers the assignment end;
- every disclosed subcontractor in the labour chain passes the same licence-evidence gate;
- when the request is in supplier contract negotiation, the FWA Authorised Person/postholder check is confirmed.

A legacy `glaaLicenceValid: true` boolean can be recognised for migration but is not sufficient on its own because it cannot prove when or how the licence was checked. Missing current evidence fails closed.

Supplier eligibility evidence is attached to the cascade/audit result, and ineligible suppliers are removed before role/site supplier-performance scoring is calculated. This prevents a cheap or historically high-performing supplier from outranking a compliant supplier when the required licensing evidence is absent.

## Worker eligibility before ranking

A worker cannot enter the ranking pool unless the available evidence confirms:
- supplying agency eligibility;
- worker consent to share the profile;
- availability covering the shift;
- site readiness and induction validity;
- suitability state;
- working-time/rest compliance state;
- right-to-work evidence covering the assignment;
- required skills;
- required qualifications valid through the assignment;
- AWR equal-treatment confirmation once the supplied evidence reports 12+ weeks in the same role;
- charge rate within an explicit cap when a cap exists.

These are gates, not weighted preferences.

## Explainable worker ranking

After eligibility, the default worker score uses:
- attendance: 22%
- punctuality: 18%
- quality: 18%
- productivity: 16%
- site experience: 10%
- role experience: 10%
- supplier fill reliability: 4%
- cost: 2%

Small-sample performance is shrunk toward a neutral prior so a handful of shifts cannot create false certainty.

Sensitive/protected-like fields are explicitly excluded from ranking inputs. The engine reports when such fields were present and ignored.

## Zero-account supplier response

The supplier portal contract is designed so an agency does not need an account or technical implementation just to cover a shift.

A request link is:
- cryptographically signed;
- bound to tenant, site, request and agency;
- time limited;
- assigned a token ID so the host can enforce one-time use;
- verified before any response is accepted.

The response surface contains only the assignment information and actions needed to answer the request. It supports:
- confirm a preferred worker;
- propose an alternative;
- partial fill;
- decline.

Preferred-worker confirmation is restricted to workers WFM actually offered. Alternative workers are captured only as **pending revalidation** and must pass the same eligibility engine before acceptance.

Audit evidence stores a short token fingerprint rather than the raw response link or signing secret.

### Atomic one-time response capture

The portal now has a fail-closed atomic consumption boundary for otherwise valid responses:
- cryptographic token verification and tenant/site/request/agency scope checks run first;
- the supplier response is normalized and validated before token consumption, so an ordinary form error does not burn the agency's valid link;
- a valid response is accepted only if an injected durable token store confirms an atomic first consumption;
- a missing store, store error or ambiguous store result rejects the capture rather than falling back to an in-memory success path;
- the PostgreSQL adapter uses one `INSERT ... ON CONFLICT (tenant_id, token_id) DO NOTHING RETURNING ...` operation backed by a composite primary key, so concurrent application instances share one replay decision;
- the ledger stores scoped IDs, a short token fingerprint, action and timestamps, never the raw signed token or signing secret.

The branch includes the required table DDL as an explicit deployment contract, but this development slice does **not** apply the DDL to Railway or any customer database. Production promotion still requires a real PostgreSQL integration proof against the target migration/runtime path.

## Supplier learning

Supplier performance is measured from operational evidence and prefers site/role evidence when enough history exists, falling back to broader role or portfolio evidence when it does not.

The current supplier score uses:
- fill reliability: 28%
- preferred-worker fulfilment: 22%
- attendance/no-show reliability: 18%
- response speed: 14%
- replacement avoidance: 8%
- invoice accuracy: 6%
- cost efficiency: 4%

The same neutral-prior shrinkage principle is used here so one lucky request cannot make a new agency appear artificially superior. Evidence confidence is surfaced with the score.

Supplier compliance is a prerequisite, not a score component. Compliance cannot be offset by price, fill rate, or historical performance.

## Current UK regulatory snapshot — 18 September 2026

The Fair Work Agency has administered gangmaster licensing since 7 April 2026. Current GOV.UK guidance instructs labour users to retain date-stamped licence evidence, note Authorised Persons/postholders, check the register every three months, and check subcontractors where used. This bounded implementation encodes those evidence/freshness controls only when the assignment has already been determined to require a gangmaster licence.

HMRC's umbrella-company PAYE rules have applied to payments made on or after 6 April 2026. Where an umbrella company employs supplied workers, the relevant agency — or in specified cases the end client — now carries responsibility for ensuring PAYE is operated correctly and can face recovery of underpaid PAYE. This is a material adjacent workstream and is not falsely represented as covered by the gangmaster-licence gate.

The Employment Rights Act 2025 guaranteed-hours and reasonable-shift-notice measures include agency workers, but the government's June-August 2026 implementation consultation states that these measures have **not yet taken effect**. The current engine therefore does not falsely enforce an uncommenced notice/guaranteed-hours threshold; the architecture should retain readiness for the future secondary legislation.

Primary guidance used for this snapshot:
- https://www.gov.uk/government/publications/how-to-check-if-a-labour-provider-has-a-gangmasters-licence/how-to-check-if-a-labour-provider-has-a-gangmasters-licence
- https://www.gov.uk/guidance/paye-rules-for-labour-supply-chains-that-include-umbrella-companies-from-6-april-2026
- https://www.gov.uk/government/consultations/make-work-pay-ending-one-sided-flexibility-reforms-of-zero-hours-and-similar-contracts

## Cost and time evidence

The value model is deliberately scenario-based. It can model:
- manager minutes saved per labour request;
- invoice reconciliation minutes saved per agency worker;
- manager/admin cost saved from those hours;
- modelled avoided no-show cost.

It only reports value from customer-supplied assumptions and labels the output as modelled; it does not claim realised customer savings without measured evidence.

## Authority boundary

The engine and portal produce planning, response capture and workflow hand-offs only. They forbid:
- direct schedule writes;
- direct payroll writes;
- direct invoice approval;
- bypassing worker compliance checks;
- bypassing supplier compliance checks.

Invoice reconciliation is for the manufacturer's agency invoice only. It must never be used to withhold or delay the worker's wages.

## Current proof

The deterministic test suite covers:
- compliant preferred-worker selection;
- hard worker-eligibility gates;
- supplier-compliance gating before supplier and worker ranking;
- fresh FWA licence evidence acceptance;
- fail-closed rejection of legacy boolean-only licensing evidence where freshness/proof is absent;
- three-calendar-month licence-check freshness;
- subcontractor licensing evidence;
- Authorised Person confirmation for supplier contract-negotiation state;
- licence validity through assignment end when an expiry is supplied;
- proof that an unlicensed supplier with stronger worker metrics cannot enter ranking or dispatch;
- industrial-action request blocking;
- sensitive-field exclusion;
- ranking evidence quality;
- high-risk approval;
- agency confirmations and alternative-worker revalidation;
- hours/rate/expense invoice reconciliation;
- deterministic repeatability;
- 5,000 synthetic candidate evaluations with no ineligible worker selected;
- site/role supplier performance profiling;
- small-sample supplier-score shrinkage;
- reliable supplier selection over cheaper but materially weaker suppliers;
- exclusion of unapproved suppliers from ranking;
- scenario-only cost/time value modelling;
- signed portal token validation;
- wrong-scope and expired-token rejection;
- fail-closed missing/erroring token-store behavior;
- invalid supplier input not consuming the one-time token;
- 100 concurrent valid response attempts yielding one accepted capture and 99 replay rejections;
- PostgreSQL adapter contract using a composite unique key and one `ON CONFLICT DO NOTHING` insert;
- preferred-worker restriction and alternative-worker pending revalidation;
- audit receipt secret/raw-token exclusion;
- 1,000 mutated portal tokens with zero accepted.

The changed portal/store slice passes 11/11 deterministic tests locally on Node 22.16.0, plus a separate 10,000-way concurrency stress run produced exactly 1 accepted capture and 9,999 replay rejections. The other four suites are unchanged by this bounded change. Hosted Actions remains a promotion blocker if the runner fails before allocating any executable steps.

A real PostgreSQL migration/integration proof, real outbound supplier adapters, UI/browser validation, authorised customer-data replay, production security review and live operational measurements remain required before promotion. The next highest-value product gap is the real outbound supplier delivery/response adapter boundary, because the engine can now decide who may receive work and safely capture one response, but it still lacks end-to-end evidence that requests can be delivered, retried and correlated across email/SMS/API channels without duplicate dispatch or silent loss.
