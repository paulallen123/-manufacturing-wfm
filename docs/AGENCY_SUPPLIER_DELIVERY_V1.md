# Agency Supplier Delivery v1

## Purpose

Provide a bounded outbound delivery and receipt-reconciliation boundary for Agency Labour Exchange requests without adding any production sender, Railway deployment, customer-data mutation or release-gate bypass.

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

The PostgreSQL delivery adapter contract uses a composite primary key of `(tenant_id, idempotency_key)`. The key is deterministic for tenant/site/request/agency/channel/delivery-revision so repeated processing of the same logical dispatch cannot create a second claim.

The state model is:
- `dispatching` — exactly one process has claimed the logical delivery;
- `sent` — provider explicitly confirmed send;
- `not_sent` — provider explicitly confirmed no send occurred, so a bounded retry can be claimed safely;
- `unknown` — the provider may have accepted the message or the sender failed ambiguously; automatic retry is blocked.

A timeout/exception after a send attempt is therefore treated as unknown rather than automatically retried. This favours duplicate prevention over pretending an uncertain provider result is safe to repeat.

If the durable store is unavailable, the sender is unavailable, the response deadline has passed, or audit persistence fails after a send attempt, the operation fails closed.

## Authenticated provider receipt reconciliation

`agency-supplier-delivery-receipt.mjs` adds a bounded reconciliation path for provider callbacks or lookups. It does not send messages itself and has no authority to modify schedules, payroll or invoices.

A receipt is accepted only after a verifier authenticates the raw provider payload. The core supports provider-specific verifier adapters and includes an HMAC-SHA256 raw-body verifier for integrations that genuinely use that signing scheme; it is not presented as a universal email/SMS-provider signature format.

After authentication, the normalized event is correlated against the existing delivery ledger using tenant + delivery ID, with channel and provider-message-reference checks. Events are also rejected if their timestamp predates the delivery beyond a small clock-skew allowance or is materially in the future.

The receipt ledger is independently idempotent on `(tenant_id, provider_key, provider_event_id)`. PostgreSQL reconciliation locks the target delivery row, records the provider event once and applies only conservative transitions:
- authenticated `confirmed_sent` can resolve `dispatching`, `unknown` or a prior `not_sent` to `sent`, preventing a later duplicate retry when stronger positive provider evidence arrives;
- authenticated `definitively_not_sent` can resolve only `unknown` to `not_sent`; it cannot make an actively `dispatching` send retryable while that original sender call may still complete;
- a generic `delivery_failed` event is audit evidence but does **not** become retry-safe automatically;
- negative evidence never downgrades an already `sent` delivery to a retryable state.

The raw webhook is never persisted by this boundary. Audit output stores a short event fingerprint and a short provider-message-reference fingerprint, while site/request/agency identity comes back from the authoritative delivery ledger. Destination, secure portal URL and worker personal data are excluded.

## Current UK process context — 18 September 2026

Current Fair Work Agency / GOV.UK Conduct Regulations guidance (Regulation 21, updated 22 June 2026) lists the assignment information an employment business must provide to a worker when offering an assignment, including hirer identity and business, start/duration, position and duties, location, days/hours, health and safety risks and controls, required experience/training/qualifications/authorisations, rate where not already agreed, and expenses.

The existing validated request pack already carries the manufacturer-side facts needed to support that downstream process, while this outbound message intentionally stays minimal and links the supplier to the full scoped assignment view. This implementation does not claim that WFM itself discharges the employment business's legal duty to the worker.

A fresh official-source check on 18 September 2026 found a Fair Work Agency contact-page update dated 17 September 2026 about how sponsored-visa workers can report serious abuse. That is operational contact guidance rather than a material change to the agency-labour eligibility, licensing or delivery controls encoded here, so no compliance rule was changed in this slice.

## Development proof

The deterministic outbound-delivery suite remains **12/12 tests** from the preceding slice, including supplier eligibility before dispatch, request-policy binding, 1,000 duplicate-dispatch concurrency, ambiguous-send fail-closed behaviour and the PostgreSQL delivery-state contract.

The new deterministic receipt-reconciliation suite passes **13/13 tests** locally on Node 22.16.0 and proves:
- valid authenticated positive evidence resolves an `unknown` delivery without invoking a sender;
- raw-body tampering and malformed signatures fail before any receipt-store mutation;
- missing verifier, missing store and verifier exceptions fail closed;
- channel, provider-message-reference and event-time mismatches fail closed;
- only explicit `definitively_not_sent` can turn an already-`unknown` outcome into a retry-safe state;
- a negative receipt cannot make an actively `dispatching` send retryable;
- generic delivery failures cannot silently create retry authority;
- positive proof can supersede a prior `not_sent` state to prevent a later duplicate retry;
- negative evidence cannot downgrade an already-sent delivery;
- 1,000 concurrent copies of one authenticated provider event record one event and one state transition;
- raw webhook fields, routing address, portal URL and worker data do not enter receipt evidence;
- the PostgreSQL contract uses row locking, provider-event uniqueness and conservative state transitions;
- a separate 10,000-way replay stress run records exactly one provider event and one state transition, with 9,999 idempotent duplicates and zero rejected authenticated replays.

The committed source and test blobs were re-fetched from the branch and matched to the locally executed Git blob hashes before reporting this evidence.

The DDL remains a development contract only. It has not been applied to Railway or any customer environment, and no real email, SMS or API provider was invoked.

## Next promotion gap

The next highest-value gap is **real PostgreSQL integration proof** for the token, outbound-delivery and receipt-reconciliation stores, including concurrent claim/reconcile races against the intended migration/runtime path. After that, one real-but-non-production provider adapter should be proven using that provider's official signature scheme and sandbox/test callbacks. Browser/UI validation, authorised customer-data replay, production security review and live operational measurements also remain promotion gates.
