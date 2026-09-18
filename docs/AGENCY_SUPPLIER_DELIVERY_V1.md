# Agency Supplier Delivery v1

## Purpose

Provide a bounded outbound delivery boundary for Agency Labour Exchange requests without adding any production sender, Railway deployment, customer-data mutation or release-gate bypass.

The delivery boundary sits after supplier eligibility. It is deliberately not a ranking engine and cannot make an ineligible supplier dispatchable.

## Safety and eligibility boundary

A delivery can only be prepared when the supplied eligibility result:
- belongs to the same agency;
- is explicitly `eligible: true`;
- contains no supplier eligibility failures;
- identifies the supplier-compliance engine version and evidence used;
- was evaluated under the same Fair Work Agency gangmaster-licence applicability policy as the request being dispatched.

That final binding prevents an eligibility result produced for a request where licensing was marked not required from being reused to dispatch a request where licensing is required. A policy mismatch fails closed before any delivery state or sender call exists.

The audit record retains the supplier-compliance engine version and a short fingerprint of the eligibility evidence so the dispatch can be correlated back to the evidence that allowed it without copying the evidence or worker data into the delivery ledger.

## Low-friction agency experience

The email/SMS/API delivery payload is intentionally small: role, site/location, start time, requested headcount, response deadline and one secure response link. Full assignment data remains behind the scoped supplier portal rather than being spread across message logs.

No worker names or worker personal data are required in the outbound message. Preferred-worker decisions remain in the scoped portal and are subject to the existing eligibility/revalidation controls.

Raw destinations and raw portal URLs are transient sender inputs. Persistent delivery/audit records keep short fingerprints instead. Control characters are rejected from required routing fields and API destinations must use HTTPS.

## Idempotency and fail-closed delivery state

The PostgreSQL adapter contract uses a composite primary key of `(tenant_id, idempotency_key)`. The key is deterministic for tenant/site/request/agency/channel/delivery-revision so repeated processing of the same logical dispatch cannot create a second claim.

The state model is:
- `dispatching` — exactly one process has claimed the logical delivery;
- `sent` — provider explicitly confirmed send;
- `not_sent` — provider explicitly confirmed no send occurred, so a bounded retry can be claimed safely;
- `unknown` — the provider may have accepted the message or the sender failed ambiguously; automatic retry is blocked.

A timeout/exception after a send attempt is therefore treated as unknown rather than automatically retried. This favours duplicate prevention over pretending an uncertain provider result is safe to repeat. A future provider-reconciliation capability is required to resolve unknown outcomes automatically.

If the durable store is unavailable, the sender is unavailable, the response deadline has passed, or audit persistence fails after a send attempt, the operation fails closed.

## Current UK process context — 18 September 2026

Current Fair Work Agency / GOV.UK Conduct Regulations guidance (Regulation 21, updated 22 June 2026) lists the assignment information an employment business must provide to a worker when offering an assignment, including hirer identity and business, start/duration, position and duties, location, days/hours, health and safety risks and controls, required experience/training/qualifications/authorisations, rate where not already agreed, and expenses.

The existing validated request pack already carries the manufacturer-side facts needed to support that downstream process, while this outbound message intentionally stays minimal and links the supplier to the full scoped assignment view. This implementation does not claim that WFM itself discharges the employment business's legal duty to the worker.

## Development proof

The deterministic delivery suite passes **12/12 tests** and covers:
- supplier eligibility before dispatch;
- request-policy binding of supplier eligibility evidence, including gangmaster-licence applicability;
- deterministic idempotency keys;
- unsafe channel/link/input rejection;
- stale-deadline rejection before store or sender calls;
- missing store/sender fail-closed behaviour;
- 1,000 concurrent duplicate calls producing one sender call;
- ambiguous sender failure becoming `unknown` and not being blindly retried;
- explicit `not_sent` permitting a bounded safe retry;
- audit-write failure after a send attempt becoming unknown;
- PostgreSQL uniqueness and state-transition contracts;
- absence of raw destination/portal-link values from ledger inputs and audit receipts.

An additional local stress run of 10,000 simultaneous calls produced 1 sender call, 1 sent result, 9,999 duplicate/in-progress rejections and 0 other outcomes.

The DDL is a development contract only. It has not been applied to Railway or any customer environment, and no real email, SMS or API provider is invoked by this slice.

## Next promotion gap

The next highest-value gap is provider delivery reconciliation: real but non-production adapter proofs for email/SMS/API delivery receipts or webhooks, authenticated callback correlation, and deterministic resolution of `unknown` outcomes without duplicate supplier requests. Real PostgreSQL integration against the target migration/runtime path remains a separate promotion requirement.
