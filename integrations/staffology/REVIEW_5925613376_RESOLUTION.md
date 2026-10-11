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

## Published transport admission and terminal red — 2026-10-01

The independently verified reviewed tree
`03d5c8d906bd82a20626e4c6a9d1e0a450672669` was published without changing
its bytes as transport commit `f454b8f850ed8fb28addd15613d8f612b4563549`,
whose real remote parent is `35d8e4673f2cd8e205e92f9cb46187acb3277d79`.
Native commit `2011246c7b5c899b5469b0edc21d8850294a12fb` remains local provenance and is
not described as remotely published. Draft PR 289 remains the sole review PR;
the unintended PR 291 was closed unmerged and is not an authority or evidence
source.

Existing CircleCI pipeline `61e9707a-b210-4976-a25c-1146854a8e46`, workflow
`7f720269-3163-48a2-b11f-a5167ec0e90d`, admitted the changed protected trigger
and exact `CIRCLE_SHA1`. Core passed in 11 seconds. Runtime job
`4adbb748-0e4e-43bc-b643-3dcb28d54bbf` failed after 3 minutes 23 seconds in the
supported Ubuntu 24.04 / Node 22.23.2 Docker build. The terminal builder error
was `max depth exceeded` while preparing the layer at the agency/attendance
COPY boundary (Dockerfile lines 207–209 in the published source). The retained
545,056-byte coordinator log shows only that the composed Staffology command
completed; it does not establish a final image, image ID, runtime gate, or a
complete raw test count. Always-run upload success and the single downloaded
terminal screenshot are qualified as diagnostics, not build success.

## Bounded depth and evidence repair

The runnable stage still installs, verifies and extracts the same sealed
runtime and applies the same overlays to the same paths. Its context COPY
instructions now use BuildKit link-independent layers, so the 256-copy
instruction Dockerfile no longer creates a 256-deep parent chain. Packaging
regressions accept reviewed COPY flags while continuing to assert every
bootstrap/integration-fabric destination. No proof stage, test, non-root
boundary, package-manager removal, source-SHA seal, production refusal, or
immutable application permission was removed.

The existing autonomy stage now writes the complete Staffology TAP stream,
assembly receipt, local provenance receipt and exact build source SHA into a
private discarded-stage evidence target. Existing CircleCI exports that target
before the final cached build and retains it in its existing private artifacts;
none of those private employee/provider bytes enter the runnable image. This
is source preparation only: the repaired supported image and Node 22.23.2
runtime remain **UNPASSED** until a new reviewed exact-source admission runs.

## Authenticated operation wiring

The prior published source exposed only a dormant integration report. The
canonical assembly now wires an existing-session operation boundary into the
existing integration routes, canonical SQLite database and append-only audit:

- employee acquisition uses only the server-held Staffology credential,
  employer, tenant, exact ordered cohort and request bounds, then delegates the
  reviewed envelope to the existing integration/onboarding store;
- payroll preparation still derives one allowance-free `WORKED_BASIC` line
  from the exact released unsent canonical batch and enforces the exact-cent
  £12.50 boundary before creating an intent;
- the authenticated exact account must currently retain both `payroll.export`
  and `company.configure`; the runtime derives and issues the one-shot permit
  only after the complete fresh provider baseline exists, and re-resolves that
  exact email+tenant account at consumption;
- delivery and explicit recovery use the existing durable coordinator/store,
  fencing and uncertain-delivery reconciliation. Recovery never calls generic
  requeue/resend and returns only a sanitised status projection while complete
  provider evidence remains private;
- the existing integration report and append-only audit expose sanitised
  status/actions. No second database, adapter, worker, service, tenant or
  implementation run was introduced.

The default remains dormant and fail-closed. Activation requires a server-held
`WFM_STAFFOLOGY_OPERATION_JSON` exact binding and `STAFFOLOGY_API_KEY`; the
profile candidate must equal the image's sealed source SHA. Request bodies
cannot supply a credential, provider origin, tenant, employer, runtime binding,
permit or client. These source paths do not authorise configuration, deployment
or a provider call.

Offline tests cover dormant/source binding, tenant/permission refusal, exact
two-employee cohort acquisition, canonical payroll delegation, one simulated
POST with fresh financial readback, one-shot replay, and the existing
authority/recovery/£12.50-versus-£1,250 suites. They remain synthetic and are
not provider acceptance or hosted proof.

## Remaining gates after this preparation

Before any release-and-hosted-test request, independent review must verify this
new native commit/tree and all consequential blobs, then one legitimate
protected-trigger descendant may be transported with real remote
`f454b8f850ed8fb28addd15613d8f612b4563549` ancestry. The existing contained
CircleCI route must produce a terminal green exact image digest, full raw TAP
counts, assembly/provenance/source receipts, Node 22.23.2 runtime result and all
unchanged FORGE/security/payroll/tenant/recovery/Autopilot results.

Still unavailable and therefore not claimed: live provider employee evidence,
an approved provider period/draft and real employee IDs, credential/runtime
binding, provider acceptance, fresh provider readback, hosted financial
reconciliation, deployed UI/audit evidence, authenticated tenant isolation,
restart/recovery on one exact deployed image, and every remaining mandatory
customer-readiness/Golden Journey/security/persistence/recovery/Autopilot gate.
The frozen `northstar-demo` run
`09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e` was not read or mutated.

## Independent operation-scope review and repair — 2026-10-01

Independent reconstruction verified native commit
`8cef6810c5dbcd208e397e7795742fd310f33577`, parent
`acbbf29daa57348f4bdd2ae21e27ce2abe2d40bb`, and tree
`109d519c95ce63f9bc1c0acd0f8e670217717b65`. It remains unpublished; PR 289
still points to transport `f454b8f850ed8fb28addd15613d8f612b4563549` / tree
`03d5c8d906bd82a20626e4c6a9d1e0a450672669`.

The review retained two calibrated failures before this repair:

1. The real bridge produced the canonical payroll input without the four
   runtime-provenance fields, so the real coordinator rejected an otherwise
   valid operation with `STAFFOLOGY_BINDING_MISMATCH` before its first provider
   GET. The prior delegation-only mock did not exercise this composition.
2. When a fixture manually supplied those missing binding fields, a caller
   could select `staffology-OUTSIDE-cohort`; the injected client observed one
   GET and SQLite contained one durable intent before the intercepted request
   became `STAFFOLOGY_TRANSPORT_ERROR`. This was not a provider request, but it
   proved the absent pre-intent cohort boundary.

The raw reproduction is retained at
`evidence/operation-trusted-scope-red.tap`; the real-composition successor run
is retained at `evidence/operation-trusted-scope-green.tap`.

The operation boundary now constructs delivery input by combining the
canonical bridge result exclusively with the server-held trusted binding.
Caller binding fields cannot override it. The server-held operation profile
also contains the exact permitted VECTOR employee, Staffology employee,
payroll code, entry, released period and batch/checksum, effective date, pay-run
coordinates, basic pay code, rounding policy, hours, rate and expected basic
pay. The request must exactly equal that scope before the current exact account
is resolved and before any provider read or durable intent. The Staffology
employee must belong to the configured exact acquisition cohort. A conflicting
tenant, employer, employee, account authority, run coordinate, £1,250 value or
recovery delivery/digest is rejected before network or persistence.

Recovery derives its delivery ID and payload digest again from the same
server-held canonical released batch and exact operation scope. A caller cannot
select another persisted delivery; actual uncertain-delivery fencing and
no-blind-resend behavior remain in the existing coordinator/store.

The real-composition regression now uses `Bridge.createRuntime` with a real
released basic-only batch, `Boundaries.createBoundaries` with real SQLite and
current exact-principal resolution, and `Operations.createOperations`. It
proves a complete fresh baseline, exactly one simulated POST, fresh financial
readback, £12.50 reconciliation, private baseline/readback/comparison evidence,
acknowledged receipt persistence, replay without a second POST, and close/reopen
readback. Negative cases prove zero GET, zero POST and zero intent for
outside-cohort, tenant, account, period, value and recovery-scope changes. These
are synthetic offline results, not live-provider or hosted acceptance.

The complete retained pipeline 3 terminal log is 1,210,675 bytes with SHA-256
`f1303a2fb0edf6b00fe4d7768cf2bba9603bfd1845c23abf24a759245e0d3604`.
Its `max depth exceeded` outcome remains the only prescribed-container result;
`COPY --link` and source-level mapping checks do not establish a final OCI
rootfs, image digest or supported runtime pass. One cold exact-source Ubuntu
24.04 / pinned Node 22.23.2 non-deploy admission remains mandatory after
independent review of this successor.

The canonical 21 readiness requirement IDs in
`implementation/runtime/one-day-enterprise-engine-core.cjs` remain authoritative.
No completion-stage list, Staffology test or source repair closes any hosted,
customer, Golden Journey, security, tenant, persistence, recovery or Autopilot
gate. No provider, deployment, credential, ref or frozen-run operation occurred.

## Remote b6 reconciliation and cross-platform cleanup — 2026-10-01

Fresh readback moved existing draft PR 289 to remote commit
`b6e1dd26f5ca64e7ba6510eae73cc03047f6244e`, real parent
`f454b8f850ed8fb28addd15613d8f612b4563549`, tree
`719ed6c5bbc590c6ab0401005752228e6a1d8287`, changing only Dockerfile blob
`e7bce4a52e637e7c9e9d9ba6b6ca19cc27b1f155`. That native commit is not in
this restored checkout and its ancestry was not fabricated. Its verified
same-destination COPY consolidation was reconciled into this successor while
preserving the operations module, private evidence target, strict tests and
source-SHA binding. The parent-to-successor mapping comparison retains every
source/destination mapping and reduces the runnable-stage COPY instruction
count from 210 to 52.

Pipeline 6 / workflow `587a1a3d-eea2-4619-9e45-89f8673aaa2d` / runtime job 5
is **HALTED**, not passed. Its only material output was: `No frozen-candidate
trigger change; halting heavy proof without marking product failure.` No build,
runtime, image, TAP or full proof step ran because b6 changed only Dockerfile
and retained the prior protected trigger. This successor legitimately refreshes
that existing trigger; it has not been published or admitted.

The independently observed Windows cleanup red was valid: the operation test
registered directory removal before the later reopened SQLite close hook, so
Windows correctly refused removal with `EPERM`. The fixture now owns every
SQLite handle and closes them in reverse creation order before removing its
directory. The analogous Autopilot replay fixture now owns and closes later
engines before its lifecycle guard, database and directory. Cleanup errors are
not caught or ignored.

The full-mode HTTP test now starts the real composed security bootstrap with a
synthetic server-held exact-source operation profile and a child-process-only
Staffology transport interceptor. It invokes the authenticated
`employees/acquire-stage` route, applies the reviewed batch through the existing
canonical application route, and retains the exact cohort/rate/contract/audit
restart readback. It also invokes `payroll/approve-deliver` with a wrong run and
proves rejection without another intercepted provider request. Adapter list
pages are checked against the complete server-held cohort before any detail GET,
so an outside employee ID cannot cause its detail to be fetched.

A positive `approve-deliver` HTTP operation is not locally manufactured: the
sealed fixture has no existing application route that creates a new payroll
period/released batch for the newly onboarded synthetic cohort. Injecting that
released state through SQL or a test-only state flag would violate the proof
contract. The real bridge/SQLite operation test separately proves the exact
released-batch-to-one-simulated-POST/readback/receipt/reopen path, but it is not
mislabelled as the missing authenticated HTTP payroll workflow. Therefore the
strict combined full HTTP operation journey and prescribed Node 22.23.2 image
remain **UNPASSED** until the existing canonical payroll workflow can produce
that cohort's released batch through real application commands and the
contained cold build executes it.

## Exact-source payroll HTTP closure after `c36f611` (2026-10-01)

- The coordinator independently reconstructed native `c36f611c7124f86579e1feda5a9418f1c284dfc2` / tree `aa0a9c6334ec5e108554df3ef568ce6916978038`. It remains local and unpublished. The actual remote PR289 head remains `b6e1dd26f5ca64e7ba6510eae73cc03047f6244e`; any later transparent transport must use that real remote object as parent rather than inventing native ancestry.
- A detached worktree at exact `c36f611` reproduced the remaining source red without network or provider traffic: its composed `server.cjs` had no `/api/command` dispatch from `time-source-ingest` to the sealed payroll domain's existing `openPeriodFromSource`. The retained raw source reproduction is `evidence/full-http-payroll-command-red.tap`. Consequently the imported cohort could not enter the genuine review/sign/release workflow.
- The composer now adds only that bounded dispatch inside the existing authenticated `mutate` transaction and extends the existing account-permission administration allow-list with the domain's pre-existing dedicated `time.ingest` permission. `openPeriodFromSource` retains validation of Monday/week uniqueness, complete frozen roster, manager/org identities, source version, normalised actual-attendance records and complete teams. No period engine, database, worker, tenant or implementation run was added.
- Staffology configuration now supports an acquisition-only exact-source profile with `payroll: null`. Acquisition stays exact-cohort/server-credential bound; payroll delivery and recovery fail closed with `STAFFOLOGY_PAYROLL_DORMANT` until a second-phase server-held profile names the genuine released batch and checksum returned by the canonical application.
- The strict full HTTP source now requires `WFM_BUILD_SOURCE_SHA` to be the admitted 40-hex source identity. Docker passes the existing `RAILWAY_GIT_COMMIT_SHA` into this proof; the prior synthetic repeated-`a` candidate identity was removed.
- The strict journey uses the actual routes to assign `time.ingest`, acquire/apply/onboard the exact `employee-001`/`PAY901` and `employee-002`/`PAY902` cohort, persist £10.00 GBP rates and 40-hour contracts, ingest explicitly labelled offline observed attendance, perform manager checks/signature and canonical payroll release, read the returned batch/checksum/export, restart with that exact trusted payroll scope, and assert one simulated provider POST, £12.50 reconciliation, private receipt, replay without a second POST, restart readback and audit/status projection. Wrong tenant, current permission, cohort, run and £1,250 inputs are asserted before provider traffic. This remains synthetic/offline evidence, never a live-provider claim.
- The full strict journey source is now executable only with the locked passkey dependency closure and composed FULL runtime. That closure is absent locally, so the complete HTTP journey and prescribed Node 22.23.2 container remain **UNPASSED** here pending the one independently reviewed contained cold build. Existing recovery/fencing tests remain the authority for lost-lease and uncertain-delivery behavior; the HTTP journey does not weaken or replace them.
- The existing 21-requirement readiness registry remains authoritative. Golden Journey, hosted security/tenant/persistence/recovery/Autopilot, image identity, provider acceptance and customer readiness all remain **UNPASSED** until evidence from one exact admitted/deployed candidate closes them.

## Final focused pre-admission repairs after `6e4bc04` (2026-10-01)

- The replay/audit mismatch was reproduced at the real operation boundary: one initial delivery plus one acknowledged replay made exactly one simulated provider POST but invoked the append-only `staffology-payroll-operation` audit twice. The old HTTP expectation of one audit row was wrong. `evidence/operation-replay-audit-red.tap` retains that red. Audit details now explicitly distinguish `outcome=initial,replayed=false` from `outcome=replayed,replayed=true`; the strict HTTP proof expects both truthful rows while retaining the one-POST limit.
- The two existing CircleCI Docker builds now use `--progress=plain` and tee complete output into the existing private runtime-artifact directory. The Staffology Docker RUN always cats its complete private TAP before returning the original test exit status, so a failing test remains a failing layer while its diagnostic is present in the plain build log. No workflow, service or infrastructure was added.
- The positive fenced-successor fixture retains its virtual lease timing (`100` then `1000`) but uses a bounded 1000 ms injected HTTP timeout instead of the contention-sensitive 100 ms transport deadline. Negative timeout tests and zero-dispatch semantics remain unchanged.
- The synthetic provider fixture now persists its accepted £12.50 state in the isolated test directory across server processes. After VECTOR restart, the authenticated exact-scope `payroll/readback` operation performs fresh GET observations of the open run and entry using the adapter's existing validation primitives, records the readback audit, and proves £12.50 without another POST. This is durable simulated-provider state with zero external provider requests, not hosted/provider acceptance.
- The strict HTTP proof now expects two append-only operation audit rows (initial and replay), one readback audit row, one provider POST total, and fresh provider plus VECTOR/SQLite observations after restart. The existing private baseline/readback/comparison receipt remains authoritative and immutable.
- The prescribed Node 22.23.2 full HTTP/container build, OCI image identity and all hosted/customer/provider gates remain **UNPASSED** until the one independently reviewed contained admission executes. The existing 21-requirement readiness registry remains authoritative.

- Checkpoint freshness for this final repair: native `6e4bc0448c166f6abab2519ca8cdc12da7703278` is not present in this restored object database. Existing local transport checkpoint `8ee574128f969b13c22bb63eae75db4eb3346180` has the independently verified identical tree `7e8c6e1b245618d5349add56654b350ce6290452` and published-base parent `35d8e4673f2cd8e205e92f9cb46187acb3277d79`; it is the honest local parent of this repair. This does not claim native `6e4bc04` was remotely published, and the coordinator must still use the freshly verified actual PR289 remote head as transport parent.

## Canonical-period and provider-isolation correction after `c675803` (2026-10-01)

- The exact sealed domain red is retained in `evidence/full-http-period-collision-red.tap`: canonical initialisation already owns `2026-09-07` from `synthetic-closed-week-fixture`, so `openPeriodFromSource` correctly rejected the old strict-test date with `This review week already exists.` before cohort lookup and with zero provider requests. The existing period and duplicate-week guard are unchanged. The strict test now uses unused valid Monday `2026-09-14` consistently under an explicitly synthetic test-process `2026-10-01` as-of clock (so the week is genuinely closed under the existing sign/release rules) for observed attendance, review, release, export, provider approval and readback, while rates/contracts remain effective `2026-09-01`.
- Fresh post-restart evidence again asserts the exact two onboarding people and staff identities, names, source IDs, PAY901/PAY902 payroll IDs, ready lifecycle, applied integration records, both £10 GBP hourly rates from `2026-09-01`, and both full-time 40-hour contracts through authenticated application readback plus read-only SQLite evidence. No SQL mutation or manufactured release is used.
- The child-process provider interceptor now fails closed for every origin except exact `https://api.staffology.co.uk` and loopback. The proof asserts no unexpected forwarded origin, exact bounded Staffology methods/paths/run/entry/cohort, and one simulated POST total. Its accepted synthetic state remains durable across server restarts.
- The existing private artifact route now receives `staffology-http-result.json` containing the exact source SHA, tenant, period, returned batch ID/checksum, cohort mapping, request counts, complete fresh provider readback snapshots/provenance, VECTOR people/staff/integration/reconciliation readback and audit counts. It is synthetic private evidence, not live-provider acceptance.
- Fresh remote readback advanced PR289 to `adf9b7246c150ca824b24893cd35b49e0cf835ff` (parent `b6e1dd26f5ca64e7ba6510eae73cc03047f6244e`, tree `a3ceee1bfde0aa01893a70a8acd12950b038364e`) by changing only the protected trigger to retain the b6 admission. This local history does not fabricate that remote commit; transparent publication must use the freshly reverified actual remote head as parent.
- CircleCI pipeline 7 / workflow `b79bb3e8-5765-472b-88d1-ee9216a4ee42` is **FAILED**, not an image pass: core succeeded, runtime failed after 1m46s with 1182/1184 tests passing. Both failures were stale individual-COPY assumptions in `tests/vector-runtime-packaging.test.cjs`; the already-reviewed consolidated mapping assertions address those cases and pass supplemental testing. Complete raw log SHA-256 `61429f299ca5cde9b17ecade590693a776de2acaf6246c1e07e4be5c84879deb` is coordinator-retained. No unchanged rerun was invoked.
- The prescribed Node 22.23.2 full HTTP/image admission and every applicable gate in the existing 21-requirement readiness registry remain **UNPASSED** pending one final independently reviewed contained build.

## Generated child-preload syntax correction after `8f3c49b` (2026-10-01)

- Independent review correctly found that source-file `node --check` did not compile the JavaScript generated by the outer mock-provider template. The actual generated child contained a literal newline inside the unexpected-origin append string and failed `new vm.Script(...)` with `SyntaxError: Invalid or unexpected token`. The complete focused red is retained in `evidence/generated-provider-preload-red.tap`.
- `independent/generated-provider-preload.test.cjs` now extracts and evaluates the actual template bytes from `full-http-employee-journey.test.cjs`, compiles the resulting child preload, and asserts its fail-closed origin fence. It is included in canonical assembly and the contained Docker Staffology TAP, so outer-source syntax checking cannot mask this class of child-generation failure again.
- The unexpected-origin newline now uses the required double escaping. Loopback forwarding is restricted to HTTP URLs whose parsed hostname is exactly `127.0.0.1` or `localhost`, allowing intended ephemeral ports while continuing to log and reject every other origin. Exact Staffology request bounds, durable synthetic provider state, private source/provenance evidence and all production authority boundaries are unchanged.
- No publication or CI admission was invoked. PR289 remote parent must be freshly reverified from the current actual remote head (`adf9b7246c150ca824b24893cd35b49e0cf835ff` at the last coordinator readback) before any transparent transport. All hosted and 21 readiness-registry gates remain **UNPASSED**.

## Pipeline 8 core-command compatibility correction (2026-10-01)

- The reviewed native `b8b016add73d237f3259b4768da58e92999422a2` was transparently published as `4d96909f0cfb2ce650771981ba068c70617d8a5a` with real parent `adf9b7246c150ca824b24893cd35b49e0cf835ff` and identical tree `ca9d132c516042c7651e256871daca30eb2ae845`. This mapping is publication provenance; native b8 was not mislabelled as the remote commit.
- CircleCI pipeline 8 / workflow `d311e655-b068-480c-9a3e-116b5fbea053` admitted exact remote source `4d96909`, verified Node 22.23.2, then **FAILED** in core job 8 after six seconds; runtime never ran. `scripts/validate-product-factory.mjs` required the established `docker build --pull=false` prefix, but the logging repair had inserted `--progress=plain` before it. Complete coordinator-retained raw failure is 10,659 bytes, SHA-256 `fe4f9b476451e1273808c341591583d117c204b693d150f43fa5af73b284f8c7`; the locally reproduced raw red is `evidence/circleci-build-command-contract-red.log`. No build, image or full HTTP pass is claimed.
- Both existing CircleCI commands now preserve `docker build --pull=false` and place `--progress=plain` immediately after it. Pipefail, tee'd private logs, `--pull=false`, exact `CIRCLE_SHA1` build arguments, protected trigger admission, private evidence export and no-deploy containment remain intact. The focused Docker admission contract asserts the corrected ordering twice.
- A repository scan found no other strict source validator for the displaced ordering. The actual `node scripts/run-forge-ci.mjs` core path now completes with `VECTOR_FORGE_CORE_CI=PASS`, including `PRODUCT_FACTORY_VALIDATION=PASS` and all subsequent validators/tests; this is source/core validation, not a container or customer-readiness pass.
- No unchanged pipeline was rerun. The protected trigger is refreshed only for this corrected exact descendant. All image, strict full HTTP, hosted/provider and 21 readiness-registry gates remain **UNPASSED** pending independent review and one contained admission.

## Pipeline 9 strict-HTTP canonical blocker correction (2026-10-01)

- Native `6bbeafb9e37549d0c0b5e37d596243ec768b332a` was transparently published as `b27e39197e233c7b660551d85781071168503b29` with real parent `4d96909f0cfb2ce650771981ba068c70617d8a5a` and identical tree `bee88c13b91d1b941e1ebed45b341bc1bf1fc0c0`. CircleCI pipeline 9 / workflow `0eaff073-a294-4c9c-88d7-1803e1336f64` passed core job 10 in 17 seconds and **FAILED** runtime job 11 after 29 seconds. Exact source/build argument and Node 22.23.2 were preserved; Gusto 13/13 and locked passkey 28/28 passed. Staffology was 122/123 with strict HTTP failing before release. Complete coordinator-retained plain log is 62,413 bytes, SHA-256 `88fef066192967bb5869021f5c3209be2325bbbc5ef20f64ad9bbc64ee3c872b`.
- The two exact blocker objects are retained in `evidence/full-http-team-blockers-red.tap`: (1) time review flagged the 75-minute worked row as unscheduled because expected shift evidence was null; (2) canonical pricing held the employee because the onboarding contract lacked complete WorkRules fields and raised `Cannot read properties of undefined (reading 'slice')` while reading the missing premium window. Zero real external requests occurred.
- The fixture now supplies factual synthetic expected shift evidence equal to the independently supplied observed 09:00–10:15 attendance, with zero breaks and 75 planned minutes. This is schedule evidence for time-review comparison; it is not converted into presumed attendance. Because no variance exists, no treatment is fabricated and time review remains active.
- Both imported employees now receive complete reviewed full-time WorkRules contract versions through the existing authenticated `rules-contract` command before source ingestion. The original onboarding contracts effective `2026-09-01` remain intact; the complete reviewed versions effective `2026-09-14` add the established overtime, premium-window, holiday, jurisdiction and policy fields required by genuine `priceSeries`. Post-restart evidence asserts both versions, both 40-hour terms and both £10 GBP rates.
- Continued isolated actual-domain execution found and retained a subsequent mock-shape red in `evidence/full-http-provider-run-red.tap`: the run-detail GET incorrectly returned entry-shaped JSON and failed exact run-version validation before any POST. The interceptor now returns the exact run object for the run path and the exact entry object only for the entry path.
- An isolated execution using the actual composed server/domain modules (without claiming the unavailable passkey bootstrap gate) then completed the entire synthetic employee HTTP journey through the real domain application boundary: costing, time ingestion, review/sign/release, one simulated POST, fresh provider readback, persistence/reopen, audit and private receipt. The receipt was created and the journey passed 1/1; this is qualified isolated domain evidence, not a real-provider employee application or the prescribed supported-container/full-security proof.
- No publication or CI invocation was performed. All prescribed image/full-bootstrap, hosted/provider and 21 registry gates remain **UNPASSED** until independent review and one contained admission using the freshly verified actual PR289 remote head.

## Strict HTTP private-evidence custody correction after `6add66a` (2026-10-01)

- Independent review correctly identified that the successful isolated journey queried only private-evidence phases, exported summaries, and then deleted its SQLite database. The actual custody failure is retained in `evidence/full-http-private-evidence-custody-red.tap`: complete baseline/run/entry bodies, stored digests, delivery payload/dispatch/acknowledgement, request log, reviewed rates/contracts and scoped audit rows did not survive cleanup.
- The existing private artifact output now receives a schema-v2 scoped proof before cleanup. It includes the exact source/binding/tenant/period/batch/checksum/cohort, durable delivery intent and receipt (excluding owner token), every private evidence body with its stored digest, fresh run/entry/provenance, bounded sanitised request log, reviewed rate/contract evidence, VECTOR persistence/reconciliation and relevant append-only audit rows. It explicitly records `synthetic: true` and `actualExternalRequests: 0`; credentials, login/session material and unrelated tenant state are excluded.
- The journey independently validates each stored private-evidence digest, writes a SHA-256 sidecar for the complete proof, stops the server, closes SQLite, removes the temporary runtime/database with non-forcing cleanup, then reopens the private artifact and revalidates its whole-file digest, evidence digests, exact identities, acknowledgement, rates/contracts, request limit and initial/replay/readback audit counts. Thus the evidence remains readable only from the existing discarded-stage private artifact route after runtime state cleanup; it is not copied into the runnable image or public artifacts.
- This remains synthetic isolated-domain preparation. Prescribed Node 22.23.2 full-security-bootstrap/container admission, hosted/provider proof and all applicable gates in the existing 21-requirement registry remain **UNPASSED** pending independent review and one contained admission. No publication, CI invocation or hosted/frozen mutation was performed.

## Exact private-evidence scope and native-identity correction (2026-10-01)

- The previously reported native identifier `f789c55a1e32aee0c30ded357504d223773cc299` was a transcription error, not a second object or ancestry change. The repository object is `f789c558223d58e61c513db75599d24a068fed9d`: `git cat-file -s` reports 249 raw commit-body bytes, and hashing those exact `git cat-file commit` bytes with `git hash-object -t commit --stdin` returns the same `f789c558...` identity. Exact Base64/raw-object evidence accompanies the owner handoff.
- The retained custody red remains applicable. The repaired export now selects the exact acknowledged `delivered.deliveryId`, selects private evidence only for that delivery, and selects relevant audit rows only for the trusted `northstar-demo` tenant. Before export it asserts every evidence row has that delivery ID, every audit row has that tenant, and every initial/replay operation audit identifies that exact delivery. No unqualified delivery, evidence or cross-tenant audit query remains.
- Complete raw private evidence bodies and stored digests, strict bootstrap contract, source binding, cohort, origin fence, 14-request/one-POST bounds and £12.50-versus-£1,250 denials remain unchanged. This is still synthetic preparation; prescribed contained and hosted gates remain **UNPASSED**.

## Pipeline 10 hosted runtime-identity caller correction (2026-10-01)

- Reviewed native `c999f173c2a29695431c09e2a5a84b715bffbfae` was transparently published as `b4512f94c54315d4969e7b98425b4bb761caf55a` with identical tree `3989ba4fec69c5bf75d6a7242d113cd985d61e26` and real parent `b27e39197e233c7b660551d85781071168503b29`. Pipeline 10 core job 12 passed; runtime job 13 **FAILED** after its build and security steps passed because the hosted `docker run` caller omitted required `WFM_CANDIDATE_SHA`. The complete failure facts and raw-log digest are retained in `evidence/circleci-runtime-identity-caller-red.log`; final image/hosted/customer readiness is not claimed.
- The existing isolated hosted caller now passes its exact `${CIRCLE_SHA1}` as `WFM_CANDIDATE_SHA`. The runtime still independently reads `/app/.wfm-build-source-sha` and fails startup on absence, invalid form or mismatch; no identity or hosted guard was weakened. The proof now reads `/api/runtime-identity`, requires `candidateSha` to equal `CIRCLE_SHA1`, requires `sourceBinding=build-file-matched`, and independently checks both protected response headers. Identity body/headers join the existing private runtime artifacts.
- A held-out caller contract exercises a matching configured SHA plus independently read sealed file and the mismatch failure. Node pin, non-root entrypoint, package-manager removal, production refusal, origin/secret boundaries, private Staffology evidence and all original negative gates remain unchanged.
- Fresh read-only metadata reports that the masked `STAFFOLOGY_API_KEY` row exists on executor `fc72219b-ee7c-4b84-8d94-1a14cf7d6e78` in environment `eed9f097-610a-416e-83b9-6bc7bdb3eeef`; its value was not read and running-process binding remains **UNVERIFIED**. Release/live-manifest/image-transfer approval remains withheld. No publication, CI invocation, deployment, provider request or frozen-state mutation was performed for this repair.

## Pipeline 11 application-UID proof correction (2026-10-01)

- Native `3e5062d29111ae3e43f2367f7567406a0ab750a6` was transparently published as `dfeb74eb524fe936516c6b4a8b53ac9f2876e580`, with real remote parent `b4512f94c54315d4969e7b98425b4bb761caf55a` and identical tree `c6e8e5108894a7437ffc0e12b42435d54be6cf6c`. Pipeline 11 core job 14 passed; runtime job 15 **FAILED** after build and runtime-security success. The actual retained output identifies only a successful hosted health response followed by exit 1, not the precise silent assertion. Exact log identities and this qualification are retained in `evidence/circleci-pid1-uid-caller-red.log`.
- Source inspection found a real semantic defect in the next caller assertion: `docker exec ... id -u` measures a newly created exec process using intentional image `Config.User=root`; it does not measure the running PID 1 application after the volume/bootstrap entrypoint permanently executes `gosu node`. The repair does not claim the unavailable diagnostic proved this was the terminal assertion.
- The caller now reads `/proc/1/status` from the running container and pipes only that non-secret process metadata into a fail-closed verifier. The verifier requires exactly one well-formed four-field UID record and rejects root in real, effective, saved or filesystem UID. Tests retain positive non-root coverage and root/missing/malformed/duplicate negatives. Image root wrapper, volume ownership bootstrap, `exec gosu node`, Node pin, package-manager removal and production refusal are unchanged.
- Every hosted HTTP boundary now emits a bounded named PASS diagnostic only after success: health, sealed source identity/body/headers, root page, unauthenticated bootstrap 401, PID 1 application UID, and unauthenticated demand 401. The non-secret diagnostic joins the existing private artifact route; shell xtrace, environment and credentials remain excluded.
- Pipeline 11 produced a local built image digest only; it was not transferred, deployed or proven hosted. Live approval, running-process Staffology credential binding and the live provider manifest remain withheld. No publication, CI invocation, deployment, provider request or frozen-state mutation was performed for this repair.

## PID 1 UID exact-record-arity correction (2026-10-01)

- Independent byte review verified native `071449e15ef8b3eedb039937131c388759de68d7`, its truthful local parent, tree and all eight changed blobs. It remains unpublished. Owner Linux reproduction confirmed the review finding: the old AWK projection discarded a fifth numeric or junk field and returned `OLD_UID_VERIFIER_RESULT=PASS values=1000 1000 1000 1000`. The pre-fix reproduction is retained in `evidence/pid1-uid-extra-field-red.log`.
- The verifier now separately counts every `Uid:` record, counts any record whose arity is not exactly the Linux label plus four UID values, and projects values only from an exact-five-field record. Admission requires exactly one record, zero wrong-arity records and four decimal values; root rejection for real/effective/saved/filesystem identities is unchanged.
- Behavioral negatives now cover extra numeric fields, trailing junk and a valid record accompanied by a malformed additional `Uid:` record, as well as the existing missing, truncated, non-numeric, duplicate and root cases. The CircleCI caller, `/proc/1/status` source, bounded private diagnostics, root bootstrap wrapper and all production containment/security requirements are unchanged.
- Coordinator Windows has no Bash executable, so unavailable Windows supplemental execution is neither a pass nor a product failure. Owner Linux checks are reported below; prescribed contained execution remains required. No publication, CI invocation, deployment, provider request, credential change or frozen-state mutation was performed.

## PID 1 UID decimal-canonicalisation correction (2026-10-01)

- Owner Linux execution against native `ff599297e6c2f6d68d61d6ecbdd3c34a5ad94a76` reproduced the final review finding exactly: input `Uid:\t08\t1000\t0\t1000` exited zero, emitted Bash's invalid-octal arithmetic diagnostic, then incorrectly emitted `VECTOR_APPLICATION_UID=PASS` despite saved UID zero. The raw reproduction is retained in `evidence/pid1-uid-leading-zero-red.log`; this claim is based on executed Bash, not source inference.
- The verifier no longer evaluates untrusted UID text with Bash arithmetic. It first requires each value to be canonical decimal (`0` or a non-zero digit followed by at most nine digits), rejects the Linux overflow/sentinel boundary and larger values using deterministic C-locale length/lexical comparison, then detects root using string equality. An invalid earlier value therefore cannot suppress a later root check or reach PASS.
- Behavioral negatives cover leading-zero values in every UID position, multiple leading-zero-before-root arrangements, `00`, the `4294967295` sentinel and an eleven-digit overflow, while retaining all root, arity, junk, duplicate and valid non-root cases. No runtime flag, caller, wrapper, identity, containment or private diagnostic boundary changed.
- Coordinator Windows Bash remains unavailable and is not counted as a pass or failure. Owner Linux affected checks are reported below; prescribed contained execution remains pending. No publication, CI invocation, deployment, provider request, credential change or frozen-state mutation occurred.

## Hosted operation controls and application-root refusal (2026-10-01)

- The exact reviewed candidate `f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560` / tree `74aba749449f3f4cd68ee385b24637026ea90ec8` passed the supported non-deploy route (pipeline 12: core 16 and runtime 17 succeeded). This proves the isolated fixture image and strict synthetic Staffology journey, not customer-hosted acceptance. The coordinator's later read-only process attestation found the existing Railway custom start command bypassed `vector-entrypoint.sh` and ran the hosted application as UID 0; that actual pre-fix red is retained in `evidence/hosted-root-startup-red.log`.
- Hosted bootstrap now independently refuses root, missing, or malformed effective-UID evidence before application initialisation. Non-hosted build/predeploy admission remains allowed to run as root, preserving the privileged volume bootstrap followed by `exec gosu node`. Focused tests cover root/unavailable/malformed rejection and legitimate UID 1000 acceptance.
- The existing Integrations screen now mounts customer-facing Staffology controls on the approved Vector shell. It reads status through the authenticated `/api/integrations` route and uses only the existing canonical acquire-stage, reviewed inbound apply, approve-deliver, fresh readback, and recovery routes. Busy controls prevent double submission; explicit dormant, restricted, loading, error, uncertain, and success states are visible. Credentials never enter the browser.
- Exact operation descriptors are emitted only when the signed-in account matches the configured tenant, holds both existing permissions, and remains the current principal. The response contains the reviewed binding/cohort and, only when configured, exact payroll approval scope; it never contains the provider key. Wrong-tenant, missing-permission, and stale-principal tests verify fail-closed descriptor suppression.
- No live cohort, payroll value, draft, or mapping was invented. The UI requires one explicit reviewed mapping per server-held employee and keeps payroll controls dormant until the exact released-batch scope exists. Existing server authority, provider cohort fencing, append-only audit, durable apply/readback/reopen, one-write replay, ownership, recovery, and amount mismatch checks remain authoritative.
- Source work performed no publication, CI invocation, deployment, restart, configuration change, credential access, provider request, or frozen-state mutation. Customer-ready and registry closures remain withheld pending independent byte review, coordinator transport, and exact hosted journey evidence.

## Hosted deployment identity binding correction (2026-10-02)

- Independent review found that native `901bbcedd892c89d1b6d2de6c64b260b1d6501ae` accepted a literal profile deployment identifier without comparing it to the executing Railway deployment. The offline failing reproduction is retained in `evidence/hosted-deployment-profile-binding-red.log`; it performed no provider request or hosted mutation.
- In hosted mode, configuration now requires a canonical `RAILWAY_DEPLOYMENT_ID` from the existing trusted process environment. An absent profile deployment ID resolves to that runtime identity, while an explicit profile value must match it exactly. Missing, empty, whitespace-bearing, malformed, differently cased, stale, or conflicting runtime/profile identities fail closed before credentials can be used.
- Non-hosted fixtures retain an explicit deployment identity and ignore Railway-only identity input. The sealed candidate SHA remains independently required and matched; deployment resolution does not weaken tenant, implementation-run, configuration, employer, cohort, payroll, current-principal, or financial scope validation.
- The resolved deployment ID becomes `profile.binding.deploymentId`, so the same exact value flows through authorised status, trusted payload binding, durable dispatch, audit and private evidence. No client-supplied operation request can select or override it.
- Coordinator evidence separately reports exact candidate `f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560` deployed as `54e96e40-5fc2-428b-b96d-7453a5fa1810`, Node 22.23.2 PID 1 UID 1000 in all four fields, dormant operations, and unchanged existing permissions. Those are hosted execution facts, not results produced by this source-only correction.
- This source task performed no publication, CI invocation, deployment, restart, configuration change, credential access, provider request, import, payroll mutation, or frozen-state mutation. Exact hosted journey and customer-ready gates remain open.

## Profile-scoped staging and customer mapping controls (2026-10-02)

- Independent hosted inspection of native `0238c3c88036f125f9c0a40f1ca0de9f8434fa67` found `/api/integrations` reported `inbound=[]` and no `WFM_INTEGRATIONS_JSON` Staffology connector. The pre-fix composed `stagePeople` therefore returned 503 before the existing integration store. This dormant, zero-provider-call reproduction is retained in `evidence/hosted-profile-missing-ingress-red.log`.
- The server-held operation profile now owns an exact people connector descriptor: connector ID, scope, tenant, provider and the sole `people` object type. The operation validates current tenant and `company.configure` authority plus exact request keys, cohort, connector ID and server-held scope before provider acquisition. Client-supplied connector/scope overrides fail before a provider call.
- Composition passes that private descriptor directly to the existing `integrations.stage` and `prepareInboundIntegration` boundary. It does not add a token, modify `WFM_INTEGRATIONS_JSON`, call generic `IG.authenticate`, or expose a new ingress route. An existing configured connector with the same exact descriptor remains compatible; a conflicting same-ID connector fails closed. Existing integration idempotency, held-record reasons, application, checkpoint and append-only stage/apply audit remain authoritative.
- The Vector panel no longer accepts implementation-detail JSON. It reads the existing authenticated bootstrap and renders labelled per-employee manager, site, job, contract and weekly-hours controls, an explicit cohort review confirmation, held-record reasons and the existing reviewed application result. Provider employee/payroll identities remain source-held: payroll identity is copied from the acquired provider record at the server boundary and any supplied mismatch remains rejected by the canonical bridge. No rate, hours, cohort, payroll draft or business value is inferred.
- Dormant/unauthorised, loading, held, staged, applied/onboarding, uncertain, recovery, readback and error messages remain visible; busy-state double-click prevention and explicit user refresh remain. The separately observed OpenAI `usage_limit_exceeded` turns remain a genuine terminal account-quota blocker and were not retried, reclassified, or changed in source.
- Exact deployment binding, sealed candidate, non-root bootstrap, current-principal, tenant/run/cohort/payroll, provider request fencing, private evidence and all prior negative controls remain unchanged. This source task performed no publication, CI invocation, deployment, configuration change, provider request/write, credential creation, import, payroll mutation, or frozen-state mutation.

## Hosted settings navigation and real-provider lifecycle correction (2026-10-02)

- The original bounded real-provider discovery preserved exactly five employee details: four `Current` employees and one `Former` employee, Ian Jones (`3a7e7298-b414-4b87-9cf9-ab9c75bded62`), whose employment ended `2019-07-21`. Their pay bases are mixed Monthly, Daily and Hourly; no employee was relabelled. All five reference working pattern `9258014d-a111-4809-8ae8-2df7557c1f0a`, whose independently bounded GET reported Standard HoursPerDay 7.5 Monday–Friday and 0 on weekends, totalling 37.5 weekly. This is source working-pattern evidence, not a synthetic 40-hour/default inference and not rate or competency evidence.
- The Former employee remains excluded from any starter cohort and the canonical lifecycle guard remains unchanged. No Year2022 historical draft was recreated or reused; the selected demo employer's open list and Year2026 list were empty. No provider write or import occurred.
- Hosted candidate `f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560` reproduced a customer-navigation defect: clicking Settings & more left `.vector-settings` absent despite a present `.content` and 37 source navigation buttons, without a browser error. The retained red is `evidence/hosted-settings-navigation-red.log`. Source inspection and behavioral reproduction identified the cause: open state lived only in a transient DOM node, so an authoritative content replacement discarded it and `apply` had no state from which to restore it.
- Settings visibility now belongs to Vector shell state. Every `apply` reconciles that state into the current `.content`, so an authoritative rerender recreates the panel; explicit Close or navigation clears it. Existing source routes and permission-based availability remain authoritative—no hidden route is forced visible. The source-bound identity snapshot now retains tenant/account fields so pending Staffology UI state is invalidated on an account or tenant change.
- A behavioral regression executes the actual settings functions, opens the panel, replaces the content container, verifies the panel is recreated with source-derived links, then explicitly closes it. Existing Staffology profile/staging, authority, idempotency, lifecycle and provider fences remain unchanged.
- Broader Golden Journey, security, tenant isolation, persistence, recovery and Autopilot gates remain open. The actual `usage_limit_exceeded` terminal condition remains an account-quota blocker, not a pass or retry instruction. Root retains publication/build/hosted execution ownership; this source task performed none of those actions.

## Mixed five-person lifecycle custody and mapping preflight correction (2026-10-02)

- Independent offline replay of the retained five-person provider readback reproduced a real all-or-nothing defect before repair: `peopleEnvelope` threw `STAFFOLOGY_EMPLOYEE_LIFECYCLE_REQUIRED` on Ian Jones (`3a7e7298-b414-4b87-9cf9-ab9c75bded62`, Former, ended `2019-07-21`) before the existing integration store was called. Consequently the four Current employees were not staged and no durable record explained the Former hold. The bounded reproduction records zero provider requests and is retained in `evidence/five-person-lifecycle-red.json`; the four other provider identities remain in the separately held private response rather than being copied into source.
- Acquisition continues to require the exact configured five-person cohort. The canonical envelope now represents the Former record as a lifecycle deletion with its exact source revision, provider identity, status and end date. The existing integration store stages the complete five-person comparison first: its existing per-record preparation boundary records that Former row as held with the explicit lifecycle reason and immutable digest. A deterministic second batch contains only the four eligible Current records, allowing the existing reviewed apply boundary to proceed without ever treating the Former record as a starter. No employee is omitted from acquisition, no source lifecycle is relabelled, and no target rate, skill or competence is inferred.
- The application boundary independently refuses every Former/delete row before onboarding validation. The held full-cohort batch cannot be applied, while the Current-only batch retains existing idempotency and replay behavior. Focused persistence coverage applies four Current fixture records, proves the Former fixture remains held and absent from onboarding, closes/reopens SQLite, reads both batches back, rejects cross-tenant detail access, and confirms replay makes no second application call. The fixture deliberately labels the four Current IDs as retained test fixtures; it does not fabricate the privately retained real identities.
- Reviewed mapping values are now validated against the existing canonical tenant's manager, site, job, contract-type and weekly-hours options before any Staffology acquisition request. Invalid or invented options fail with `STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED` at zero provider calls; the positive test accepts the canonical 37.5-hour selection. Exact cohort, connector, current-principal, tenant and permission checks still run first, and generic authenticated ingress remains unchanged.
- The previously retained working-pattern facts remain authoritative: all five source records referenced `9258014d-a111-4809-8ae8-2df7557c1f0a`; its bounded read reported 7.5 hours Monday–Friday and zero on weekends, or 37.5 weekly. The cohort remains four Current and one Former with mixed Monthly/Daily/Hourly bases. No provider request/write, import, publication, CI, deployment, configuration, credential or frozen-state mutation occurred in this source task.
- Coordinator-owned runtime facts are recorded without claiming them as source-test results: the executor's two non-secret bindings were corrected to exact candidate `f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560` and deployment `54e96e40-5fc2-428b-b96d-7453a5fa1810`; executor deployment `0255e65b-e501-4f83-9c04-8433ccf15471` completed two authenticated cycles but the registry remains 5/21 and `customerProofComplete=false`. `vector-durable-proof` is inactive and the inspected source/configuration has no reference to it; current persistence remains the existing SQLite/data volume. Autopilot remains **UNPASSED** on terminal `usage_limit_exceeded`, and broader Golden Journey, supported Node 22.23.2/container, hosted provider, security, persistence and recovery gates remain open pending coordinator execution.

## Pipeline 17 configured-connector and integration-detail contract corrections (2026-10-02)

- Native `9d320a2ba0306b8ae6547ed01767249fcb7c18bc` / tree `bc10211d06d1016b39a7b01f58a21596646c9acb` was transparently transported to existing review branch commit `93513c250e3f0105a1fd019bf63a5a1674970b98` with remote parent `f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560`; independent review matched all 1,107 files and modes. Pipeline 17 workflow `fa270569-d6f6-4a77-948a-0fc8c19131f0`, runtime job `8c03bb19-501c-434a-9fdc-7793ead233c3`, stopped in the exact Node 22.23.2 proof build with 142 tests executed, 140 passed and two failed. No runtime image, deployment, provider or customer pass is claimed.
- The first retained RED was the strict full-HTTP acquisition returning 503 because its generic fixture connector used scope `d1`, while its operation profile omitted the connector and therefore resolved the default `staffology-reviewed-people` scope. The production conflict refusal was correct: same connector ID with different server-held scope must fail. The fixture now explicitly binds its server-held operation connector to the already configured `staffology-people` / `d1` descriptor. It retains the existing generic connector token only for pre-existing generic-ingress tests; the canonical operation still receives no new public credential and uses the same current-account, tenant, connector and scope checks.
- The second retained RED was an assertion that `integrations.detail` returned invented aggregate properties `valid` and `held`. The actual existing detail contract returns batch metadata plus per-record status. The persistence test now derives the factual counts from those records, requires four `valid` rows and exactly one `held` Former row, and continues to assert the exact Former identity/reason, held-batch application refusal, four-person application transaction, close/reopen readback, replay without a handler call, cross-tenant 404 and append-only stage/stage/apply audit sequence.
- On the available owner runtime, Node 22.22.2 with its experimental SQLite module and the extracted sealed runtime passed the focused persistence test 1/1. The affected operation, connector, mapping, bridge, lifecycle, hosted UID and UI suite passed 39/39. This is useful local evidence but is not the prescribed Node 22.23.2 container proof. The strict full-HTTP path could not be executed locally because this checkout has neither Docker nor the locked passkey dependency closure; its actual end-to-end green remains pending coordinator-owned contained execution.
- Current serving candidate `f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560` / deployment `54e96e40-5fc2-428b-b96d-7453a5fa1810` remains unchanged. The rebound executor's scoped checks do not close the registry, which remains 5/21. Paused Supabase remains untouched and has no current source/environment dependency. This task performed no publication, CI invocation, deployment, restart, provider request/write, configuration, credential or infrastructure mutation.
- The existing protected trigger now truthfully admits one coordinator-owned, contained, non-deploy Node 22.23.2 rerun for the reviewed repair: native `cb9dd7b228e484c2bb47b9a98fb91a7c8afe260d`, tree `47a13e8b5aeb532946cf9a32926e3dde92ac12b5`, transported only as a descendant of remote parent `93513c250e3f0105a1fd019bf63a5a1674970b98`, with Pipeline 17's 142-total/140-pass/two-failure result retained. This trigger change is admission metadata only; no rerun or pass is claimed by this source task.

## Registered-worker tenant-environment execution boundary (2026-10-02)

- Source inspection retained the missing-boundary RED: the registered worker could claim `tenant-environment`, but no route could execute that claim. The only execution helper claimed as the unrelated `implementation-orchestrator`, while `/work/result` could assert `EFFECT_RECORDED` without running the provisioner. No Railway credential was read or moved into this workspace, and no live claim, effect, evidence submission, configuration change, provider request, deployment, CI invocation or publication occurred.
- The existing controller now exposes one bounded `POST /api/implementation/autonomous/work/execute` path for the already registered worker. It requires both existing credentials, the configured tenant/run/owner and exact candidate/deployment binding, an exact `tenant-environment` job and intent digest, and the current owner/fence/private lease token with a live lease. It executes only the existing synchronous tenant provisioner inside the controller's SQLite effect/receipt transaction. A matching READY environment is revalidated without changing its ID, namespace, digest, event history or scope.
- Tenant-environment `EFFECT_RECORDED` submissions through generic `/work/result` are now rejected, so a receipt cannot be manufactured without executing the supported effect boundary. Successful execution records `AWAITING_EVIDENCE`, returns `evidenceRequired:true`, and leaves readiness unsatisfied. Duplicate execution after completion is refused and cannot run the effect again.
- The retained route regression covers exact candidate/deployment binding, wrong owner, stale fence, wrong lease token, changed intent, expired lease, same-environment idempotency, duplicate refusal, and transaction rollback. A forced receipt failure after a changed configuration effect rolls back the environment mutation and preserves the original RUNNING lease; the subsequent valid request records exactly one new receipt.
- Strict tenant evidence remains separate and unchanged: PASS still requires `fixtureOnly:false`, explicit zero-human execution with zero interventions, cloud-runtime provisioning, exact environment/tenant/run/candidate/deployment identities, successful runtime health, tenant-isolation and durable-state verification, independent hosted-verifier provenance, and fresh post-deployment timestamps. The current signed manager fixture therefore cannot satisfy this contract, and this source repair does not claim a customer, passkey, hosted, provider or Golden Journey pass.
- Available Linux Node 22.22.2 focused execution passed 55/55 across active-controller integration, worker fencing/atomicity, tenant provisioner and strict evidence-contract tests. The complete available `implementation/runtime/*.test.cjs` collection then passed 125/125 with zero failures/skips. This is not the prescribed Node 22.23.2 contained Linux proof. The coordinator-reported live tuple/status and current remote proof-runner blobs remain external review inputs and are not re-claimed or overwritten here.

## Canonical transport and independent execution review (2026-10-03)

- Native owner delta c88a78d67b8848f446c9a4a03b3cb58bd639608f has parent b130f2619b81890dbebae395f4787bd1336eee46. Only its two code/test deltas and appended record were transported onto verified current canonical parent 74533ed802fa20ab35b811b316194a2614af009b; no native ancestry from 74533 is claimed. Current canonical record and all unrelated blobs are preserved. The native trailing blank removal was already present.
- Independent unchanged-74533 RED on official Windows Node 22.23.2 reproduced both failures: generic receipt returned200 instead of409 and missing execution route returned401 instead of409. Full TAP SHA256 aa82639027661f1840f4ebb9174539f8dfc3df9b5d20883b03f1c67373a4d97c is retained privately. The reviewed repair passed55/55 focused and145/145 complete implementation runtime tests, zero failures/skips; full TAP SHA256 d61972aeeeb6ffb0b09ed9909a852dd91d6716960820f3b7fe155109c34abe16 and1609c6414253aaa07707b9c9e234914cd67023651b60a565c422bd635f5f36e6. These are local tests, not hosted or prescribed Linux container proof.
- Source publication admits one existing, contained, non-deploy exact-CIRCLE_SHA1 build. No live work claim/effect/evidence PASS, provider mutation or customer-proof gate is asserted by this source change. Fresh candidate/deployment/executor/configuration binding and independent hosted proof remain mandatory.

## Personal workflow calendar consistency (2026-10-10)

- Current canonical source `f3f39845bcf06a15c198d05611da284df22fb462` reproduced seven leave-workflow failures and their failed parent on official Windows Node 22.23.2: 27 tests, 19 passed, eight failed, zero skipped. Personal evidence used the wall clock while the reviewed weekly workflow used the authoritative tenant calendar; the September fixture's upcoming shifts aged out in October.
- A new HTTP regression first failed because personal `serverTime` disagreed with `/api/tenant-calendar`. Runtime composition now uses the existing tenant calendar for personal snapshots and work commands. Authentication, session expiry, clock events, production clock-injection restrictions, sealed input validation and runtime source-identity enforcement are unchanged. The regression checks matching timestamps and future scheduled shifts; existing leave reservation, approval, audit and restart checks remain intact.
- The focused workflow, calendar and runtime-identity run passed 41/41, zero failures/skips. The unchanged broad Dockerfile test selection executed 1,211 tests on Windows: 1,186 passed, 25 failed, zero skipped. Twenty-one failures require Linux directory fsync and four require bash/PID UID validation. These failures remain recorded; no platform checks were removed or marked passed. Exact-source Linux container admission and hosted customer proof remain pending.
- Current Railway candidate build `9bd50cb6-1679-41f5-8ebb-3dc80d211fb2` previously built this parent successfully but refused startup with `WFM_RUNTIME_IDENTITY_SHA_MISMATCH`; the configured expected SHA was older `e8710a736622a2c231c462214e9c159fd82d8b01`. The mismatch must be repaired by binding configuration to the admitted source, not by relaxing the identity guard. This record does not claim a hosted, provider, registry or customer-proof pass.

## Remaining synthetic journey fixture drift (2026-10-10)

- Exact commit `87467421e8da5fba7096f20e46376acfff634051` passed all 163 full Staffology tests locally. Railway deployment `8f2b6c86-3a0d-41ba-839a-186127ac0ea3` then passed the complete broad Linux suite: 1,211 tests, zero failures/skips. Its later local-journey admission correctly failed when `api-journey-proof.mjs` selected a second future shift from the expired September fixture; no runtime was deployed.
- An explicit HTTP calendar assertion reproduced the remaining defect locally: the journey launched its synthetic server at October wall time. Its test-only child now uses the already reviewed September fixture calendar through the existing test clock contract and verifies the calendar timestamp, personal timestamp and at least four future shifts before exercising leave. All 14 API journey checks then passed, including saved approval, concurrent update conflict, tenant denial, audit and restart. Hosted clock-injection restrictions remain unchanged.
- Both standalone API/payroll harnesses use the operating system temporary directory, preserving isolated disposable databases on Linux and Windows. The complete local focused sequence executed 158 tests: 157 passed and one failed because this Windows account cannot create the provenance test's symlink. The symlink-rejection check remains intact and must pass in Linux; it is not waived. The next exact-source Linux build and hosted verification remain pending.
- The standalone synthetic payroll journey also passed all nine checks, including four-team sign-off, reconciliation, checksum-bound CSV, idempotent release, cross-tenant refusal and exact batch/CSV persistence after restart. Its manual handoff marker makes no external provider submission; provider acceptance is not claimed.

## Hosted restoration and authenticated HTML title (2026-10-10)

- Source `f277ab4a5490d058d572e62dadace7cdb2e962e5` completed every existing Linux Docker admission stage and deployed successfully as `7ff934a9-d0fa-4da5-9fca-397e4f51e426`, image digest `sha256:f191a762befec604b0c23a052dd17c5a7673c57add3a686fc3e6115855a442ba`. Broad tests passed 1,211/1,211 with zero skips; composed API/payroll checks passed 23 and attendance checks passed 11. Public HTTPS/source/asset checks passed 11, including unauthenticated denial on six protected APIs.
- The existing signed browser service verified employee, manager, payroll, admin and isolation contexts, followed by authenticated desktop/mobile role entry. Fresh registry status was 3/21, `operationalReady=false` and `wholeJourneyProven=false`, with stale evidence, incomplete workforce identity/training, provider and fixture/production boundaries still open. Autopilot startup reported `Agents_API_adapter_requires_OPENAI_API_KEY`; no account-credit exhaustion is inferred from a missing credential.
- The existing acquisition-only Staffology profile was still bound to older source `9a1439ee11680447923a6a1ead5976553c7cd69b`. Offline validation reproduced that refusal and admitted a one-field source binding repair, with the exact five-person cohort preserved, no payroll scope and zero provider requests. Reusing the admitted image as deployment `8d07b2da-468d-4c5e-9fa9-3014668a09ae` restored the configured operation; the existing signed browser service independently read back the exact source/deployment binding and dormant payroll. No provider acquisition or write was performed.
- Hosted browser proof exposed the inherited `Manufacturing Workforce · Interactive Design` HTML title despite the final JavaScript title sanitizer. Two new behavioral regressions failed before repair. The existing final sanitizer now normalizes the HTML entry title to the already approved `Vector · Workforce`; the independent gate rejects legacy, missing or multiple HTML titles. HTML outside that title, including environment disclosures, is preserved. All 17 affected sanitizer, admission, composition and asset-provenance tests passed. An isolated replay of the existing runtime-asset patch stage and repaired sanitizer admitted all 53 JavaScript files plus the actual HTML entry and proved idempotence. Exact successor Linux and hosted evidence remains required; earlier deployed proof is not claimed for these new bytes.

## Independent gross-pay decimal correction (2026-10-11)

- An independent integer/rational calculation reproduced a defect in the deployed parent's unchanged payroll modules: 30 observed synthetic minutes at GBP 8.03/hour produced 401 pence instead of 402, while the internal reconciliation (which reused the same price engine) returned true. The retained `verification/vector-repair-20260920/payroll-decimal-red.json` records the actual module hashes and five independently calculated examples. No hosted payroll or provider operation was used to reproduce it.
- The separately versioned money helper retains decimal operands as rational integers until each existing continuous pay-component rounding point. Both legacy and contract pricing now use exact gross/base/premium/oncost calculations; additive premium and allowance sums avoid intermediate binary rounding. The existing half-up rounding convention, segment boundaries, break classification, rates/contracts, approvals, export schema and stored batches are retained. This concerns gross-work components, not a tax/net-pay or legal-policy calculation.
- The canonical composer embeds the same helper into the shared browser/server cost module for both absent-directory and pre-extracted callers. It validates exact patch anchors and rejects duplicate application or source drift. Docker copies the helper and patcher into the existing composition stage and admits the new behavioral suite. The sealed archive is not rewritten.
- The calibrated original-code regression run had 12 tests: five passed and seven failed, including both pricing paths, browser/server, split breaks and a midnight rate change. The repaired run passed all 12; the money and existing packaging/admission checks passed 22/22 with zero skips. The independent matrix checks 108 rate/minute combinations through actual pricing. Fresh local full composition passed and its separately calculated five examples all matched.
- The existing isolated authenticated payroll journey passed all nine checks on the repaired composed runtime: four-team sign-off, reconciliation, checksum-bound 172-row CSV, idempotent release, cross-tenant refusal and unchanged batch/CSV after process restart. Its handoff marker submits nothing to a provider. These are local synthetic results; exact successor Linux admission and hosted evidence remain pending. Customer-readiness gates, customer policy/identity/training and provider acceptance are not inferred from this repair.

### Independent review follow-up

- Review found and reproduced two further edge cases before publication: long-decimal allowance sums lost precision when converted back to Number (417 instead of 416 pence), and using raw operand arrays as row keys split an equivalent continuous allowance into two rounding components (834 instead of 833 pence).
- Pricing now carries the original allowance and multiplier operands through rational aggregation. Display values stay numeric, temporary calculation operands are removed before export, and reduced rational aggregate identities preserve continuous components when operands differ but totals are exactly equal.
- Both defects have retained failing regression runs and permanent tests. Independent rereview reports no outstanding findings after 16/16 targeted tests and four additional factor-identity checks; the established money, packaging and Docker-admission selection passes 26/26 with no skips. The canonical composition contract's Linux-only PATH could not locate tar on Windows; that unchanged check is left for the required Linux admission, not waived or reported passing here.

## Authenticated browser startup calendar repair (2026-10-11)

- A stronger signed browser inspection of source `6bb16c8dee0f61c74471c66e0c1cc193549fb273` found that employee, manager, payroll and admin entry pages had an empty main root despite successful authentication and the correct title. Browser errors began with `Tenant calendar authority unavailable` and cascaded to missing WFM globals. The old title/role proof is explicitly insufficient to establish usable screens.
- Runtime composition made core/domain exports depend on `WFMTenantCalendarSnapshot`, but the browser fetched that snapshot only later from the Vector shell. A new real HTTP regression reproduced the absent blocking bootstrap (27 passed, one failed plus its parent, zero skips).
- Composition now serves a same-origin JavaScript calendar bootstrap behind the existing authenticated API actor guard and loads it before `core.js`. It uses the same tenant/person/site calendar resolution as the JSON endpoint, returns no-store/nosniff, and does not accept a client-selected tenant or relax CSP. The sealed archive and session checks remain unchanged.
- The real authenticated workflow suite passes 29/29, zero failures/skips. The new check verifies anonymous refusal, script ordering, tenant override refusal, agreement with the JSON calendar, and successful execution of the real browser core/engine/cost/work-rule modules. Independent review, exact Linux build and a fresh rendered-interface inspection remain required before claiming the hosted defect repaired.

### Hosted startup proof and authoritative heading follow-up

- Startup commit `f038a1e6abf34a687f2aa28addbc6cb9ea195279` passed independent review, the 1,214-test Linux suite with zero failures/skips, and existing Docker admission. Deployment `21139e75-82d7-4069-948f-639189534d13` serves image `sha256:dd6d20395e522c9a33aca0e082f7f866812425a84fbe7b843e6a61bf06bcaf1a`. All 15 public checks passed. Signed hosted browser inspection verified substantive employee, manager, payroll and admin screens plus isolation-manager entry with no fatal startup errors. Initial navigation snapshots could precede destination rendering and are not asserted as complete workflows.
- The same hosted inspection exposed a separate stale heading: the shared `heading()` template still printed 14 September 2026 while the authenticated tenant calendar reported 11 October. The customer-asset patch now derives this label from the authenticated snapshot's `asOf` and `timeZone`, escapes the result, and shows `DATE UNAVAILABLE` when authority is missing or invalid. It does not infer time from the browser clock or change historical record dates.
- Four new tests against the actual sealed app source failed before repair; all five asset-patch tests now pass. Coverage includes timezone date differences, DST, year boundaries, invalid authority, refreshed snapshots, idempotence and source-anchor drift. Independent review also passed retirement-to-patch-to-sanitizer compatibility, full app syntax, and duplicate/missing-anchor refusal without a partial write. The patch also applies successfully to the actual served parent app asset. The ordinary local composer does not run this customer-asset patch; the existing Docker stage does. Exact successor Linux admission and hosted date verification remain pending.
- These repairs do not supply customer identity, training, policy approvals, provider delivery or whole-journey readiness. Autopilot still requires a usable service credential. The newest source invalidates earlier source-bound identity/security evidence until measured again.

## Employee screen settling and role-aware Time Review (2026-10-11)

- Heading source `a9d3b4431233ca0a074282a75bfdb261f258bbb6` passed all 1,218 broad Linux tests, zero failures/skips, and deployed as `2f78e49d-a97c-4049-8c6e-6e35435ec536`. All 15 public checks passed. A longer authenticated navigation probe stalled on the employee home page; it is retained as incomplete, not counted as a hosted date or navigation pass.
- Actual shell regressions reproduced repeated identical employee-home DOM and document-title writes after asynchronous rendering reconnected the document observer. A per-host cache and conditional title assignment now let unchanged successful content settle while updating changed values and restoring replacement content.
- Independent review found a related outage loop: four observer passes made four personal-record requests and eight DOM writes. The error screen now remains stable with an explicit Try again button. Further delayed-response tests reproduced stale account/navigation/host results. Calendar and response completion now recheck current identity, role, route and host connection; obsolete current requests release their loading state and queue a refresh of the current screen.
- Payroll lacked manager Time Review access but still requested its evidence, and the bridge converted the source's permission denial into a server error. The shell now requests Time Review only when the source attendance route is available and discards results after permission changes. The bridge preserves source 401/403 without exposing the source response body; other upstream failures remain errors.
- The real HTTP workflow regression and earlier focused role suite passed 49/49. Independent review of the success-render addition passed 50/50. After outage and delayed-response additions, all 23 focused shell/bridge tests pass. Failing runs are retained. Final independent review, exact-source Linux admission and bounded hosted navigation/outage recovery proof are required for this successor; no complete customer journey or provider delivery is asserted.
- Final independent rereview found no actionable issue: 23/23 focused tests and five additional lifecycle checks passed, covering double retry, queued replacement-host recovery, overlapping account requests, navigation during calendar loading and role loss. The scoped repair is ready for publication; hosted observer and outage recovery remain to be measured.

## Authenticated browser identity and demand-cache isolation (2026-10-11)

- The prior settling repair `c79308ae57b8cd95b09eb39aa0c65b30de09f392` deployed as `446810d9-3cbb-4803-b917-eb34531f45b6`, image `sha256:bae463411a15e80e12bf8fcf8a0e75ff8bc951706e0a43dca4f425cb85a2c5ab`. All 1,224 broad Linux tests and 15 public checks passed. Hosted verifier `24235997-dbc4-4e7b-9644-ead5ba5b2345` measured 32 passing checks: five fixture role/tenant contexts, 19 real section destinations, authoritative rendered heading dates, browser responsiveness, and a browser-only personal-service outage that settled and recovered through Try again. Earlier probes with obsolete title/ambiguous locator expectations are retained as failed harness runs. No whole-customer-journey claim is made.
- That inspection also recorded an employee request to manager-only decision intelligence. Isolated execution reproduced a second issue: globally cached and delayed manager summaries could survive an in-memory account/tenant switch. New regressions initially passed one of six cases. The overlay now binds its cache, cooldown and pending requests to authenticated tenant/account/role, removes old cards on changes, rejects stale success/failure completions, and verifies the response tenant and contract. Employees and missing identities do not request the endpoint; authenticated payroll access is preserved under the existing server policy.
- Integration review and the real hosted actor diagnostic confirmed that `me()` is a display profile containing id/name/title/costs, while `F.actor` carries authenticated tenant/email/personId/role. Both the demand overlay and shared shell identity now use the ready authenticated actor; display name/site remain presentation fields. Sign-out clears identity. This also prevents repeated calendar invalidation and the false unverified-timezone label caused by comparing the server tenant with a missing display-profile tenant.
- The two real actor-shape regressions failed before correction. All 25 focused identity/shell/service tests and all 78 overlay tests now pass, including actual HTTP workflows. All three unchanged source-guard tests also pass after preserving their required source entry anchor. Docker admission includes the new demand-cache tests without removing or skipping existing checks. Fresh independent review and exact-source hosted proof are required for this successor; earlier scoped security evidence is not reused for the new source.
- Final independent review is clear: 78 checks across demand/shared-shell/provider/navigation, real HTTP workflows and source admission passed, plus four additional actual sealed-bootstrap/calendar checks. The scoped repair is ready to publish. Hosted evidence must be regenerated for the successor.

## Fresh personal records after workflow navigation (2026-10-11)

- Identity revision `fbdfd5913a1cd41e907a0dc32e3fd0363a8bc8e6` deployed as `499b0bdd-2044-4e12-a5d5-37da9a55e9fb`, image `sha256:3b6b2dec477794e93961ab4ef3a7092e3a2301d9f4c6a7fb88cf31af10434bf6`. The 1,234-test broad Linux suite and all 15 public checks passed. Hosted verifier `6749ae23-c6af-4c6d-a558-895107aa2fc9` passed 38 scoped checks, including current employee timezone, zero employee intelligence requests, successful permitted role requests, 19 destinations, dates and outage recovery. The fresh readiness snapshot remained 3/21 with operationalReady and wholeJourneyProven false.
- A separate regression showed that returning home through the authoritative render path retained the old ready personal record indefinitely: a changed leave balance remained 10 h instead of the new 9 h. The wrapped application render now invalidates the employee-home record and increments its request epoch before the underlying render. MutationObserver-only passes still reuse stable content. An older pending response cannot overwrite the fresh result.
- The new balance test first failed (13/14 passed). All 18 final shell/source-guard tests pass, with independent review additionally verifying wrapper this/arguments/result, invalidation before the underlying await, stale failure fencing and quiet repeated success/error observer passes. No actionable findings remain. Hosted return-to-home freshness is pending on this successor; the planned check intercepts responses only in its isolated browser and does not modify any saved balance.
