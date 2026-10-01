# Independent retest 5925613376 — canonical offline resolution

## Replacement-owner succession and verified source state — 2026-10-01

Codex is the sole implementation and release owner succeeding the preserved,
stopped task `task_e_6abd8e51b4288327be80cf7f4e325d2e`. The user authorised this
one controlled replacement; the failed task was not run or retried, and no
further task, service, tenant, implementation run, product, database, worker, or
checklist was created. There is no unattended or running task: all work in this
succession is the foreground work in the existing
`paulallen123/-manufacturing-wfm` checkout and existing
`review/staffology-customer-proof-20261001` branch.

The checkout supplied native Git source, so transport objects were not imported.
Git independently resolves the starting head as
`35d8e4673f2cd8e205e92f9cb46187acb3277d79`, parent
`de32f6d663a530ddccffc6e8d1d0e641e68e039a`, and tree
`620f9fbf1ffa088a00fcc4e76bc8660400abb1c2`; the recorded base
`dedf7b307464c513f418bb7c95f37e53660b56a1` is an ancestor. Full native object
connectivity passed. Candidate `52a345be6a3ce857cbeabcfc3cb3bc8999bc120e`
is absent and is not represented as published or reviewed source. The supplied
chat attachment was not exposed as a filesystem byte stream in this execution
environment, so its stated 3,051,096-byte / SHA-256
`cf042bfc419a8779bc5361ac304d4db63194f3d7b49f1f14ed96ca55cd323a19`
receipt is retained as coordinator evidence, not falsely reported as a new local
decode. Native source verification made object import unnecessary.

PR 289 remains the sole recorded draft review. This checkout has no remote and
therefore performed no publication, PR creation, merge, release, deployment,
restart, provider request, credential/infrastructure mutation, or frozen-tenant
mutation. PR 290 and wrapper bytes were not used.

## Successor independent reds and bounded repairs

The successor first retained a failing TAP reproduction in
`evidence/succession-independent-red.tap`: an injected initial GET failure after
claim creation left `sending` with zero POSTs, and a mapped Former employee with
leave date entered a normal onboarding upsert. The repaired coordinator now
durably marks the zero-dispatch outcome `uncertain` with
`dispatchStarted:false`; it neither invents provider delivery nor resends. The
existing expired-uncertain recovery boundary can therefore fence a successor,
while reconciliation still refuses any row without the exact dispatch marker.

Permit validity and consumption now also require the issuing canonical approver
object to retain the same tenant and both `payroll.export` and
`company.configure` permissions. Removing current permissions makes `check`
false and consumption fails before the simulated dispatch callback. Existing
tenant-qualified revocation, exact permit binding, expiry, and one-shot
consumption remain intact.

Former employees and any employee carrying an effective end date are now held
with `STAFFOLOGY_EMPLOYEE_LIFECYCLE_REQUIRED` before the onboarding envelope is
created. This preserves the reviewed runtime rule that deletion/deactivation
must use the employee-change workflow and prevents normal onboarding from
reactivating a leaver. Current employees retain the exact cohort and start-date
mapping.

CircleCI's configuration-rejected red was reproduced from blob `33701f3`: the
single `printf` scalar was physically split across lines 109–110. The YAML is
repaired without weakening `require_frozen_candidate`, branch filters, the
supported Ubuntu 24.04 machine, Node 22.23.2 assertion, source-SHA build arg, or
`--pull=false`. The protected trigger records this exact repaired descendant so
an unchanged retrigger is unnecessary; a coordinator must still arrange
admission of the new exact commit to the existing CircleCI project. No pipeline
was invoked here.

The successor independent suite is 3 pass / 0 fail / 0 skip on locally available
Node 22.22.2. The current Staffology glob is 104 pass / 1 fail: its only failure
is the full employee persistence test when run directly without an assembled
runtime (`lib/integration-gateway.cjs` is deliberately absent from the checkout
root). The pre-extracted-directory composer caller and exact source/assembly
hashing pass. The canonical archive-extraction caller remains unpassed because
the existing supported `@simplewebauthn/server` dependency closure is absent;
no registry retry or substitute dependency was attempted. Node 22.23.2,
supported-container build, full HTTP persistence/stop/reopen readback, image
digest, and hosted gates remain unpassed and cannot be promoted to customer
proof.

## Replacement-owner follow-up — held-out current authority and recovery

Independent review matched all ten blobs in the preceding native delta and then
supplied two calibrated held-out failures. Their unmodified failing observations
are retained in `evidence/succession-held-out-red.tap`. The first proved that an
issued request actor retained in `liveApprovers` was stale after the canonical
principal was replaced. The second used the real SQLite store and proved that a
fenced successor could acquire an expired zero-dispatch intent but could not
progress because reconciliation demanded a nonexistent baseline and dispatch
marker.

`liveApprovers` has been removed. An approval now persists the stable canonical
`personId`, and every check and consumption resolves that identity through the
existing canonical `users` authority. The composed server wires a scoped lookup
of the existing `users` row and parses its current permissions; there is no new
directory, permission table, or policy. Missing principals, tenant changes, and
removed `payroll.export` or `company.configure` permissions deny authority.
Recreating the authority object still resolves the current principal, while an
unchanged authorised principal remains a positive control.

The adapter now treats pre-dispatch recovery and post-dispatch reconciliation as
separate states. Every failure after `begin` but before the atomic dispatch
callback is marked as provably zero-dispatch when the worker still owns the
lease. The real store can fence an expired `uncertain` row or an expired
`sending` row only when `dispatch_json IS NULL`, covering a process crash before
the catch handler. A fenced successor reloads the durable original payload,
obtains a fresh baseline and current authority, and reserves at most one
dispatch. Transport failure before reservation returns a retryable
zero-dispatch result; current-authority denial remains unresolved. Actual
dispatch attempts continue through the older uncertain-delivery reconciliation
path and are never resent.

The repaired held-out suite passes 3/3 on the locally available Node 22.22.2 and
includes replacement-snapshot/permission removal, authority recreation,
tenant-change denial, a real SQLite successor, old-worker fencing, a successful
fresh resume, and a one-POST total. With a pre-extracted sealed runtime explicitly
bound through `WFM_RUNTIME`, the Staffology set passes 111/111 and the existing
employee integration persistence test performs close/reopen readback. The FORGE
core suite passes 45/45. The full HTTP employee journey source now fails closed
unless both `CANONICAL_SOURCE_DIR` and `WFM_RUNTIME` identify a runtime containing
`local-paths.cjs`, `security-runtime/bootstrap.cjs`,
`LOCAL_PROOF_PROVENANCE.json`, and `STAFFOLOGY_ASSEMBLY.json`; its exact synthetic
cohort is employee-001/PAY901 and employee-002/PAY902 with GBP 10 effective
2026-09-01 and full-time 40-hour contracts plus application and append-only audit
readback after restart.

The available pre-extracted runtime does not contain `local-paths.cjs`, and the
supported `@simplewebauthn/server` lockfile closure is neither installed nor in
the local npm cache. Therefore the absent-directory full composition, the strict
full HTTP run, required Node 22.23.2, and supported Docker image remain UNPASSED.
No package-registry loop, substitute passkey implementation, CircleCI run,
provider request, deployment, release, merge, credential change, or frozen
tenant/run mutation occurred. The smallest intervention remains admission of the
new exact review commit to the existing non-deploy CircleCI project after
independent patch and hook review.

## Supported Docker admission follow-up

Coordinator review established that the supported Dockerfile still ran
`node --test integrations/staffology/*.test.cjs` directly from `/proof`. The
exact invocation was reproduced before repair and is retained in
`evidence/docker-admission-direct-checkout-red.tap`: 104 tests passed and the
employee persistence suite failed because `/proof/lib/integration-gateway.cjs`
does not exist. The glob also excluded every nested `independent/*.test.cjs`
suite, including the two calibrated successor regressions and strict full HTTP
journey. The structural failing reproduction is retained in
`evidence/docker-admission-contract-red.tap`.

The existing `autonomy-proof` stage now composes
`/proof/staffology-full-runtime` only after the existing locked
`security/runtime` dependency installation. Its Staffology admission binds
`CANONICAL_SOURCE_DIR=/proof`, `WFM_RUNTIME=/proof/staffology-full-runtime`, and
`STAFFOLOGY_RUNTIME_MODE=full`, then explicitly runs every root Staffology suite,
both successor regression suites, the Docker admission contract, and the strict
full HTTP employee journey before the existing composer contract tests. The
remaining FORGE, payroll, tenant, recovery, security, Autopilot, containment,
portable-autonomy, source-SHA, and final-runtime steps are unchanged.

The source-level Docker admission contract passes on available Node 22.22.2 and
proves composition occurs after the locked dependency install, all three full
runtime bindings are present, and no nested required suite is omitted. A local
supported image build remains UNPASSED because Docker, Podman, and Buildah are
absent and the exact lockfile packages are neither installed nor present in the
empty npm cache. No registry retry was attempted. The concrete handoff is a
fresh exact-source, `--pull=false`, `RAILWAY_GIT_COMMIT_SHA=$CIRCLE_SHA1` build
in the existing CircleCI project after coordinator patch and hook review; a
halted, skipped, dependency-unavailable, or unrun job is not a pass.

## Exact approving-account follow-up

Independent review found that canonical `users` is keyed by `email`, while
multiple accounts may legitimately share one tenant/person pair. The retained
red in `evidence/shared-person-authority-red.tap` creates two privileged accounts
for the same person, removes permissions only from the approving account, and
demonstrates the former person-only resolver selecting the other privileged row:
`check` stayed true and consumption succeeded without a provider request.

Approvals now persist the exact authenticated account email in the existing
`approved_by` field while still requiring a valid person linkage at issuance.
Every check and consumption resolves that email together with the bound tenant,
then verifies the returned email, tenant, person linkage, and both current
permissions. The composed canonical resolver queries the existing email primary
key plus tenant; it adds no directory, permission table, or fallback. Existing
person-only approval rows fail closed after this source change.

The repaired held-out suite covers two same-person accounts, revocation of only
the actual approver, positive current-account authority, tenant change, authority
recreation, and one-shot consumption. Its four assertions pass on available
Node 22.22.2. Canonical assembly validation additionally inspects the composed
server for the email-and-tenant resolver. The strict full HTTP source now asserts
the exact two staff rows—including IDs, source IDs, payroll IDs, names, and ready
state—and an explicit count of two, rather than relying on a vacuously true
`every()` result. Full supported-container execution remains approval-bound and
UNPASSED for the previously recorded local dependency/tooling limitations.

## Exact-account descendant admission preparation

The coordinator independently recovered all 24 changed files for commit
`8962f72b8ead8c93a5df0ec995bb6e6d57ce9739` and reconstructed tree
`a6850f3b6613f9643cbdf318d817ff9398a6ef3e` exactly, without relying on the stale
ten-file Copy Patch export. Supplemental Node 24.21.0 execution covered all root
Staffology suites, successor suites, the Docker admission contract, unchanged
original-eight assertions plus positive control, three held-out probes, and the
sealed persistence kernel: 125 passed, 0 failed, 0 skipped. These are source and
sealed-kernel results only; they do not establish strict full HTTP, the prescribed
Node 22.23.2 image, or hosted proof.

The reviewed source tree still carried trigger blob
`15de80c6f621504b73e08a6877b0442da284ba64`, unchanged from the earlier d64
source. In the reviewed descendant sequence, `require_frozen_candidate` would
therefore find no `HEAD^`→`HEAD` trigger change and halt both jobs. This checkout
materialises the independently reconstructed tree as a flattened native
checkpoint whose actual parent is `35d8e46`; that local parent comparison already
shows the older trigger delta and is not misrepresented as the reviewed
descendant ancestry. The identity comparison against blob `15de80c` is the
retained reproduction of the real descendant halt condition.

The trigger now explicitly requests a fresh exact-source, non-deploy admission
for tree `a6850f3b6613f9643cbdf318d817ff9398a6ef3e` through existing CircleCI project
`ab7bf08e-2426-4256-9381-ba3f59c6d6f9` and definition
`fe503fe6-0af9-5c00-aaf9-9b73d7ce0971`. After this admission-only commit, the
actual native `HEAD^`→`HEAD` comparison must show the trigger changed; the guard,
real ancestry, Ubuntu 24.04 machine, Node 22.23.2 pin, `--pull=false`, and
`RAILWAY_GIT_COMMIT_SHA=$CIRCLE_SHA1` remain unchanged. Publication and CI
invocation remain pending coordinator hook and exact-byte review. A halt, skip,
dependency failure, or unrun job is not a pass, and supported image/full HTTP
proof remain UNPASSED.

## Preserved evidence and exact assertions

The original eight-failure TAP transcript remains unchanged at
`evidence/review-5921699729-red.tap`. The original executable R01–R08 assertions
remain in `review-5921699729-regressions.test.cjs`; they are not replaced by a
different implementation or a second proof runner.

The follow-up retest identified R01, R02, R03 and R04 as still failing on the
published executable source and clarified two additional boundary reproductions:
R06 permitted a retained £1,250 gross for an approved 1.25 × £10 calculation,
and R08 permitted a duplicate acquired employee to conceal an omitted reviewed
employee. `review-5925613376-regressions.test.cjs` retains those two supplied
reproductions alongside the original assertions.

## Canonical repairs

- R01–R04 remain enforced in `canonical-production-boundaries.cjs`: the exact
  adapter binding is mandatory and may not carry legacy/extra aliases; approval
  permits have an exact validated schema; malformed permits fail closed without
  disguising database faults; delivery lookup and collision handling are scoped
  to the exact runtime binding; and an unexpired lease cannot be recovered by
  another owner.
- R06 is now checked at the canonical payroll-source boundary before intent
  creation. The adapter-derived exact-cent total must equal both retained
  `grossPence` and, when present, retained `gross`; no binary floating-point
  conversion participates in the comparison.
- R08 now requires unique acquired external IDs and exact set equality between
  the acquired cohort and reviewed mappings before any staging envelope exists.

The supported assembly copies these exact bridge and boundary bytes into the
sealed runtime and records their SHA-256 identities in `STAFFOLOGY_ASSEMBLY.json`.
Assembly validation independently hashes each executable copy and requires it to
equal both the reviewed source bytes and the recorded receipt identity.
The archive itself remains sealed. Activation remains unavailable and no route,
worker, provider client or credential is enabled.

## Frozen target

The candidate `dedf7b307464c513f418bb7c95f37e53660b56a1`, tenant
`northstar-demo`, and implementation run
`09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e` remain recorded targets only. None was
mutated or executed. A hosted release-and-test approval request must not be
prepared unless the supported container-build gate and every offline gate pass.

## Canonical completion checklist — 2026-10-01

- [x] R01 requires the authenticated approval actor's tenant to equal the exact
  permit binding tenant.
- [x] R02 binds dispatch to the same runtime binding, delivery ID, payload
  digest, entry, pay-run coordinates, expected pay and rounding authority.
- [x] R03 filters private delivery reads by the store's trusted binding and
  rejects delivery-key collisions from another binding.
- [x] R04 permits dispatch only for the exact Staffology `POST` path, employer,
  query contract and canonical import-body digest.
- [x] The supplied £12.50/£1,250 and exact employee-cohort regressions remain
  green.
- [x] The existing application’s reviewed `/api/integrations/apply` boundary
  persists valid `people` rows through its existing `ON.stage` onboarding state
  transaction; Staffology does not introduce another employee database.
- [x] Pre-fix R01–R04 TAP from source `c28df01` is retained in
  `evidence/review-5926046040-red.tap`; the seven-suite post-fix TAP is retained
  in `evidence/review-5926046040-green.tap`.
- [x] The only changes made to the older regression fixture were adding the
  actor tenant and replacing its placeholder payload/path/hash with the exact
  dispatch interface now enforced by R01 and R04. Its eight assertions were not
  weakened or renamed.
- [x] Canonical assembly and zero-cost offline CI pass with executable source
  byte equality enforced.
- [ ] Remote publication is blocked: this checkout has no Git remote or GitHub
  authentication, and the configured network proxy rejects GitHub with HTTP
  403. Prepared PR metadata is not represented as an opened or retrievable PR.
- [ ] The supported container build is blocked: no Docker, Podman or Buildah is
  installed, configured package repositories are unreachable, and the approved
  CircleCI review route cannot be invoked without a retrievable remote branch.
- [ ] Deployment and hosted payroll proof remain paused pending both blocked
  gates and the separate exact approval.
