# Sign-to-workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect a short, resumable questionnaire to reviewed automatic workspace configuration and the existing secure owner flow.

**Architecture:** Adapt the existing compiler behind the current implementation run. Store drafts separately from applied scope, apply through existing ownership fencing, and adopt Dot's profile/access slice at explicit interfaces.

**Tech Stack:** Node 22.23.2, node:sqlite, CommonJS runtime overlays, existing JavaScript UI and Docker admission.

**Spec:** `docs/superpowers/specs/2026-10-11-sign-to-workspace-design.md`

## Global Constraints

- Preserve the existing application, tenant/run model, owner fencing, 21-control release and policy-authority paths.
- No live customer accounts or credentials are created by development or tests.
- Deferred integrations are recorded as deferred, never configured or proven.
- Questionnaire role selections describe training needs and never grant permissions.

## Review Focus

- A contract for a different run must not take over an existing tenant environment.
- An audit failure must undo the associated configuration write, including inside a shared transaction.
- Stale drafts and stale deployment reviews must not apply or overwrite current configuration.
- A completed questionnaire must not grant access, invent policy authority or pass integrations.
- Reload/retry after interrupted application must preserve the prior configuration and a recoverable draft.

### Task 1: Provisioning consistency

**Files:** `implementation/runtime/tenant-environment-provisioner.cjs`, its existing test file.
**Interfaces:** Preserve `provision({tenant,runId,scope})` and `statusForTenant(tenant)`; reject a different run, preserve validated workforcePartition, and use a nested-safe atomic savepoint.

- [x] Add failing real-SQLite tests for different-run conflict, creation/update audit failures, outer rollback and partition preservation.
- [x] Run the tests and record expected failures on the base.
- [x] Implement the smallest binding/normalization/transaction correction.
- [x] Run provisioner, work-fencing and implementation engine tests.

### Task 2: Revisioned compiler-backed setup

**Files:** New `implementation/runtime/workspace-setup.cjs` and tests; `one-day-enterprise-engine-core.cjs` route integration and focused tests.
**Interfaces:** `createWorkspaceSetup({db,compiler,candidateSha,deploymentId})` supplies draft read/save and reviewed application using an injected synchronous application callback inside the same transaction. Drafts bind tenant/run/revision/baseScopeDigest/source/deployment; application returns the persisted environment digest.

- [ ] Write real-compiler/SQLite tests for draft isolation, clarification, validation, revision conflicts, prior scope changes, audit/application failure, replay and restart.
- [ ] Record RED, implement draft and review logic, then verify GREEN.
- [ ] Add authenticated current-run routes and prove unauthenticated, employee and cross-tenant requests cannot read/apply another draft.
- [ ] Ensure the existing scope/environment/audit boundary rolls back together without bypassing work ownership.

### Task 3: Current-screen questionnaire and review

**Files:** `implementation/ui/implementation-journey.js`, associated UI tests and styling if necessary.
**Interfaces:** Consume the current-run setup routes; show four question groups, saved draft, clarification, review, application result and separate operational readiness.

- [ ] Write failing rendered/request-flow tests for save, resume, review, conflict and failed apply.
- [ ] Implement the form/review flow with preserved user input and honest status labels.
- [ ] Verify the existing readiness presentation regressions remain green.

### Task 4: Profile/access adoption and full proof

**Files:** Dot's reviewed patch plus coordinated `security/runtime/bootstrap.cjs`, Dockerfile and composition tooling.
**Interfaces:** Verified signing event binds the existing tenant/run/profile to first-owner verification; account and invitation creation remain in Dot's reserved module.

- [ ] Review Dot's exact base, patch, interfaces and tests before adoption.
- [ ] Wire the real compiler and new modules into local and hosted composition.
- [ ] Prove a new isolated owner can enter setup; run duplicate/invalid signature, interruption and rollback cases.
- [ ] Obtain independent review, exact-source full runtime CI and final deployment/readback within the authorised scope. Report any unavailable live signing/customer inputs separately from code completion.
