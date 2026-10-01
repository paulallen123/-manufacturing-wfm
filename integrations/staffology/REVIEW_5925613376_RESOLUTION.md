# Independent retest 5925613376 — canonical offline resolution

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

## Independent coordination update — published head 96b64d5 (2026-10-01)

- Coordination reports current PR #289 head
  `96b64d5b3d19c87163ffc274ee12749c3d19cf61` on
  `review/staffology-customer-proof-20261001`, with canonical base
  `dedf7b307464c513f418bb7c95f37e53660b56a1`.
- Coordination reports that the published successor already contains the
  tenant-qualified revocation repair, dual-caller composer and
  `RAILWAY_GIT_COMMIT_SHA` correction. At the time of that coordination update,
  those published objects were not present in this isolated checkout; the
  subsequently verified read-only handoff is recorded below and is not
  re-published or reconstructed by this branch.
- The reported canonical CI uses `commands.require_frozen_candidate`, jobs
  `forge_core_validation` and `forge_runtime_validation`, and workflow
  `vector_forge_proof`. The protected trigger
  `artifact/vector-proof-freeze.trigger`, root image entrypoint and non-root app
  UID check must remain intact. The local wrapper CI/Docker/composer edits from
  `cb660b0` were withdrawn rather than presented as canonical reconciliation.
- Browser/API access available at the time of that coordination update returned
  authorization/HTTP 403 failures, so comments 5926962136, 5926981576,
  5927871931, 5927871697 and the compatible original-eight attachment from
  5926247499 were not independently retrieved. The older locally named R01–R08
  suite is not claimed to be that compatible suite.
- `canonical-employee-persistence.test.cjs` is an independent module-boundary
  proof: it runs the sealed integration gateway and onboarding engine, applies
  the exact reviewed cohort, closes/reopens SQLite and verifies durable
  readback. It does **not** start/stop `server.cjs`, exercise HTTP/UI, execute
  `scripts/run-local-vector-proof.mjs`, or prove a canonical container image.
- Independent UI inspection confirms that the module test manually performs
  the tenant-state update that the application route would normally own, and
  its reopened onboarding people remain in `staged` state. It therefore does
  not prove the mandatory app HTTP onboarding application, application-process
  stop/start/reopen, rendered customer journey, or image execution gates; all
  remain unpassed.
- `evidence/review-revocation-red.tap` and
  `evidence/canonical-caller-absent-directory-red.log` are restored byte-for-byte
  from local wrapper commit `cb660b07`. They remain historical reproductions
  specific to that local wrapper/source and are not evidence about published
  canonical head `96b64d5...`. The earlier green TAP is unchanged; the new local
  result is separately named and qualified by source/runtime.
- Coordination browser inspection established the remote identities above, but
  exact archive download and `downloadMedia` timed out. This is an
  environment-side source-transfer limitation, not missing user-upload work;
  blocked network routes must not be retried repeatedly.
- The smallest unblock is a read-only mount/fetch of exact head `96b64d5...`
  including its Git ancestry and Node 22.23.2 build admission, followed by the
  existing non-deploying `vector_forge_proof` owner/controller path without
  changing or bypassing the protected trigger. No deployment or provider
  credential is required for that intervention.

## Verified canonical-source handoff and application journey — 2026-10-01

- The new carrier was checked before use. Its decoded RGB payload has the
  `STAFPKG1` header, length 4,747,856, and the embedded and computed ZIP SHA-256
  `32aea01b8038453633c583c507d7a9d5b5e4d3a95b404d0a6a46fded69a17818`.
  The filesystem PNG SHA-256 is `47c1dc0e...`, not the supplied original-PNG
  SHA-256 `1ae027ff...`; consequently only the decoded payload, not PNG byte
  identity, is verified. Safe-path, duplicate, symlink, per-entry/total-size,
  CRC and `SOURCE_MANIFEST` checks passed for 1,080 ZIP entries and all 1,061
  source files (785 unique Git blobs).
- The handoff identifies source `96b64d5b3d19c87163ffc274ee12749c3d19cf61`,
  actual root tree `9a76ec10418e26543a5c832032222ec130a103ef`, and
  base/merge-base `dedf7b307464c513f418bb7c95f37e53660b56a1`. It is a
  verified source snapshot plus remote receipts, not a native Git bundle; no
  ancestry is invented for this checkout.
- On available Node 22.22.2, the verbatim compatible eight assertions plus
  positive dispatch control passed 9/9, the seven published Staffology suites
  passed 104/104, canonical assembly passed, and `run-forge-ci.mjs` passed.
  Source/runtime-qualified raw outputs and exact command receipts are retained
  in `evidence/*source-96b64d5-node22.22.2*`. These are **TESTED** results on
  Node 22.22.2, not proof of the prescribed Node 22.23.2 image.
- The dual composer caller contract passed its pre-extracted caller but failed
  its absent-directory caller because this environment lacks the required
  `security/runtime/node_modules/@simplewebauthn/server/package.json`
  dependency closure. The 1/2 raw TAP is retained and is not reported as a
  pass.
- A retained real-server red reproduction proves that
  `/api/integrations/apply` returns an applied gateway while its people outcome
  and onboarding batch remain `staged`; application is not inferred from that
  response. The added source-parametric application test then uses the existing
  `onboarding-review` command, stops the canonical server, starts a fresh
  canonical server process over the same disposable SQLite file, logs in with
  a distinct independent client, and verifies the exact two-person cohort,
  payroll IDs, reviewed status, integration applied references and the three
  durable audit actions. Its green TAP is separate from every earlier green
  artifact. This is **PROVEN only for the disposable canonical HTTP process and
  SQLite journey**, not rendered UI or image execution.
- No deployment hook, protected trigger, provider endpoint, credential, hosted
  tenant or frozen run was touched. `northstar-demo` and run
  `09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e` remain frozen.
- The supported image gate is still **BLOCKED/NOT RUN**: there is no local
  Docker/Podman/Buildah, no controller admission in this task, and the mounted
  handoff is not a native Git checkout eligible for `require_frozen_candidate`.
  The smallest intervention is an environment-side native fetch/mount of the
  verified source and ancestry, Node 22.23.2 dependency closure, and admission
  of that exact SHA to the existing non-deploying `vector_forge_proof` owner
  path while preserving `require_frozen_candidate` and
  `artifact/vector-proof-freeze.trigger`. Execution is stopped at that external
  gate; no hosted approval request is prepared.

## Current PR head `de32f6d` reconciliation — 2026-10-01

- The delta carrier decoded as `STAFPKG1`, length 153,078, with matching
  embedded/computed ZIP SHA-256
  `59b579c508235bd942785cea215872e04773431cc70376e11c9d5ac7bb6f9489`.
  Its five paths passed duplicate, absolute/traversal, backslash, NUL, symlink,
  size and CRC checks. Overlaying its exact `Dockerfile` and
  `staffology-employee-persistence.test.cjs` onto the immutable prior snapshot
  verified all 1,062 files against `DE32_SOURCE_MANIFEST.json` (786 unique
  blobs). The resulting identity is source
  `de32f6d663a530ddccffc6e8d1d0e641e68e039a`, root tree
  `19003afa7798e993c27668a0202a338d920cd883`, base/merge-base receipt
  `dedf7b307464c513f418bb7c95f37e53660b56a1`. This remains snapshot/remote
  receipt evidence, not invented native ancestry.
- The exact published Docker pre-extraction command was reproduced unchanged:
  104 tests passed, then the new persistence test failed loading absent
  repository path `lib/integration-gateway.cjs` (105 total, exit 1). The raw
  `MODULE_NOT_FOUND` TAP is retained before the repair.
- The Docker admission is now based on the exact `de32f6d` Dockerfile and
  composes the full absent-directory runtime before the Staffology wildcard.
  It supplies both `WFM_RUNTIME` and `CANONICAL_SOURCE_DIR`; the persistence
  test fails explicitly with `WFM_RUNTIME_REQUIRED` rather than silently using
  the repository, and the HTTP journey fails explicitly without its verified
  source. No test deletion, substitute runtime, frozen-candidate change or
  trigger bypass is used.
- A second retained red HTTP reproduction confirms that review alone creates
  zero canonical staff records (`staffId` remains null). The repaired journey
  now starts with synthetic Staffology `acquireEmployees`, passes those records
  through `peopleEnvelope` with exact reviewed mappings, retains an out-of-set
  mapping rejection, and only then uses native HTTP ingestion. It completes
  the established invitation/token acceptance identity boundary, authenticated
  work configuration with reviewed CNC evidence, effective payroll-rate import
  and readiness application. After process stop/reopen, an independent session
  verifies the exact two canonical staff links, payroll IDs, readiness state,
  gateway references and durable audit counts. No SQL update, `markVerified`
  call, manual state flag or provider request is used by this HTTP journey.
- On available Node 22.22.2, the exact original eight plus positive control pass
  9/9; the current published suites pass 105/105 when explicitly bound to the
  extracted sealed runtime; the source-parametric native HTTP journey passes
  1/1; the repaired review delta passes 106/106 with both explicit source and
  runtime; canonical assembly and Forge core validation pass. The older module test
  remains only a module/store contract because it manually owns its transaction;
  it is not substituted for the HTTP evidence.
- The supported lockfile install was attempted exactly with
  `npm ci --prefix security/runtime --omit=dev --ignore-scripts --no-audit
  --no-fund`, but registry access made no progress and the bounded attempt was
  terminated. `@simplewebauthn/server` remains absent. Consequently the
  absent-directory composer contract remains **BLOCKED** (1 pass/1 fail), the
  complete bootstrap/provenance application journey has not run here, and the
  Docker image gate remains **BLOCKED/NOT RUN**. The green HTTP evidence is
  explicitly limited to the sealed-server/pre-extracted composer scope.
- The smallest remaining intervention is execution of this exact delta in the
  existing non-deploy `vector_forge_proof` admission with its lockfile
  dependency cache/registry, native source ancestry, prescribed Node 22.23.2
  image and `RAILWAY_GIT_COMMIT_SHA` bound to the admitted source SHA. The
  controller must retain `require_frozen_candidate` and the unchanged protected
  trigger. No deployment, provider, credential or frozen-tenant action is part
  of that intervention. Execution is stopped at these inaccessible external
  dependencies; no hosted approval request is prepared.
