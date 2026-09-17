# Security incident record — test-runner containment drift

Date: 2026-09-17
Environment: Railway `manufacturing-wfm-test` / service `wfm-test-runner`
Status: contained

## Detection

During the Last Line Defence review, the service expected to remain in a fail-closed security hold was found executing downloaded WFM source and targeted regression tests.

Evidence from deployment `0c702056-4f4f-4d5f-96bb-362f0c5517f4` included:

- `TARGETED_REGRESSION_BEGIN`
- source archive SHA verification before execution
- 29 tests, 26 passes and 3 failures
- `TARGETED_REGRESSION_EXIT=1`
- a failed access-control regression (`cost-restricted supervisor sees neither rates nor charges`) caused by `ERR_SQLITE_ERROR: database is locked`

No HTTP requests were recorded for the inspected deployment and the service had no Railway or custom public domain.

This is treated as containment/configuration drift, not evidence of an external attacker. The source of the configuration change was not attributable from the Railway evidence available to this review.

## Immediate containment

The runner start command was replaced with a dormant fail-closed hold:

`SECURITY_CONTAINMENT_ACTIVE reason=unexpected_regression_execution browser_execution=DISABLED source_execution=DISABLED`

A fresh configuration deployment, `2080a890-71b5-4985-b49a-ffad3dcd87f2`, was forced after a normal redeploy reused the previous snapshot and briefly re-ran the regression command. The fresh deployment succeeded and emitted the containment marker.

The service remains without public domains and IPv6 egress remains disabled.

## Independent containment lock

A second, independent deployment guard was added so changing the start command alone is insufficient to reactivate the runner:

- environment variable: `WFM_SECURITY_CONTAINMENT_LOCK=1`
- pre-deploy gate: exits with code 42 and `SECURITY_CONTAINMENT_LOCKED` whenever the lock is set
- restart policy: `NEVER`

A negative-control deployment (`27e6f55c-5696-4b2c-a62b-da7d75cb8ea8`) was deliberately triggered after the guard was installed. It failed before workload execution with `SECURITY_CONTAINMENT_LOCKED`, demonstrating fail-closed behaviour. The previously successful contained deployment remains the last runnable state.

## Release criteria

Do not clear `WFM_SECURITY_CONTAINMENT_LOCK` or restore an executable test command until all of the following are true:

1. browser/runtime security floor is independently verified;
2. intended source/bundle hashes are reviewed;
3. vulnerability scanning is proven to scan real targets;
4. recovery/audit restoration defect is addressed or explicitly risk-accepted;
5. the access-control regression suite passes deterministically without SQLite lock races;
6. the exact release action is bounded and reversible.

Containment release must be an explicit security transition, not an incidental deployment side effect.
