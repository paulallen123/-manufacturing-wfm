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
