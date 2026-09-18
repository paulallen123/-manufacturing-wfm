# Agency Labour Exchange v1

## Purpose

Turn an identified manufacturing labour shortage into a fast, auditable agency fulfilment workflow while reducing manager and agency administration.

This is a bounded development slice on the Manufacturing Event / Cost lane. It does **not** change the frozen customer-proof runtime and it does not deploy to Railway.

## Operational loop

1. A shortage is identified after internal staffing and approved overtime options.
2. WFM builds a structured agency request pack containing the assignment facts needed by the supplier.
3. Only approved suppliers enter the cascade.
4. Candidate eligibility is evaluated before any performance ranking.
5. Eligible candidates are ranked using job-relevant, explainable evidence.
6. Preferred workers are sent to agencies in configurable parallel cascade phases.
7. Agencies can confirm a preferred worker, propose an alternative, partially fill, or decline.
8. Alternatives are revalidated before acceptance.
9. Clocked hours can be reconciled against agency claims and invoice lines.
10. Supplier outcomes feed role/site-specific agency performance evidence for the next request.
11. Any mismatch is routed for manufacturer invoice review rather than affecting worker pay.

## Request pack

The request model includes:
- hirer and business nature;
- role, duties and location;
- shift start/end, expected duration, days/hours and worker count;
- required skills and qualifications;
- health and safety risks and control measures;
- expenses and pay/condition metadata;
- an explicit industrial-action replacement flag.

Requests with incomplete core evidence or an industrial-action replacement purpose fail closed.

## Eligibility before ranking

A worker cannot enter the ranking pool unless the available evidence confirms:
- approved/active supplying agency;
- worker consent to share the profile;
- availability covering the shift;
- site readiness and induction validity;
- suitability state;
- working-time/rest compliance state;
- right-to-work evidence covering the assignment;
- required skills;
- required qualifications valid through the assignment;
- AWR equal-treatment confirmation once the supplied evidence reports 12+ weeks in the same role;
- charge rate within an explicit cap when a cap exists;
- GLAA licence evidence when the request explicitly requires it.

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

## Supplier experience

The request cascade supports:
- parallel supplier requests;
- configurable response SLA;
- preferred-worker IDs;
- confirm preferred worker;
- propose alternative;
- partial fill;
- decline.

An alternative worker is never trusted solely because an agency proposed them; the candidate must pass the same eligibility checks.

High-risk work is routed through manager approval even when standard-role auto-dispatch is enabled.

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

This means the cascade can learn which supplier is actually strongest for a specific manufacturing role/site rather than relying on a static supplier order or cheapest-rate-first strategy.

## Cost and time evidence

The value model is deliberately scenario-based. It can model:
- manager minutes saved per labour request;
- invoice reconciliation minutes saved per agency worker;
- manager/admin cost saved from those hours;
- modelled avoided no-show cost.

It only reports value from customer-supplied assumptions and labels the output as modelled; it does not claim realised customer savings without measured evidence.

## Authority boundary

The engine produces planning and workflow hand-offs only. It forbids:
- direct schedule writes;
- direct payroll writes;
- direct invoice approval;
- bypassing candidate compliance checks.

Invoice reconciliation is for the manufacturer's agency invoice only. It must never be used to withhold or delay the worker's wages.

## Current proof

The deterministic test suite covers:
- compliant preferred-worker selection;
- hard eligibility gates;
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
- scenario-only cost/time value modelling.

This is engineering proof, not customer/pilot evidence. Real supplier integrations, real customer data replay, production security review, UI/browser validation and live operational measurements remain required before promotion.
