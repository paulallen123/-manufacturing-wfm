# Finite labour-demand translation

This increment addresses the demand-driven staffing workstream in issue #202 and
the existing #233 scheduling foundation. It uses the current demand forecast,
labour translator and forecasting service endpoints; no second model or planner
is introduced. It is stacked on PR #356 at
`46724ce075af8c687b506bbf9f3cc307c9c2b12b`.

Two finite capacity inputs could previously overflow when multiplied, so positive
production demand became zero required workers. Product underflow or a very small
capacity could also produce infinite/unsafe headcounts. Both forecasting endpoints
additionally allowed `capacity.forecast` to substitute a caller-supplied forecast
for the forecast returned by the server.

`unitsPerLabourHour` and `shiftHours` now require finite positive primitive numbers.
Numeric strings, booleans and structured values are rejected. Omitted `shiftHours`
retains the existing eight-hour default. Their product must remain finite and
positive. Forecast P50/P90 quantities must be finite nonnegative numbers with
P90 >= P50. Each translated headcount must be a safe integer, and positive demand
may not underflow to zero workers. Invalid arithmetic fails explicitly rather than
emitting a staffing recommendation. Genuine zero demand and valid fractional
capacity remain supported.

`/api/operations/scheduling/forecast/shadow` and `/forecast/what-if` always translate
their own computed forecast, ignoring a substituted `capacity.forecast`. The
returned labour `forecastId` therefore remains tied to the returned forecast.
Existing authentication, tenant scope, non-persistence and `NO_EXECUTION` boundaries
remain in force. Invalid conversion returns HTTP 400 without partial forecast or
labour output.

The existing Docker source and composed-runtime suites already include both changed
test files and package the changed modules. Node 22.23.2 regression coverage includes
capacity overflow/underflow, malformed rate/duration, nonfinite and contradictory
demand, unsafe headcounts, positive-demand quotient underflow, valid fractional
capacity/zero demand, frozen input preservation, both endpoint failures and forecast
substitution denial.

This does not validate customer productivity rates or forecast accuracy, nor does
it redesign model fitting, source provenance or forecast evidence admission.
Canonical integration, full exact-image admission and hosted customer/recovery
proof remain release gates; no hosted/customer state or release pointer is changed.
