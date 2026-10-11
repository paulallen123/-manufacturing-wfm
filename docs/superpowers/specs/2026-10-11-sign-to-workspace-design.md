# Sign-to-workspace onboarding

The customer should enter one permanent secure workspace after a verified signing event, answer a short organisation questionnaire once, review the resulting setup, and continue into guided implementation and daily operations. Workspace access and operational readiness are separate states. Integrations may be configured later; deferral never passes an existing readiness control.

Paul's create-once requirement (relayed by Dot at 22:09 UTC): repeated signing events, renewals, logins and retries reuse the authoritative customer's permanent workspace and immutable initialSetupRunId. Contracts and renewals are separate linked records and cannot rebind the workspace, recreate owner access or reset questionnaire completion. An unfinished questionnaire resumes; a completed one stays completed, with later changes confined to settings or targeted questions. Account setup labels must not be used as questionnaire state. Wrong-customer and wrong-run guards remain intact.

Base: `8632e5bb5c84e4fc258311d31d973714be169866`, tree `8f46735489ecfde8ccf38722646df361f532dd02`. Preserve the existing application, tenant/run model, owner fencing, 21-control release and policy-authority paths. No live customer accounts or credentials are created by development or tests.

## Boundaries

Dot's isolated task owns organisation profile creation, verification of the first owner and secure access/invitation primitives. This execution workspace owns the current Implementation UI, configuration compiler adapter, revisioned drafts, application integration and tenant-environment consistency. Bootstrap/Docker composition are shared adoption seams controlled here. The final signing ingress must consume an independently verified event and its server-bound contract/tenant/owner identity; a request saying SIGNED is not sufficient. Missing verifier/provider configuration must fail closed. The final acceptance journey must enrol and sign in a new test owner, not reuse the demo director.

## Configuration flow

Reuse the sealed `lib/configuration-compiler.cjs` through dependency injection from the existing runtime. Do not duplicate its compilation or its legacy autopilot progression. The permanent workspace's initial setup run owns one revisioned setup draft; the existing scope and tenant-environment records remain the applied configuration. Four opening groups collect organisation/sites, workforce/languages/pattern count, requested capabilities/training roles, and systems to connect now or later. Site timezones must be real IANA zones. Questionnaire role selections describe training needs and never grant permissions.

Saving produces a resumable draft and targeted clarification questions. It does not change the applied scope, users, policies, payroll or readiness evidence. Revision and base applied-scope digests prevent stale browser answers from overwriting a newer setup. The server recompiles on apply and requires the exact reviewed revision/digest. Unknown/conflicting answers remain questions rather than invented values. Existing scope updates invalidate a pending review.

An explicit review action applies only validated organisation/configuration metadata through the existing ownership-fenced provisioner. The applied scope, environment configuration, draft state and their audit records must commit atomically. Policy exceptions continue through the existing authenticated authority forms. Deferred integrations are recorded as deferred, never configured or proven. Application failure preserves the prior applied configuration and leaves a retryable draft; stale source/deployment review requires a fresh review.

## Tenant and transaction integrity

A tenant environment cannot silently move to a different implementation run. Identical repeat requests are idempotent. Provisioning with a shared database uses a savepoint so its configuration and append-only audit event succeed or fail together, including inside an outer transaction. Explicit workforce partitions are preserved and validated in the normalized configuration rather than dropped.

## Acceptance

Exercise real SQLite and the real compiler. Cover duplicate setup, different-run conflict, creation/update audit failure, enclosing transaction rollback, restart/resume, missing answers, invalid timezone, duplicate site codes, zero/invalid population, injected policy/access fields, cross-tenant/unauthorised access, stale revision, changed applied scope, failed application, replay and rollback. Render the actual UI module with its normal request flow and prove that a draft cannot claim applied/operational readiness. Run the existing relevant suites, exact-source composition and full runtime admission before canonical adoption.

This design implements the user's clarified flow and continuation instruction. It does not treat missing live signing, owner-verification or provider configuration as solved by isolated tests.
