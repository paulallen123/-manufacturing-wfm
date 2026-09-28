# VECTOR execution checkpoint — 20 September 2026

Status: **BUILT**. The combined repair passes local exact-runtime checks. The approved real environment has not yet passed a repaired browser action journey.

21 September provenance closure: independent attack testing found that the original verifier accepted an unlisted nested `package.json` that changed Node module semantics without changing the listed-file digest. The verifier now requires the actual regular-file set to equal the manifest, rejects duplicate/non-normalized paths and refuses symlinks or special entries. On exact Node v22.23.2, 50 focused tests and 22 synthetic engine checks passed; an independent verifier rejected the original attack and passed 14 held-out attacks, with zero skips. Evidence: `provenance-closure-20260921.json`. This repairs static local file-set/contents closure only; it does not establish Docker/deployed identity, immutable execution, Railway durability, restore, or browser proof.

Execution window: 20 September 2026 23:30 UTC to 21 September 2026 23:30 UTC. This is the user's target, not a completion guarantee or a claim of uninterrupted background execution.

## Ownership and source

Repository: `paulallen123/-manufacturing-wfm` (private).

- Common candidate: `6667f4217e0c0a8a90cab8d4c7d79f8efd628662`.
- Workflow/access repair: `1aad642a4ec4bbbcb40e933ab2bcae750be50e85`.
- Dashboard/proof truth repair, PR219: `57d5dbe3cc2d3792a330af7541b8f713eb28397b`.
- Integrated candidate: branch `repair/vector-integrated-engine-proof-20260920`. Its Git history preserves both parents. The immutable commit is the one containing this checkpoint; use its SHA when binding a release.
- Foreground owner: current execution session, integrating and verifying the two existing repairs. Source integration and deployment diagnosis were delegated independently; editing ownership has returned to this session.
- Preserve all unrelated source from the full first-parent tree. The 58-file local manifest is a materialized subset, not permission to replace the repository.

The retired review interface formerly supplied handlers still called by Time Review/payroll. Existing repair code reconnects those handlers to authenticated business APIs. PR219 corrects dashboard values and prevents a proof wrapper reporting success when its runner fails. This candidate combines them and fixes stale test provenance. It retains the new Vector interface and sealed real engine.

## Repeatable evidence

Run from a full checkout, using Node **v22.23.2**:

```sh
node scripts/run-local-vector-proof.mjs /tmp/vector-evidence-run-001
```

Choose an unused output directory. This command assembles the sealed engine with current overlays, hashes all 150 runtime files, runs focused tests, creates isolated synthetic SQLite stores, exercises authenticated APIs and saves logs/results. It does not access a deployment, send payroll to a provider, or change real accounts. Runtime composition is not the full Docker admission build.

Current evidence: `verification/vector-integration-20260920/repeatability-run/`.

- **41/41 focused tests passed**, zero failures or skips: security/recovery, workflow controllers, dashboard/proof regressions and tamper rejection for evidence provenance.
- **13/13 employee/manager API checks passed**: populated leave request, entitlement reservation, duplicate/stale/concurrent edits, self-approval refusal, tenant isolation, actual manager approval (HTTP 200), fresh login, controlled restart, persisted audit and payroll holds.
- **9/9 payroll API checks passed**: seven fictional attendance exceptions resolved, four teams signed, reconciliation, checksum-bound 172-row CSV, idempotent release, tenant refusal, manual handoff marker, forbidden void after handoff, saved batch/CSV after restart. No provider submission occurred.
- The 22 engine checks passed once independently and again via the single reproduction command against newly composed runtime and fresh databases.
- `candidate-source-manifest.json` identifies the final local source inputs. `initial-source-integration.json` records the earlier, unmodified two-parent assembly and its 39-test run; it must not be mistaken for final provenance.
- Runtime digest: `b52730837a6cef2da0f63d95ca2e4cfde882aa37f0de1eb6ba532036bd9c9369`.
- Composed UI JS SHA256: `5ef5a7516003c8cbcfdb00279d128097b0654c06a14ca7d36c36be71af48c040`.
- Composed UI CSS SHA256: `bfe09dfc63a219fa997d7a9671c117e763d05d9f196fceb4ee3ff5ed1cfa976d`.
- Workflow JS SHA256: `3c176dcb56f283b7ed8422c08937bdbcf09dc96ec36c4a3d5ecb67c80188a38a`.

These asset hashes describe local composition. Compare them with actual container/served bytes before configuring strict hosted proof. Do not assume Docker composition yields identical bytes without checking.

## Deployed state and release dependency

Canonical product: `https://wfm-one-day-enterprise-v1-production.up.railway.app`.

- Railway project: `9cd73309-0ece-4b9a-891f-7daa13d94f0d`.
- Environment: `9e7875b6-e214-4c32-9cee-81235e3d49ff`.
- Product service: `8cadddc3-15e9-4c38-a93f-0af829054f29`.
- Observed SUCCESS deployment: `a2b4a0ca-83d3-4285-b16f-f8d0f9dbb97c`; release source `338e07b24d3096d30dcc97fe14c33a03261b7e86`. Served frontend/backend byte binding is not yet established.
- The live page loads its sign-in form. No authenticated product/browser session is available to this execution session.
- Railway reports no volume or bucket, while deployed code uses local SQLite through `WFM_DB`. Current database path, coherent external backup and restore remain unverified.
- **BLOCKED: safe live promotion.** Obtain an authorised owner/runtime session; take a coherent online SQLite backup from the currently running product, preserve it outside the ephemeral container, verify an independent restore and current schema/identity/state, then establish persistent storage before replacing/restarting the product. Copying a live database file alone is insufficient when WAL is active.
- Available Railway tools have no shell/container-file-download/full-database-snapshot operation. Scoped app exports are not full backups. Redacted variable values and an exhausted agent route were not repeatedly retried.
- Do not remove security holds, reset the database, switch to a retired service, deploy an unauthenticated shell or synthesize a privileged session to work around this dependency.
- Owner access recovery is implemented but disabled by default, and has not been provisioned or deployed. Use legitimate owner recovery; its presence is not proof that product access has been restored.

The new repair branch and draft PR have no observed automatic canonical-deployment path. Two existing PR gates should run: `sanitize-sealed-runtime.yml` and `vector-only-ui-guard.yml`. Merging into the candidate branch matches deployment workflows, so keep the PR unmerged until preservation and release evidence are established. Full Docker admission has not been run in this workspace.

Browser recorder remains a separate service: `bf962aba-0c56-4620-b81e-44d43c9a1456`. Its latest failed deployment exposed scheduling-only logs; root cause is unknown. Earlier runner success reported zero exercised action journeys and unbound assets. Do not relabel those reports or unrelated local videos as deployed proof.

## Shared task register and six existing workstreams

The execution brief was appended successfully to all six existing enabled workstreams; original scope, requirements and schedules were preserved. No duplicate automation was created. This does not change their configured model. Enabled flags and recent run records exist; the tool did not supply a next-run timestamp, so uninterrupted execution is not claimed.

| Workstream / existing task | Current owner scope | Next executable result | Acceptance evidence |
|---|---|---|---|
| Orchestrator — `6aabbaef5f6c8191a2ef2e3d6436fdd8` | Shared register, release ownership, dependency order, deduplication | Reuse this candidate/checkpoint; assign one editor per shared area; release only after preservation | Commit, deployment, ownership and concise evidence links agree |
| Product — `6aa93ea528c88191b82973ecb557189b` | New Vector interface and customer journeys | Exercise employee leave → balance/overlaps → manager decision in the browser, then attendance, schedule, weekly approval and payroll | Populated UI before/after, authenticated API result, audit, refresh/login/restart; source/served binding |
| Trust, Proof & Release — `6aab0609c2d08191a17cecf6de5e323f` | Security, database durability, admission, independent proof | Preserve current DB, verify restore and Docker admission; repair separate recorder; capture scoped repeatable proof | Role/tenant/concurrency controls, durable deployment/restart, video/trace/screenshots/errors and state assertions |
| Implementation & Support — `6aad52d7d5808191b562e965b50ea925` | One-day provisioning/import/training; autonomous support | Continue existing engine; turn each remaining manual dependency into a bounded elimination task | Sign-up to trained go-live, reconciled import, injected fault → detection → isolated repair → verified recovery |
| Integration & Data Fabric — `6aadb48162b88191b702074fb100ee79` | Existing connector/data contracts; Factory Graph foundations | Reuse adapters; choose the next actual provider test with available authority and data | Discovery, mappings, identity, provenance, dedup/replay, renewal/recovery, reconciled provider evidence |
| Frontier — `6aac6504804081918fba07d4e07d6612` | Cross-domain experiments and future ideas | Retain independent bounded experiments without taking shared release/UI ownership | Measured result against a strong simple baseline, permissions/safety preserved |

## Full ambition retained

The following is a requirements index, not a claim that all listed capabilities are implemented. Keep existing finer-grained records and completion evidence; do not overwrite them with this coarse index. The full accepted brief is copied unchanged into `EXECUTION_BRIEF.md`.

| Area / customer benefit | Retained requirements and ideas | Dependency | Required proof |
|---|---|---|---|
| Product / reliable daily work | Self-service, leave/balances/overlaps, attendance corrections, shifts/swaps/breaks/absence/overtime/premiums, skills expiry, fatigue/rest, production staffing, weekly approval, payroll, mobile/desktop | Bound UI/API/identity/SQLite path; policy and financial contracts | Completed role-specific journeys and independently expected calculations |
| Implementation / one-day go-live | Signup, isolated cloud provisioning, discovery, bulk import/configuration/reconciliation, customer training; zero-human implementation | Identity/provisioning, connectors, lawful authority, durable configuration | Complete Golden Customer Journey; every remaining manual step measured |
| Integration / fewer manual transfers | NetSuite, SAP, ERP/HCM/payroll, MES, maintenance, access control, files, MuleSoft; reusable discovery/mappings/identity/provenance/replay/dedup/token renewal/recovery | Provider authority, test data and shared semantic contracts | Separate simulated, hosted synthetic, actual-provider and real-customer outcomes |
| Manufacturing intelligence / grounded decisions | Employee/line twins, permissioned Factory Graph and source history, orders/assets/maintenance/materials/skills/cost, document/CAD/BOM/revisions, semantic search and grounded actions | Proven source identity and tenant-scoped graph/data access | Source-linked answers, permitted actions, revision correctness and measured retrieval quality |
| Workforce economics / reconciled value | Agency demand/suppliers/rates/compliance/assignment/invoices, energy-aware staffing/production, cost-to-serve/good unit/capacity/maintenance, operational/finance dashboards | Accurate pay/time/production/energy/supplier data | Independent reconciliation; forecasts, avoided costs, released capacity and booked savings separated; no double-counting |
| Clocking / zero new hardware | Invisible/self-clocking from lawful existing signals, privacy and correction, offline/duplicate/missing/ambiguous events | Signal coverage and authority, identities, deterministic event controls | Coverage/latency/error/recovery measurements; inferred presence distinct from confirmed work |
| Support and security / zero human support | Prevention/detection/diagnosis, isolated repair verification/promotion/rollback, compound faults, permissions/supply chain/audit/backups/recovery | Durable state and constrained tool authority | Injected failures, measured detection/repair, recurrence, recovery integrity and manual dependency count |
| Frontier and learning / better manufacturing outcomes | Cleanroom/intervention orchestration; people/production/maintenance/agency/energy/quality/cost; adaptive learning; authoritative qualification/occupancy/break/safety rules | Current candidate contracts and representative fixtures | Strong baseline comparison; recheck previously reported duplicate IDs/transition contradictions only on relevant source |
| Global scale / same product across customers | One employee/one site through 10,000+ employees and 50+ global sites; geography/time zones/localisation/manufacturing variation | Tenancy, capacity, data/financial semantics | Representative scale, concurrent edits, geography/time boundaries, restore and customer isolation |
| Commercial proof / credible differentiation | Reuse CADDi/WFM/operations/maintenance competitor and RFP research; polished three-minute demo and major-function videos | Working product, lawful evidence, targeted primary-source refresh only when needed | Measured comparisons; actual new Vector recording; no unsupported superiority claims |

## Next safe actions

1. Review draft integration and attached exact-runtime results; inspect the two existing PR gates. Do not rebuild either completed sibling repair.
2. Complete secure owner sign-in to reach the existing Railway/runtime preservation route. Current dependency is account/runtime access, not permission for routine implementation.
3. Preserve and restore-verify the running database; establish durable storage; then promote the reviewed exact candidate through required gates.
4. Bind the served UI and backend to the deployed candidate. Use populated authorised synthetic accounts and record the complete employee-manager journey, followed by attendance, schedule/weekly review/payroll.
5. Continue independent implementation, integration and Frontier tasks under their existing owners. Record exact scoped statuses: PROVEN, BUILT, DESIGNED, RESEARCHED or BLOCKED. Use PROVEN only for the approved real environment.

Usage: two bounded independent delegates; reused existing repairs, workstreams and infrastructure. No new paid service or duplicated automation. Token/cost totals are not exposed; savings are not estimated. No live deployment, restart, credential change or external payroll/provider submission has occurred during this integration.


## Trust and release delta — 27 September 2026

- **BLOCKED — payroll command replay safety.** On sealed artifact SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`, an exact retry of one post-release adjustment proposal with the same idempotency key created `PADJ-2` after `PADJ-1`; both were independently approvable and one export contained two rows. Regression: 0/1 passed, 1/1 failed, 0 skipped. Evidence: `tests/payroll-command-idempotency.adversarial.test.cjs` and `evidence/payroll-command-idempotency-20260927.json`.
- Root cause: the generic `/api/command` path does not persist and replay consequential payroll commands by tenant, actor, key and canonical command/payload digest. Required next action is a transactional idempotency receipt, different-payload rejection, and proposal/approval/export retry proof under concurrency and restart.
- **BLOCKED — release admission.** Exact-head GitHub run 36291526749 recorded runner ID 0 and zero steps, so it is infrastructure non-execution rather than a product result. Same-build hosted browser, durable restart/recovery, customer release and the three-minute marketing video remain BLOCKED.

- **BLOCKED — post-approval payroll-state substitution.** On sealed artifact SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`, an adjustment approved at 900 GBP minor units was changed in persisted state to 123456 without changing the tenant version. VECTOR restarted healthy and exported the substituted value with HTTP 200 without reapproval. Regression: 0/1 passed, 1/1 failed, 0 skipped. Evidence: `tests/payroll-approved-state-substitution.adversarial.test.cjs` and `evidence/payroll-approved-state-substitution-20260927.json`.
- Required next action: bind approval to exact inputs, source fingerprints, calculated amount, currency provenance and reviewer identity; verify the seal plus deterministic recalculation before readiness/export/download; fail closed and reconcile on mismatch.

- **BUILT — immediate local payroll permission revocation.** On exact sealed artifact SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`, the same authenticated payroll cookie succeeded before revocation, received 403 for dashboard and adjustment proposal immediately after permissions were removed, and remained denied after controlled restart. Persisted permissions were empty and the administration action was audited. Proof: 1/1 passed, 0 failed, 0 skipped. Boundary is local synthetic only; SSO/federation, token revocation, multi-region propagation and hosted enforcement remain BLOCKED. Evidence: `tests/payroll-permission-revocation.proof.test.cjs` and `evidence/payroll-permission-revocation-20260927.json`.


- **BLOCKED — in-flight payroll authority revocation.** On exact sealed artifact SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`, a payroll request completed initial authentication and was then held at a partial JSON body. An authenticated administrator removed all permissions before the body was released. The held request still returned HTTP 200 and persisted `PADJ-1` for 900 GBP minor units. Fail-first regression: 0/1 passed, 1/1 failed, 0 skipped. Evidence: `tests/payroll-inflight-permission-revocation.adversarial.test.cjs` and `evidence/payroll-inflight-permission-revocation-20260927.json`.
- Root cause: `server.cjs` snapshots the actor and permissions before awaiting the request body; the consequential mutation later authorizes against that stale object without a live user/session recheck. Required next action is an authority recheck inside the protected mutation boundary, zero state/audit/lineage mutation on rejection, and concurrent/restart proof on a newly sealed artifact.


- **BUILT — token-specific local payroll logout revocation.** On exact sealed artifact SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`, two independent payroll sessions both accessed the dashboard. Logging out the first deleted only its hashed token row; that bearer immediately received 401 and remained denied after controlled restart, while the second session continued to return 200. Proof: 1/1 passed, 0 failed, 0 skipped. Evidence: `tests/payroll-session-token-revocation.proof.test.cjs` and `evidence/payroll-session-token-revocation-20260927.json`.
- Boundary: this is local self-service revocation of one presented bearer only. Administrator/IdP account-wide revocation, password-reset invalidation, external IAM/SSO propagation, multi-region consistency, the separately reproduced in-flight mutation race and hosted enforcement remain BLOCKED.


## 2026-09-27 — all-team weekly sign-off to payroll-release browser slice

- **Objective:** prevent one signed team from standing in for company payroll readiness; carry the approved Vector UI through every returned weekly team and one immutable payroll release.
- **Acceptance:** every expected team has request/signature/audit revision equality and refreshed signed state; payroll release returns one persisted/audited batch; exported bytes match the server SHA-256 header; refresh and fresh payroll login return the same batch.
- **Implementation:** `scripts/current-candidate-role-browser-proof.mjs` now completes every returned team through visible issue/category/employee/sign actions, proves the release remains disabled after the first team, then releases through the payroll UI and reads back CSV, audit, refresh and fresh login. `scripts/vector-proof-result.mjs` rejects partial, duplicate, revision-mismatched or checksum/unpersisted payroll evidence. Docker admission includes `tests/vector-payroll-release-proof.test.mjs`.
- **Tests:** red 0/2 before the classifier change. Fresh local sealed-runtime regression run: 25 passed, 0 failed, 0 skipped; both changed scripts passed Node syntax checks.
- **Published evidence:** head `3953eb7628ba5e5c8e1dcdd0fc8b9729d796e531`; blobs `375ba391f40ea246f0343a309b267376419bd9f6` (test), `bfaec1b0c53fed477a64feb08de1fb38d506d4df` (classifier), `2893a2891a4a562014d30680723aa96c91a063f5` (browser verifier), `612aa1bd0a4cd449b43fdae0b65706d36080a63d` (Dockerfile).
- **Deployment/proof:** **BUILT**, not hosted **PROVEN**. Chromium was unavailable locally. GitHub Customer Proof Gate run 36318966536 failed before execution with no steps or logs; Railway success contexts are build/deployment signals only.
- **Safety:** no customer, production, payroll-provider, DNS, infrastructure or persistent fixture mutation. No jurisdiction claim and no realised-savings claim.
- **Scale/global:** team discovery is data-driven with no fixed hierarchy depth; the present synthetic fixture still contains four teams and 172 export rows, so larger-scale performance remains unproved.
- **Dependencies:** exact-candidate browser execution and release identity binding remain separate Trust/Proof work.
- **Next action:** execute this exact deployed browser journey; if it passes, preserve the batch across a safe restart and verify role/tenant denial on its export without changing the serving SHA.
- **Active-work check:** built from completed compatible head `0ff5e3b4ce5172711a225fdd6a6d800dc726ecbc`; no in-flight deployment or migration was interrupted.


## 2026-09-28 — payroll blocker task compression

- **Objective:** reduce the high-frequency manager path from Payroll preparation to the exact next incomplete weekly team without bypassing source review.
- **Acceptance:** an authorised manager sees one contextual action for the first source-returned incomplete team; one action selects that exact team and opens Weekly sign-off; stale/signed or out-of-scope team identifiers are refused; payroll-only users cannot acquire the action; weekly sign and payroll release gates remain unchanged.
- **Implementation:** `ux-overlay/vector-workflows.js` now derives the next reviewable team from the authenticated payroll report and exposes `next-review` only to manager-review roles. The action revalidates the team in both payroll and weekly-review scopes before changing UI context. It performs no business mutation.
- **Task compression:** the normal blocker path falls from two controls (open Weekly sign-off, then find/select a team) to one contextual control, removing team hunting while preserving the same stable navigation and destination.
- **Tests:** fail-first customer-effort regression reproduced the missing action. Final focused controller/syntax checks passed 2/2; the affected local sealed-runtime suite passed 25/25 with zero skips. Adversarial assertions cover out-of-scope IDs and payroll-only role denial. The larger `vector-workflows.test.cjs` integration suite was not rerun in this partial checkout because its local runtime composer source set is absent; the added regression remains in that canonical suite for full-checkout admission.
- **Published evidence:** source commit `d7aa40bdcb0635ecf63ee1d3078236c74711b9cf`; blobs `695d4980ecc4a1008b6c20a3b87e708f18fc88d5` (controller) and `cffc29061aba0d593862ee2435a4a870291242f8` (regression).
- **Status:** **BUILT**, not hosted **PROVEN**. No customer, production, payroll-provider, deployment, DNS, infrastructure or persistent fixture mutation occurred.
- **Scale/global:** the action is derived from returned team IDs and names with no fixed site, entity or hierarchy count. The focused fixture used two teams and the retained affected suite covers the existing four-team/172-row payroll proof; large-estate UI/performance remains unproved.
- **Outcome/savings:** no financial saving is claimed. The measurable product hypothesis is one fewer control plus zero manual team search per incomplete-team entry.
- **Dependencies:** exact-candidate hosted browser evidence, refresh/new-login behavior, accessibility, and large-team-list performance remain Trust/Proof work.
- **Next action:** execute the exact hosted manager journey from Payroll preparation into the selected incomplete team, assert the served SHA, visible selection, unchanged sign/release holds and keyboard/screen-reader naming, then retain the measurement only if the one-action path passes.
- **Active-work check:** PR #225 was still open/draft and unchanged at `bc333a24382a0a1017f7fe6dfe8d5253d4129b6a` before editing; no deployment or migration was in flight or interrupted.

## 2026-09-28 — payroll export content binding

- **Reproduced false green:** a semantically different CSV with a freshly recomputed checksum, unchanged batch/audit/fresh-login IDs, the expected row count and `reconciliationOk=true` was accepted as payroll proof. Fail-first result: 2/3 passed, 1/3 failed, 0 skipped.
- **BUILT repair:** the browser verifier now reconstructs the server CSV contract from the authoritative pre-release payroll lines, compares the complete downloaded text byte-for-byte, and independently binds both SHA-256 values. The proof classifier requires this authoritative checksum and reports `payroll-export-content-reconciliation` when it is missing or mismatched. Both Docker admission paths include the shared CSV proof module; the main proof stage includes its regression.
- **Fresh focused verification:** three syntax checks and 8/8 tests passed with zero failures or skips. Literal server-contract output, quote escaping, spreadsheet-formula refusal, self-consistent wrong-content rejection, all-team sign-off and exact-revision regressions are covered.
- **Exact boundary:** the payroll verifier files were selected at PR head `bc333a24382a0a1017f7fe6dfe8d5253d4129b6a` and confirmed unchanged through integration parent `86acdd5424b7570b3bea8e6d1549ea1203d7c8e0`; sealed runtime SHA-256 is `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da` and server payroll-control SHA-256 is `ec5fa3cd5cb2bc4d2e66694b6211ad3dc8c24ea279bd48b0bc0fa01260eb1200`. Evidence: `evidence/payroll-export-content-binding-20260928.json`.
- **Claim:** **BUILT** in the local synthetic verifier only. Chromium, a Docker build and hosted exact-candidate execution did not occur in this checkpoint; Docker CLI is unavailable in this workspace.
- **Release:** customer release and the marketing video remain **BLOCKED**. Existing leave-audit substitution, in-flight payroll authority, post-approval payroll substitution and exact hosted/restart gates remain unchanged.
- **Safety:** no live deployment, customer/payroll mutation, provider handoff, restart, DNS, credential or infrastructure action occurred.


## 2026-09-28 — source-bound weekly-review continuation

- **Objective:** remove repeated hunting across exceptions, review sections, employee totals and the final signature while retaining every mandatory evidence check.
- **Acceptance:** one manager-only control opens the next existing required action in source order; opening it cannot resolve, confirm, verify or sign anything; signed/stale teams expose no continuation; payroll-only roles cannot render or execute it.
- **Implementation:** `ux-overlay/vector-workflows.js` derives a next-required action from the authenticated selected team: open source exception → reviewable unconfirmed category → unchecked employee when blockers are clear → existing sign workflow. `continue-review` recalculates the action from current in-memory source readback on every click and delegates to the existing modal/action; it performs no mutation itself.
- **Task compression:** the next required task now has one stable first-click target rather than requiring the manager to interpret and search up to all returned issue/category/employee rows. Exact time and click savings remain a hosted-browser measurement, not a claim.
- **Tests:** fail-first regression reproduced the missing continuation. A second red-first attack exposed payroll-only rendering and was repaired. Fresh final checks: 3/3 focused controller checks plus 25/25 affected sealed-runtime tests passed, zero failures or skips; both changed files passed Node syntax checks.
- **Published evidence:** source commit `42b9669080341e605abe8fe9385595e83825a3a1`; blobs `5c01a2c381c838a45e467e32904ff10d05541107` (controller) and `42a277d066a2bb636e2e6b294275e788982c85ce` (regression).
- **Status:** **BUILT**, not hosted **PROVEN**. No customer, production, payroll-provider, DNS, infrastructure or persistent fixture mutation was performed.
- **Scale/global:** routing is derived from returned arrays and Unicode labels without fixed employee, site, entity or hierarchy counts. The focused fixture includes a Unicode employee name; the retained affected suite covers four teams and 172 export rows. Large-estate performance and locale-specific browser rendering remain unproved.
- **Outcome/savings:** no financial or realised time saving is claimed. The measurable hypothesis is one fixed first-click target and no manual next-row selection for each required review stage.
- **Dependencies:** exact-candidate browser execution must verify focus order, accessible naming, mobile/tablet layout, source refresh between actions, fresh login and unchanged sign/payroll holds.
- **Next action:** exercise the complete continuation sequence on the exact hosted candidate and capture per-step first-click success, route/action identity, source readback and final unchanged release controls.
- **Active-work check:** PR #225 advanced only through the compatible payroll-export proof commit `a2dd28fd02e7467a5a79b8a36f0d4877ec5366bd`; it did not touch the owned workflow files. No deployment or migration was interrupted.

## 2026-09-28 — immutable leave-decision correlation

- **Reproduced false green:** on sealed runtime SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`, mutable tenant JSON and its ordinary leave audit note were rewritten together from declined to approved. The append-only command audit survived but bound only version and request ID; after restart VECTOR returned HTTP 200 and presented the substituted approval. Fail-first result: 0/1 passed, 1/1 failed, 0 skipped.
- **BUILT repair:** every new leave decision receives an append-only version-1 seal binding request, employee, decision, reviewer, review time and reason plus an independently recomputable SHA-256 digest. Every read re-correlates sealed evidence with mutable state and fails closed with HTTP 503 on missing, substituted or digest-mismatched state. A tenant/action audit index bounds the correlation query, and Docker proof admission now executes the real server/SQLite restart-and-tamper regression.
- **Fresh focused verification:** an untampered sealed decline survived controlled restart and returned HTTP 200; the joint state/audit substitution was rejected after restart with HTTP 503. Final result: 2/2 passed, 0 failed, 0 skipped on Node v22.23.2. Evidence: `evidence/leave-decision-immutable-correlation-20260928.json`.
- **Boundary:** **BUILT** in the local synthetic exact-runtime lane, not hosted **PROVEN**. Legacy decisions lacking a version-1 seal remain explicitly unverified and need reviewed reconciliation/migration before release. Full-database replacement or trigger-removal resistance requires external immutable evidence and recovery controls.
- **Release:** this closes the newly created leave-decision correlation gate for sealed post-repair decisions only. Docker execution, exact hosted identity, legacy-decision migration, durable restore and the complete approved browser journey remain **BLOCKED**; the marketing video is not ready.
- **Safety:** no live deployment, customer/payroll/provider mutation, restart, DNS, credential or infrastructure action occurred.

## 2026-09-28 — legacy leave-decision quarantine

- **Reproduced upgrade false green:** a decline was created on the unmodified sealed runtime, producing the historical append-only shape `{version,resultId}`. After applying the immutable-evidence hardener and restarting the same SQLite database, VECTOR still returned HTTP 200 and treated the unsealed decision as authoritative. Fail-first result: 0/1 passed, 1/1 failed, 0 skipped.
- **BUILT repair:** reads now require every approved or declined leave request to have exactly one version-1 append-only seal. Legacy rows, missing seals, mismatched generic/sealed IDs and duplicate seals fail closed with HTTP 503. There is intentionally no automatic backfill because copying mutable historical fields into a new seal would manufacture trust.
- **Fresh focused verification:** 3/3 passed, 0 failed, 0 skipped on Node v22.23.2. Untampered sealed decision restart returned HTTP 200; jointly rewritten sealed state returned 503; pre-seal database upgrade returned 503. The existing Docker proof-stage command executes the expanded real server/SQLite test file.
- **Boundary:** **BUILT** in the local synthetic exact-runtime lane, not hosted **PROVEN**. Any real legacy record requires separately authorised reviewed reconciliation or explicit quarantine using independent evidence before promotion.
- **Release:** silent acceptance of legacy leave decisions is closed locally. Full Docker execution, an authorised legacy-data inventory/reconciliation, exact hosted identity, current-build controlled restart and the complete approved browser journey remain **BLOCKED**.
- **Evidence:** `evidence/leave-decision-legacy-quarantine-20260928.json`.
- **Safety:** no live deployment, customer/payroll/provider mutation, restart, DNS, credential or infrastructure action occurred.

## 2026-09-28 — passkey-first normal sign-in

- **Reproduced authentication gap:** executing the real `company-ui.js` from sealed runtime SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da` rendered a populated password field, while `POST /api/passkeys/register/options` returned 404. Fail-first result: 0/2 passed, 2/2 failed, 0 skipped.
- **BUILT repair:** the normal sign-in view renders no password field or password wording and invokes the browser WebAuthn ceremony. The server now stores P-256/ES256 public credentials and requires one-time challenges, exact Origin and RP binding, user presence, user verification, signature verification and an advancing non-zero authenticator counter. Registration challenges are also bound to the already authenticated session; audit records retain only a hashed credential reference.
- **Fresh focused verification:** 2/2 passed, 0 failed, 0 skipped on Node v22.23.2. The executed UI offered `Continue with passkey`; hostile Origin and an assertion lacking user verification were rejected with HTTP 403; an independently generated P-256 assertion created an authenticated session; exact replay was rejected. The leave hardener followed by the passkey hardener also passed syntax checks against a fresh exact-runtime extraction.
- **Boundary:** **BUILT** in the local synthetic exact-runtime lane, not hosted **PROVEN**. This proof covers a single account/runtime and does not establish attestation policy, enterprise federation, multi-device credentials, large-scale authentication, or regional recovery.
- **Release:** customer release remains **BLOCKED**. Existing accounts have no proven no-password enrollment, recovery, credential replacement/revocation or hosted ceremony. The legacy password API remains solely as an unexposed migration bootstrap and has not been retired. The next gate is an independently approved passwordless enrollment/recovery flow followed by exact-build hosted register → sign out → passkey sign in → refresh/new-login proof.
- **Evidence:** `evidence/passkey-first-authentication-20260928.json`; runtime overlay `scripts/harden-passkey-auth.mjs`; executable proof `tests/passkey-authentication.proof.test.cjs`.
- **Safety:** no live deployment, customer/payroll/provider mutation, restart, DNS, credential or infrastructure action occurred.

## 2026-09-28 — password-free proof-runner identity

- **Reproduced proof bottleneck:** the exact sealed runtime had no machine/workload session exchange. A proof runner calling its intended challenge endpoint reached the authenticated catch-all and returned HTTP 401, so automation still depended on first acquiring a human session. Fail-first result: 0/1 passed, 1/1 failed, 0 skipped.
- **BUILT repair:** an explicitly enabled proof runner can answer a one-time 30-second challenge with an Ed25519 signature and exchange it for a 30–300 second session. Tenant, account, role and allowed method/path pairs come only from server configuration; the runner cannot self-assert them. Every protected request rechecks the current key, account/tenant binding and exact allowlist. Issuance creates append-only audit evidence containing runner ID, account, expiry, route count and a hashed session reference.
- **Fresh exact-runtime verification:** the focused proof passed 1/1 with zero skips. The two-minute session reached its sole allowed route, received HTTP 403 on a disallowed mutation, rejected exact exchange replay, persisted bounded session metadata and audit evidence, then failed closed with HTTP 503 after the runner identity was disabled and the runtime restarted.
- **Affected security regression:** 5/5 passed, zero failures/skips: immutable leave-decision tamper refusal, legacy-decision quarantine, password-free normal sign-in, passkey Origin/user-verification/replay controls and the new proof-runner exchange. Both changed files passed Node syntax checks.
- **Boundary:** **BUILT** in the local synthetic exact-runtime lane, not hosted **PROVEN**. This is a proof-only workload identity, not customer authentication and not a production backdoor. Hosted key custody/rotation, exact Golden Journey route scope, concurrent runners and OIDC/provider federation remain unproved.
- **Release:** customer readiness remains **BLOCKED** until this identity is independently configured in the approved hosted synthetic lane and executes the exact deployed Golden Journey. After the run, disabling/removing the identity must immediately deny the bearer while retaining audit evidence.
- **Evidence:** `evidence/proof-runner-workload-identity-20260928.json`; overlay `scripts/harden-proof-runner-identity.mjs`; proof `tests/proof-runner-workload-identity.proof.test.cjs`.
- **Safety:** no live deployment, customer/payroll/provider mutation, restart, DNS, credential or infrastructure action occurred.

## 2026-09-28 — proof-runner atomic action budget

- **Reproduced missing containment:** the proof-only workload configuration rejected `actionBudget` as unsupported, confirming that a stolen otherwise-valid two-minute bearer had no server-enforced action-count ceiling. Fail-first result: 0/1 passed, 1/1 failed, 0 skipped.
- **BUILT repair:** each configured runner now has a mandatory 1–100 request budget copied into its session and issuance audit. Exact route scope is checked first; one atomic SQLite update then consumes one allowed action. With budget 1, two concurrent permitted requests produced exactly one HTTP 200 and one HTTP 429; a disallowed mutation still returned 403 without consuming authority; all later allowed attempts remained 429. Exhaustion produced exactly one append-only audit event.
- **Fresh local verification:** focused proof passed three consecutive fresh-store runs. The affected security suite passed 6/6 with zero failures/skips, covering leave evidence tamper/quarantine, passkey UI and ceremony controls, proof-runner concurrency/replay/scope/kill-switch controls and domain-audit request binding. The overlay applied twice to a fresh sealed extraction and the resulting server passed syntax validation.
- **Exact boundary:** sealed runtime SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`; selected PR #225 parent `4458196e879ddcc796a654c2d48aa91bdcf3c27a`; changed-file SHA-256 values are preserved in `evidence/proof-runner-action-budget-20260928.json`. Execution used Node v24.19.0 because Node v22.23.2 and Docker were unavailable in this workspace, so this is local synthetic **BUILT**, not exact-release or hosted **PROVEN**.
- **Release:** customer readiness remains **BLOCKED** until the same test passes inside the exact Node 22.23.2 Docker candidate and an independently controlled hosted identity executes a minimally budgeted Golden Journey on the deployed SHA. Key custody/rotation, OIDC federation and hosted concurrent-runner isolation remain unproved.
- **Safety:** no live deployment, customer/payroll/provider mutation, restart, DNS, credential or infrastructure action occurred.

## 2026-09-28 — proof-runner atomic burst-rate containment

- **Reproduced missing containment:** the proof-only workload configuration rejected `maxRequestsPerSecond` as unsupported. The short-lived session had an overall action budget but no server-enforced control preventing an allowed bearer from bursting that entire budget at once. Fail-first result: 0/1 passed, 1/1 failed, 0 skipped.
- **BUILT repair:** each runner now requires a 1–20 requests-per-second ceiling. One atomic SQLite update checks and consumes both the current rate window and total action budget after exact-route authorization. In the test, two simultaneous same-window allowed calls produced exactly one HTTP 200 and one HTTP 429; the out-of-scope mutation remained HTTP 403 without consuming authority; two later-window actions succeeded; the fourth total allowed attempt returned 429 for budget exhaustion.
- **Detection:** one `proof-runner-rate-limited` append-only event was emitted for the rejected window without duplicate event flooding; total-budget exhaustion remained separately audited once. Issuance evidence now records both server-configured limits.
- **Fresh local verification:** focused proof passed three consecutive fresh-store runs. The affected security suite passed 6/6 with zero failures/skips. The overlay applied twice to a fresh sealed extraction and the resulting server passed syntax validation.
- **Exact boundary:** sealed runtime SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`; selected PR #225 parent `c531dbb5510281ac17969a0f8fec0f5411047aab`; hashes are in `evidence/proof-runner-rate-limit-20260928.json`. Execution used Node v24.19.0 because Node v22.23.2 and Docker were unavailable, so this is local synthetic **BUILT**, not exact-release or hosted **PROVEN**.
- **Release:** customer readiness remains **BLOCKED** pending exact Node 22.23.2 Docker execution and hosted multi-instance proof. The current SQLite session counter is authoritative only within one runtime/database; cross-region or independently sharded enforcement remains unproved.
- **Safety:** no live deployment, customer/payroll/provider mutation, restart, DNS, credential or infrastructure action occurred.

## 2026-09-28 — proof-runner monotonic authority contraction

- **Reproduced post-compromise gap:** a bearer issued with 120 seconds, three actions and three requests per second was persisted across restart under configuration reduced to 30 seconds, one action and one request per second. The request path rechecked the key, account, tenant and routes but retained the larger issuance-time limits, so both concurrent requests returned HTTP 200. Fail-first result: 1/2 passed, 1/2 failed, 0 skipped.
- **BUILT repair:** before every protected action, persisted expiry, total action budget and request rate are contracted to the lower of the issuance-time value and current trusted configuration. The contraction is persisted and enforced on that same request; a later configuration expansion cannot enlarge an existing session. If reduced expiry is already past, the request fails closed with HTTP 401.
- **Detection:** each real contraction emits one append-only `proof-runner-session-contracted` event with a hashed session reference and previous/effective limits. The concurrent test produced one event, not duplicate audit noise.
- **Fresh local verification:** three consecutive fresh-store focused runs each passed 2/2. The affected security suite passed 7/7 with zero failures/skips. The overlay applied twice to a fresh sealed extraction and the resulting server passed syntax validation.
- **Preserved harness failure:** the first final-suite invocation misbound the proof-runner overlay to `WFM_LEAVE_AUDIT_HARDENER`; six fixtures stopped at the passkey prerequisite before candidate execution (1/7 passed, 6/7 failed). The corrected explicit bindings produced the 7/7 result above. The failed invocation is not product evidence.
- **Exact boundary:** sealed runtime SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`; selected PR #225 parent `b4916d60a3d0fa4be98feab1d1e3608f512e4a9d`; hashes are preserved in `evidence/proof-runner-authority-contraction-20260928.json`. Execution used Node v24.19.0 because Node v22.23.2 and Docker were unavailable, so this is local synthetic **BUILT**, not exact-release or hosted **PROVEN**.
- **Release:** customer readiness remains **BLOCKED** pending exact-runtime Docker execution and hosted propagation proof across every active instance. Immediate configuration delivery without restart, multi-region convergence and OIDC/provider federation remain unproved.
- **Safety:** no live deployment, customer/payroll/provider mutation, restart, DNS, credential or infrastructure action occurred.

## 2026-09-28 — proof-runner exact-key rotation revocation

- **Reproduced credential-rotation gap:** a proof-runner session was issued with one Ed25519 key, then the runtime restarted with a different trusted public key under the same runner ID. The old bearer still reached `GET /api/bootstrap` with HTTP 200 because the session was bound only to the runner ID. Fail-first result: 2/3 passed, 1/3 failed, 0 skipped.
- **BUILT repair:** issuance now persists the SHA-256 fingerprint of the exact DER public key that verified the workload assertion. Every protected request compares it with the currently trusted key before consuming scope, rate or action authority. A mismatch—or a legacy proof-runner session without a fingerprint—fails closed with HTTP 401.
- **Detection:** the first stale-bearer attempt records one append-only `proof-runner-credential-revoked` event containing only the hashed session reference and runner ID. A second attempt remained 401 without creating duplicate audit noise.
- **Fresh local verification:** three consecutive fresh-store focused runs each passed 3/3. The affected security suite passed 8/8 with zero failures/skips. The overlay applied twice to a fresh sealed extraction and the resulting server passed syntax validation.
- **Exact boundary:** sealed runtime SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`; selected PR #225 parent `76b9e636cd3f19f6a99c8c7b6eb0a5fe53019ec6`; hashes are preserved in `evidence/proof-runner-key-rotation-revocation-20260928.json`. Execution used Node v24.19.0 because Node v22.23.2 and Docker were unavailable, so this is local synthetic **BUILT**, not exact-release or hosted **PROVEN**.
- **Release:** customer readiness remains **BLOCKED** pending exact Node 22.23.2 Docker execution and hosted rotation propagation across every active instance. Hosted key custody, rotation atomicity and OIDC/provider federation remain unproved.
- **Safety:** no live deployment, customer/payroll/provider mutation, restart, DNS, credential or infrastructure action occurred.

## 2026-09-28 — proof-runner account-authority snapshot revocation

- **Reproduced privilege-escalation gap:** a proof-runner bearer was issued while its linked account was a manager with costs access and no extra permissions. After restart, the account was changed to administrator, retained costs access and gained `system.admin`. The old bearer returned HTTP 200 and inherited the elevated role and permission. Fail-first result: 3/4 passed, 1/4 failed, 0 skipped.
- **BUILT repair:** issuance now fingerprints normalized account, tenant, person identifiers, role, costs flag and sorted unique permissions. Every protected request compares the current actor with that issuance snapshot before consuming route, rate or action authority. Any change—or a legacy proof session without the snapshot—fails closed with HTTP 401.
- **Detection:** the first stale-authority attempt records one append-only `proof-runner-authority-revoked` event containing only the hashed session reference and runner ID. A second attempt remained 401 without duplicate audit noise.
- **Fresh local verification:** three consecutive fresh-store focused runs each passed 4/4. The affected security suite passed 9/9 with zero failures/skips. The overlay applied twice to a fresh sealed extraction and the resulting server passed syntax validation.
- **Exact boundary:** sealed runtime SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`; selected PR #225 parent `ea175fd7f6609c4d359edf9b76cc28c3addcaccf`; hashes are preserved in `evidence/proof-runner-authority-snapshot-revocation-20260928.json`. Execution used Node v24.19.0 because Node v22.23.2 and Docker were unavailable, so this is local synthetic **BUILT**, not exact-release or hosted **PROVEN**.
- **Release:** customer readiness remains **BLOCKED** pending exact Node 22.23.2 Docker execution and hosted role/permission propagation across every active instance. Dedicated proof-account governance and OIDC/provider federation remain unproved.
- **Safety:** no live deployment, customer/payroll/provider mutation, restart, DNS, credential or infrastructure action occurred.

## 2026-09-28 — proof-runner expected-role issuance binding

- **Reproduced fresh-issuance privilege gap:** the linked manager account was changed to administrator before the proof-runner challenge exchange, retaining its existing costs access and gaining `system.admin`. The valid workload assertion returned HTTP 200 and created a session because server configuration did not state which account role was authorised. Fail-first result: 4/5 passed, 1/5 failed, 0 skipped.
- **BUILT repair:** every proof-runner key now requires a trusted server-configured role. After signature, audience, nonce and lifetime verification, session exchange requires exact email, tenant and role agreement before creating authority; mismatch returns HTTP 503. The regression also proves zero proof-runner sessions and zero issuance audit events after denial.
- **Defence in depth:** the prior issuance-time authority fingerprint remains in force, so later role, costs or permission changes still revoke an existing bearer with HTTP 401. Exact-key binding, route intersection, monotonic contraction, budgets, rate limits, replay denial and kill switch remain unchanged.
- **Fresh local verification:** three consecutive fresh-store focused runs each passed 5/5. The affected security suite passed 10/10 with zero failures/skips. The overlay applied twice to a fresh sealed extraction, and the resulting server plus both changed files passed syntax validation.
- **Preserved harness failures:** the initial focused run omitted the explicit sealed-artifact path and stopped 0/5 at ENOENT. The first affected-suite run used the newer artifact variable but omitted the legacy test's `WFM_TEST_RUNTIME_ARCHIVE`; nine reached tests passed and one stopped at tar ENOENT. Neither run is product evidence.
- **Exact boundary:** sealed runtime SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`; selected PR #225 parent `2804b24e68eec1e798d08d37d200a15ecc2171cd`; hashes are preserved in `evidence/proof-runner-expected-role-binding-20260928.json`. Execution used Node v24.19.0 because Node v22.23.2 and Docker were unavailable, so this is local synthetic **BUILT**, not exact-release or hosted **PROVEN**.
- **Release:** customer readiness remains **BLOCKED** pending exact Node 22.23.2 Docker execution and hosted denial before session creation on every active instance after an unexpected proof-account role change. Hosted role governance, propagation and identity-provider federation remain unproved.
- **Safety:** no live deployment, customer/payroll/provider mutation, restart, DNS, credential or infrastructure action occurred.

## 2026-09-28 — proof-runner complete capability-policy binding

- **Reproduced same-role privilege gap:** the configured account remained a manager with its normal costs access, but `system.admin` was injected before proof-runner challenge exchange. The valid workload assertion returned HTTP 200 and created a session because trusted configuration stated the role but not the allowed costs flag or permission set. Fail-first result: 5/6 passed, 1/6 failed, 0 skipped.
- **BUILT repair:** every proof-runner key now requires a boolean costs value and explicit normalized permission array. After cryptographic assertion verification, linked email, tenant, role, costs and exact permission set must all match before a session or issuance audit can exist; mismatch returns HTTP 503. Permission identifiers are deduplicated, sorted, bounded and validated.
- **Proof-integrity correction:** the seeded manager already had costs access before the earlier escalation tests. The prior authority-snapshot and expected-role evidence plus this checkpoint now distinguish that baseline from the observed role and `system.admin` escalation. No failure or result was removed.
- **Fresh local verification:** three consecutive fresh-store focused runs each passed 6/6. The affected security suite passed 11/11 with zero failures/skips. The overlay applied twice to a fresh sealed extraction, and the resulting server plus changed files passed syntax validation.
- **Exact boundary:** sealed runtime SHA-256 `dd0b0d5673247cc64c59c0cd873a1b413129e905a19f05c7f2d863f1ad0555da`; selected PR #225 parent `581fc6908624de7bc5e657ed3f2a2fef6c285d8e`; hashes are preserved in `evidence/proof-runner-capability-policy-binding-20260928.json`. Execution used Node v24.19.0 because Node v22.23.2 and Docker were unavailable, so this is local synthetic **BUILT**, not exact-release or hosted **PROVEN**.
- **Release:** customer readiness remains **BLOCKED** pending exact Node 22.23.2 Docker execution and hosted denial before session creation on every active instance when costs or permissions differ from trusted policy. Hosted capability governance, propagation and identity-provider federation remain unproved.
- **Safety:** no live deployment, customer/payroll/provider mutation, restart, DNS, credential or infrastructure action occurred.
