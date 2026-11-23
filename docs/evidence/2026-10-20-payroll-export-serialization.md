# Payroll export serialization regression

State: **TESTED locally; independently source-reviewed**. This is a test-only
integration-support package, not new product functionality or release authority.

## Requirement and ownership

Issue #265 Golden Journey requires a reconciled CSV release, audit and fresh
readback. This package adds missing focused coverage for exact quoted Unicode
serialization and zero batch/audit mutation when export serialization is refused.
It exercises the existing sealed payroll implementation with the existing
`patchPayrollMoneySources` transform. It does not replace the export engine or
the browser journey.

Ownership reservation:
https://github.com/paulallen123/-manufacturing-wfm/issues/265#issuecomment-6283272813

Checked current #265 body and all 573 comments (six REST pages), #288 body and
comments, open PR scopes (recent and pre-13-October searches), complete remote
branch names, and source tests. No focused serialization/failed-release atomicity
test owner was found. #378 owns role-denial runner/classifier changes, #396 owns
cross-tenant export probes, #220 owns broader API/SQLite journey support, #383
owns restart comparison, and #369 owns schedule reconciliation. Their files and
branches are untouched. Existing F0–F7, release-intake, held-defect and research
scope remains open; historical discussion records are not counted as features.

No AGENTS.md or .agents/skills existed in the selected checkout or its workspace
ancestor; remote AGENTS.md also returned 404. Current canonical was fetched and
rechecked as `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. Local starting main was
older and was not used. Off-platform chat/job/lease discovery was unavailable;
personal-context lookup returned unavailable. No runtime lease is inferred from
idle CI. Sole canonical integrator remains **Continue customer proof**,
thread `01a12a1a-6c4a-7221-9862-ca8ddcd0f5a1`.

## Exact scope

- Base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`
- Branch: `test/vector-bounded-20261020`
- Added: `tests/payroll-export-serialization.test.mjs`
- Added: this evidence record
- Sealed input archive SHA-256:
  `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`

The test verifies the archive hash before reading its four real domain modules.
It uses fresh VM contexts for CommonJS and browser-global loading, actual
category/employee acknowledgement and independent-manager sign-off, actual
release, batch readback and retry methods. Synthetic fixtures exist only in
memory. A test-only decoder independently checks 19-column width and five named values, quotes/commas,
Unicode, leading-zero payroll ID, exact minutes and decimal gross, source record,
CRLF, JSON serialization/readback and idempotent retry. This is not an HTTP
checksum assertion, browser execution, SQLite restart, or provider import.

Four top-level tests include 84 rejection cases:
14 unsafe strings × three fields (employee name, team name, batch ID) × two
module modes. Each must raise the specific serialization 409 and preserve the
entire signed state, including no batch and no release audit entry. The
multiline/control/formula rejection already exists; no runtime change was needed.

## Actual verification

Executor: Node **v22.23.2**, `/workspace/wfm-cloud/bin/node`.

```
node --test tests/payroll-export-serialization.test.mjs scripts/patch-payroll-money.test.mjs
1..20
# tests 20
# suites 0
# pass 20
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`node --check tests/payroll-export-serialization.test.mjs` and
`git diff --check`: passed.

Preserved development failures: first run 0/4 because the synthetic costing policy
omitted `warningPercent`; diagnostic repeat confirmed the same fixture error.
After adding the existing required policy field, 2/4 passed; the rejected-field
matrix incorrectly expected invalid payroll IDs to reach serialization even
though the earlier payroll-ID validator already refuses them. The matrix was
corrected to exercise team names. Final 20/20 includes the four new tests plus
16 existing money tests. These early failures are fixture development, not a
claim that product code failed and was repaired.

Test sensitivity was checked in temporary `/tmp` copies only:

- Disable embedded-quote escaping in the loaded module: 2/4 passed, **2/4 failed**
  in the exact-value tests, as expected.
- Inject an early batch write before CSV serialization: 2/4 passed, **2/4 failed**
  in the no-mutation tests, as expected.

Neither mutant is committed or applied to product/archive files.

## Review and release boundary

Independent review was attempted with `codex review --uncommitted`, but no review
executed: `failed to initialize in-process app-server client: Read-only file
system (os error 30)`. A bounded retry directing SQLite/log paths to writable
`/tmp` also failed before execution. This is an execution-environment failure,
not an approval denial or a reviewer acceptance. Author verification and mutation
checks must not be relabeled independent review.

Canonical integration, exact-image admission, deployment, hosted browser,
provider, customer proof and real payroll/personnel actions: **not run**.
No workflow, Dockerfile, archive, runtime, shared runner, freeze trigger, release
gate or security configuration changed. Deployment identifiers in older ledger
entries were not revalidated or used as authority by this package.

Independent source review subsequently completed on exact head
`943408ccb74b694c5460d64233db1fd28f27a592` through the parent coordination thread.
Verdict: **acceptable for the narrow test-only scope, no blocking defect**.
The reviewer checked the two-file scope, archive hash, real source methods,
specific serialization rejection, complete signed-state comparison and separate
module contexts. They did **not** run the tests or independently reproduce 20/20.
This evidence-only correction addresses their nonblocking wording finding:
the test checks 19-column width and five named values, not all 19 field values.
No formal GitHub approval is implied; the test source remains unchanged.

Next action: the sole canonical integrator adopts only this bounded
test/evidence package, reconciles it with the existing Golden Journey work and
runs the accepted exact-candidate gates, including an independent Node22 rerun.
Docker's explicit test list does not yet include this new file; adoption into that
shared gate is solely the integrator's work. Keep draft; no merge
or deployment is requested here. A green domain test does not establish safe
spreadsheet interpretation, authenticated HTTP behavior or customer readiness.
