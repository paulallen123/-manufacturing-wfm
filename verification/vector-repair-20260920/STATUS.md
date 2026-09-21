# Confidential Vector repair evidence — 20 September 2026

Historical snapshot. Current access, hosted action evidence and the shared priority list are recorded in [21 September evidence](../vector-live-20260921/EVIDENCE.md). Ordinary app access has since been restored; the staging recovery feature was not activated.

## Status and source boundaries

BUILT and locally checked; deployed end-to-end proof remains BLOCKED. All test records are synthetic. No live customer outcomes or savings are claimed.

Inspected candidate: `6667f4217e0c0a8a90cab8d4c7d79f8efd628662` in private `paulallen123/-manufacturing-wfm`.
Sealed runtime artifact SHA256: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`.
Canonical Railway service: `wfm-one-day-enterprise-v1`, deployment `a2b4a0ca-83d3-4285-b16f-f8d0f9dbb97c`, source `338e07b24d3096d30dcc97fe14c33a03261b7e86` at inspection. The locally repaired candidate is not that deployment. Served asset equality and deployed saved-action proof have not been established.

## Reproduced problem and additive repair

Retiring review-ui.js removed the owner of RF, weekly-review actions and payroll handlers while surviving Time Review and payroll consumers still called them. The new Vector-owned workflow module reconnects these consumers to existing authenticated commands and reports. The retired interface is not restored, and the sealed engine artifact is unchanged. Composition and canonical routing explicitly package and serve the new module.

Independent review caught a missing static route and missing recovery-module Docker COPY before deployment. It also found async account-switch receipt risks and preservation requirements for breaks and unsaved Time Review edits. The accompanying workflow tests and source changes cover the bounded repair; browser rendering and every workflow remain subject to deployed checks.

A separate disabled-by-default recovery module changes only the existing synthetic owner account password through a short-lived, single-use, hash-configured grant. It preserves tenant/role identity and security freeze/epoch/policy controls, revokes only the target account sessions and transactionally audits consumption. It issues no session. No grant was provisioned, no password was changed and recovery has not been deployed. See security/runtime/OWNER_ACCESS_RECOVERY.md.

## Local evidence

- api-journey-results.json: 13 authenticated API/SQLite checks: leave creation, balance reservation, overlap/duplicate refusal, manager decision, tenant/role refusal, concurrency, new login, payroll holds, persisted restart and audit.
- payroll-journey-results.json: 9 checks: seven fixture exceptions resolved, four teams signed after employee/category verification, reconciled preparation, 172-row CSV release and checksum, duplicate batch reuse, cross-tenant export refusal, manual handoff record, refusal to void a sent batch, unchanged saved batch/CSV after new login and local restart. No provider submission occurred.
- security/runtime/*.test.cjs: 20 passing tests, including grant replay, independent-worker race, targeted revocation, security context refusal and full rollback on audit failure.
- ux-overlay/vector-workflows.test.cjs: 12/12 passing controller-to-real-API and packaging checks; see workflows-independent.tap. VM controller tests are not browser tests.

Local runtime is Node v24.19.0. The Dockerfile pins Node22.23.2 and the sealed package requires Node22; a full exact-runtime Docker build has not run here. Local restart retains a deliberately reused SQLite path. This does not prove Railway storage durability.

## Hosted evidence and access limitations

GitHub repository and Railway metadata access work. The available Railway OAuth connection redacts variable values and exposes no container shell or database backup/download operation. Browser owner access is still at GitHub sign-in for Railway. One app login attempt returned Incorrect email or password; it was not retried. Old staging-access grants are expired and were not revived.

The existing private browser runner evidence still has zero action journeys, unexercised affordances and unbound asset digests. A bounded attempt to run an authenticated read-only API diagnostic on that existing private proof service failed before execution: deployment `06152c7f-66e8-4743-b02a-ced7efac3241` FAILED, one builder-scheduling log and no runtime logs. Its temporary start-command override was cleared and configuration re-read. Product configuration, security holds and product deployment were unchanged. No additional service or paid capacity was added.

Railway configuration shows no mounted volume for the canonical SQLite service. Actual WFM_DB location, a recoverable backup and durable restart cannot be established with the current connection. Do not restart or redeploy the product until its state can be preserved. Railway agent fallback reports its usage limit reached; no limit was increased.

## Shared next priorities

1. Complete owner Railway browser sign-in or obtain an existing authorized shell/backup channel. Verify actual database location and preserve state; retrieve tenant epoch/policy through authorized read-only access.
2. Complete exact Node22/container admission, retain deployment holds, then deploy the specifically reviewed repair under existing release controls.
3. Restore owner app access via ordinary recovery/manual password entry; verify the first saved new-Vector action against exact asset digests and deployment SHA.
4. Exercise complete leave, attendance/sign-off, scheduling/availability/qualifications, payroll, agency/production/cost, permissions/tenant/mobile journeys, including duplicate/conflict/interruption and durable restart checks. Fix reproduced remaining defects.
5. Record the real three-minute product demonstration and individual saved-action recordings only after those deployed checks pass. No recordings or substitute animations were produced.

## Frontier repair kept separate

Current cleanroom PR216 candidate `b5d387153d102023e1d358726475e143dba30ed8` was independently reproduced and repaired on private branch `repair/cleanroom-fail-closed-20260920`, commit `8f721b577e78e6f35a7a31e5d8f47ca9c90fa309`.
Duplicate identifiers, contradictory/duplicate transition rules, delimiter collisions and omitted unapproved exits now fail closed or remain visible for review. 41/41 local tests pass; 26 new regressions fail original code. Existing 2,000-plan and 5,000-history simulation outputs remain unchanged. This is local advisory-engine evidence, not certified cleanroom safety or deployed integration proof.

## Repeat locally

From a checkout root:

```sh
node scripts/compose-vector-local-runtime.mjs /absolute/new/vector-proof
node --test security/runtime/*.test.cjs ux-overlay/vector-workflows.test.cjs
WFM_LOCAL_RUNTIME=/absolute/new/vector-proof node verification/vector-repair-20260920/api-journey-proof.mjs
WFM_LOCAL_RUNTIME=/absolute/new/vector-proof node verification/vector-repair-20260920/payroll-journey-proof.mjs
```

These commands use isolated synthetic databases. The composer refuses an existing output directory and verifies the sealed artifact digest. Its local path adapter is only a test harness; Docker build admission and hosted checks remain separate.
