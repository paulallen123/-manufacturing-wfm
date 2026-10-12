# Complete requested-slot validation

This bounded follow-up to issue #202's WFM depth work and the existing #233
scheduling foundation strengthens the shared independent schedule validator.
It is stacked on maximum-shift-duration PR #353, source
`fe1cc82637fe875a60efc29289bcaffa67695c90`.

Previously `validateSchedule` returned `valid:true` for an empty/partial schedule
even with required slots, and skipped known-slot/time checks for shortfalls. An
invented shortfall could therefore be accepted as valid schedule evidence.

Every requested slot must now have exactly one assignment or explicit shortfall.
Missing entries produce `MISSING_SLOT_ASSIGNMENT` with the omitted slot ID.
Duplicate entries remain invalid. Shortfalls must identify a real requested slot
and match its start/end instants, just like filled assignments. A filled assignment
cannot simultaneously declare `shortfall:true`. Empty demand and empty assignments
remain valid; a complete schedule with genuine shortfalls remains structurally
valid, with coverage still reported separately by existing quality metrics.

This is validation of requested-slot completeness and temporal identity. Existing
worker eligibility, policy, maximum shift length and SHADOW authority checks remain
in force. It does not establish demand authenticity, production execution authority
or complete customer readiness.

The existing Docker source and composed-runtime suites already execute the changed
test file and package this engine into the scheduling service. No new workflow,
service or validator is introduced. Node 22.23.2 regressions reproduce the original
false acceptance and cover partial/empty schedules, unknown shortfalls, altered
times, contradictory fill/shortfall, multi-headcount slots, duplicates, valid
shortfalls, input ordering and frozen-input preservation.

Full exact-image and hosted admission remain canonical release gates. Other active
scheduling repairs, including PR #352's site binding, touch the same validator;
the sole canonical integration owner must retain both repairs when composing the
candidate. No hosted artifact, tenant, provider or release pointer is changed here.
