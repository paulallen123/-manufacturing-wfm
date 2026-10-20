# Immutable absence-recovery advisory

State: **TESTED locally; independently source-reviewed**.

Requirement: existing PR #226 absence/qualified-labour-shortage shadow decisions
and #265 F4 decision-evidence consistency. A returned advisory must not change
its constraints or recommendation while retaining the same episode identity.

## Ownership and exact scope

Reservation:
https://github.com/paulallen123/-manufacturing-wfm/issues/265#issuecomment-6283358837

Base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.
Branch: `fix/vector-absence-shadow-immutable-20261020`.

Refreshed #265/#288, open PR searches for the exact module and absence recovery,
remote branches and current consumers before editing. Historical original
PR #226 remains open at `4cea4b0513df4aa8c25df9be5cb3705c77b3e852`; it is not
silently treated as ownerless. Its module and canonical module have identical
blob `0051f54d3ee78e306fbc8c4657983d7d416eeb9e`, carried into canonical by
`fd9a62e`. There is no outstanding delta in this file from that historical PR,
and no focused immutability reservation or current writer was found.
PR #341 concerns the separate scheduling engine. Current UI redesign,
payroll-money, PR497 and all existing release ownership are untouched.
External task visibility remains incomplete; this isolated reservation is not a
runtime lease. No AGENTS.md or .agents skill files exist in this checkout.

Changed files:

- `operations/runtime/absence-recovery-shadow.cjs`
- `operations/runtime/absence-recovery-shadow.test.cjs`
- this evidence record

## Product change

The former outer `Object.freeze` left required skills, affected lines and nested
episode recommendation, ranking, prediction and evidence arrays writable. The
wrapper now recursively freezes its normalized, owned return graph. The existing
Decision Episode constructor already clones its payload; normalized lists are
fresh arrays. Caller-owned input remains mutable and detached.

No shared Decision Episode implementation, service, UI, archive, Dockerfile,
workflow, freeze marker, authority or release gate changed. The existing service
serializes/persists the result without mutating it. The Dockerfile already copies
this module and explicitly runs its existing test file; that wiring was inspected,
not executed as image proof.

## Executed checks

Node **v22.23.2**:

```
node --test operations/runtime/absence-recovery-shadow.test.cjs
# tests 4
# pass 3
# fail 1
# skipped 0
```

This RED run was against unchanged production source plus the regression:
mutation did not throw because the returned nested array was mutable.

After the repair:

```
node --test operations/runtime/absence-recovery-shadow.test.cjs operations/runtime/decision-episode.test.cjs operations/runtime/demand-decision-service.test.cjs
# tests 12
# pass 12
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

The new tests attempt nine nested mutations, recursively inspect every returned
object for freezing, check unchanged identity/serialized bytes and verify that
caller input can still change independently. Existing service tests exercise
local synthetic SQLite persistence and role/tenant behavior.

An independent-from-the-assertion comparison loaded the base module via
`git show 48dce8f:operations/runtime/absence-recovery-shadow.cjs` and the repaired
module with the same Decision Episode dependency and synthetic fixture:

```
BASE_VS_FIXED_SERIALIZED_ADVICE=IDENTICAL
PAYLOAD_SHA256=c109c04632ebcfbe35d1782bfe3dfe0da5a32d58918ddcc680d59eb5116817fb
```

That comparison is author verification, not independent review.
Syntax and `git diff --check` passed.

## Boundaries and next action

Independent source review completed through the parent coordination channel on
exact head `cd0f5b5d447dfd4a8f05bef70f524ba9e15ba558`: **acceptable for the narrow
normalized-output immutability repair, no blocker**. The reviewer checked owned
result recursion, JSON-cloned episode data, normalized lists, consumer
compatibility, mutation/detachment tests and existing Docker wiring. They did
**not** rerun the 12 tests. No formal GitHub approval is implied.

The committed "does not alter serialized advice" test compares two repaired
calls: it proves determinism and caller detachment. The base-versus-fixed byte
comparison is the separate author-run check above, not that regression.
The known broken local review server was not retried. The sole integrator,
Continue customer proof (`01a12a1a-6c4a-7221-9862-ca8ddcd0f5a1`), retains adoption
and release ownership. Keep draft pending integration admission.

No canonical integration, Docker/image admission, deployment, hosted/customer
proof, provider calls, workforce/payroll mutation or measured benefit occurred.
This is normalized output immutability only: it does not repair arbitrary active
input/prototype behavior, authenticate source evidence, freeze JSON transmitted
to clients, or add missing constraint fields to the episode digest.

Next: independently rerun the Node22 command; then the
sole integrator reconciles this delta onto one candidate and runs the existing
combined/image/hosted gates before any operational or customer-proof claim.
