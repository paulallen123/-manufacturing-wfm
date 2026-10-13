# Configured maximum shift hours

This increment implements the per-shift fatigue constraint within the WFM depth
workstream in issue #202. It extends the existing Manufacturing Scheduling Engine
and Scheduling Intelligence Service; it does not add another planner or executor.
Open-PR searches found no existing `maxShiftHours` implementation on 12 October
2026. Base source: `90ad90fcf60adaca9abacdd4ad14bf392f95e585`.

Supply an explicit policy value through the existing scenario or trusted shadow
plan input, for example:

```json
{"policy":{"maxShiftHours":12,"ruleVersion":"customer-approved-shift-policy-v4"}}
```

The value must be a finite positive primitive number. Fractional hours are allowed.
Null, zero, negative numbers, numeric strings, booleans and structured values are
rejected. Omitting the field preserves the existing behavior and plan identity;
this feature does not invent a jurisdictional legal limit. A supplied scenario
policy is advisory input, not evidence of customer policy approval or authority
to publish a schedule.

Duration is elapsed time between the requirement's absolute start and end instants,
including overnight and DST transitions. Exactly the configured limit is allowed;
any longer shift is ineligible with `MAX_SHIFT_HOURS_BREACH`. The existing exact and
greedy solvers, independent validation, open-shift evaluation, swap evaluation and
shadow repair share this check. Solvers retain an explicit unfilled slot and reason.
They do not split shifts or create work that was not requested.

The configured value is stored in `plan.policy`, included in the plan digest, and
inherited by repairs unless an explicit replacement policy is supplied through the
existing API contract. The authenticated `/api/operations/scheduling/capabilities`
response advertises `tableStakes.configuredMaximumShiftHours=true`.

## Verification and release

The existing engine and service test files are already executed by the Docker
source suite and composed-runtime proof; the engine is already copied into
`/app/operations-runtime`. No new runtime composition or proof lane is needed.

Regressions cover exact boundaries, overnight/DST elapsed time, malformed limits,
exact/greedy shortfalls, independent validation, swaps, repair inheritance, plan
identity, authenticated manager scenarios, SQLite service reopen/readback,
idempotent replay and tenant separation. Tests use synthetic data only.

Local source and composed HTTP verification use Node 22.23.2. Full exact-image
admission, hosted customer journey, restart/recovery and independent canonical
integration remain release gates. This development branch does not establish
production scheduling authority or a deployed customer outcome. The canonical
release owner must compose this increment with other scheduling repairs before
promotion; the frozen hosted artifact is not patched in place.
