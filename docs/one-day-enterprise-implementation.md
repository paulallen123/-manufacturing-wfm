# One-Day Enterprise Implementation Standard

Status: engineering target / proof programme. Not a production or customer claim until the full evidence gate passes.

## Product promise being engineered

A qualifying enterprise activates its contract in the morning and, within one working day, has:

- an isolated, secured tenant;
- identity and role provisioning;
- connected authoritative HR/HCM, payroll, ERP and relevant manufacturing sources;
- employees, hierarchy, sites, departments and cost structures configured at scale;
- shift, attendance, absence, approval, clocking and payroll configuration generated;
- historical replay/reconciliation evidence;
- manager/admin/payroll users certified for their privileged workflows;
- frontline users certified for first use;
- a role-aware in-product coach that continues to teach forgotten and newly introduced capability.

The implementation experience is **discover -> infer -> simulate -> prove -> ask only exceptions -> activate**.

## Non-negotiables

1. No per-employee manual setup for a clean enterprise source dataset.
2. No privileged configuration access merely because somebody completed training.
3. No payroll-sensitive or security-sensitive rule is guessed into production.
4. A high-risk inference requires historical replay and/or an explicit authorised decision.
5. Implementation READY is evidence-driven and fail-closed.
6. Customer-proof / production lanes are not mutated by experimental implementation work.
7. Human effort is spent on genuine ambiguity, not copying data between templates.

## Pre-activation readiness

The one-day clock assumes the contracting journey has already collected or scheduled:

- identity administrator authorisation;
- source-system owner consent;
- required service-account/OAuth approvals;
- tenant region/data-residency choice;
- named customer implementation owner;
- named admin/payroll/manager training cohort;
- a same-day employee learning window;
- at least one suitable historical attendance/payroll period for replay.

Missing prerequisites do not become hidden implementation work. They are shown before activation as blockers.

## Eight-hour dependency model

Work runs in parallel rather than as a consultant-style serial project.

### Early critical path

Tenant environment -> identity -> source discovery -> people/hierarchy.

Once people/hierarchy exists, four lanes start concurrently:

- structure/configuration inference;
- attendance/absence/scheduling/payroll policy inference;
- security/recovery validation;
- role learning assignment.

### Configuration lane

Imported normalized data is converted into:

- organisation structure;
- mass employee assignments and cohorts;
- manager hierarchy;
- candidate shift templates;
- break patterns;
- observed overtime/payroll policy proposals;
- exception decisions.

Structural configuration can auto-apply only at high confidence. Payroll-sensitive policy remains non-auto-applied until replay proves the outcome and the applicable evidence gate is satisfied.

### Validation lane

The system replays historical periods, compares expected and generated outcomes, exercises failure cases and records evidence. Any unexplained variance blocks READY.

### Learning lane

Learning begins as soon as each role/configuration surface is stable enough; it does not wait for implementation to finish.

- Employee: self-service, schedule, clocking, absence, corrections.
- Manager: exceptions, sign-off, absence decisions, schedule recovery, labour cost, coaching.
- Payroll: exception analysis, reconciliation, controlled export, audit.
- Admin: policy, roles, site setup, integration health, security, feature enablement, teach-back.

A quiz cannot certify competence by itself. Mastery requires practical/observed or retrieval evidence; coaching/trainer competencies additionally require teach-back evidence.

## Continuous learning

The product maintains a competence record per user/role.

Refresh is triggered by evidence such as:

- repeated contextual-help use;
- failed attempts;
- long periods since an infrequently used task;
- a role change;
- changed policy/configuration;
- a newly released feature affecting that role;
- a security/payroll workflow change.

New feature release metadata creates delta learning only for affected roles. The Guide remains unobtrusive when the user is current.

## Customer experience

The customer should normally see one implementation surface:

- overall readiness and deadline;
- completed automated work;
- only unresolved decisions;
- any external-access blocker;
- competence/training progress;
- final evidence pack.

They should not see connector internals, raw mappings, technical worker jobs or hundreds of scoping questions unless they deliberately expand advanced details.

### Pilot guidance for held workforce imports

To enable the review message on the Data Readiness card for an opted-in setup role,
set both `WFM_IMPORT_GUIDANCE_PILOT_TENANT` and `WFM_IMPORT_GUIDANCE_PILOT_ROLE`
to the exact stored tenant ID and role in the service environment. The service reads
these settings at startup. Remove either setting and restart the service to end the
pilot. Existing workspace permissions still apply. This setting changes only the
message for a held import whose prerequisites are complete.

## Current proof architecture

Current branch: `feature/one-day-enterprise-implementation-v1`

Current draft PR: #79, stacked on the Autonomous Integration Fabric.

Implemented components:

- autonomous one-day readiness control plane;
- dependency-aware critical-path/SLA model;
- adaptive role learning engine;
- teach-back gate for trainers/coaches;
- continuous help-triggered refresh;
- feature-delta learning assignment;
- in-product Guide surface;
- deterministic configuration inference for organisation, employee cohorts, shifts, breaks and observed overtime;
- synthetic one-day timing simulation;
- Docker build admission intended to execute implementation, learning, integration and theory tests.

## Claim boundary

The timing model is synthetic. GitHub Actions is currently failing before executable steps are created and the new Railway test service has not received its first deployment. Therefore the code is **not yet represented as runtime-proven**. Those infrastructure failures are tracked separately from product test results.

The next proof milestone is an executable exact-image test run followed by a customer-like replay using a large synthetic manufacturing workforce and representative integration data.
