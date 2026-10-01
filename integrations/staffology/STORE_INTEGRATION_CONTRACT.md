# Existing canonical store: required integration contract

This document describes required changes to the adapter's existing six-operation interface. It is not a production store implementation. Codex owns wiring to the existing outbound delivery, ownership/controller, approval and private-evidence boundaries. Never deploy `sqlite-store-fixture.cjs`.

## Trusted construction

Construct the coordinator only inside verified server code, with exact tenant/run/source/deployment/configuration/employer binding. The input cannot choose the trusted binding, store, provider client or authority callback. `authorizeWrite` is server-side preflight; a caller flag or model label cannot grant permission. Preflight does not replace the persistence-boundary authority check.

## `get(deliveryId)`

Return the exact persisted intent/digest/binding/status/receipt, plus:

- `baseline`: the original complete immutable baseline evidence containing `phase: baseline`, full run and entry snapshots with hashes and provenance. Do not substitute a newer observation during recovery.
- `dispatchAttempt`: null before the guarded effect, otherwise the exact object below. Retrieve it from the existing durable journal/evidence boundary; no new production database.

```js
{
  deliveryId, digest, bindingDigest,
  baselineSha256, baselineRunSha256,
  request: { method: 'POST', path, bodySha256 }
}
```

The adapter verifies these fields against the stored payload, current binding, original baseline and exact serialized import request before reconciliation. It refuses missing or different data. The marker records a reserved intent to dispatch, never proof of Staffology acceptance or execution.

## `begin(row)`

Retain the existing atomic business-operation claim, exclusive token and persisted exact intent. A losing claim must not submit. Existing uncertain or legacy rows must never become permission to resend.

## `assertOwned({deliveryId, token, digest, bindingDigest, permit?, request?, dispatch?})`

Ordinary calls continue to validate current identity/token/fence/lease/binding and return true only for the current owner.

Calls carrying `dispatch` are consequential operations, not read-only assertions:

1. Enter the existing persistence/effect guard, using the current verified worker identity, exact tenant/run/build/configuration scope and active lease/fence. Check current server-side payroll authority, effective dates, expiry/revocation and exact permission/request/baseline binding at that boundary.
2. Reject an already-reserved dispatch attempt. Persist the exact one-time marker above in the existing durable state/journal, bound to the original baseline and request.
3. Invoke `dispatch()` once, without an await/yield between final validation and invocation. Do not retain or enqueue the callback for later. The callback starts the injected transport; it returns no transport-result authority. Keep conflicting claim/authority changes excluded across this final validation/effect step.
4. Return true only for a permitted guarded attempt. An ordinary implementation returning true without invoking the callback causes refusal. A late or duplicate callback cannot send. Store/commit failure after transport invocation remains ambiguous and must not permit a retry.

This requires deliberate canonical integration. Merely adding `if (dispatch) dispatch()` to an existing asynchronous ownership check is insufficient. The canonical owner's actual store tests must cover competing workers/processes, lease expiry, fence changes, current permission revocation, exact scope, transaction failure and crash windows. The fixture only demonstrates the interface against disposable SQLite; it has no production identity, lease or permission system.

## `recordEvidence`, `acknowledge`, `markUncertain`

Enforce current owner/fence/lease and exact scope transactionally in every consequential operation. Evidence is append-only, private, immutable and linked to the persisted business intent. Retain complete baseline, readback and comparison values, including rejected results. `recordEvidence` must confirm durable persistence; `get` must return the original baseline. Preserve comparison results even when basic pay is wrong. No employee or financial payload belongs in public issue comments or application logs.

Acknowledgement must persist the exact narrow receipt and be independently read back from the canonical store. This local readback is not independent provider verification. State that survives only in an author-created receipt cannot admit hosted proof.

## Conservative reconciliation

Readback must first satisfy the independently approved basic input. Only changes to the validated basic rate, multiplier, regular-line rate/multiplier/value and calculated basicPay can be classified as approved input changes. Type/presence changes, other entry fields, unknown fields, tax, NI, pension, retained payOptions.basicPay and any run-level changes remain held. This deliberately does not infer tax consequences or customer payroll rules.

The baseline must contain exactly one complete, consistent mapped hourly basic line and no additional replacement lines. Empty/missing/malformed/ambiguous baselines are outside this narrow scope. These holds may block otherwise legitimate provider recalculations; explicit authoritative expectations and an appropriately scoped review are required, not weakened assertions.

Before any future live request, verify a safe exclusive provider draft window and fresh exact run coordinates. Local ownership does not lock external Staffology users. The current-open import route offers no demonstrated provider CAS or idempotency guarantee. Preserve original baselines and approved cleanup scope; a deleted draft does not erase all provider effects.

## Owner integration gate

Wire actual persisted employee import and mapping, approved VECTOR payroll output, the existing store and server authority, independent readback/evidence admission and receipt/status/UI flow. Run the canonical build and affected recovery/integration suites on the reconciled source. Establish running-process credential/configuration binding without revealing secrets. Only then prepare the separate, exact deployment-and-provider-test approval. No activation is authorised by this package.
