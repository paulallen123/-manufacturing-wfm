# Static credential authority boundary

Long-lived API keys, Basic-auth credentials and similar static secrets are common in manufacturing software, especially reporting, plant-adjacent and legacy integrations. They must not be treated as safe merely because the requested operation is a read.

## Required runtime evidence

Before a static credential can advance beyond documentation/spec evidence, WFM must prove all of the following in an authorised environment:

- encrypted transport and an exact approved host;
- the effective runtime operations are read-only;
- the credential is bound to the intended company/tenant;
- the effective resource scope is known;
- company-wide/all-site/all-station scope is explicitly customer-approved when the provider cannot narrow it;
- rotation and revocation work operationally;
- age/rotation policy is enforceable where a customer policy supplies a maximum age;
- credential material never enters catalogue, evidence, diagnostics or ordinary logs.

Authentication failure is not a normal retry condition for static credentials. Repeated 401/403 responses stop automated authentication retries and enter credential diagnostics so a revoked or rotated key cannot create an infinite retry loop.

## Scope versus mutation trade-off

A narrower credential is not automatically safer. Some providers expose a read-only reporting key with broad resource visibility while a narrower user-scoped key inherits write or administrator operations. WFM must prefer bounded read authority over mutation-capable authority and may use the broad read key only after the customer explicitly approves the data scope. If neither route satisfies least privilege, use a customer-controlled read projection/export instead of weakening the runtime boundary.

Evocon is the first explicit provider example: its documented `Custom reports` key is read-only for the reporting namespace but covers all stations, while `User rights` can be narrower by station yet can inherit read-write operations and support production-order automation.

## Failure/recovery rules

The reusable `runtime/static-credential-authority.mjs` guard fails closed on:

- cleartext transport;
- missing host pinning;
- write/admin/control authority;
- unapproved all-resource scope;
- unproven company/tenant binding;
- unproven rotation or revocation;
- expired/stale credentials where a maximum age is configured;
- API keys, secrets, tokens or Authorization values leaking into evidence payloads.

Every reproduced provider-specific failure should become either a guard rule, adapter diagnostic or regression test rather than a one-off vendor workaround.
